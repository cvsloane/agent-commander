import type { Approval, Session } from '@agent-command/schema';
import * as db from '../db/index.js';
import { notificationRepository, type NotificationReservationInput } from '../db/notifications.js';
import { pool } from '../db/index.js';
import { recordClawdbotNotificationDecision } from '../metrics.js';

interface ClawdbotThrottleSettings {
  maxPerHour: number;
  batchDelayMs: number;
  sessionCooldownMs: number;
}

export interface ClawdbotConfig {
  enabled: boolean;
  baseUrl?: string;
  token?: string;
  channel?: string;
  recipient?: string;
  events: Record<string, boolean>;
  providers: Record<string, boolean>;
  throttle?: ClawdbotThrottleSettings;
  actionableOnly?: boolean;
}

interface NotificationOptions {
  isActionable?: boolean;
  sessionId?: string;
  approvalId?: string;
  status?: string;
  url?: string;
}

interface QueuedNotification {
  userId: string;
  eventType: string;
  dedupeKey: string;
  message: string;
  config: ClawdbotConfig;
  options: NotificationOptions;
}

interface NotificationStore {
  reserve(input: NotificationReservationInput): Promise<{ allowed: boolean; reason?: string }>;
  recordSuccess(
    input: Pick<
      NotificationReservationInput,
      'userId' | 'channel' | 'dedupeKey' | 'sessionId' | 'actionable'
    >
  ): Promise<void>;
  recordFailure(
    input: Pick<NotificationReservationInput, 'userId' | 'channel' | 'dedupeKey'>
  ): Promise<void>;
  recordLog(input: {
    userId: string;
    channel: 'openclaw';
    eventType: string;
    dedupeKey: string;
    target?: string;
    status: 'sent' | 'failed' | 'throttled';
    attemptCount?: number;
    responseStatus?: number;
    error?: string;
    payload?: Record<string, unknown>;
  }): Promise<void>;
}

const DEFAULT_CLAWDBOT_EVENTS: Record<string, boolean> = {
  approvals: true,
  waiting_input: false,
  waiting_approval: false,
  error: true,
  snapshot_action: true,
  usage_thresholds: true,
  approval_decisions: false,
  governance_approval: true,
  run_failed: true,
  run_blocked: true,
  host_offline: true,
};

const DEFAULT_THROTTLE: ClawdbotThrottleSettings = {
  maxPerHour: 30,
  batchDelayMs: 1000,
  sessionCooldownMs: 30000,
};

const RETRY_DELAYS_MS = [250, 1000] as const;

function dedupeKey(eventType: string, options: NotificationOptions): string {
  return [eventType, options.sessionId ?? '', options.approvalId ?? '', options.status ?? ''].join(
    '|'
  );
}

function isTransient(status: number | undefined): boolean {
  return status === undefined || status === 408 || status === 429 || status >= 500;
}

export function createClawdbotNotifier(dependencies: {
  notifications: NotificationStore;
  fetch: typeof fetch;
  getSettings: (userId: string) => Promise<Record<string, unknown> | null>;
  sleep?: (milliseconds: number) => Promise<void>;
}) {
  let queue: QueuedNotification[] = [];
  let flushTimer: NodeJS.Timeout | null = null;
  const sleep =
    dependencies.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, milliseconds);
        timer.unref?.();
      }));

  async function getUserConfig(userId: string): Promise<ClawdbotConfig | null> {
    try {
      const settings = await dependencies.getSettings(userId);
      const data = (settings as { data?: { alertSettings?: { clawdbot?: ClawdbotConfig } } } | null)
        ?.data;
      return data?.alertSettings?.clawdbot ?? null;
    } catch (error) {
      console.error('[openclaw] Failed to read notification settings:', error);
      return null;
    }
  }

  async function sendOnce(
    config: ClawdbotConfig,
    message: string
  ): Promise<{
    ok: boolean;
    status?: number;
    error?: string;
  }> {
    if (!config.baseUrl || !config.token) return { ok: false, error: 'OpenClaw is not configured' };
    try {
      const response = await dependencies.fetch(
        `${config.baseUrl.replace(/\/+$/, '')}/hooks/agent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.token}`,
          },
          body: JSON.stringify({
            message,
            channel: config.channel,
            to: config.recipient,
            sessionKey: 'agent-command-alerts',
          }),
          signal: AbortSignal.timeout(10000),
        }
      );
      return {
        ok: response.ok || response.status === 202,
        status: response.status,
        ...(!response.ok && response.status !== 202 ? { error: `HTTP ${response.status}` } : {}),
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async function deliver(notification: QueuedNotification): Promise<void> {
    let attempts = 0;
    let result: Awaited<ReturnType<typeof sendOnce>> = { ok: false };
    for (;;) {
      attempts += 1;
      result = await sendOnce(notification.config, notification.message);
      if (result.ok) break;
      const delay = RETRY_DELAYS_MS[attempts - 1];
      if (!delay || !isTransient(result.status)) break;
      await sleep(delay);
    }

    const state = {
      userId: notification.userId,
      channel: 'openclaw' as const,
      dedupeKey: notification.dedupeKey,
    };
    if (result.ok) {
      await dependencies.notifications.recordSuccess({
        ...state,
        sessionId: notification.options.sessionId,
        actionable: notification.options.isActionable,
      });
    } else {
      await dependencies.notifications.recordFailure(state);
    }
    await dependencies.notifications.recordLog({
      ...state,
      eventType: notification.eventType,
      target: notification.config.baseUrl,
      status: result.ok ? 'sent' : 'failed',
      attemptCount: attempts,
      responseStatus: result.status,
      error: result.error,
      payload: {
        url: notification.options.url,
        session_id: notification.options.sessionId,
        approval_id: notification.options.approvalId,
      },
    });
  }

  async function flushPending(): Promise<void> {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    const pending = queue;
    queue = [];
    for (const notification of pending) {
      await deliver(notification);
    }
  }

  function scheduleFlush(delayMs: number): void {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      void flushPending().catch((error) => {
        console.error('[openclaw] Flush failed:', error);
      });
    }, delayMs);
    flushTimer.unref?.();
  }

  return {
    async queueNotification(
      userId: string,
      eventType: string,
      provider: string | null,
      message: string,
      options: NotificationOptions = {}
    ): Promise<void> {
      const config = await getUserConfig(userId);
      if (!config?.enabled || !config.baseUrl || !config.token) return;
      if (provider && config.providers[provider] === false) {
        recordClawdbotNotificationDecision({
          decision: 'blocked',
          reason: 'provider_disabled',
          eventType,
          provider,
        });
        return;
      }
      if ((config.actionableOnly ?? true) && options.isActionable === false) {
        recordClawdbotNotificationDecision({
          decision: 'blocked',
          reason: 'actionable_only',
          eventType,
          provider,
        });
        return;
      }
      if ((config.events[eventType] ?? DEFAULT_CLAWDBOT_EVENTS[eventType] ?? true) === false) {
        recordClawdbotNotificationDecision({
          decision: 'blocked',
          reason: 'event_disabled',
          eventType,
          provider,
        });
        return;
      }

      const throttle = config.throttle ?? DEFAULT_THROTTLE;
      const key = dedupeKey(eventType, options);
      const reservation = await dependencies.notifications.reserve({
        userId,
        channel: 'openclaw',
        dedupeKey: key,
        sessionId: options.sessionId,
        actionable: options.isActionable,
        maxPerHour: throttle.maxPerHour,
        dedupeWindowMs: options.approvalId ? 60 * 60_000 : 5 * 60_000,
        sessionCooldownMs: throttle.sessionCooldownMs,
        payload: { message, url: options.url },
      });
      if (!reservation.allowed) {
        recordClawdbotNotificationDecision({
          decision: 'blocked',
          reason:
            reservation.reason === 'rate_limit'
              ? 'rate_limit'
              : reservation.reason === 'session_cooldown'
                ? 'session_cooldown'
                : 'dedupe_key',
          eventType,
          provider,
        });
        await dependencies.notifications.recordLog({
          userId,
          channel: 'openclaw',
          eventType,
          dedupeKey: key,
          target: config.baseUrl,
          status: 'throttled',
          error: reservation.reason,
          payload: { url: options.url },
        });
        return;
      }

      recordClawdbotNotificationDecision({
        decision: 'allowed',
        reason: 'allowed',
        eventType,
        provider,
      });
      queue.push({ userId, eventType, dedupeKey: key, message, config, options });
      scheduleFlush(throttle.batchDelayMs);
    },

    flushPending,

    async sendTest(config: ClawdbotConfig): Promise<boolean> {
      const result = await sendOnce(
        config,
        'Agent Command Test Notification\n\nThis is a test from Agent Command to OpenClaw.'
      );
      return result.ok;
    },

    clearSessionState(_sessionId: string): void {
      // Dedupe and cooldown state is durable in PostgreSQL and expires by timestamp.
    },

    formatApprovalMessage(approval: Approval, session: Session | null): string {
      const requested = approval.requested_payload as Record<string, unknown>;
      return `Approval Required\n\nSession: ${session?.title || session?.id?.slice(0, 8) || 'Unknown'}\nTool: ${String(requested.tool ?? 'Permission')}\nReason: ${String(requested.reason ?? 'N/A')}`;
    },

    async notifyAllUsers(
      eventType: string,
      provider: string | null,
      message: string,
      options: NotificationOptions = {}
    ): Promise<void> {
      const result = await pool.query<{ user_id: string }>(
        `SELECT user_id
         FROM user_settings
         WHERE user_id IS NOT NULL
           AND COALESCE(
             (settings->'data'->'alertSettings'->'clawdbot'->>'enabled')::boolean,
             false
           ) = true`
      );
      for (const row of result.rows) {
        await this.queueNotification(row.user_id, eventType, provider, message, options);
      }
    },

    async notifyApprovalCreated(
      approval: Approval,
      session: Session | null,
      actionable = true
    ): Promise<void> {
      await this.notifyAllUsers(
        'approvals',
        approval.provider,
        this.formatApprovalMessage(approval, session),
        {
          isActionable: actionable,
          sessionId: approval.session_id,
          approvalId: approval.id,
        }
      );
    },

    async notifySessionError(session: Session, actionable = true): Promise<void> {
      await this.notifyAllUsers(
        'error',
        session.provider,
        `Session Error\n\nSession: ${session.title || session.id.slice(0, 8)}`,
        { isActionable: actionable, sessionId: session.id, status: session.status }
      );
    },

    async notifyWaitingInput(session: Session, actionable = false): Promise<void> {
      await this.notifyAllUsers(
        'waiting_input',
        session.provider,
        `Waiting for Input\n\nSession: ${session.title || session.id.slice(0, 8)}`,
        { isActionable: actionable, sessionId: session.id, status: session.status }
      );
    },

    async notifyWaitingApproval(session: Session, actionable = false): Promise<void> {
      await this.notifyAllUsers(
        'waiting_approval',
        session.provider,
        `Waiting for Approval\n\nSession: ${session.title || session.id.slice(0, 8)}`,
        { isActionable: actionable, sessionId: session.id, status: session.status }
      );
    },
  };
}

export const clawdbotNotifier = createClawdbotNotifier({
  notifications: notificationRepository,
  fetch,
  getSettings: (userId) => db.getUserSettings(userId),
});
