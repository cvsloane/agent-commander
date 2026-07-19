import type { Session } from '@agent-command/schema';
import { pool } from './index.js';

export interface AttentionDetection {
  reason: string | null;
  question?: string;
  confidence?: number;
  captureHash?: string;
}

export interface AttentionTransition {
  session: Session;
  event: {
    id: number;
    ts: string;
    type: 'attention.changed';
    payload: {
      attention_reason: string | null;
      question?: string;
      confidence?: number;
      capture_hash?: string;
    };
  };
}

class AttentionRepository {
  async transition(
    sessionId: string,
    detection: AttentionDetection
  ): Promise<AttentionTransition | null> {
    const payload = {
      attention_reason: detection.reason,
      ...(detection.question ? { question: detection.question } : {}),
      ...(detection.confidence !== undefined ? { confidence: detection.confidence } : {}),
      ...(detection.captureHash ? { capture_hash: detection.captureHash } : {}),
    };
    const result = await pool.query<AttentionTransition>(
      `WITH updated AS (
         UPDATE sessions
         SET attention_reason = $2, updated_at = NOW()
         WHERE id = $1 AND attention_reason IS DISTINCT FROM $2
         RETURNING *
       ), inserted AS (
         INSERT INTO events (session_id, type, payload)
         SELECT id, 'attention.changed', $3::jsonb
         FROM updated
         RETURNING *
       )
       SELECT row_to_json(updated) AS session,
              row_to_json(inserted) AS event
       FROM updated
       JOIN inserted ON inserted.session_id = updated.id`,
      [sessionId, detection.reason, JSON.stringify(payload)]
    );
    return result.rows[0] ?? null;
  }
}

export const attentionRepository = new AttentionRepository();
