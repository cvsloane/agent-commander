import { pool } from './index.js';
import type { Approval, ApprovalDecision, Event } from '@agent-command/schema';

export type CommandClass = 'durable' | 'volatile';
export type CommandStatus = 'queued' | 'sent' | 'completed' | 'failed' | 'expired';

export type CommandRecord = {
  cmd_id: string;
  host_id: string;
  session_id: string | null;
  type: string;
  payload: Record<string, unknown>;
  class: CommandClass;
  status: CommandStatus;
  created_at: string | Date;
  sent_at: string | Date | null;
  completed_at: string | Date | null;
  expires_at: string | Date;
  result: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  idempotency_key: string | null;
  idempotency_fingerprint: string | null;
};

export type EnqueueCommand = {
  cmd_id: string;
  host_id: string;
  session_id?: string | null;
  type: string;
  payload: Record<string, unknown>;
  class: CommandClass;
  expires_at: string | Date;
  idempotency_key?: string | null;
  idempotency_fingerprint?: string | null;
};

export type EnqueueResult = {
  record: CommandRecord;
  created: boolean;
};

export type QueryResult<Row> = {
  rows: Row[];
  rowCount?: number | null;
};

export interface Queryer {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<Row>>;
}

export class CommandOutboxRepository {
  constructor(private readonly database: Queryer) {}

  async enqueue(command: EnqueueCommand): Promise<EnqueueResult> {
    const inserted = await this.database.query<CommandRecord>(
      `INSERT INTO commands (
         cmd_id, host_id, session_id, type, payload, class, expires_at,
         idempotency_key, idempotency_fingerprint
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [
        command.cmd_id,
        command.host_id,
        command.session_id ?? null,
        command.type,
        JSON.stringify(command.payload),
        command.class,
        command.expires_at,
        command.idempotency_key ?? null,
        command.idempotency_fingerprint ?? null,
      ]
    );

    if (inserted.rows[0]) {
      return { record: inserted.rows[0], created: true };
    }

    const existing = command.idempotency_key
      ? await this.getByIdempotencyKey(command.host_id, command.idempotency_key)
      : await this.getById(command.cmd_id);
    if (!existing) {
      throw new Error('Command enqueue conflict could not be resolved');
    }
    return { record: existing, created: false };
  }

  async getById(cmdId: string): Promise<CommandRecord | null> {
    const result = await this.database.query<CommandRecord>(
      'SELECT * FROM commands WHERE cmd_id = $1',
      [cmdId]
    );
    return result.rows[0] ?? null;
  }

  async getByIdForHost(hostId: string, cmdId: string): Promise<CommandRecord | null> {
    const result = await this.database.query<CommandRecord>(
      'SELECT * FROM commands WHERE cmd_id = $1 AND host_id = $2',
      [cmdId, hostId]
    );
    return result.rows[0] ?? null;
  }

  async getByIdempotencyKey(hostId: string, idempotencyKey: string): Promise<CommandRecord | null> {
    const result = await this.database.query<CommandRecord>(
      'SELECT * FROM commands WHERE host_id = $1 AND idempotency_key = $2',
      [hostId, idempotencyKey]
    );
    return result.rows[0] ?? null;
  }

  async markSent(hostId: string, cmdId: string): Promise<CommandRecord | null> {
    const result = await this.database.query<CommandRecord>(
      `UPDATE commands
       SET status = 'sent', sent_at = COALESCE(sent_at, NOW())
       WHERE cmd_id = $1 AND host_id = $2 AND status = 'queued'
       RETURNING *`,
      [cmdId, hostId]
    );
    return result.rows[0] ?? null;
  }

  async markQueued(hostId: string, cmdId: string): Promise<CommandRecord | null> {
    const result = await this.database.query<CommandRecord>(
      `UPDATE commands
       SET status = 'queued', sent_at = NULL
       WHERE cmd_id = $1 AND host_id = $2 AND status = 'sent'
       RETURNING *`,
      [cmdId, hostId]
    );
    return result.rows[0] ?? null;
  }

  async markCompleted(
    hostId: string,
    cmdId: string,
    resultPayload?: Record<string, unknown>
  ): Promise<CommandRecord | null> {
    const result = await this.database.query<CommandRecord>(
      `UPDATE commands
       SET status = 'completed', completed_at = NOW(), result = $3, error = NULL
       WHERE cmd_id = $1 AND host_id = $2 AND status IN ('queued', 'sent')
       RETURNING *`,
      [cmdId, hostId, resultPayload ? JSON.stringify(resultPayload) : null]
    );
    return result.rows[0] ?? null;
  }

  async markFailed(
    hostId: string,
    cmdId: string,
    errorPayload: Record<string, unknown>
  ): Promise<CommandRecord | null> {
    const result = await this.database.query<CommandRecord>(
      `UPDATE commands
       SET status = 'failed', completed_at = NOW(), error = $3
       WHERE cmd_id = $1 AND host_id = $2 AND status IN ('queued', 'sent')
       RETURNING *`,
      [cmdId, hostId, JSON.stringify(errorPayload)]
    );
    return result.rows[0] ?? null;
  }

  async listDeliverable(hostId: string): Promise<CommandRecord[]> {
    // Legacy agentd does not deduplicate cmd_id, so an ambiguous `sent` row
    // must not be replayed. Claim queued rows before transport to prevent two
    // concurrent hellos from executing the same destructive command.
    const result = await this.database.query<CommandRecord>(
      `WITH deliverable AS (
         SELECT cmd_id
         FROM commands
         WHERE host_id = $1
           AND class = 'durable'
           AND status = 'queued'
           AND expires_at > NOW()
         ORDER BY created_at ASC, cmd_id ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE commands AS command
       SET status = 'sent', sent_at = COALESCE(command.sent_at, NOW())
       FROM deliverable
       WHERE command.cmd_id = deliverable.cmd_id
       RETURNING command.*`,
      [hostId]
    );
    return result.rows.sort((left, right) => {
      const created = new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
      return created || left.cmd_id.localeCompare(right.cmd_id);
    });
  }

  async expireStale(hostId?: string): Promise<CommandRecord[]> {
    const result = await this.database.query<CommandRecord>(
      `UPDATE commands
       SET status = 'expired', completed_at = NOW()
       WHERE status IN ('queued', 'sent')
         AND expires_at <= NOW()
         AND ($1::uuid IS NULL OR host_id = $1)
       RETURNING *`,
      [hostId ?? null]
    );
    return result.rows;
  }

  async pruneTerminal(retentionMs: number): Promise<number> {
    const result = await this.database.query(
      `DELETE FROM commands
       WHERE status IN ('completed', 'failed', 'expired')
         AND completed_at <= NOW() - ($1::double precision * INTERVAL '1 millisecond')`,
      [retentionMs]
    );
    return result.rowCount ?? 0;
  }
}

export const commandOutbox = new CommandOutboxRepository(pool as Queryer);

export async function decideApprovalAndEnqueue(input: {
  approval_id: string;
  decision: ApprovalDecision;
  decided_payload: Record<string, unknown>;
  decided_by_user_id: string;
  command: EnqueueCommand;
}): Promise<{ approval: Approval; command: CommandRecord; event: Event | null } | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const approvalResult = await client.query<Approval>(
      `UPDATE approvals SET
         decision = $2,
         decided_payload = $3,
         decided_by_user_id = $4,
         ts_decided = NOW()
       WHERE id = $1 AND decision IS NULL AND timed_out_at IS NULL
       RETURNING *`,
      [
        input.approval_id,
        input.decision,
        JSON.stringify(input.decided_payload),
        input.decided_by_user_id,
      ]
    );
    const approval = approvalResult.rows[0];
    if (!approval) {
      await client.query('ROLLBACK');
      return null;
    }

    const commandResult = await client.query<CommandRecord>(
      `INSERT INTO commands (
         cmd_id, host_id, session_id, type, payload, class, expires_at,
         idempotency_key, idempotency_fingerprint
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        input.command.cmd_id,
        input.command.host_id,
        input.command.session_id ?? null,
        input.command.type,
        JSON.stringify(input.command.payload),
        input.command.class,
        input.command.expires_at,
        input.command.idempotency_key ?? null,
        input.command.idempotency_fingerprint ?? null,
      ]
    );
    const command = commandResult.rows[0];
    if (!command) throw new Error('Approval command was not enqueued');

    if (!input.command.session_id) {
      throw new Error('Approval decision command is missing its session');
    }
    const eventPayload = {
      approval_id: input.approval_id,
      session_id: input.command.session_id,
      decision: input.decision,
      mode: input.decided_payload.mode,
      decided_by_user_id: input.decided_by_user_id,
    };
    const eventResult = await client.query<Event>(
      `INSERT INTO events (session_id, type, event_id, payload)
       VALUES ($1, 'approval.decided', $2, $3)
       ON CONFLICT (session_id, event_id) WHERE event_id IS NOT NULL DO NOTHING
       RETURNING *`,
      [
        input.command.session_id,
        `approval:${input.approval_id}:decided`,
        JSON.stringify(eventPayload),
      ]
    );

    await client.query('COMMIT');
    return { approval, command, event: eventResult.rows[0] ?? null };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
