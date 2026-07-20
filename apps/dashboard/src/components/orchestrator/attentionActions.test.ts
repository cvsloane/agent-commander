import { describe, expect, it, vi } from 'vitest';
import type { OrchestratorItem } from '@/stores/orchestrator';
import { executeAttentionResponse, type AttentionActionClient } from './attentionActions';

function item(overrides: Partial<OrchestratorItem> = {}): OrchestratorItem {
  return {
    id: 'approval-1',
    sessionId: '00000000-0000-4000-8000-000000000001',
    sessionTitle: 'Builder',
    sessionCwd: '/repo',
    sessionProvider: 'codex',
    sessionHostId: '11111111-1111-4111-8111-111111111111',
    sessionStatus: 'WAITING_FOR_APPROVAL',
    source: 'approval',
    action: {
      type: 'yes_no',
      question: 'Allow command?',
      options: [
        { value: 'allow', label: 'Allow' },
        { value: 'deny', label: 'Deny' },
      ],
      context: '',
      confidence: 1,
    },
    approval: {
      id: '00000000-0000-4000-8000-000000000002',
      session_id: '00000000-0000-4000-8000-000000000001',
      provider: 'codex',
      ts_requested: '2026-07-20T12:00:00.000Z',
      requested_payload: { tool: 'Bash', command: 'pnpm test' },
      decision: null,
      ts_decided: null,
    },
    approvalType: 'binary',
    createdAt: Date.parse('2026-07-20T12:00:00.000Z'),
    ...overrides,
  };
}

function client(): AttentionActionClient {
  return {
    decideApproval: vi.fn().mockResolvedValue(undefined),
    decideGovernanceApproval: vi.fn().mockResolvedValue(undefined),
    sendCommand: vi.fn().mockResolvedValue(undefined),
  };
}

describe('executeAttentionResponse', () => {
  it('uses the approval decision endpoint for an actionable provider approval', async () => {
    const api = client();

    await executeAttentionResponse(item(), 'allow', 'action', api);

    expect(api.decideApproval).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000002',
      { decision: 'allow', mode: 'both' }
    );
    expect(api.sendCommand).not.toHaveBeenCalled();
  });

  it('routes conversational approval prompts through terminal input', async () => {
    const api = client();
    const conversational = item({
      approval: {
        ...item().approval!,
        requested_payload: { tool: 'AskUserQuestion' },
      },
      approvalType: 'text_input',
      action: {
        type: 'text_input',
        question: 'Which option?',
        context: '',
        confidence: 1,
      },
    });

    await executeAttentionResponse(conversational, 'Option A', 'action', api);

    expect(api.sendCommand).toHaveBeenCalledWith(conversational.sessionId, {
      type: 'send_input',
      payload: { text: 'Option A', enter: true },
    });
    expect(api.decideApproval).not.toHaveBeenCalled();
  });
});
