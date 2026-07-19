import { pool } from './index.js';

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
         cmd_id, host_id, session_id, type, payload, class, expires_at, idempotency_key
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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

  async getByIdempotencyKey(hostId: string, idempotencyKey: string): Promise<CommandRecord | null> {
    const result = await this.database.query<CommandRecord>(
      'SELECT * FROM commands WHERE host_id = $1 AND idempotency_key = $2',
      [hostId, idempotencyKey]
    );
    return result.rows[0] ?? null;
  }

  async markSent(cmdId: string): Promise<CommandRecord | null> {
    const result = await this.database.query<CommandRecord>(
      `UPDATE commands
       SET status = 'sent', sent_at = COALESCE(sent_at, NOW())
       WHERE cmd_id = $1 AND status IN ('queued', 'sent')
       RETURNING *`,
      [cmdId]
    );
    return result.rows[0] ?? null;
  }

  async markCompleted(
    cmdId: string,
    resultPayload?: Record<string, unknown>
  ): Promise<CommandRecord | null> {
    const result = await this.database.query<CommandRecord>(
      `UPDATE commands
       SET status = 'completed', completed_at = NOW(), result = $2, error = NULL
       WHERE cmd_id = $1 AND status IN ('queued', 'sent')
       RETURNING *`,
      [cmdId, resultPayload ? JSON.stringify(resultPayload) : null]
    );
    return result.rows[0] ?? null;
  }

  async markFailed(
    cmdId: string,
    errorPayload: Record<string, unknown>
  ): Promise<CommandRecord | null> {
    const result = await this.database.query<CommandRecord>(
      `UPDATE commands
       SET status = 'failed', completed_at = NOW(), error = $2
       WHERE cmd_id = $1 AND status IN ('queued', 'sent')
       RETURNING *`,
      [cmdId, JSON.stringify(errorPayload)]
    );
    return result.rows[0] ?? null;
  }

  async listDeliverable(hostId: string): Promise<CommandRecord[]> {
    const result = await this.database.query<CommandRecord>(
      `SELECT * FROM commands
       WHERE host_id = $1
         AND class = 'durable'
         AND status IN ('queued', 'sent')
         AND expires_at > NOW()
       ORDER BY created_at ASC, cmd_id ASC`,
      [hostId]
    );
    return result.rows;
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
}

export const commandOutbox = new CommandOutboxRepository(pool as Queryer);
