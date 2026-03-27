import { randomUUID } from 'node:crypto';
import type {
  AutomationAgent,
  AutomationRun,
  AutomationRunEvent,
  AutomationRuntimeState,
  AutomationWakeup,
  CreateWorkItem,
  GovernanceApproval,
  GovernanceApprovalDecisionRequest,
  MemoryEntry,
  MemorySearchQuery,
  MemoryTrajectory,
  Repo,
  UpsertAutomationAgent,
  UpsertMemoryEntry,
  WakeAutomationAgentRequest,
  WorkItem,
  WorkItemsQuery,
} from '@agent-command/schema';
import {
  pool,
  getEvents,
  getLatestSnapshot,
  getRepoById,
  getSessionById,
  getSessionUsageLatest,
  getToolStats,
} from './index.js';
import { config } from '../config.js';
import {
  DEFAULT_EMBEDDING_DIMENSIONS,
  generateEmbedding,
  isEmbeddingAvailable,
  toVectorLiteral,
} from '../services/embeddings.js';

type JsonObject = Record<string, unknown>;

export type MemoryContextBrief = {
  repo: MemoryEntry[];
  global: MemoryEntry[];
};

export type ClaimedAutomationWakeup = AutomationWakeup & {
  agent_name: string;
  agent_provider: string;
  agent_role: string;
  agent_status: string;
  agent_user_id: string;
  agent_default_cwd: string | null;
  agent_fixed_host_id: string | null;
  wake_policy_json: JsonObject;
  memory_policy_json: JsonObject;
  budget_policy_json: JsonObject;
  worker_pool_json: JsonObject;
  max_parallel_runs: number;
  active_run_count?: number;
};

let vectorColumnSupport: Promise<boolean> | null = null;

function asJson(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function clip(value: string, max = 1200): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

async function hasVectorColumn(): Promise<boolean> {
  if (!vectorColumnSupport) {
    vectorColumnSupport = pool.query(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_name = 'memory_entries'
           AND column_name = 'embedding_vector'
       ) AS supported`
    )
      .then((result) => Boolean(result.rows[0]?.supported))
      .catch(() => false);
  }
  return vectorColumnSupport;
}

function normalizeEmbedding(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const normalized = value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
  return normalized.length > 0 ? normalized : null;
}

async function resolveEmbedding(input: UpsertMemoryEntry): Promise<{
  embedding: number[] | null;
  embeddingModel: string | null;
  embeddingDimensions: number | null;
}> {
  const provided = normalizeEmbedding(input.embedding);
  if (provided) {
    return {
      embedding: provided,
      embeddingModel: input.embedding_model || null,
      embeddingDimensions: input.embedding_dimensions ?? provided.length,
    };
  }

  if (!isEmbeddingAvailable()) {
    return { embedding: null, embeddingModel: null, embeddingDimensions: null };
  }

  try {
    const generated = await generateEmbedding(`${input.summary}\n\n${input.content}`);
    if (!generated) {
      return { embedding: null, embeddingModel: null, embeddingDimensions: null };
    }
    return {
      embedding: generated,
      embeddingModel: input.embedding_model || config.OPENAI_EMBEDDING_MODEL,
      embeddingDimensions: input.embedding_dimensions ?? generated.length ?? DEFAULT_EMBEDDING_DIMENSIONS,
    };
  } catch {
    return { embedding: null, embeddingModel: null, embeddingDimensions: null };
  }
}

function summarizeWorkItem(item: WorkItem | null): string | null {
  if (!item) return null;
  return `${item.title}\n${item.objective}`;
}

export async function createMemoryEntry(
  userId: string,
  input: UpsertMemoryEntry
): Promise<MemoryEntry> {
  const embedding = await resolveEmbedding(input);
  const useVectorColumn = embedding.embedding && await hasVectorColumn();
  const values: unknown[] = [
    userId,
    input.scope_type,
    input.repo_id || null,
    input.session_id || null,
    input.tier,
    input.summary,
    input.content,
    JSON.stringify(input.metadata ?? {}),
    input.confidence ?? 0.5,
    input.expires_at || null,
    embedding.embedding ? JSON.stringify(embedding.embedding) : null,
    embedding.embeddingModel,
    embedding.embeddingDimensions,
  ];
  const result = useVectorColumn
    ? await pool.query(
        `INSERT INTO memory_entries (
           user_id,
           scope_type,
           repo_id,
           session_id,
           tier,
           summary,
           content,
           metadata,
           confidence,
           expires_at,
           embedding,
           embedding_model,
           embedding_dimensions,
           embedding_vector
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::vector)
         RETURNING *`,
        [...values, toVectorLiteral(embedding.embedding!)]
      )
    : await pool.query(
        `INSERT INTO memory_entries (
           user_id,
           scope_type,
           repo_id,
           session_id,
           tier,
           summary,
           content,
           metadata,
           confidence,
           expires_at,
           embedding,
           embedding_model,
           embedding_dimensions
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *`,
        values
      );
  return result.rows[0];
}

export async function recordMemoryAccess(entryIds: string[]): Promise<void> {
  if (entryIds.length === 0) return;
  await pool.query(
    `UPDATE memory_entries
     SET access_count = access_count + 1,
         last_accessed_at = NOW()
     WHERE id = ANY($1::uuid[])`,
    [entryIds]
  );
}

export async function searchMemory(
  userId: string,
  query: MemorySearchQuery
): Promise<MemoryEntry[]> {
  const vectorSearch = await hasVectorColumn();
  const queryEmbedding = vectorSearch && isEmbeddingAvailable()
    ? await generateEmbedding(query.q)
    : null;
  const result = queryEmbedding
    ? await pool.query(
        `WITH ranked AS (
           SELECT
             *,
             ts_rank_cd(search_vector, plainto_tsquery('english', $2)) AS text_rank,
             CASE
               WHEN embedding_vector IS NOT NULL THEN 1 - (embedding_vector <=> $7::vector)
               ELSE 0
             END AS semantic_rank
           FROM memory_entries
           WHERE user_id = $1
             AND ($3::text IS NULL OR scope_type = $3)
             AND (
               $4::uuid IS NULL
               OR repo_id = $4
               OR ($3::text IS NULL AND scope_type = 'global')
             )
             AND ($5::text IS NULL OR tier = $5)
             AND (expires_at IS NULL OR expires_at > NOW())
             AND (
               embedding_vector IS NOT NULL
               OR search_vector @@ plainto_tsquery('english', $2)
               OR summary ILIKE ('%' || $2 || '%')
               OR content ILIKE ('%' || $2 || '%')
             )
         )
         SELECT * FROM ranked
         ORDER BY
           CASE
             WHEN $4::uuid IS NOT NULL AND repo_id = $4 THEN 0
             WHEN scope_type = 'global' THEN 1
             ELSE 2
           END,
           semantic_rank DESC,
           text_rank DESC,
           CASE tier
             WHEN 'procedural' THEN 0
             WHEN 'semantic' THEN 1
             WHEN 'episodic' THEN 2
             ELSE 3
           END,
           confidence DESC,
           updated_at DESC
         LIMIT $6`,
        [
          userId,
          query.q,
          query.scope_type || null,
          query.repo_id || null,
          query.tier || null,
          query.limit,
          toVectorLiteral(queryEmbedding),
        ]
      )
    : await pool.query(
        `WITH ranked AS (
           SELECT
             *,
             ts_rank_cd(search_vector, plainto_tsquery('english', $2)) AS rank
           FROM memory_entries
           WHERE user_id = $1
             AND ($3::text IS NULL OR scope_type = $3)
             AND (
               $4::uuid IS NULL
               OR repo_id = $4
               OR ($3::text IS NULL AND scope_type = 'global')
             )
             AND ($5::text IS NULL OR tier = $5)
             AND (expires_at IS NULL OR expires_at > NOW())
             AND (
               search_vector @@ plainto_tsquery('english', $2)
               OR summary ILIKE ('%' || $2 || '%')
               OR content ILIKE ('%' || $2 || '%')
             )
         )
         SELECT * FROM ranked
         ORDER BY
           CASE
             WHEN $4::uuid IS NOT NULL AND repo_id = $4 THEN 0
             WHEN scope_type = 'global' THEN 1
             ELSE 2
           END,
           rank DESC,
           CASE tier
             WHEN 'procedural' THEN 0
             WHEN 'semantic' THEN 1
             WHEN 'episodic' THEN 2
             ELSE 3
           END,
           confidence DESC,
           updated_at DESC
         LIMIT $6`,
        [
          userId,
          query.q,
          query.scope_type || null,
          query.repo_id || null,
          query.tier || null,
          query.limit,
        ]
      );

  const rows = result.rows as MemoryEntry[];
  await recordMemoryAccess(rows.map((row) => row.id));
  return rows;
}

export async function getMemoryContextBrief(
  userId: string,
  options: { repo_id?: string | null; limitPerScope?: number } = {}
): Promise<MemoryContextBrief> {
  const limitPerScope = options.limitPerScope ?? 5;
  const [repoResult, globalResult] = await Promise.all([
    options.repo_id
      ? pool.query(
          `SELECT * FROM memory_entries
           WHERE user_id = $1
             AND repo_id = $2
             AND scope_type = 'repo'
             AND tier IN ('procedural', 'semantic', 'episodic')
             AND (expires_at IS NULL OR expires_at > NOW())
           ORDER BY
             CASE tier
               WHEN 'procedural' THEN 0
               WHEN 'semantic' THEN 1
               ELSE 2
             END,
             confidence DESC,
             updated_at DESC
           LIMIT $3`,
          [userId, options.repo_id, limitPerScope]
        )
      : Promise.resolve({ rows: [] }),
    pool.query(
      `SELECT * FROM memory_entries
       WHERE user_id = $1
         AND scope_type = 'global'
         AND tier IN ('procedural', 'semantic', 'episodic')
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY
         CASE tier
           WHEN 'procedural' THEN 0
           WHEN 'semantic' THEN 1
           ELSE 2
         END,
         confidence DESC,
         updated_at DESC
       LIMIT $2`,
      [userId, limitPerScope]
    ),
  ]);

  return {
    repo: repoResult.rows as MemoryEntry[],
    global: globalResult.rows as MemoryEntry[],
  };
}

export async function createMemoryTrajectory(input: {
  user_id: string;
  repo_id?: string | null;
  session_id?: string | null;
  automation_run_id?: string | null;
  objective?: string | null;
  outcome: string;
  summary: string;
  steps_json: unknown;
}): Promise<MemoryTrajectory> {
  const result = await pool.query(
    `INSERT INTO memory_trajectories (
       user_id,
       repo_id,
       session_id,
       automation_run_id,
       objective,
       outcome,
       summary,
       steps_json
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      input.user_id,
      input.repo_id || null,
      input.session_id || null,
      input.automation_run_id || null,
      input.objective || null,
      input.outcome,
      input.summary,
      JSON.stringify(input.steps_json ?? []),
    ]
  );
  return result.rows[0];
}

export async function ingestSessionToMemory(options: {
  session_id: string;
  automation_run_id?: string | null;
  objective?: string | null;
}): Promise<{ memory: MemoryEntry | null; trajectory: MemoryTrajectory | null }> {
  const session = await getSessionById(options.session_id);
  if (!session?.user_id) {
    return { memory: null, trajectory: null };
  }

  const existing = await pool.query(
    `SELECT id FROM memory_trajectories WHERE session_id = $1 LIMIT 1`,
    [options.session_id]
  );
  if (existing.rows[0]) {
    return { memory: null, trajectory: null };
  }

  const [snapshot, events, toolStats, usageRows] = await Promise.all([
    getLatestSnapshot(options.session_id),
    getEvents(options.session_id, undefined, 20),
    getToolStats(options.session_id),
    getSessionUsageLatest([options.session_id]),
  ]);

  const usage = usageRows[0];
  const eventTypes = events.map((event) => event.type).slice(0, 8);
  const toolSummary = toolStats.map((stat) => `${stat.tool_name}:${stat.total_calls}`).slice(0, 8);
  const snapshotExcerpt = snapshot?.capture_text ? clip(snapshot.capture_text, 1600) : '';
  const objective = options.objective || session.title || 'Session execution';

  const summary = [
    `Objective: ${objective}`,
    `Outcome: ${session.status}`,
    session.cwd ? `Working directory: ${session.cwd}` : null,
    toolSummary.length > 0 ? `Top tools: ${toolSummary.join(', ')}` : null,
    usage?.estimated_cost_cents != null
      ? `Estimated cost cents: ${usage.estimated_cost_cents}`
      : null,
    eventTypes.length > 0 ? `Recent events: ${eventTypes.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const content = [
    summary,
    snapshotExcerpt ? `Snapshot excerpt:\n${snapshotExcerpt}` : null,
  ]
    .filter(Boolean)
    .join('\n\n');

  const memory = await createMemoryEntry(session.user_id, {
    scope_type: session.repo_id ? 'repo' : 'global',
    repo_id: session.repo_id || undefined,
    session_id: session.id,
    tier: 'episodic',
    summary: clip(summary, 250),
    content,
    metadata: {
      session_status: session.status,
      provider: session.provider,
      tool_stats: toolStats,
      recent_event_types: eventTypes,
      usage: usage ?? null,
    },
    confidence: session.status === 'DONE' ? 0.7 : session.status === 'ERROR' ? 0.45 : 0.55,
  });

  const trajectory = await createMemoryTrajectory({
    user_id: session.user_id,
    repo_id: session.repo_id || null,
    session_id: session.id,
    automation_run_id: options.automation_run_id || null,
    objective,
    outcome:
      session.status === 'DONE' ? 'succeeded'
      : session.status === 'ERROR' ? 'failed'
      : session.status.toLowerCase(),
    summary: clip(summary, 300),
    steps_json: {
      events: events.map((event) => ({
        id: event.id,
        type: event.type,
        ts: event.ts,
      })),
      tool_stats: toolStats,
      usage: usage ?? null,
    },
  });

  return { memory, trajectory };
}

export async function distillTrajectories(limit = 10): Promise<number> {
  const groups = await pool.query(
    `WITH grouped AS (
       SELECT
         user_id,
         repo_id,
         md5(lower(summary)) AS summary_signature,
         min(summary) AS summary,
         count(*)::int AS match_count,
         array_agg(id ORDER BY created_at DESC) AS trajectory_ids
       FROM memory_trajectories
       WHERE distilled_at IS NULL
         AND outcome = 'succeeded'
       GROUP BY user_id, repo_id, md5(lower(summary))
       HAVING count(*) >= 3
       ORDER BY max(created_at) DESC
       LIMIT $1
     )
     SELECT * FROM grouped`,
    [limit]
  );

  let promoted = 0;
  for (const row of groups.rows) {
    const trajectoryIds = (row.trajectory_ids as string[]) ?? [];
    const evidenceCount = trajectoryIds.length;
    const scopeType = row.repo_id ? 'repo' : 'global';
    await createMemoryEntry(row.user_id, {
      scope_type: scopeType,
      repo_id: row.repo_id || undefined,
      tier: 'semantic',
      summary: row.summary,
      content: `${row.summary}\n\nPromoted from ${evidenceCount} successful trajectories.`,
      metadata: {
        promoted_from_trajectory_ids: trajectoryIds,
        evidence_count: evidenceCount,
        summary_signature: row.summary_signature,
      },
      confidence: 0.85,
    });
    await pool.query(
      `UPDATE memory_trajectories
       SET distilled_at = NOW()
       WHERE id = ANY($1::uuid[])`,
      [trajectoryIds]
    );
    promoted++;
  }

  return promoted;
}

export async function listAutomationAgents(userId: string): Promise<AutomationAgent[]> {
  const result = await pool.query(
    `SELECT * FROM automation_agents
     WHERE user_id = $1
     ORDER BY name`,
    [userId]
  );
  return result.rows;
}

export async function getAutomationAgentById(
  userId: string,
  id: string
): Promise<AutomationAgent | null> {
  const result = await pool.query(
    `SELECT * FROM automation_agents
     WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  return result.rows[0] || null;
}

export async function createAutomationAgent(
  userId: string,
  input: UpsertAutomationAgent
): Promise<AutomationAgent> {
  const result = await pool.query(
    `INSERT INTO automation_agents (
       user_id,
       role,
       name,
       status,
       reports_to_automation_agent_id,
       provider,
       default_cwd,
       fixed_host_id,
       wake_policy_json,
       memory_policy_json,
       budget_policy_json,
       worker_pool_json,
       max_parallel_runs
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      userId,
      input.role,
      input.name,
      input.status || 'active',
      input.reports_to_automation_agent_id || null,
      input.provider,
      input.default_cwd || null,
      input.fixed_host_id || null,
      JSON.stringify(input.wake_policy_json ?? {}),
      JSON.stringify(input.memory_policy_json ?? {}),
      JSON.stringify(input.budget_policy_json ?? {}),
      JSON.stringify(input.worker_pool_json ?? {}),
      input.max_parallel_runs ?? 1,
    ]
  );
  return result.rows[0];
}

export async function updateAutomationAgent(
  userId: string,
  id: string,
  input: Partial<UpsertAutomationAgent>
): Promise<AutomationAgent | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let index = 1;

  const addField = (column: string, value: unknown): void => {
    fields.push(`${column} = $${index++}`);
    values.push(value);
  };

  if (input.role !== undefined) addField('role', input.role);
  if (input.name !== undefined) addField('name', input.name);
  if (input.status !== undefined) addField('status', input.status);
  if (input.reports_to_automation_agent_id !== undefined) {
    addField('reports_to_automation_agent_id', input.reports_to_automation_agent_id || null);
  }
  if (input.provider !== undefined) addField('provider', input.provider);
  if (input.default_cwd !== undefined) addField('default_cwd', input.default_cwd || null);
  if (input.fixed_host_id !== undefined) addField('fixed_host_id', input.fixed_host_id || null);
  if (input.wake_policy_json !== undefined) addField('wake_policy_json', JSON.stringify(input.wake_policy_json));
  if (input.memory_policy_json !== undefined) addField('memory_policy_json', JSON.stringify(input.memory_policy_json));
  if (input.budget_policy_json !== undefined) addField('budget_policy_json', JSON.stringify(input.budget_policy_json));
  if (input.worker_pool_json !== undefined) addField('worker_pool_json', JSON.stringify(input.worker_pool_json));
  if (input.max_parallel_runs !== undefined) addField('max_parallel_runs', input.max_parallel_runs);

  if (fields.length === 0) {
    return getAutomationAgentById(userId, id);
  }

  values.push(id, userId);
  const result = await pool.query(
    `UPDATE automation_agents
     SET ${fields.join(', ')}
     WHERE id = $${index++} AND user_id = $${index}
     RETURNING *`,
    values
  );
  return result.rows[0] || null;
}

export async function createAutomationWakeup(
  userId: string,
  agentId: string,
  input: WakeAutomationAgentRequest
): Promise<AutomationWakeup> {
  const agent = await getAutomationAgentById(userId, agentId);
  if (!agent) {
    throw new Error('Automation agent not found');
  }

  if (input.idempotency_key) {
    const existing = await pool.query(
      `SELECT w.*
       FROM automation_wakeups w
       WHERE w.automation_agent_id = $1
         AND w.idempotency_key = $2
         AND COALESCE(w.repo_id, '00000000-0000-0000-0000-000000000000'::uuid)
             = COALESCE($3::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
         AND w.status IN ('queued', 'running', 'blocked')
       ORDER BY w.requested_at DESC
       LIMIT 1`,
      [agentId, input.idempotency_key, input.repo_id || null]
    );
    if (existing.rows[0]) {
      return existing.rows[0];
    }
  }

  const result = await pool.query(
    `INSERT INTO automation_wakeups (
       automation_agent_id,
       repo_id,
       source,
       idempotency_key,
       context_json
     )
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      agentId,
      input.repo_id || null,
      input.source,
      input.idempotency_key || null,
      JSON.stringify(input.context_json ?? {}),
    ]
  );
  return result.rows[0];
}

export async function claimNextAutomationWakeup(): Promise<ClaimedAutomationWakeup | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const selected = await client.query(
      `SELECT
         w.*,
         a.name AS agent_name,
         a.provider AS agent_provider,
         a.role AS agent_role,
         a.status AS agent_status,
         a.user_id AS agent_user_id,
         a.default_cwd AS agent_default_cwd,
         a.fixed_host_id AS agent_fixed_host_id,
         a.wake_policy_json,
         a.memory_policy_json,
         a.budget_policy_json,
         a.worker_pool_json,
         a.max_parallel_runs,
         (
           SELECT COUNT(*)::int
           FROM automation_runs ar
           WHERE ar.automation_agent_id = a.id
             AND ar.status IN ('starting', 'running')
         ) AS active_run_count
       FROM automation_wakeups w
       JOIN automation_agents a ON a.id = w.automation_agent_id
       WHERE w.status = 'queued'
         AND a.status = 'active'
         AND NOT (
           COALESCE(a.wake_policy_json->>'concurrency_policy', 'coalesce_if_active') = 'always_enqueue'
           AND (
             SELECT COUNT(*)::int
             FROM automation_runs ar
             WHERE ar.automation_agent_id = a.id
               AND ar.status IN ('starting', 'running')
           ) >= a.max_parallel_runs
         )
       ORDER BY w.requested_at
       FOR UPDATE OF w SKIP LOCKED
       LIMIT 1`
    );

    const row = selected.rows[0];
    if (!row) {
      await client.query('COMMIT');
      return null;
    }

    const updated = await client.query(
      `UPDATE automation_wakeups
       SET status = 'running',
           claimed_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [row.id]
    );

    await client.query('COMMIT');
    return {
      ...row,
      ...updated.rows[0],
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function markAutomationWakeupStatus(
  id: string,
  status: AutomationWakeup['status'],
  contextPatch?: JsonObject
): Promise<AutomationWakeup | null> {
  const result = await pool.query(
    `UPDATE automation_wakeups
     SET status = $2,
         context_json = CASE
           WHEN $3::jsonb IS NULL THEN context_json
           ELSE context_json || $3::jsonb
         END,
         finished_at = CASE
           WHEN $2 IN ('completed', 'skipped', 'blocked', 'failed', 'coalesced')
             THEN NOW()
           ELSE finished_at
         END
     WHERE id = $1
     RETURNING *`,
    [id, status, contextPatch ? JSON.stringify(contextPatch) : null]
  );
  return result.rows[0] || null;
}

export async function requeueAutomationWakeup(
  id: string,
  contextPatch?: JsonObject
): Promise<AutomationWakeup | null> {
  const result = await pool.query(
    `UPDATE automation_wakeups
     SET status = 'queued',
         claimed_at = NULL,
         finished_at = NULL,
         context_json = CASE
           WHEN $2::jsonb IS NULL THEN context_json
           ELSE context_json || $2::jsonb
         END
     WHERE id = $1
     RETURNING *`,
    [id, contextPatch ? JSON.stringify(contextPatch) : null]
  );
  return result.rows[0] || null;
}

export async function coalesceAutomationWakeup(
  id: string,
  runId: string,
  contextPatch?: JsonObject
): Promise<AutomationWakeup | null> {
  const result = await pool.query(
    `UPDATE automation_wakeups
     SET status = 'coalesced',
         coalesced_into_run_id = $2,
         context_json = CASE
           WHEN $3::jsonb IS NULL THEN context_json
           ELSE context_json || $3::jsonb
         END,
         finished_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, runId, contextPatch ? JSON.stringify(contextPatch) : null]
  );
  return result.rows[0] || null;
}

export async function createAutomationRun(input: {
  automation_agent_id: string;
  wakeup_id: string;
  repo_id?: string | null;
  status: AutomationRun['status'];
  objective: string;
  memory_snapshot_json?: JsonObject;
  session_id?: string | null;
}): Promise<AutomationRun> {
  const result = await pool.query(
    `INSERT INTO automation_runs (
       automation_agent_id,
       wakeup_id,
       repo_id,
       session_id,
       status,
       objective,
       memory_snapshot_json
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.automation_agent_id,
      input.wakeup_id,
      input.repo_id || null,
      input.session_id || null,
      input.status,
      input.objective,
      JSON.stringify(input.memory_snapshot_json ?? {}),
    ]
  );
  return result.rows[0];
}

export async function updateAutomationRun(
  id: string,
  updates: {
    session_id?: string | null;
    status?: AutomationRun['status'];
    result_summary?: string | null;
    memory_snapshot_json?: JsonObject;
    pending_followups_json?: Array<JsonObject>;
    usage_json?: JsonObject;
    ended_at?: string | null;
  }
): Promise<AutomationRun | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let index = 1;
  const addField = (column: string, value: unknown): void => {
    fields.push(`${column} = $${index++}`);
    values.push(value);
  };

  if (updates.session_id !== undefined) addField('session_id', updates.session_id);
  if (updates.status !== undefined) addField('status', updates.status);
  if (updates.result_summary !== undefined) addField('result_summary', updates.result_summary);
  if (updates.memory_snapshot_json !== undefined) {
    addField('memory_snapshot_json', JSON.stringify(updates.memory_snapshot_json));
  }
  if (updates.pending_followups_json !== undefined) {
    addField('pending_followups_json', JSON.stringify(updates.pending_followups_json));
  }
  if (updates.usage_json !== undefined) addField('usage_json', JSON.stringify(updates.usage_json));
  if (updates.ended_at !== undefined) addField('ended_at', updates.ended_at);

  if (fields.length === 0) {
    const current = await pool.query('SELECT * FROM automation_runs WHERE id = $1', [id]);
    return current.rows[0] || null;
  }

  values.push(id);
  const result = await pool.query(
    `UPDATE automation_runs
     SET ${fields.join(', ')}
     WHERE id = $${index}
     RETURNING *`,
    values
  );
  return result.rows[0] || null;
}

export async function getAutomationRunById(
  userId: string,
  runId: string
): Promise<AutomationRun | null> {
  const result = await pool.query(
    `SELECT r.*
     FROM automation_runs r
     JOIN automation_agents a ON a.id = r.automation_agent_id
     WHERE r.id = $1
       AND a.user_id = $2`,
    [runId, userId]
  );
  return result.rows[0] || null;
}

export async function appendAutomationRunEvent(input: {
  automation_run_id: string;
  event_type: string;
  level?: 'info' | 'warn' | 'error';
  message: string;
  payload?: JsonObject;
}): Promise<AutomationRunEvent> {
  const result = await pool.query(
    `WITH next_seq AS (
       SELECT COALESCE(MAX(seq), 0) + 1 AS seq
       FROM automation_run_events
       WHERE automation_run_id = $1
     )
     INSERT INTO automation_run_events (
       automation_run_id,
       seq,
       event_type,
       level,
       message,
       payload
     )
     SELECT $1, next_seq.seq, $2, $3, $4, $5
     FROM next_seq
     RETURNING *`,
    [
      input.automation_run_id,
      input.event_type,
      input.level || 'info',
      input.message,
      JSON.stringify(input.payload ?? {}),
    ]
  );
  return result.rows[0];
}

export async function listAutomationRunEvents(
  userId: string,
  runId: string
): Promise<AutomationRunEvent[]> {
  const result = await pool.query(
    `SELECT e.*
     FROM automation_run_events e
     JOIN automation_runs r ON r.id = e.automation_run_id
     JOIN automation_agents a ON a.id = r.automation_agent_id
     WHERE e.automation_run_id = $1
       AND a.user_id = $2
     ORDER BY e.seq ASC`,
    [runId, userId]
  );
  return result.rows;
}

export async function appendPendingFollowupToRun(
  runId: string,
  followup: JsonObject
): Promise<AutomationRun | null> {
  const result = await pool.query(
    `UPDATE automation_runs
     SET pending_followups_json = COALESCE(pending_followups_json, '[]'::jsonb) || $2::jsonb
     WHERE id = $1
     RETURNING *`,
    [runId, JSON.stringify([followup])]
  );
  return result.rows[0] || null;
}

export async function getActiveAutomationRunForScope(input: {
  automation_agent_id: string;
  repo_id?: string | null;
}): Promise<AutomationRun | null> {
  const result = await pool.query(
    `SELECT *
     FROM automation_runs
     WHERE automation_agent_id = $1
       AND status IN ('starting', 'running')
       AND COALESCE(repo_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
     ORDER BY started_at ASC
     LIMIT 1`,
    [input.automation_agent_id, input.repo_id || null]
  );
  return result.rows[0] || null;
}

export async function countActiveAutomationRuns(automationAgentId: string): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM automation_runs
     WHERE automation_agent_id = $1
       AND status IN ('starting', 'running')`,
    [automationAgentId]
  );
  return result.rows[0]?.count ?? 0;
}

export async function listAutomationRuns(userId: string, filters?: {
  automation_agent_id?: string;
  status?: string;
  limit?: number;
}): Promise<AutomationRun[]> {
  let query = `
    SELECT r.*
    FROM automation_runs r
    JOIN automation_agents a ON a.id = r.automation_agent_id
    WHERE a.user_id = $1`;
  const params: unknown[] = [userId];
  let index = 2;

  if (filters?.automation_agent_id) {
    query += ` AND r.automation_agent_id = $${index++}`;
    params.push(filters.automation_agent_id);
  }
  if (filters?.status) {
    query += ` AND r.status = $${index++}`;
    params.push(filters.status);
  }
  query += ` ORDER BY r.started_at DESC`;
  if (filters?.limit) {
    query += ` LIMIT $${index++}`;
    params.push(filters.limit);
  }

  const result = await pool.query(query, params);
  return result.rows;
}

export async function listAutomationWakeups(userId: string, filters?: {
  automation_agent_id?: string;
  status?: string;
  limit?: number;
}): Promise<AutomationWakeup[]> {
  let query = `
    SELECT w.*
    FROM automation_wakeups w
    JOIN automation_agents a ON a.id = w.automation_agent_id
    WHERE a.user_id = $1`;
  const params: unknown[] = [userId];
  let index = 2;

  if (filters?.automation_agent_id) {
    query += ` AND w.automation_agent_id = $${index++}`;
    params.push(filters.automation_agent_id);
  }
  if (filters?.status) {
    query += ` AND w.status = $${index++}`;
    params.push(filters.status);
  }

  query += ` ORDER BY w.requested_at DESC`;
  if (filters?.limit) {
    query += ` LIMIT $${index++}`;
    params.push(filters.limit);
  }

  const result = await pool.query(query, params);
  return result.rows;
}

export async function listActiveAutomationRuns(): Promise<AutomationRun[]> {
  const result = await pool.query(
    `SELECT * FROM automation_runs
     WHERE status IN ('starting', 'running')
     ORDER BY started_at`
  );
  return result.rows;
}

export async function listFinishedSessionsPendingMemoryIngestion(limit = 10): Promise<Array<{ id: string }>> {
  const result = await pool.query(
    `SELECT s.id
     FROM sessions s
     LEFT JOIN memory_trajectories mt ON mt.session_id = s.id
     LEFT JOIN automation_runs ar ON ar.session_id = s.id
     WHERE s.user_id IS NOT NULL
       AND s.status IN ('DONE', 'ERROR')
       AND mt.id IS NULL
       AND ar.id IS NULL
     ORDER BY COALESCE(s.updated_at, s.created_at) DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows as Array<{ id: string }>;
}

export async function listAutomationRuntimeStates(): Promise<AutomationRuntimeState[]> {
  const result = await pool.query(
    `SELECT *
     FROM automation_runtime_states
     ORDER BY updated_at DESC`
  );
  return result.rows;
}

export async function getAutomationRuntimeState(input: {
  automation_agent_id: string;
  repo_id?: string | null;
}): Promise<AutomationRuntimeState | null> {
  const result = await pool.query(
    `SELECT *
     FROM automation_runtime_states
     WHERE automation_agent_id = $1
       AND COALESCE(repo_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
     LIMIT 1`,
    [input.automation_agent_id, input.repo_id || null]
  );
  return result.rows[0] || null;
}

export async function upsertAutomationRuntimeState(input: {
  automation_agent_id: string;
  repo_id?: string | null;
  active_session_id?: string | null;
  active_host_id?: string | null;
  last_session_id?: string | null;
  last_run_id?: string | null;
  runtime_status?: AutomationRuntimeState['runtime_status'];
  state_json?: JsonObject;
  usage_rollup_json?: JsonObject;
}): Promise<AutomationRuntimeState> {
  const updated = await pool.query(
    `UPDATE automation_runtime_states
     SET active_session_id = COALESCE($3, active_session_id),
         active_host_id = COALESCE($4, active_host_id),
         last_session_id = COALESCE($5, last_session_id),
         last_run_id = COALESCE($6, last_run_id),
         runtime_status = COALESCE($7, runtime_status),
         state_json = state_json || $8::jsonb,
         usage_rollup_json = usage_rollup_json || $9::jsonb,
         updated_at = NOW()
     WHERE automation_agent_id = $1
       AND COALESCE(repo_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
     RETURNING *`,
    [
      input.automation_agent_id,
      input.repo_id || null,
      input.active_session_id ?? null,
      input.active_host_id ?? null,
      input.last_session_id ?? null,
      input.last_run_id ?? null,
      input.runtime_status ?? null,
      JSON.stringify(input.state_json ?? {}),
      JSON.stringify(input.usage_rollup_json ?? {}),
    ]
  );
  if (updated.rows[0]) {
    return updated.rows[0];
  }

  const inserted = await pool.query(
    `INSERT INTO automation_runtime_states (
       automation_agent_id,
       repo_id,
       active_session_id,
       active_host_id,
       last_session_id,
       last_run_id,
       runtime_status,
       state_json,
       usage_rollup_json
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      input.automation_agent_id,
      input.repo_id || null,
      input.active_session_id ?? null,
      input.active_host_id ?? null,
      input.last_session_id ?? null,
      input.last_run_id ?? null,
      input.runtime_status ?? 'idle',
      JSON.stringify(input.state_json ?? {}),
      JSON.stringify(input.usage_rollup_json ?? {}),
    ]
  );
  return inserted.rows[0];
}

export async function replaceAutomationRuntimeState(input: {
  automation_agent_id: string;
  repo_id?: string | null;
  active_session_id?: string | null;
  active_host_id?: string | null;
  last_session_id?: string | null;
  last_run_id?: string | null;
  runtime_status: AutomationRuntimeState['runtime_status'];
  state_json?: JsonObject;
  usage_rollup_json?: JsonObject;
}): Promise<AutomationRuntimeState> {
  const updated = await pool.query(
    `UPDATE automation_runtime_states
     SET active_session_id = $3,
         active_host_id = $4,
         last_session_id = $5,
         last_run_id = $6,
         runtime_status = $7,
         state_json = $8::jsonb,
         usage_rollup_json = $9::jsonb,
         updated_at = NOW()
     WHERE automation_agent_id = $1
       AND COALESCE(repo_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
     RETURNING *`,
    [
      input.automation_agent_id,
      input.repo_id || null,
      input.active_session_id ?? null,
      input.active_host_id ?? null,
      input.last_session_id ?? null,
      input.last_run_id ?? null,
      input.runtime_status,
      JSON.stringify(input.state_json ?? {}),
      JSON.stringify(input.usage_rollup_json ?? {}),
    ]
  );
  if (updated.rows[0]) {
    return updated.rows[0];
  }

  const inserted = await pool.query(
    `INSERT INTO automation_runtime_states (
       automation_agent_id,
       repo_id,
       active_session_id,
       active_host_id,
       last_session_id,
       last_run_id,
       runtime_status,
       state_json,
       usage_rollup_json
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      input.automation_agent_id,
      input.repo_id || null,
      input.active_session_id ?? null,
      input.active_host_id ?? null,
      input.last_session_id ?? null,
      input.last_run_id ?? null,
      input.runtime_status,
      JSON.stringify(input.state_json ?? {}),
      JSON.stringify(input.usage_rollup_json ?? {}),
    ]
  );
  return inserted.rows[0];
}

export async function getAutomationRunBySessionId(
  sessionId: string
): Promise<AutomationRun | null> {
  const result = await pool.query(
    `SELECT * FROM automation_runs WHERE session_id = $1 ORDER BY started_at DESC LIMIT 1`,
    [sessionId]
  );
  return result.rows[0] || null;
}

export async function computeAutomationBudgetUsage(
  automationAgentId: string
): Promise<{ daily_cents: number; monthly_cents: number }> {
  const result = await pool.query(
    `SELECT
       COALESCE(SUM(
         CASE
           WHEN started_at >= date_trunc('day', NOW())
             THEN COALESCE(NULLIF(usage_json->>'estimated_cost_cents', '')::int, 0)
           ELSE 0
         END
       ), 0)::int AS daily_cents,
       COALESCE(SUM(
         CASE
           WHEN started_at >= date_trunc('month', NOW())
             THEN COALESCE(NULLIF(usage_json->>'estimated_cost_cents', '')::int, 0)
           ELSE 0
         END
       ), 0)::int AS monthly_cents
     FROM automation_runs
     WHERE automation_agent_id = $1`,
    [automationAgentId]
  );
  return {
    daily_cents: result.rows[0]?.daily_cents ?? 0,
    monthly_cents: result.rows[0]?.monthly_cents ?? 0,
  };
}

export async function createGovernanceApproval(input: {
  user_id: string;
  automation_agent_id: string;
  automation_run_id?: string | null;
  type: GovernanceApproval['type'];
  request_payload: JsonObject;
}): Promise<GovernanceApproval> {
  const result = await pool.query(
    `INSERT INTO governance_approvals (
       user_id,
       automation_agent_id,
       automation_run_id,
       type,
       request_payload
     )
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      input.user_id,
      input.automation_agent_id,
      input.automation_run_id || null,
      input.type,
      JSON.stringify(input.request_payload),
    ]
  );
  return result.rows[0];
}

export async function listGovernanceApprovals(
  userId: string,
  filters?: { status?: string }
): Promise<GovernanceApproval[]> {
  let query = `SELECT * FROM governance_approvals WHERE user_id = $1`;
  const params: unknown[] = [userId];
  if (filters?.status) {
    query += ` AND status = $2`;
    params.push(filters.status);
  }
  query += ` ORDER BY requested_at DESC`;
  const result = await pool.query(query, params);
  return result.rows;
}

export async function getGovernanceApprovalById(
  userId: string,
  id: string
): Promise<GovernanceApproval | null> {
  const result = await pool.query(
    `SELECT * FROM governance_approvals WHERE user_id = $1 AND id = $2`,
    [userId, id]
  );
  return result.rows[0] || null;
}

export async function decideGovernanceApproval(
  userId: string,
  id: string,
  actorUserId: string,
  decision: GovernanceApprovalDecisionRequest
): Promise<GovernanceApproval | null> {
  const status = decision.decision === 'approved' ? 'approved' : 'denied';
  const result = await pool.query(
    `UPDATE governance_approvals
     SET status = $3,
         decision_payload = $4,
         decided_at = NOW(),
         decided_by_user_id = $5
     WHERE id = $1
       AND user_id = $2
       AND status = 'pending'
     RETURNING *`,
    [
      id,
      userId,
      status,
      JSON.stringify(decision.decision_payload ?? {}),
      actorUserId,
    ]
  );
  return result.rows[0] || null;
}

export async function createWorkItem(
  userId: string,
  input: CreateWorkItem
): Promise<WorkItem> {
  if (input.dedupe_key) {
    const existing = await pool.query(
      `SELECT * FROM work_items
       WHERE user_id = $1
         AND dedupe_key = $2
         AND COALESCE(repo_id, '00000000-0000-0000-0000-000000000000'::uuid)
             = COALESCE($3::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
         AND status IN ('queued', 'in_progress', 'blocked')
       LIMIT 1`,
      [userId, input.dedupe_key, input.repo_id || null]
    );
    if (existing.rows[0]) {
      return existing.rows[0];
    }
  }

  const result = await pool.query(
    `INSERT INTO work_items (
       user_id,
       repo_id,
       title,
       objective,
       priority,
       assigned_automation_agent_id,
       dedupe_key,
       payload_json
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      userId,
      input.repo_id || null,
      input.title,
      input.objective,
      input.priority ?? 0,
      input.assigned_automation_agent_id || null,
      input.dedupe_key || null,
      JSON.stringify(input.payload_json ?? {}),
    ]
  );
  return result.rows[0];
}

export async function listWorkItems(
  userId: string,
  query: WorkItemsQuery
): Promise<WorkItem[]> {
  let sql = `SELECT * FROM work_items WHERE user_id = $1`;
  const params: unknown[] = [userId];
  let index = 2;

  if (query.repo_id) {
    sql += ` AND repo_id = $${index++}`;
    params.push(query.repo_id);
  }
  if (query.status) {
    sql += ` AND status = $${index++}`;
    params.push(query.status);
  }
  if (query.assigned_automation_agent_id) {
    sql += ` AND assigned_automation_agent_id = $${index++}`;
    params.push(query.assigned_automation_agent_id);
  }
  sql += ` ORDER BY priority DESC, created_at ASC LIMIT $${index}`;
  params.push(query.limit);

  const result = await pool.query(sql, params);
  return result.rows;
}

export async function getWorkItemById(
  userId: string,
  id: string
): Promise<WorkItem | null> {
  const result = await pool.query(
    `SELECT * FROM work_items WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  return result.rows[0] || null;
}

export async function updateWorkItem(
  userId: string,
  id: string,
  updates: {
    status?: WorkItem['status'];
    priority?: number;
    assigned_automation_agent_id?: string | null;
  }
): Promise<WorkItem | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let index = 1;

  const addField = (column: string, value: unknown): void => {
    fields.push(`${column} = $${index++}`);
    values.push(value);
  };

  if (updates.status !== undefined) addField('status', updates.status);
  if (updates.priority !== undefined) addField('priority', updates.priority);
  if (updates.assigned_automation_agent_id !== undefined) {
    addField('assigned_automation_agent_id', updates.assigned_automation_agent_id || null);
  }

  if (fields.length === 0) {
    return getWorkItemById(userId, id);
  }

  values.push(id, userId);
  const result = await pool.query(
    `UPDATE work_items
     SET ${fields.join(', ')}
     WHERE id = $${index++} AND user_id = $${index}
     RETURNING *`,
    values
  );
  return result.rows[0] || null;
}

async function adoptStaleWorkItemCheckout(
  workItemId: string,
  agentId: string,
  runId: string
): Promise<WorkItem | null> {
  const result = await pool.query(
    `UPDATE work_items wi
     SET checkout_run_id = $3,
         updated_at = NOW()
     WHERE wi.id = $1
       AND wi.assigned_automation_agent_id = $2
       AND wi.status = 'in_progress'
       AND EXISTS (
         SELECT 1
         FROM automation_runs ar
         WHERE ar.id = wi.checkout_run_id
           AND ar.status NOT IN ('starting', 'running')
       )
     RETURNING *`,
    [workItemId, agentId, runId]
  );
  return result.rows[0] || null;
}

export async function checkoutWorkItem(input: {
  work_item_id: string;
  agent_id: string;
  run_id: string;
  expected_statuses?: string[];
}): Promise<WorkItem | null> {
  const expectedStatuses = input.expected_statuses ?? ['queued', 'blocked'];
  const updated = await pool.query(
    `UPDATE work_items
     SET status = 'in_progress',
         assigned_automation_agent_id = $2,
         checkout_run_id = $3,
         updated_at = NOW()
     WHERE id = $1
       AND status = ANY($4::text[])
       AND (checkout_run_id IS NULL OR checkout_run_id = $3)
       AND (assigned_automation_agent_id IS NULL OR assigned_automation_agent_id = $2)
     RETURNING *`,
    [input.work_item_id, input.agent_id, input.run_id, expectedStatuses]
  );
  if (updated.rows[0]) {
    return updated.rows[0];
  }

  const currentResult = await pool.query(
    `SELECT * FROM work_items WHERE id = $1`,
    [input.work_item_id]
  );
  const current = currentResult.rows[0] as WorkItem | undefined;
  if (!current) return null;

  if (
    current.status === 'in_progress' &&
    current.assigned_automation_agent_id === input.agent_id &&
    current.checkout_run_id === input.run_id
  ) {
    return current;
  }

  return adoptStaleWorkItemCheckout(input.work_item_id, input.agent_id, input.run_id);
}

export async function claimNextWorkItemForAgent(input: {
  user_id: string;
  agent_id: string;
  run_id: string;
  repo_id?: string | null;
}): Promise<WorkItem | null> {
  const result = await pool.query(
    `SELECT * FROM work_items
     WHERE user_id = $1
       AND status IN ('queued', 'blocked')
       AND (
         assigned_automation_agent_id IS NULL
         OR assigned_automation_agent_id = $2
       )
       AND ($3::uuid IS NULL OR repo_id = $3 OR repo_id IS NULL)
     ORDER BY priority DESC, created_at ASC
     LIMIT 1`,
    [input.user_id, input.agent_id, input.repo_id || null]
  );
  const next = result.rows[0] as WorkItem | undefined;
  if (!next) return null;
  return checkoutWorkItem({
    work_item_id: next.id,
    agent_id: input.agent_id,
    run_id: input.run_id,
  });
}

export async function completeWorkItem(
  workItemId: string,
  status: 'done' | 'cancelled' | 'blocked'
): Promise<WorkItem | null> {
  const result = await pool.query(
    `UPDATE work_items
     SET status = $2,
         checkout_run_id = NULL,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [workItemId, status]
  );
  return result.rows[0] || null;
}

export async function syncAutomationRunUsageFromSession(
  automationRunId: string,
  sessionId: string
): Promise<AutomationRun | null> {
  const usage = (await getSessionUsageLatest([sessionId]))[0];
  if (!usage) return null;
  return updateAutomationRun(automationRunId, {
    usage_json: {
      provider: usage.provider,
      estimated_cost_cents: usage.estimated_cost_cents ?? 0,
      total_tokens: usage.total_tokens ?? 0,
      reported_at: usage.reported_at,
    },
  });
}

export async function finalizeAutomationRunFromSession(
  automationRun: AutomationRun
): Promise<{
  run: AutomationRun;
  ingested: { memory: MemoryEntry | null; trajectory: MemoryTrajectory | null };
  work_item: WorkItem | null;
}> {
  if (!automationRun.session_id) {
    throw new Error('Automation run has no session_id');
  }

  const session = await getSessionById(automationRun.session_id);
  if (!session) {
    const run = await updateAutomationRun(automationRun.id, {
      status: 'failed',
      result_summary: 'Session missing during automation finalization',
      ended_at: new Date().toISOString(),
    });
    if (!run) throw new Error('Failed to update automation run');
    return {
      run,
      ingested: { memory: null, trajectory: null },
      work_item: null,
    };
  }

  const usageUpdated = await syncAutomationRunUsageFromSession(automationRun.id, automationRun.session_id);
  const finalStatus = session.status === 'ERROR'
    ? 'failed'
    : session.status === 'DONE' || session.status === 'WAITING_FOR_INPUT' || session.status === 'IDLE'
      ? 'succeeded'
      : 'cancelled';
  const finalRun = await updateAutomationRun(automationRun.id, {
    status: finalStatus,
    result_summary: session.title || `Session ${session.status}`,
    ended_at: new Date().toISOString(),
    usage_json: usageUpdated?.usage_json ? asJson(usageUpdated.usage_json) : undefined,
  });
  if (!finalRun) {
    throw new Error('Failed to finalize automation run');
  }

  const ingested = await ingestSessionToMemory({
    session_id: automationRun.session_id,
    automation_run_id: automationRun.id,
    objective: automationRun.objective,
  });

  let completedWorkItem: WorkItem | null = null;
  const wakeup = await pool.query(
    `SELECT context_json FROM automation_wakeups WHERE id = $1`,
    [automationRun.wakeup_id]
  );
  const context = asJson(wakeup.rows[0]?.context_json);
  const workItemId = typeof context.work_item_id === 'string' ? context.work_item_id : null;
  if (workItemId) {
    completedWorkItem = await completeWorkItem(
      workItemId,
      finalStatus === 'succeeded' ? 'done' : 'blocked'
    );
  }

  await markAutomationWakeupStatus(
    automationRun.wakeup_id,
    finalStatus === 'failed' ? 'failed' : 'completed',
    {
      session_id: automationRun.session_id,
      final_status: session.status,
    }
  );

  return { run: finalRun, ingested, work_item: completedWorkItem };
}

export async function describeRepo(repoId?: string | null): Promise<Repo | null> {
  if (!repoId) return null;
  return getRepoById(repoId);
}

export async function buildObjectiveFromWake(
  wakeup: ClaimedAutomationWakeup
): Promise<{ objective: string; workItem: WorkItem | null; repo: Repo | null }> {
  const context = asJson(wakeup.context_json);
  const repo = await describeRepo(wakeup.repo_id);
  const explicitObjective = typeof context.objective === 'string' ? context.objective.trim() : '';
  const agentUserId = wakeup.agent_user_id;

  let workItem: WorkItem | null = null;
  if (typeof context.work_item_id === 'string') {
    workItem = await getWorkItemById(agentUserId, context.work_item_id);
  } else if (wakeup.agent_role === 'worker') {
    // Claimed later once a run exists; here just preview the best candidate if present.
    const result = await pool.query(
      `SELECT * FROM work_items
       WHERE user_id = $1
         AND status IN ('queued', 'blocked')
         AND (
           assigned_automation_agent_id IS NULL
           OR assigned_automation_agent_id = $2
         )
         AND ($3::uuid IS NULL OR repo_id = $3 OR repo_id IS NULL)
       ORDER BY priority DESC, created_at ASC
       LIMIT 1`,
      [agentUserId, wakeup.automation_agent_id, wakeup.repo_id || null]
    );
    workItem = result.rows[0] || null;
  }

  const objective = explicitObjective
    || summarizeWorkItem(workItem)
    || [
      `Autonomous ${wakeup.agent_role} run for ${wakeup.agent_name}.`,
      repo?.display_name ? `Repository: ${repo.display_name}.` : null,
      `Review the current state, act within budget and scope, and leave the session in a clear terminal state.`,
    ]
      .filter(Boolean)
      .join(' ');

  return { objective, workItem, repo };
}
