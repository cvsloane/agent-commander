import type { Session, Approval } from '@agent-command/schema';
import * as db from '../db/index.js';
import { pool } from '../db/index.js';

interface ClawdbotConfig {
  enabled: boolean;
  baseUrl?: string;
  token?: string;
  channel?: string;
  recipient?: string;
  events: Record<string, boolean>;
  providers: Record<string, boolean>;
}

interface QueuedNotification {
  userId: string;
  message: string;
  config: ClawdbotConfig;
  timestamp: number;
}

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const DEFAULT_CLAWDBOT_EVENTS: Record<string, boolean> = {
  approvals: true,
  waiting_input: true,
  waiting_approval: true,
  error: true,
  snapshot_action: true,
  usage_thresholds: true,
  approval_decisions: true,
};

class ClawdbotNotifier {
  private queue: QueuedNotification[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private rateLimits: Map<string, RateLimitEntry> = new Map();
  private readonly maxPerHour = 30;
  private readonly flushDelayMs = 1000;

  async queueNotification(
    userId: string,
    eventType: string,
    provider: string | null,
    message: string
  ): Promise<void> {
    const config = await this.getUserClawdbotConfig(userId);
    if (!config) return;

    if (!config.enabled) return;
    if (!config.baseUrl || !config.token) return;

    // Check event filter
    const eventEnabled = config.events[eventType] ?? DEFAULT_CLAWDBOT_EVENTS[eventType] ?? true;
    if (!eventEnabled) return;

    // Check provider filter
    if (provider) {
      const providerEnabled = config.providers[provider] ?? true;
      if (!providerEnabled) return;
    }

    // Check rate limit
    if (!this.checkRateLimit(userId)) {
      console.log(`[clawdbot] Rate limit exceeded for user ${userId}`);
      return;
    }

    this.queue.push({
      userId,
      message,
      config,
      timestamp: Date.now(),
    });

    this.scheduleFlush();
  }

  private checkRateLimit(userId: string): boolean {
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;
    const entry = this.rateLimits.get(userId);

    if (!entry || now - entry.windowStart > hourMs) {
      this.rateLimits.set(userId, { count: 1, windowStart: now });
      return true;
    }

    if (entry.count >= this.maxPerHour) {
      return false;
    }

    entry.count++;
    return true;
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flush().catch((err) => {
        console.error('[clawdbot] Flush error:', err);
      });
    }, this.flushDelayMs);
  }

  private async flush(): Promise<void> {
    this.flushTimer = null;
    const toSend = this.queue.splice(0, this.queue.length);

    for (const notification of toSend) {
      try {
        const success = await this.sendToClawdbot(
          notification.config,
          notification.message
        );
        if (!success) {
          console.warn(`[clawdbot] Failed to send notification for user ${notification.userId}`);
        }
      } catch (err) {
        console.error(`[clawdbot] Error sending notification:`, err);
      }
    }
  }

  private async sendToClawdbot(config: ClawdbotConfig, message: string): Promise<boolean> {
    if (!config.baseUrl || !config.token) return false;

    const url = `${config.baseUrl}/hooks/agent`;
    const body = {
      message,
      channel: config.channel,
      to: config.recipient,
      sessionKey: 'agent-command-alerts',
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.token}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });

      return response.ok || response.status === 202;
    } catch (err) {
      console.error('[clawdbot] HTTP error:', err);
      return false;
    }
  }

  private async getUserClawdbotConfig(userId: string): Promise<ClawdbotConfig | null> {
    try {
      const settings = await db.getUserSettings(userId);
      if (!settings) return null;

      const data = (settings as { data?: { alertSettings?: { clawdbot?: ClawdbotConfig } } }).data;
      return data?.alertSettings?.clawdbot ?? null;
    } catch (err) {
      console.error('[clawdbot] Error fetching user settings:', err);
      return null;
    }
  }

  async sendTest(config: ClawdbotConfig): Promise<boolean> {
    const message = `Agent Command Test Notification

This is a test from Agent Command. If you received this message, your Clawdbot integration is working correctly.`;

    return this.sendToClawdbot(config, message);
  }

  // Notification formatters
  formatApprovalMessage(approval: Approval, session: Session | null): string {
    const sessionTitle = session?.title || session?.id?.slice(0, 8) || 'Unknown';
    const tool = (approval.requested_payload as Record<string, unknown>)?.tool as string || 'Permission';
    const reason = (approval.requested_payload as Record<string, unknown>)?.reason as string || 'N/A';

    return `Approval Required

Session: ${sessionTitle}
Tool: ${tool}
Reason: ${reason}

Respond in Agent Command`;
  }

  formatErrorMessage(session: Session): string {
    const sessionTitle = session.title || session.id.slice(0, 8);
    const metadata = session.metadata as Record<string, unknown> | null;
    const errorDetail = metadata?.status_detail as string || 'Unknown error';

    return `Session Error

Session: ${sessionTitle}
Error: ${errorDetail}`;
  }

  formatWaitingInputMessage(session: Session): string {
    const sessionTitle = session.title || session.id.slice(0, 8);

    return `Waiting for Input

Session: ${sessionTitle}

The session is waiting for your input.`;
  }

  formatWaitingApprovalMessage(session: Session): string {
    const sessionTitle = session.title || session.id.slice(0, 8);

    return `Waiting for Approval

Session: ${sessionTitle}

The session is waiting for an approval decision.`;
  }

  // Get all user IDs with clawdbot enabled
  private async getUsersWithClawdbot(): Promise<string[]> {
    try {
      const result = await pool.query(
        `SELECT user_subject FROM user_settings
         WHERE (settings->'data'->'alertSettings'->'clawdbot'->>'enabled')::boolean = true`
      );
      return result.rows.map((row) => row.user_subject);
    } catch (err) {
      console.error('[clawdbot] Error fetching users with clawdbot:', err);
      return [];
    }
  }

  // Notify all users with clawdbot enabled for a specific event
  async notifyAllUsers(
    eventType: string,
    provider: string | null,
    message: string
  ): Promise<void> {
    const userIds = await this.getUsersWithClawdbot();
    for (const userId of userIds) {
      await this.queueNotification(userId, eventType, provider, message);
    }
  }

  // High-level notification methods for pubsub integration
  async notifyApprovalCreated(approval: Approval, session: Session | null): Promise<void> {
    const message = this.formatApprovalMessage(approval, session);
    await this.notifyAllUsers('approvals', approval.provider, message);
  }

  async notifySessionError(session: Session): Promise<void> {
    const message = this.formatErrorMessage(session);
    await this.notifyAllUsers('error', session.provider, message);
  }

  async notifyWaitingInput(session: Session): Promise<void> {
    const message = this.formatWaitingInputMessage(session);
    await this.notifyAllUsers('waiting_input', session.provider, message);
  }

  async notifyWaitingApproval(session: Session): Promise<void> {
    const message = this.formatWaitingApprovalMessage(session);
    await this.notifyAllUsers('waiting_approval', session.provider, message);
  }
}

export const clawdbotNotifier = new ClawdbotNotifier();
