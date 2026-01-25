import type { Session, Approval } from '@agent-command/schema';
import * as db from '../db/index.js';
import { pool } from '../db/index.js';

interface ClawdbotThrottleSettings {
  maxPerHour: number;
  batchDelayMs: number;
  sessionCooldownMs: number;
}

interface ClawdbotConfig {
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

// Default events: only critical ones enabled
const DEFAULT_CLAWDBOT_EVENTS: Record<string, boolean> = {
  approvals: true,
  waiting_input: false,      // OFF by default (noisy)
  waiting_approval: false,   // OFF by default (redundant with approvals)
  error: true,
  snapshot_action: true,
  usage_thresholds: true,
  approval_decisions: false, // OFF by default (noisy)
};

const DEFAULT_THROTTLE: ClawdbotThrottleSettings = {
  maxPerHour: 30,
  batchDelayMs: 1000,
  sessionCooldownMs: 30000,
};

class ClawdbotNotifier {
  private queue: QueuedNotification[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private rateLimits: Map<string, RateLimitEntry> = new Map();

  // Deduplication tracking
  private notificationHistory: Map<string, number> = new Map(); // dedupeKey -> timestamp
  private approvalNotified: Map<string, number> = new Map(); // userId|approvalId -> timestamp
  private sessionLastNotified: Map<string, number> = new Map(); // userId|sessionId -> timestamp

  // Clear old deduplication entries periodically
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Clean up stale entries every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleEntries();
    }, 5 * 60 * 1000);
  }

  private cleanupStaleEntries(): void {
    const now = Date.now();
    const maxAge = 60 * 60 * 1000; // 1 hour

    for (const [key, timestamp] of this.notificationHistory) {
      if (now - timestamp > maxAge) {
        this.notificationHistory.delete(key);
      }
    }

    for (const [key, timestamp] of this.approvalNotified) {
      if (now - timestamp > maxAge) {
        this.approvalNotified.delete(key);
      }
    }

    // Clean up old session last notified entries
    for (const [sessionId, timestamp] of this.sessionLastNotified) {
      if (now - timestamp > maxAge) {
        this.sessionLastNotified.delete(sessionId);
      }
    }
  }

  private generateDedupeKey(
    userId: string,
    eventType: string,
    sessionId?: string,
    approvalId?: string,
    status?: string
  ): string {
    return [
      userId,
      eventType,
      sessionId ?? '',
      approvalId ?? '',
      status ?? '',
    ].join('|');
  }

  private approvalKey(userId: string, approvalId: string): string {
    return `${userId}|${approvalId}`;
  }

  private sessionKey(userId: string, sessionId: string): string {
    return `${userId}|${sessionId}`;
  }

  private shouldNotify(
    userId: string,
    eventType: string,
    config: ClawdbotConfig,
    options: {
      isActionable?: boolean;
      sessionId?: string;
      approvalId?: string;
      status?: string;
    } = {}
  ): { allowed: boolean; reason?: string } {
    const { isActionable, sessionId, approvalId, status } = options;
    const throttle = config.throttle ?? DEFAULT_THROTTLE;
    const actionable = isActionable !== false;
    const actionableOnly = config.actionableOnly ?? true;

    // 1. Check actionableOnly filter
    if (actionableOnly && !actionable) {
      return { allowed: false, reason: 'actionableOnly filter (not actionable)' };
    }

    // 2. Check event type filter
    const eventEnabled = config.events[eventType] ?? DEFAULT_CLAWDBOT_EVENTS[eventType] ?? true;
    if (!eventEnabled) {
      return { allowed: false, reason: `event type '${eventType}' disabled` };
    }

    // 3. Check rate limit (non-mutating)
    if (!this.canSend(userId, throttle.maxPerHour)) {
      return { allowed: false, reason: 'rate limit exceeded' };
    }

    // 4. Approval-specific deduplication
    if (approvalId && this.approvalNotified.has(this.approvalKey(userId, approvalId))) {
      return { allowed: false, reason: `approval ${approvalId} already notified` };
    }

    // 5. Strong deduplication by dedupeKey
    const dedupeKey = this.generateDedupeKey(userId, eventType, sessionId, approvalId, status);
    const lastNotified = this.notificationHistory.get(dedupeKey);
    if (lastNotified) {
      const dedupeWindowMs = 5 * 60 * 1000; // 5 minutes
      if (Date.now() - lastNotified < dedupeWindowMs) {
        return { allowed: false, reason: `duplicate notification (key: ${dedupeKey})` };
      }
    }

    // 6. Session cooldown check
    if (sessionId && !actionable) {
      const sessionLastTime = this.sessionLastNotified.get(this.sessionKey(userId, sessionId));
      if (sessionLastTime && Date.now() - sessionLastTime < throttle.sessionCooldownMs) {
        return { allowed: false, reason: `session ${sessionId} cooldown active` };
      }
    }

    return { allowed: true };
  }

  private recordNotification(
    userId: string,
    eventType: string,
    sessionId?: string,
    approvalId?: string,
    status?: string,
    isActionable?: boolean
  ): void {
    const now = Date.now();
    const dedupeKey = this.generateDedupeKey(userId, eventType, sessionId, approvalId, status);
    this.notificationHistory.set(dedupeKey, now);

    if (approvalId) {
      this.approvalNotified.set(this.approvalKey(userId, approvalId), now);
    }

    if (sessionId && isActionable === false) {
      this.sessionLastNotified.set(this.sessionKey(userId, sessionId), now);
    }
  }

  async queueNotification(
    userId: string,
    eventType: string,
    provider: string | null,
    message: string,
    options: {
      isActionable?: boolean;
      sessionId?: string;
      approvalId?: string;
      status?: string;
    } = {}
  ): Promise<void> {
    const config = await this.getUserClawdbotConfig(userId);
    if (!config) return;

    if (!config.enabled) return;
    if (!config.baseUrl || !config.token) return;

    // Check provider filter
    if (provider) {
      const providerEnabled = config.providers[provider] ?? true;
      if (!providerEnabled) return;
    }

    // Run shouldNotify checks
    const { allowed, reason } = this.shouldNotify(userId, eventType, config, options);
    if (!allowed) {
      console.log(`[clawdbot] Notification blocked for user ${userId}: ${reason}`);
      return;
    }

    const throttle = config.throttle ?? DEFAULT_THROTTLE;

    // Consume rate limit only after passing all checks
    this.consumeRateLimit(userId);

    // Record this notification for deduplication
    this.recordNotification(
      userId,
      eventType,
      options.sessionId,
      options.approvalId,
      options.status,
      options.isActionable
    );

    this.queue.push({
      userId,
      message,
      config,
      timestamp: Date.now(),
    });

    this.scheduleFlush(throttle.batchDelayMs);
  }

  private canSend(userId: string, maxPerHour: number): boolean {
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;
    const entry = this.rateLimits.get(userId);

    if (!entry || now - entry.windowStart > hourMs) {
      return true;
    }

    return entry.count < maxPerHour;
  }

  private consumeRateLimit(userId: string): void {
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;
    const entry = this.rateLimits.get(userId);

    if (!entry || now - entry.windowStart > hourMs) {
      this.rateLimits.set(userId, { count: 1, windowStart: now });
      return;
    }

    entry.count++;
  }

  private scheduleFlush(delayMs: number = DEFAULT_THROTTLE.batchDelayMs): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flush().catch((err) => {
        console.error('[clawdbot] Flush error:', err);
      });
    }, delayMs);
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

  // Clear state for a deleted session
  clearSessionState(sessionId: string): void {
    const sessionSuffix = `|${sessionId}`;
    for (const key of this.sessionLastNotified.keys()) {
      if (key.endsWith(sessionSuffix)) {
        this.sessionLastNotified.delete(key);
      }
    }
    // Clean up any deduplication entries for this session
    for (const key of this.notificationHistory.keys()) {
      const parts = key.split('|');
      if (parts[2] === sessionId) {
        this.notificationHistory.delete(key);
      }
    }
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
    message: string,
    options: {
      isActionable?: boolean;
      sessionId?: string;
      approvalId?: string;
      status?: string;
    } = {}
  ): Promise<void> {
    const userIds = await this.getUsersWithClawdbot();
    for (const userId of userIds) {
      await this.queueNotification(userId, eventType, provider, message, options);
    }
  }

  // High-level notification methods for pubsub integration
  async notifyApprovalCreated(
    approval: Approval,
    session: Session | null,
    isActionable: boolean = true
  ): Promise<void> {
    const message = this.formatApprovalMessage(approval, session);
    await this.notifyAllUsers('approvals', approval.provider, message, {
      isActionable,
      sessionId: approval.session_id,
      approvalId: approval.id,
    });
  }

  async notifySessionError(session: Session, isActionable: boolean = true): Promise<void> {
    const message = this.formatErrorMessage(session);
    await this.notifyAllUsers('error', session.provider, message, {
      isActionable,
      sessionId: session.id,
      status: session.status,
    });
  }

  async notifyWaitingInput(session: Session, isActionable: boolean = false): Promise<void> {
    const message = this.formatWaitingInputMessage(session);
    await this.notifyAllUsers('waiting_input', session.provider, message, {
      isActionable,
      sessionId: session.id,
      status: session.status,
    });
  }

  async notifyWaitingApproval(session: Session, isActionable: boolean = false): Promise<void> {
    const message = this.formatWaitingApprovalMessage(session);
    await this.notifyAllUsers('waiting_approval', session.provider, message, {
      isActionable,
      sessionId: session.id,
      status: session.status,
    });
  }
}

export const clawdbotNotifier = new ClawdbotNotifier();
