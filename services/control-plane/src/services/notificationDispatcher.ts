import type { Approval, AutomationRun, GovernanceApproval, Session } from '@agent-command/schema';
import { config } from '../config.js';
import { notificationRecipients } from '../db/notificationRecipients.js';
import { clawdbotNotifier } from './clawdbot.js';
import { webPushService, type WebPushNotification } from './webPush.js';

interface AttentionPayload {
  attention_reason: string | null;
  question?: string;
  confidence?: number;
  capture_hash?: string;
}

interface DispatcherDependencies {
  webPush: { send(notification: WebPushNotification): Promise<unknown> };
  openClaw: {
    queueNotification(
      userId: string,
      eventType: string,
      provider: string | null,
      message: string,
      options?: {
        isActionable?: boolean;
        sessionId?: string;
        approvalId?: string;
        status?: string;
        url?: string;
      }
    ): Promise<void>;
  };
  recipients: {
    list(preferredUserId?: string | null): Promise<string[]>;
    userForAutomationAgent(automationAgentId: string): Promise<string | null>;
  };
  baseUrl?: string;
}

function link(baseUrl: string | undefined, path: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString();
  const relative = `${path}${query ? `?${query}` : ''}`;
  return baseUrl ? `${baseUrl.replace(/\/+$/, '')}${relative}` : relative;
}

export function createNotificationDispatcher(dependencies: DispatcherDependencies) {
  async function dispatch(input: {
    preferredUserId?: string | null;
    provider?: string | null;
    eventType: string;
    openClawEventType?: string;
    dedupeKey: string;
    title: string;
    body: string;
    url: string;
    sessionId?: string;
    approvalId?: string;
    status?: string;
    actionable?: boolean;
    dedupeWindowMs?: number;
  }): Promise<void> {
    if (!dependencies.baseUrl) return;
    const userIds = await dependencies.recipients.list(input.preferredUserId);
    await Promise.all(
      userIds.map(async (userId) => {
        const message = `${input.title}\n\n${input.body}\n\nOpen Agent Command: ${input.url}`;
        await Promise.allSettled([
          dependencies.webPush.send({
            userId,
            eventType: input.eventType,
            dedupeKey: input.dedupeKey,
            title: input.title,
            body: input.body,
            url: input.url,
            tag: input.dedupeKey,
            sessionId: input.sessionId,
            actionable: input.actionable,
            dedupeWindowMs: input.dedupeWindowMs,
          }),
          dependencies.openClaw.queueNotification(
            userId,
            input.openClawEventType ?? input.eventType,
            input.provider ?? null,
            message,
            {
              isActionable: input.actionable,
              sessionId: input.sessionId,
              approvalId: input.approvalId,
              status: input.status,
              url: input.url,
            }
          ),
        ]);
      })
    );
  }

  return {
    async notifyApproval(approval: Approval, session: Session, actionable = true): Promise<void> {
      const url = link(dependencies.baseUrl, '/tmux', {
        host_id: session.host_id,
        session_id: session.id,
        mode: 'terminal',
        attach: '1',
      });
      const requested = approval.requested_payload as Record<string, unknown>;
      const tool =
        typeof requested.tool === 'string'
          ? requested.tool
          : typeof requested.tool_name === 'string'
            ? requested.tool_name
            : 'Permission';
      await dispatch({
        preferredUserId: session.user_id,
        provider: approval.provider,
        eventType: 'approval.requested',
        openClawEventType: 'approvals',
        dedupeKey: `approval:${approval.id}`,
        title: 'Approval required',
        body: `${session.title || session.id.slice(0, 8)} needs approval for ${tool}.`,
        url,
        sessionId: session.id,
        approvalId: approval.id,
        actionable,
        dedupeWindowMs: 60 * 60_000,
      });
    },

    async notifyAttention(session: Session, attention: AttentionPayload): Promise<void> {
      if (!attention.attention_reason) return;
      if (attention.attention_reason === 'waiting_approval') return;
      const isError = attention.attention_reason === 'error';
      const url = link(dependencies.baseUrl, '/tmux', {
        host_id: session.host_id,
        session_id: session.id,
        mode: 'terminal',
        attach: '1',
      });
      await dispatch({
        preferredUserId: session.user_id,
        provider: session.provider,
        eventType: isError ? 'session.error' : 'waiting_input',
        openClawEventType: isError ? 'error' : 'waiting_input',
        dedupeKey: `attention:${session.id}:${attention.attention_reason}:${attention.capture_hash ?? session.status}`,
        title: isError ? 'Session failed' : 'Session needs attention',
        body:
          attention.question || `${session.title || session.id.slice(0, 8)} is waiting for input.`,
        url,
        sessionId: session.id,
        status: attention.attention_reason,
        actionable: true,
      });
    },

    async notifyGovernance(approval: GovernanceApproval): Promise<void> {
      if (approval.status !== 'pending') return;
      const url = link(dependencies.baseUrl, '/orchestrator', {
        item: `governance:${approval.id}`,
      });
      await dispatch({
        preferredUserId: approval.user_id,
        eventType: 'governance.approval.created',
        openClawEventType: 'governance_approval',
        dedupeKey: `governance:${approval.id}`,
        title: 'Governance approval required',
        body: `An automation run needs a ${approval.type.replace(/_/g, ' ')} decision.`,
        url,
        approvalId: approval.id,
        actionable: true,
        dedupeWindowMs: 60 * 60_000,
      });
    },

    async notifyRun(run: AutomationRun): Promise<void> {
      if (run.status !== 'failed' && run.status !== 'blocked') return;
      const userId = await dependencies.recipients.userForAutomationAgent(run.automation_agent_id);
      const url = link(dependencies.baseUrl, '/orchestrator', { item: `run:${run.id}` });
      await dispatch({
        preferredUserId: userId,
        eventType: `run.${run.status}`,
        openClawEventType: `run_${run.status}`,
        dedupeKey: `run:${run.id}:${run.status}`,
        title: `Automation run ${run.status}`,
        body: run.result_summary || run.objective,
        url,
        status: run.status,
        actionable: true,
        dedupeWindowMs: 60 * 60_000,
      });
    },

    async notifyHostOffline(hostId: string, hostName?: string): Promise<void> {
      const url = link(dependencies.baseUrl, '/tmux', { host_id: hostId });
      await dispatch({
        eventType: 'host.offline',
        openClawEventType: 'host_offline',
        dedupeKey: `host:${hostId}:offline`,
        title: 'Host offline',
        body: `${hostName || hostId} disconnected from Agent Command.`,
        url,
        actionable: true,
      });
    },
  };
}

export const notificationDispatcher = createNotificationDispatcher({
  webPush: webPushService,
  openClaw: clawdbotNotifier,
  recipients: notificationRecipients,
  baseUrl: config.APP_BASE_URL,
});
