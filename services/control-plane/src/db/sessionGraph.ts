import type {
  Session,
  SessionEdge,
  SessionEdgeType,
  SessionRole,
} from '@agent-command/schema';
import { pool } from './index.js';

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

export type SessionEdgeKey = {
  parent_session_id: string;
  child_session_id: string;
  edge_type: SessionEdgeType;
};

export type UpsertSessionEdgeResult = {
  edge: SessionEdge;
  created: boolean;
};

export type SessionGraphRollup = {
  session_id: string;
  child_sessions: {
    total: number;
    by_status: Record<string, number>;
  };
  agent_tasks: {
    total: number;
    running: number;
    completed: number;
    failed: number;
  };
};

type RollupRow = {
  child_session_total: number | string | null;
  child_sessions_by_status: Record<string, number> | null;
  agent_task_total: number | string | null;
  agent_task_running: number | string | null;
  agent_task_completed: number | string | null;
  agent_task_failed: number | string | null;
};

export class SessionGraphRepository {
  constructor(private readonly database: Queryer) {}

  async upsert(edge: SessionEdgeKey): Promise<UpsertSessionEdgeResult> {
    const inserted = await this.database.query<SessionEdge>(
      `INSERT INTO session_edges (
         parent_session_id, child_session_id, edge_type
       )
       VALUES ($1, $2, $3)
       ON CONFLICT (parent_session_id, child_session_id, edge_type)
       DO NOTHING
       RETURNING *`,
      [edge.parent_session_id, edge.child_session_id, edge.edge_type]
    );
    if (inserted.rows[0]) {
      return { edge: inserted.rows[0], created: true };
    }

    const existing = await this.database.query<SessionEdge>(
      `SELECT * FROM session_edges
       WHERE parent_session_id = $1
         AND child_session_id = $2
         AND edge_type = $3`,
      [edge.parent_session_id, edge.child_session_id, edge.edge_type]
    );
    if (!existing.rows[0]) throw new Error('Session edge upsert conflict could not be resolved');
    return { edge: existing.rows[0], created: false };
  }

  async list(sessionId: string): Promise<SessionEdge[]> {
    const result = await this.database.query<SessionEdge>(
      `SELECT *
       FROM session_edges
       WHERE parent_session_id = $1 OR child_session_id = $1
       ORDER BY created_at ASC, parent_session_id ASC, child_session_id ASC, edge_type ASC`,
      [sessionId]
    );
    return result.rows;
  }

  async delete(edge: SessionEdgeKey): Promise<boolean> {
    const result = await this.database.query<SessionEdge>(
      `DELETE FROM session_edges
       WHERE parent_session_id = $1
         AND child_session_id = $2
         AND edge_type = $3
       RETURNING *`,
      [edge.parent_session_id, edge.child_session_id, edge.edge_type]
    );
    return (result.rowCount ?? result.rows.length) > 0;
  }

  async setRole(sessionId: string, role: SessionRole): Promise<Session | null> {
    const result = await this.database.query<Session>(
      `UPDATE sessions
       SET role = $2
       WHERE id = $1
       RETURNING *`,
      [sessionId, role]
    );
    return result.rows[0] ?? null;
  }

  async backfillForkEdges(parentSessionId: string): Promise<SessionEdge[]> {
    const result = await this.database.query<SessionEdge>(
      `INSERT INTO session_edges (parent_session_id, child_session_id, edge_type)
       SELECT $1, sessions.id, 'forked'
       FROM sessions
       WHERE sessions.forked_from = $1
       ON CONFLICT (parent_session_id, child_session_id, edge_type) DO NOTHING
       RETURNING *`,
      [parentSessionId]
    );
    return result.rows;
  }

  async rollup(parentSessionId: string): Promise<SessionGraphRollup> {
    const result = await this.database.query<RollupRow>(
      `WITH child_status_counts AS (
         SELECT child.status::text AS status, COUNT(DISTINCT child.id)::int AS count
         FROM session_edges AS edge
         JOIN sessions AS child ON child.id = edge.child_session_id
         WHERE edge.parent_session_id = $1
         GROUP BY child.status
       ),
       child_rollup AS (
         SELECT
           COALESCE(SUM(count), 0)::int AS total,
           COALESCE(jsonb_object_agg(status, count), '{}'::jsonb) AS by_status
         FROM child_status_counts
       ),
       task_rollup AS (
         SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status = 'running')::int AS running,
           COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
           COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
         FROM agent_tasks
         WHERE session_id = $1
       )
       SELECT
         child_rollup.total AS child_session_total,
         child_rollup.by_status AS child_sessions_by_status,
         task_rollup.total AS agent_task_total,
         task_rollup.running AS agent_task_running,
         task_rollup.completed AS agent_task_completed,
         task_rollup.failed AS agent_task_failed
       FROM child_rollup CROSS JOIN task_rollup`,
      [parentSessionId]
    );
    const row = result.rows[0];
    return {
      session_id: parentSessionId,
      child_sessions: {
        total: Number(row?.child_session_total ?? 0),
        by_status: row?.child_sessions_by_status ?? {},
      },
      agent_tasks: {
        total: Number(row?.agent_task_total ?? 0),
        running: Number(row?.agent_task_running ?? 0),
        completed: Number(row?.agent_task_completed ?? 0),
        failed: Number(row?.agent_task_failed ?? 0),
      },
    };
  }
}

export const sessionGraph = new SessionGraphRepository(pool as Queryer);
