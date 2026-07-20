import type { AgentTask, AgentTaskStatus } from '@agent-command/schema';
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

export type UpsertAgentTask = {
  session_id: string;
  tool_use_id: string;
  description: string;
  status: AgentTaskStatus;
  started_at: string;
  ended_at?: string | null;
  metadata?: Record<string, unknown>;
};

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function timestamp(value: unknown, fallback: Date): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const epochMs = value < 1_000_000_000_000 ? value * 1000 : value;
    const parsed = new Date(epochMs);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return fallback.toISOString();
}

export function agentTaskUpdateFromEvent(
  sessionId: string,
  eventType: string,
  payload: Record<string, unknown>,
  observedAt = new Date()
): UpsertAgentTask | null {
  const isSubagentStart = eventType === 'workshop.subagent_start';
  const isSubagentStop = eventType === 'workshop.subagent_stop';
  const isToolStart = eventType === 'workshop.pre_tool_use';
  const isToolStop = eventType === 'workshop.post_tool_use';
  if (!isSubagentStart && !isSubagentStop && !isToolStart && !isToolStop) {
    return null;
  }

  if (isToolStart || isToolStop) {
    const toolName = firstString(payload, ['tool', 'tool_name', 'toolName']);
    if (toolName?.toLowerCase() !== 'task') return null;
  }

  const toolInput = recordValue(payload.toolInput) ?? recordValue(payload.tool_input);
  const toolUseId = firstString(payload, [
    'tool_use_id',
    'toolUseId',
    'toolUseID',
    'agent_id',
    'agentId',
  ]) ?? (toolInput ? firstString(toolInput, ['tool_use_id', 'toolUseId', 'agent_id']) : null);
  if (!toolUseId) return null;

  const description = firstString(payload, ['description', 'task', 'prompt'])
    ?? (toolInput ? firstString(toolInput, ['description', 'task', 'prompt', 'subagent_type']) : null)
    ?? '';
  const eventTimestamp = payload.timestamp ?? payload.ts;
  const startedAt = timestamp(
    payload.started_at ?? payload.startedAt ?? eventTimestamp,
    observedAt
  );
  const terminal = isSubagentStop || isToolStop;
  const explicitStatus = firstString(payload, ['status']);
  const failed = terminal && (
    explicitStatus === 'failed'
    || payload.success === false
    || (payload.error !== undefined && payload.error !== null)
  );
  const status: AgentTaskStatus = terminal
    ? failed ? 'failed' : 'completed'
    : 'running';
  const endedAt = terminal
    ? timestamp(payload.ended_at ?? payload.endedAt ?? eventTimestamp, observedAt)
    : null;

  return {
    session_id: sessionId,
    tool_use_id: toolUseId,
    description,
    status,
    started_at: startedAt,
    ended_at: endedAt,
    metadata: {
      ...payload,
      event_type: eventType,
    },
  };
}

export class AgentTasksRepository {
  constructor(private readonly database: Queryer) {}

  async upsert(task: UpsertAgentTask): Promise<AgentTask> {
    const result = await this.database.query<AgentTask>(
      `INSERT INTO agent_tasks (
         session_id, tool_use_id, description, status, started_at, ended_at, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (session_id, tool_use_id) DO UPDATE SET
         description = CASE
           WHEN EXCLUDED.description = '' THEN agent_tasks.description
           ELSE EXCLUDED.description
         END,
         status = CASE
           WHEN agent_tasks.status IN ('completed', 'failed') AND EXCLUDED.status = 'running'
             THEN agent_tasks.status
           ELSE EXCLUDED.status
         END,
         started_at = LEAST(agent_tasks.started_at, EXCLUDED.started_at),
         ended_at = CASE
           WHEN agent_tasks.status IN ('completed', 'failed') AND EXCLUDED.status = 'running'
             THEN agent_tasks.ended_at
           ELSE COALESCE(EXCLUDED.ended_at, agent_tasks.ended_at)
         END,
         metadata = agent_tasks.metadata || EXCLUDED.metadata
       RETURNING *`,
      [
        task.session_id,
        task.tool_use_id,
        task.description,
        task.status,
        task.started_at,
        task.ended_at ?? null,
        JSON.stringify(task.metadata ?? {}),
      ]
    );
    const saved = result.rows[0];
    if (!saved) throw new Error('Agent task upsert returned no row');
    return saved;
  }

  async list(sessionId: string): Promise<AgentTask[]> {
    const result = await this.database.query<AgentTask>(
      `SELECT *
       FROM agent_tasks
       WHERE session_id = $1
       ORDER BY started_at ASC, id ASC`,
      [sessionId]
    );
    return result.rows;
  }

  async listMany(sessionIds: string[], pageSize = 1000): Promise<AgentTask[]> {
    if (sessionIds.length === 0) return [];
    const tasks: AgentTask[] = [];
    let offset = 0;
    while (true) {
      const result = await this.database.query<AgentTask>(
        `SELECT *
         FROM agent_tasks
         WHERE session_id = ANY($1::uuid[])
         ORDER BY started_at ASC, id ASC
         LIMIT $2 OFFSET $3`,
        [sessionIds, pageSize, offset]
      );
      tasks.push(...result.rows);
      if (result.rows.length < pageSize) return tasks;
      offset += result.rows.length;
    }
  }

  async delete(sessionId: string, toolUseId: string): Promise<boolean> {
    const result = await this.database.query<AgentTask>(
      `DELETE FROM agent_tasks
       WHERE session_id = $1 AND tool_use_id = $2
       RETURNING *`,
      [sessionId, toolUseId]
    );
    return (result.rowCount ?? result.rows.length) > 0;
  }
}

export const agentTasks = new AgentTasksRepository(pool as Queryer);
