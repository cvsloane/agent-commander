import { createHash } from 'node:crypto';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import * as db from './index.js';

export type NotificationChannel = 'web_push' | 'openclaw';

export interface NotificationReservationInput {
  userId: string;
  channel: NotificationChannel;
  dedupeKey: string;
  sessionId?: string;
  actionable?: boolean;
  maxPerHour?: number;
  dedupeWindowMs?: number;
  sessionCooldownMs?: number;
  payload?: Record<string, unknown>;
}

export interface NotificationLogInput {
  userId: string;
  channel: NotificationChannel;
  eventType: string;
  dedupeKey: string;
  target?: string;
  status: 'sent' | 'failed' | 'pruned' | 'throttled';
  attemptCount?: number;
  responseStatus?: number;
  error?: string;
  payload?: Record<string, unknown>;
}

function sessionStateKey(sessionId?: string): string | null {
  return sessionId ? `session:${sessionId}` : null;
}

function elapsedMs(value: unknown, nowMs: number): number | null {
  if (!value) return null;
  const timestamp = new Date(String(value)).getTime();
  return Number.isFinite(timestamp) ? nowMs - timestamp : null;
}

interface NotificationDatabase {
  connect(): Promise<PoolClient>;
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<T>>;
}

class NotificationRepository {
  constructor(private readonly database: NotificationDatabase) {}

  async reserve(input: NotificationReservationInput): Promise<{
    allowed: boolean;
    reason?: 'rate_limit' | 'dedupe_key' | 'session_cooldown';
  }> {
    const client = await this.database.connect();
    const nowMs = Date.now();
    const maxPerHour = input.maxPerHour ?? 30;
    const dedupeWindowMs = input.dedupeWindowMs ?? 5 * 60_000;
    const cooldownMs = input.sessionCooldownMs ?? 30_000;
    const cooldownKey = input.actionable === false ? sessionStateKey(input.sessionId) : null;
    const keys = cooldownKey ? [input.dedupeKey, cooldownKey] : [input.dedupeKey];
    const payloadHash = input.payload
      ? createHash('sha256').update(JSON.stringify(input.payload)).digest('hex')
      : null;

    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `${input.userId}:${input.channel}`,
      ]);
      const [rateResult, stateResult] = await Promise.all([
        client.query<{ count: string }>(
          `SELECT (
             SELECT COUNT(DISTINCT dedupe_key)
             FROM notifications_log
             WHERE user_id = $1
               AND channel = $2
               AND status = 'sent'
               AND created_at >= NOW() - INTERVAL '1 hour'
           ) + (
             SELECT COUNT(*)
             FROM notification_delivery_state
             WHERE user_id = $1
               AND channel = $2
               AND reserved_until > NOW()
               AND dedupe_key NOT LIKE 'session:%'
           ) AS count`,
          [input.userId, input.channel]
        ),
        client.query<{
          dedupe_key: string;
          last_sent_at: string | null;
          reserved_until: string | null;
          next_attempt_at: string | null;
        }>(
          `SELECT dedupe_key, last_sent_at, reserved_until, next_attempt_at
           FROM notification_delivery_state
           WHERE user_id = $1 AND channel = $2 AND dedupe_key = ANY($3::text[])`,
          [input.userId, input.channel, keys]
        ),
      ]);

      let reason: 'rate_limit' | 'dedupe_key' | 'session_cooldown' | undefined;
      if (Number(rateResult.rows[0]?.count ?? 0) >= maxPerHour) {
        reason = 'rate_limit';
      }
      const dedupeState = stateResult.rows.find((row) => row.dedupe_key === input.dedupeKey);
      const reservedUntil = dedupeState?.reserved_until
        ? new Date(dedupeState.reserved_until).getTime()
        : 0;
      const nextAttemptAt = dedupeState?.next_attempt_at
        ? new Date(dedupeState.next_attempt_at).getTime()
        : 0;
      const dedupeElapsed = elapsedMs(dedupeState?.last_sent_at, nowMs);
      if (
        !reason &&
        (reservedUntil > nowMs ||
          nextAttemptAt > nowMs ||
          (dedupeElapsed !== null && dedupeElapsed < dedupeWindowMs))
      ) {
        reason = 'dedupe_key';
      }
      const cooldownState = cooldownKey
        ? stateResult.rows.find((row) => row.dedupe_key === cooldownKey)
        : undefined;
      const cooldownElapsed = elapsedMs(cooldownState?.last_sent_at, nowMs);
      if (!reason && cooldownElapsed !== null && cooldownElapsed < cooldownMs) {
        reason = 'session_cooldown';
      }

      if (reason) {
        await client.query('COMMIT');
        return { allowed: false, reason };
      }

      for (const key of keys) {
        await client.query(
          `INSERT INTO notification_delivery_state (
             user_id, channel, dedupe_key, last_attempt_at, reserved_until, payload_hash
           ) VALUES ($1, $2, $3, NOW(), NOW() + INTERVAL '30 seconds', $4)
           ON CONFLICT (user_id, channel, dedupe_key) DO UPDATE SET
             last_attempt_at = NOW(),
             reserved_until = NOW() + INTERVAL '30 seconds',
             payload_hash = EXCLUDED.payload_hash,
             updated_at = NOW()`,
          [input.userId, input.channel, key, payloadHash]
        );
      }
      await client.query('COMMIT');
      return { allowed: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async recordSuccess(
    input: Pick<
      NotificationReservationInput,
      'userId' | 'channel' | 'dedupeKey' | 'sessionId' | 'actionable'
    >
  ): Promise<void> {
    const keys = [input.dedupeKey];
    if (input.actionable === false && input.sessionId) keys.push(sessionStateKey(input.sessionId)!);
    await this.database.query(
      `UPDATE notification_delivery_state
       SET last_sent_at = NOW(),
           reserved_until = NULL,
           next_attempt_at = NULL,
           failure_count = 0,
           updated_at = NOW()
       WHERE user_id = $1 AND channel = $2 AND dedupe_key = ANY($3::text[])`,
      [input.userId, input.channel, keys]
    );
  }

  async recordFailure(
    input: Pick<NotificationReservationInput, 'userId' | 'channel' | 'dedupeKey'>
  ): Promise<void> {
    await this.database.query(
      `UPDATE notification_delivery_state
       SET reserved_until = NULL,
           failure_count = failure_count + 1,
           next_attempt_at = NOW() + LEAST(
             INTERVAL '15 minutes',
             INTERVAL '30 seconds' * POWER(2, LEAST(failure_count, 5))
           ),
           updated_at = NOW()
       WHERE user_id = $1 AND channel = $2 AND dedupe_key = $3`,
      [input.userId, input.channel, input.dedupeKey]
    );
  }

  async recordLog(input: NotificationLogInput): Promise<void> {
    await this.database.query(
      `INSERT INTO notifications_log (
         user_id, channel, event_type, dedupe_key, target, status,
         attempt_count, response_status, error, payload
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        input.userId,
        input.channel,
        input.eventType,
        input.dedupeKey,
        input.target ?? null,
        input.status,
        input.attemptCount ?? 1,
        input.responseStatus ?? null,
        input.error ?? null,
        JSON.stringify(input.payload ?? {}),
      ]
    );
  }
}

export function createNotificationRepository(database: NotificationDatabase) {
  return new NotificationRepository(database);
}

const lazyPool: NotificationDatabase = {
  connect: () => db.pool.connect(),
  query: <T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) =>
    db.pool.query<T>(text, values),
};

export const notificationRepository = createNotificationRepository(lazyPool);
