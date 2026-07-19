import { pool } from './index.js';

export interface PushSubscriptionRecord {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  device_label: string | null;
  created_at: string;
  last_seen_at: string;
  failure_count: number;
}

class PushSubscriptionRepository {
  async upsert(
    userId: string,
    input: { endpoint: string; p256dh: string; auth: string; device_label?: string }
  ): Promise<PushSubscriptionRecord> {
    const result = await pool.query<PushSubscriptionRecord>(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, device_label)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE SET
         p256dh = EXCLUDED.p256dh,
         auth = EXCLUDED.auth,
         device_label = EXCLUDED.device_label,
         last_seen_at = NOW(),
         failure_count = 0
       WHERE push_subscriptions.user_id = EXCLUDED.user_id
       RETURNING *`,
      [userId, input.endpoint, input.p256dh, input.auth, input.device_label ?? null]
    );
    if (!result.rows[0]) {
      throw new Error('Push endpoint is already registered to another user');
    }
    return result.rows[0];
  }

  async list(userId: string): Promise<PushSubscriptionRecord[]> {
    const result = await pool.query<PushSubscriptionRecord>(
      `SELECT *
       FROM push_subscriptions
       WHERE user_id = $1
       ORDER BY last_seen_at DESC`,
      [userId]
    );
    return result.rows;
  }

  async remove(userId: string, endpoint: string): Promise<boolean> {
    const result = await pool.query(
      `DELETE FROM push_subscriptions
       WHERE user_id = $1 AND endpoint = $2`,
      [userId, endpoint]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async removeById(id: string): Promise<void> {
    await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [id]);
  }

  async recordSuccess(id: string): Promise<void> {
    await pool.query(
      `UPDATE push_subscriptions
       SET failure_count = 0, last_seen_at = NOW()
       WHERE id = $1`,
      [id]
    );
  }

  async recordFailure(id: string): Promise<number> {
    const result = await pool.query<{ failure_count: number }>(
      `UPDATE push_subscriptions
       SET failure_count = failure_count + 1
       WHERE id = $1
       RETURNING failure_count`,
      [id]
    );
    return result.rows[0]?.failure_count ?? 0;
  }
}

export const pushSubscriptions = new PushSubscriptionRepository();
