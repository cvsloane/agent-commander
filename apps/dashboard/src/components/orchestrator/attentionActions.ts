import type {
  ApprovalDecideRequest,
  CommandRequest,
  GovernanceApprovalDecisionRequest,
} from '@agent-command/schema';
import {
  decideApproval,
  decideGovernanceApproval,
  sendCommand,
} from '@/lib/api';
import type { OrchestratorItem } from '@/stores/orchestrator';
import { buildResponse } from './DetectionEngine';

export type AttentionResponseMode = 'action' | 'waiting';

export interface AttentionActionClient {
  decideApproval: (approvalId: string, decision: ApprovalDecideRequest) => Promise<unknown>;
  decideGovernanceApproval: (
    approvalId: string,
    decision: GovernanceApprovalDecisionRequest
  ) => Promise<unknown>;
  sendCommand: (sessionId: string, command: CommandRequest) => Promise<unknown>;
}

const defaultClient: AttentionActionClient = {
  decideApproval,
  decideGovernanceApproval,
  sendCommand,
};

const NON_BLOCKING_APPROVAL_TOOLS = new Set([
  'askuserquestion',
  'exitplanmode',
  'enterplanmode',
]);

function hasNonEmptyValue(value: unknown): boolean {
  if (!value) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return false;
}

function approvalHasDecisionPayload(payload: Record<string, unknown>): boolean {
  const details = (payload.details || {}) as Record<string, unknown>;
  return [
    details.bash_command,
    payload.bash_command,
    details.command,
    payload.command,
    payload.path,
    payload.file,
    details.path,
    details.file,
    payload.args,
    details.args,
    payload.url,
    details.url,
    payload.uri,
    details.uri,
  ].some(hasNonEmptyValue);
}

function extractApprovalTool(payload: Record<string, unknown>): string | null {
  const details = (payload.details || {}) as Record<string, unknown>;
  const tool = payload.tool || payload.tool_name || details.tool || details.tool_name;
  return tool ? String(tool) : null;
}

export function shouldUseApprovalDecision(item: OrchestratorItem): boolean {
  if (!item.approval) return false;
  const requestedPayload = item.approval.requested_payload as Record<string, unknown>;
  const tool = extractApprovalTool(requestedPayload);
  if (tool && NON_BLOCKING_APPROVAL_TOOLS.has(tool.toLowerCase())) return false;

  const approvalType = item.approvalType || item.approvalInput?.type || 'binary';
  if (approvalType === 'plan_review') return true;
  if (item.sessionStatus !== 'WAITING_FOR_APPROVAL') return false;
  if (approvalType === 'text_input') return false;
  return approvalHasDecisionPayload(requestedPayload);
}

export interface AttentionDecisionOptions {
  approve: { label: string; value: string };
  deny: { label: string; value: string };
}

export function getAttentionDecisionOptions(
  item: OrchestratorItem
): AttentionDecisionOptions | null {
  if (item.source === 'governance' && item.governanceApproval) {
    return {
      approve: { label: 'Approve', value: 'approve' },
      deny: { label: 'Deny', value: 'deny' },
    };
  }
  if (item.source === 'approval' && !shouldUseApprovalDecision(item)) return null;
  if (item.action?.type !== 'yes_no' && item.approvalType !== 'plan_review') return null;

  const options = item.action?.options ?? [];
  const approve = options.find((option) => (
    ['y', 'yes', 'allow', 'approve'].includes(option.value.toLowerCase())
  ));
  const deny = options.find((option) => (
    ['n', 'no', 'deny', 'reject'].includes(option.value.toLowerCase())
  ));
  return {
    approve: {
      label: approve?.label || (item.source === 'approval' ? 'Approve' : 'Yes'),
      value: approve?.value || (item.source === 'approval' ? 'allow' : 'y'),
    },
    deny: {
      label: deny?.label || (item.source === 'approval' ? 'Deny' : 'No'),
      value: deny?.value || (item.source === 'approval' ? 'deny' : 'n'),
    },
  };
}

export async function executeAttentionResponse(
  item: OrchestratorItem,
  choice: string,
  mode: AttentionResponseMode = 'action',
  client: AttentionActionClient = defaultClient
): Promise<void> {
  if (!item.action) throw new Error('Attention details are unavailable.');

  if (item.source === 'governance' && item.governanceApproval) {
    const normalized = choice.trim().toLowerCase();
    await client.decideGovernanceApproval(item.governanceApproval.id, {
      decision: normalized.startsWith('a') || normalized.startsWith('y')
        ? 'approved'
        : 'denied',
    });
    return;
  }

  if (
    mode !== 'waiting'
    && item.source === 'approval'
    && item.approval
    && shouldUseApprovalDecision(item)
  ) {
    const approvalType = item.approvalType || item.approvalInput?.type || 'binary';
    if (approvalType === 'text_input') {
      await client.decideApproval(item.approval.id, {
        decision: 'allow',
        mode: 'both',
        payload: { updatedInput: { text: choice } },
      });
      return;
    }
    if (approvalType === 'multi_choice') {
      await client.decideApproval(item.approval.id, {
        decision: 'allow',
        mode: 'both',
        payload: { updatedInput: { selected: choice } },
      });
      return;
    }
    const normalized = choice.trim().toLowerCase();
    await client.decideApproval(item.approval.id, {
      decision: normalized.startsWith('y') || normalized === 'allow' || normalized === 'approve'
        ? 'allow'
        : 'deny',
      mode: 'both',
    });
    return;
  }

  if (!item.sessionId) throw new Error('No terminal is attached to this attention item.');
  const response = buildResponse(item.action, choice, false);
  await client.sendCommand(item.sessionId, {
    type: 'send_input',
    payload: { text: response, enter: true },
  });
}
