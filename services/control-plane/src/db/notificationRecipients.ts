import { pool } from './index.js';

class NotificationRecipientRepository {
  async list(preferredUserId?: string | null): Promise<string[]> {
    if (preferredUserId) return [preferredUserId];
    const result = await pool.query<{ user_id: string }>(
      `SELECT DISTINCT user_id
       FROM (
         SELECT user_id
         FROM push_subscriptions
         UNION
         SELECT user_id
         FROM user_settings
         WHERE user_id IS NOT NULL
           AND COALESCE(
             (settings->'data'->'alertSettings'->'clawdbot'->>'enabled')::boolean,
             false
           ) = true
       ) recipients
       WHERE user_id IS NOT NULL`
    );
    return result.rows.map((row) => row.user_id);
  }

  async userForAutomationAgent(automationAgentId: string): Promise<string | null> {
    const result = await pool.query<{ user_id: string }>(
      'SELECT user_id FROM automation_agents WHERE id = $1',
      [automationAgentId]
    );
    return result.rows[0]?.user_id ?? null;
  }
}

export const notificationRecipients = new NotificationRecipientRepository();
