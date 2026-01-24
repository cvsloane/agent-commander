import pg from 'pg';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import type {
  Host,
  Session,
  SessionUpsert,
  SessionSnapshot,
  Event,
  Approval,
  ApprovalDecision,
  SessionGroupWithCount,
  CreateGroupRequest,
  UpdateGroupRequest,
  ToolEvent,
  ToolEventStart,
  ToolEventComplete,
  ToolStat,
  SessionUsageSummary,
  Project,
} from '@agent-command/schema';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 20,
});

// Host queries
export async function upsertHost(host: {
  id: string;
  name: string;
  tailscale_name?: string;
  tailscale_ip?: string;
  capabilities: Record<string, unknown>;
  agent_version?: string;
}): Promise<Host> {
  const result = await pool.query(
    `INSERT INTO hosts (id, name, tailscale_name, tailscale_ip, capabilities, agent_version, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       tailscale_name = EXCLUDED.tailscale_name,
       tailscale_ip = EXCLUDED.tailscale_ip,
       capabilities = EXCLUDED.capabilities,
       agent_version = EXCLUDED.agent_version,
       last_seen_at = NOW()
     RETURNING *`,
    [
      host.id,
      host.name,
      host.tailscale_name || null,
      host.tailscale_ip || null,
      JSON.stringify(host.capabilities),
      host.agent_version || null,
    ]
  );
  return result.rows[0];
}

export async function createHost(host: {
  id: string;
  name: string;
  tailscale_name?: string;
  tailscale_ip?: string;
  capabilities?: Record<string, unknown>;
}): Promise<Host> {
  const result = await pool.query(
    `INSERT INTO hosts (id, name, tailscale_name, tailscale_ip, capabilities, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     RETURNING *`,
    [
      host.id,
      host.name,
      host.tailscale_name || null,
      host.tailscale_ip || null,
      JSON.stringify(host.capabilities || {}),
    ]
  );
  return result.rows[0];
}

export async function updateHostLastSeen(hostId: string): Promise<void> {
  await pool.query('UPDATE hosts SET last_seen_at = NOW() WHERE id = $1', [hostId]);
}

export async function updateHostAckedSeq(hostId: string, seq: number): Promise<void> {
  await pool.query('UPDATE hosts SET last_acked_seq = $2 WHERE id = $1', [hostId, seq]);
}

export async function getHosts(): Promise<Host[]> {
  const result = await pool.query('SELECT * FROM hosts ORDER BY last_seen_at DESC');
  return result.rows;
}

export async function getHostById(id: string): Promise<Host | null> {
  const result = await pool.query('SELECT * FROM hosts WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function updateHostCapabilities(
  hostId: string,
  capabilities: Record<string, unknown>
): Promise<Host | null> {
  const result = await pool.query(
    'UPDATE hosts SET capabilities = $2 WHERE id = $1 RETURNING *',
    [hostId, JSON.stringify(capabilities)]
  );
  return result.rows[0] || null;
}

// Agent token queries
export async function validateAgentToken(token: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT host_id, token_hash FROM agent_tokens
     WHERE revoked_at IS NULL`
  );

  for (const row of result.rows) {
    const matches = await bcrypt.compare(token, row.token_hash);
    if (matches) {
      return row.host_id;
    }
  }
  return null;
}

export async function createAgentToken(hostId: string, token: string): Promise<void> {
  const tokenHash = await bcrypt.hash(token, 10);
  await pool.query(
    `INSERT INTO agent_tokens (host_id, token_hash) VALUES ($1, $2)`,
    [hostId, tokenHash]
  );
}

// Session queries
export async function upsertSession(hostId: string, session: SessionUpsert): Promise<Session> {
  const result = await pool.query(
     `INSERT INTO sessions (
       id, host_id, kind, provider, status, title, cwd, repo_root,
       git_remote, git_branch, tmux_pane_id, tmux_target, metadata, last_activity_at,
       group_id, forked_from, fork_depth, archived_at, idled_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       title = COALESCE(EXCLUDED.title, sessions.title),
       cwd = COALESCE(EXCLUDED.cwd, sessions.cwd),
       repo_root = COALESCE(EXCLUDED.repo_root, sessions.repo_root),
       git_remote = COALESCE(EXCLUDED.git_remote, sessions.git_remote),
       git_branch = COALESCE(EXCLUDED.git_branch, sessions.git_branch),
       tmux_pane_id = EXCLUDED.tmux_pane_id,
       tmux_target = EXCLUDED.tmux_target,
       metadata = sessions.metadata || EXCLUDED.metadata,
       last_activity_at = COALESCE(EXCLUDED.last_activity_at, sessions.last_activity_at),
       group_id = COALESCE(EXCLUDED.group_id, sessions.group_id),
       forked_from = COALESCE(EXCLUDED.forked_from, sessions.forked_from),
       fork_depth = COALESCE(EXCLUDED.fork_depth, sessions.fork_depth),
       archived_at = COALESCE(EXCLUDED.archived_at, sessions.archived_at)
     RETURNING *`,
    [
      session.id,
      hostId,
      session.kind,
      session.provider,
      session.status,
      session.title || null,
      session.cwd || null,
      session.repo_root || null,
      session.git_remote || null,
      session.git_branch || null,
      session.tmux_pane_id ?? null,
      session.tmux_target ?? null,
      JSON.stringify(session.metadata || {}),
      session.last_activity_at || null,
      session.group_id ?? null,
      session.forked_from ?? null,
      session.fork_depth ?? null,
      session.archived_at ?? null,
      null,
    ]
  );
  return result.rows[0];
}

export async function pruneHostSessions(hostId: string, activeSessionIds: string[]): Promise<number> {
  const result = await pool.query(
    `UPDATE sessions
     SET archived_at = NOW(),
         status = 'DONE',
         tmux_pane_id = NULL,
         tmux_target = NULL
     WHERE host_id = $1
       AND archived_at IS NULL
       AND NOT (id = ANY($2::uuid[]))`,
    [hostId, activeSessionIds]
  );
  if ((result.rowCount || 0) > 0) {
    await pruneEmptyGroups();
  }
  return result.rowCount || 0;
}

type SessionFilters = {
  host_id?: string;
  status?: string | string[];
  provider?: string;
  needs_attention?: boolean;
  q?: string;
  group_id?: string | null;
  include_ungrouped?: boolean;
  include_archived?: boolean;
  archived_only?: boolean;
  unmanaged_only?: boolean;
};

function buildSessionsFilter(filters?: SessionFilters): { where: string; params: unknown[] } {
  let query = 'FROM sessions WHERE 1=1';
  const params: unknown[] = [];
  let paramIndex = 1;

  if (filters?.host_id) {
    query += ` AND host_id = $${paramIndex++}`;
    params.push(filters.host_id);
  }
  if (filters?.status) {
    const statuses = Array.isArray(filters.status)
      ? filters.status
      : filters.status.split(',').map((s) => s.trim()).filter(Boolean);
    if (statuses.length === 1) {
      query += ` AND status = $${paramIndex++}`;
      params.push(statuses[0]);
    } else if (statuses.length > 1) {
      query += ` AND status = ANY($${paramIndex++})`;
      params.push(statuses);
    }
  }
  if (filters?.provider) {
    query += ` AND provider = $${paramIndex++}`;
    params.push(filters.provider);
  }
  if (filters?.q) {
    query += ` AND (title ILIKE $${paramIndex} OR cwd ILIKE $${paramIndex} OR repo_root ILIKE $${paramIndex} OR git_branch ILIKE $${paramIndex})`;
    params.push(`%${filters.q}%`);
    paramIndex++;
  }
  if (filters?.needs_attention) {
    query += ` AND status IN ('WAITING_FOR_INPUT', 'WAITING_FOR_APPROVAL', 'ERROR')`;
  }
  // Group filtering
  if (filters?.group_id !== undefined) {
    if (filters.group_id === null || filters.include_ungrouped) {
      query += ` AND group_id IS NULL`;
    } else {
      query += ` AND group_id = $${paramIndex++}`;
      params.push(filters.group_id);
    }
  }
  // Archive filtering - default to excluding archived
  if (filters?.archived_only) {
    query += ` AND archived_at IS NOT NULL`;
  } else if (!filters?.include_archived) {
    query += ` AND archived_at IS NULL`;
  }
  // Unmanaged/orphan panes filter
  if (filters?.unmanaged_only) {
    query += ` AND (metadata->>'unmanaged')::boolean = true`;
  }

  return { where: query, params };
}

export async function getSessions(filters?: SessionFilters): Promise<Session[]> {
  const { where, params } = buildSessionsFilter(filters);
  const query = `SELECT * ${where} ORDER BY last_activity_at DESC NULLS LAST`;
  const result = await pool.query(query, params);
  return result.rows;
}

export async function getSessionsPage(
  filters: SessionFilters & { limit: number; offset?: number }
): Promise<{ sessions: Session[]; total: number }> {
  const { where, params } = buildSessionsFilter(filters);
  const countResult = await pool.query(`SELECT COUNT(*) ${where}`, params);
  const total = Number(countResult.rows[0]?.count || 0);

  const pageParams = [...params, filters.limit];
  let query = `SELECT * ${where} ORDER BY last_activity_at DESC NULLS LAST LIMIT $${pageParams.length}`;
  if (typeof filters.offset === 'number') {
    pageParams.push(filters.offset);
    query += ` OFFSET $${pageParams.length}`;
  }
  const result = await pool.query(query, pageParams);
  return { sessions: result.rows, total };
}

export async function getSessionById(id: string): Promise<Session | null> {
  const result = await pool.query('SELECT * FROM sessions WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function getSessionWithSnapshot(id: string): Promise<{
  session: Session;
  snapshot: SessionSnapshot | null;
  events: Event[];
  approvals: Approval[];
} | null> {
  const session = await getSessionById(id);
  if (!session) return null;

  const snapshotMaxChars = 200000;
  const [snapshotResult, eventsResult, approvalsResult] = await Promise.all([
    pool.query(
      `SELECT
         id,
         session_id,
         created_at,
         capture_hash,
         CASE
           WHEN capture_text IS NULL THEN ''
           WHEN length(capture_text) <= $2 THEN capture_text
           ELSE right(capture_text, $2)
         END AS capture_text
       FROM session_snapshots
       WHERE session_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [id, snapshotMaxChars]
    ),
    pool.query(
      `SELECT * FROM events WHERE session_id = $1 ORDER BY ts DESC LIMIT 50`,
      [id]
    ),
    pool.query(
      `SELECT * FROM approvals WHERE session_id = $1 ORDER BY ts_requested DESC`,
      [id]
    ),
  ]);

  return {
    session,
    snapshot: snapshotResult.rows[0] || null,
    events: eventsResult.rows,
    approvals: approvalsResult.rows,
  };
}

export async function getSessionsByIds(ids: string[]): Promise<Session[]> {
  if (ids.length === 0) return [];
  const result = await pool.query('SELECT * FROM sessions WHERE id = ANY($1)', [ids]);
  return result.rows;
}

// Get orphan (unmanaged) panes for a host
export async function getOrphanPanes(hostId: string): Promise<Session[]> {
  const result = await pool.query(
    `SELECT * FROM sessions
     WHERE host_id = $1
       AND (metadata->>'unmanaged')::boolean = true
       AND status != 'DONE'
       AND archived_at IS NULL
     ORDER BY last_activity_at DESC NULLS LAST`,
    [hostId]
  );
  return result.rows;
}

// Adopt orphan panes (mark them as managed)
export async function adoptOrphanPanes(sessionIds: string[], title?: string): Promise<{
  adopted: string[];
  errors: Array<{ session_id: string; error: string }>;
}> {
  const adopted: string[] = [];
  const errors: Array<{ session_id: string; error: string }> = [];

  for (const sessionId of sessionIds) {
    try {
      // Update the session's metadata to mark it as managed
      const result = await pool.query(
        `UPDATE sessions
         SET metadata = metadata - 'unmanaged' || '{"unmanaged": false}'::jsonb,
             title = COALESCE($2, title),
             updated_at = NOW()
         WHERE id = $1
           AND (metadata->>'unmanaged')::boolean = true
         RETURNING id`,
        [sessionId, title || null]
      );
      if (result.rowCount && result.rowCount > 0) {
        adopted.push(sessionId);
      } else {
        errors.push({ session_id: sessionId, error: 'Session not found or already managed' });
      }
    } catch (err) {
      errors.push({ session_id: sessionId, error: String(err) });
    }
  }

  return { adopted, errors };
}

export async function deleteSession(id: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE id = $1', [id]);
  await pruneEmptyGroups();
}

export async function updateSession(
  id: string,
  updates: { title?: string; idled_at?: string | null }
): Promise<Session | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (updates.title !== undefined) {
    fields.push(`title = $${paramIndex++}`);
    values.push(updates.title);
  }
  if (updates.idled_at !== undefined) {
    fields.push(`idled_at = $${paramIndex++}`);
    values.push(updates.idled_at);
  }

  if (fields.length === 0) {
    return getSessionById(id);
  }

  values.push(id);
  const result = await pool.query(
    `UPDATE sessions SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${paramIndex} RETURNING *`,
    values
  );
  return result.rows[0] || null;
}

// Snapshot queries
export async function insertSnapshot(
  sessionId: string,
  captureHash: string,
  captureText: string
): Promise<SessionSnapshot> {
  // Check if snapshot with same hash already exists
  const existing = await pool.query(
    `SELECT id FROM session_snapshots WHERE session_id = $1 AND capture_hash = $2`,
    [sessionId, captureHash]
  );

  if (existing.rows.length > 0) {
    // Return existing snapshot without inserting
    const result = await pool.query(
      `SELECT * FROM session_snapshots WHERE id = $1`,
      [existing.rows[0].id]
    );
    return result.rows[0];
  }

  const result = await pool.query(
    `INSERT INTO session_snapshots (session_id, capture_text, capture_hash)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [sessionId, captureText, captureHash]
  );
  await pool.query(
    `UPDATE sessions SET last_activity_at = NOW() WHERE id = $1`,
    [sessionId]
  );
  return result.rows[0];
}

export async function getLatestSnapshot(sessionId: string): Promise<SessionSnapshot | null> {
  const result = await pool.query(
    `SELECT * FROM session_snapshots WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [sessionId]
  );
  return result.rows[0] || null;
}

export async function getLatestSnapshots(
  sessionIds: string[],
  maxChars = 4000
): Promise<SessionSnapshot[]> {
  if (sessionIds.length === 0) return [];
  const result = await pool.query(
    `SELECT DISTINCT ON (session_id)
        id,
        session_id,
        created_at,
        capture_hash,
        CASE
          WHEN capture_text IS NULL THEN ''
          WHEN length(capture_text) <= $2 THEN capture_text
          ELSE right(capture_text, $2)
        END AS capture_text
     FROM session_snapshots
     WHERE session_id = ANY($1)
     ORDER BY session_id, created_at DESC`,
    [sessionIds, maxChars]
  );
  return result.rows;
}

// Event queries
export async function insertEvent(
  sessionId: string,
  type: string,
  payload: Record<string, unknown>,
  eventId?: string
): Promise<Event> {
  const result = await pool.query(
    `INSERT INTO events (session_id, type, event_id, payload)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (session_id, event_id) WHERE event_id IS NOT NULL DO NOTHING
     RETURNING *`,
    [sessionId, type, eventId || null, JSON.stringify(payload)]
  );
  return result.rows[0];
}

export async function getEvents(
  sessionId: string,
  cursor?: number,
  limit = 50
): Promise<Event[]> {
  let query = `SELECT * FROM events WHERE session_id = $1`;
  const params: unknown[] = [sessionId];
  let paramIndex = 2;

  if (cursor) {
    query += ` AND id < $${paramIndex++}`;
    params.push(cursor);
  }

  query += ` ORDER BY ts DESC LIMIT $${paramIndex}`;
  params.push(limit);

  const result = await pool.query(query, params);
  return result.rows;
}

// Approval queries
export async function createApproval(
  sessionId: string,
  provider: string,
  requestedPayload: Record<string, unknown>,
  approvalId?: string
): Promise<Approval> {
  const id = approvalId || crypto.randomUUID();
  await markPendingApprovalsTimedOutForSession(sessionId, id);
  const result = await pool.query(
    `INSERT INTO approvals (id, session_id, provider, requested_payload)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING
     RETURNING *`,
    [id, sessionId, provider, JSON.stringify(requestedPayload)]
  );
  if (result.rows[0]) {
    await updateApprovalMetrics(sessionId, 'requested');
    return result.rows[0];
  }

  const existing = await pool.query('SELECT * FROM approvals WHERE id = $1', [id]);
  return existing.rows[0];
}

export async function getApprovals(filters?: {
  status?: 'pending' | 'decided';
  session_id?: string;
}): Promise<Approval[]> {
  let query = 'SELECT * FROM approvals WHERE 1=1';
  const params: unknown[] = [];
  let paramIndex = 1;

  if (filters?.status === 'pending') {
    query += ' AND decision IS NULL AND timed_out_at IS NULL';
  } else if (filters?.status === 'decided') {
    query += ' AND decision IS NOT NULL';
  }

  if (filters?.session_id) {
    query += ` AND session_id = $${paramIndex++}`;
    params.push(filters.session_id);
  }

  query += ' ORDER BY ts_requested DESC';
  const result = await pool.query(query, params);
  return result.rows;
}

export async function getApprovalById(id: string): Promise<Approval | null> {
  const result = await pool.query('SELECT * FROM approvals WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function decideApproval(
  id: string,
  decision: ApprovalDecision,
  decidedPayload: Record<string, unknown>,
  userId?: string
): Promise<Approval | null> {
  const result = await pool.query(
    `UPDATE approvals SET
       decision = $2,
       decided_payload = $3,
       decided_by_user_id = $4,
       ts_decided = NOW()
     WHERE id = $1 AND decision IS NULL AND timed_out_at IS NULL
     RETURNING *`,
    [id, decision, JSON.stringify(decidedPayload), userId || null]
  );
  return result.rows[0] || null;
}

// Clear session approval metadata (after approval is decided)
export async function clearSessionApprovalMetadata(sessionId: string): Promise<Session | null> {
  const result = await pool.query(
    `UPDATE sessions
     SET metadata = CASE
       WHEN status = 'WAITING_FOR_APPROVAL' THEN (metadata - 'approval' - 'status_detail')
       ELSE (metadata - 'approval')
     END,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [sessionId]
  );
  return result.rows[0] || null;
}

// Mark pending approvals as timed out (superseded by new approval)
export async function markPendingApprovalsTimedOutForSession(
  sessionId: string,
  excludeApprovalId?: string
): Promise<string[]> {
  const params: unknown[] = [sessionId];
  let query = `UPDATE approvals
     SET timed_out_at = NOW()
     WHERE session_id = $1 AND decision IS NULL AND timed_out_at IS NULL`;
  if (excludeApprovalId) {
    query += ` AND id <> $2`;
    params.push(excludeApprovalId);
  }
  query += ' RETURNING id';
  const result = await pool.query(query, params);
  return result.rows.map((row) => row.id as string);
}

// Mark approval as timed out (explicit stale/superseded)
export async function markApprovalTimedOut(approvalId: string): Promise<Approval | null> {
  const result = await pool.query(
    `UPDATE approvals SET
       timed_out_at = NOW()
     WHERE id = $1 AND decision IS NULL AND timed_out_at IS NULL
     RETURNING *`,
    [approvalId]
  );
  return result.rows[0] || null;
}

// Get pending approval for a session (not decided and not timed out)
export async function getPendingApprovalForSession(sessionId: string): Promise<Approval | null> {
  const result = await pool.query(
    `SELECT * FROM approvals
     WHERE session_id = $1 AND decision IS NULL AND timed_out_at IS NULL
     ORDER BY ts_requested DESC
     LIMIT 1`,
    [sessionId]
  );
  return result.rows[0] || null;
}

// Audit log
export async function createAuditLog(
  action: string,
  objectType: string,
  objectId: string,
  payload: Record<string, unknown>,
  userId?: string
): Promise<void> {
  await pool.query(
    `INSERT INTO audit_log (user_id, action, object_type, object_id, payload)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId || null, action, objectType, objectId, JSON.stringify(payload)]
  );
}

// Session Group queries
export async function getGroups(): Promise<SessionGroupWithCount[]> {
  const result = await pool.query(
    `SELECT g.*, COUNT(s.id) as session_count
     FROM session_groups g
     LEFT JOIN sessions s
       ON s.group_id = g.id
      AND s.archived_at IS NULL
      AND s.status != 'DONE'
     GROUP BY g.id
     ORDER BY g.sort_order, g.name`
  );
  return result.rows.map((row) => ({
    ...row,
    session_count: parseInt(row.session_count, 10),
  }));
}

export async function getGroupById(id: string): Promise<SessionGroupWithCount | null> {
  const result = await pool.query(
    `SELECT g.*, COUNT(s.id) as session_count
     FROM session_groups g
     LEFT JOIN sessions s
       ON s.group_id = g.id
      AND s.archived_at IS NULL
      AND s.status != 'DONE'
     WHERE g.id = $1
     GROUP BY g.id`,
    [id]
  );
  if (!result.rows[0]) return null;
  return {
    ...result.rows[0],
    session_count: parseInt(result.rows[0].session_count, 10),
  };
}

export async function pruneEmptyGroups(): Promise<number> {
  const result = await pool.query(
    `WITH RECURSIVE active AS (
       SELECT DISTINCT g.id, g.parent_id
       FROM session_groups g
       JOIN sessions s
         ON s.group_id = g.id
        AND s.archived_at IS NULL
        AND s.status != 'DONE'
     ),
     keep AS (
       SELECT id, parent_id FROM active
       UNION
       SELECT g.id, g.parent_id
       FROM session_groups g
       JOIN keep k ON g.id = k.parent_id
     )
     DELETE FROM session_groups g
     WHERE NOT EXISTS (SELECT 1 FROM keep k WHERE k.id = g.id)`
  );
  return result.rowCount || 0;
}

export async function createGroup(group: CreateGroupRequest): Promise<SessionGroupWithCount> {
  const result = await pool.query(
    `INSERT INTO session_groups (name, parent_id, color, icon, sort_order)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      group.name,
      group.parent_id || null,
      group.color || '#6366f1',
      group.icon || 'folder',
      group.sort_order ?? 0,
    ]
  );
  return { ...result.rows[0], session_count: 0 };
}

export async function getGroupByName(
  name: string,
  parentId?: string | null
): Promise<SessionGroupWithCount | null> {
  const result = await pool.query(
    `SELECT g.*, COUNT(s.id) as session_count
     FROM session_groups g
     LEFT JOIN sessions s
       ON s.group_id = g.id
      AND s.archived_at IS NULL
      AND s.status != 'DONE'
     WHERE lower(g.name) = lower($1)
       AND (($2::uuid IS NULL AND g.parent_id IS NULL) OR g.parent_id = $2)
     GROUP BY g.id
     LIMIT 1`,
    [name, parentId ?? null]
  );

  if (!result.rows[0]) return null;
  return {
    ...result.rows[0],
    session_count: parseInt(result.rows[0].session_count, 10),
  };
}

export async function getOrCreateGroupByName(
  name: string,
  parentId?: string | null
): Promise<SessionGroupWithCount> {
  const existing = await getGroupByName(name, parentId);
  if (existing) return existing;

  try {
    return await createGroup({ name, parent_id: parentId ?? undefined });
  } catch (error) {
    const pgError = error as { code?: string };
    if (pgError.code === '23505') {
      const retry = await getGroupByName(name, parentId);
      if (retry) return retry;
    }
    throw error;
  }
}

export async function updateGroup(
  id: string,
  updates: UpdateGroupRequest
): Promise<SessionGroupWithCount | null> {
  // Check for cycles if parent_id is being updated
  if (updates.parent_id !== undefined) {
    const cycleCheck = await pool.query(
      `SELECT check_group_cycle($1, $2) as has_cycle`,
      [id, updates.parent_id]
    );
    if (cycleCheck.rows[0]?.has_cycle) {
      throw new Error('Cannot set parent: would create a cycle in the group hierarchy');
    }
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (updates.name !== undefined) {
    fields.push(`name = $${paramIndex++}`);
    values.push(updates.name);
  }
  if (updates.parent_id !== undefined) {
    fields.push(`parent_id = $${paramIndex++}`);
    values.push(updates.parent_id);
  }
  if (updates.color !== undefined) {
    fields.push(`color = $${paramIndex++}`);
    values.push(updates.color);
  }
  if (updates.icon !== undefined) {
    fields.push(`icon = $${paramIndex++}`);
    values.push(updates.icon);
  }
  if (updates.sort_order !== undefined) {
    fields.push(`sort_order = $${paramIndex++}`);
    values.push(updates.sort_order);
  }

  if (fields.length === 0) {
    return getGroupById(id);
  }

  values.push(id);
  const result = await pool.query(
    `UPDATE session_groups SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );

  if (!result.rows[0]) return null;

  // Get session count
  const countResult = await pool.query(
    `SELECT COUNT(*) as count
     FROM sessions
     WHERE group_id = $1
       AND archived_at IS NULL
       AND status != 'DONE'`,
    [id]
  );
  return {
    ...result.rows[0],
    session_count: parseInt(countResult.rows[0].count, 10),
  };
}

export async function deleteGroup(id: string): Promise<void> {
  // Get the group's parent_id for reparenting children
  const group = await pool.query(
    `SELECT parent_id FROM session_groups WHERE id = $1`,
    [id]
  );
  const parentId = group.rows[0]?.parent_id || null;

  // Reparent sessions to parent group (or null)
  await pool.query(
    `UPDATE sessions SET group_id = $2 WHERE group_id = $1`,
    [id, parentId]
  );

  // Reparent child groups to parent group (or null)
  await pool.query(
    `UPDATE session_groups SET parent_id = $2 WHERE parent_id = $1`,
    [id, parentId]
  );

  // Delete the group
  await pool.query(`DELETE FROM session_groups WHERE id = $1`, [id]);
}

// Project queries
export async function getProjects(userId: string, filters?: {
  host_id?: string;
  q?: string;
  limit?: number;
}): Promise<Project[]> {
  let query = 'SELECT * FROM projects WHERE user_id = $1';
  const params: unknown[] = [userId];
  let paramIndex = 2;

  if (filters?.host_id) {
    query += ` AND host_id = $${paramIndex++}`;
    params.push(filters.host_id);
  }
  if (filters?.q) {
    query += ` AND (path ILIKE $${paramIndex} OR display_name ILIKE $${paramIndex})`;
    params.push(`%${filters.q}%`);
    paramIndex++;
  }

  query += ' ORDER BY last_used_at DESC NULLS LAST, usage_count DESC NULLS LAST';
  if (filters?.limit) {
    query += ` LIMIT $${paramIndex++}`;
    params.push(filters.limit);
  }

  const result = await pool.query(query, params);
  return result.rows;
}

export async function touchProject(data: {
  user_id: string;
  host_id: string;
  path: string;
  display_name?: string | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO projects (user_id, host_id, path, display_name, last_used_at, usage_count)
     VALUES ($1, $2, $3, $4, NOW(), 1)
     ON CONFLICT (user_id, host_id, path) DO UPDATE SET
       last_used_at = NOW(),
       usage_count = projects.usage_count + 1,
       display_name = COALESCE(EXCLUDED.display_name, projects.display_name)`,
    [data.user_id, data.host_id, data.path, data.display_name || null]
  );
}

// User settings (persisted UI preferences)
export async function getUserSettings(userSubject: string): Promise<Record<string, unknown> | null> {
  const result = await pool.query(
    `SELECT settings FROM user_settings WHERE user_subject = $1`,
    [userSubject]
  );
  return result.rows[0]?.settings ?? null;
}

export async function upsertUserSettings(
  userSubject: string,
  settings: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const result = await pool.query(
    `INSERT INTO user_settings (user_subject, settings)
     VALUES ($1, $2)
     ON CONFLICT (user_subject) DO UPDATE
       SET settings = EXCLUDED.settings
     RETURNING settings`,
    [userSubject, JSON.stringify(settings)]
  );
  return result.rows[0]?.settings ?? {};
}

export async function assignSessionGroup(
  sessionId: string,
  groupId: string | null
): Promise<Session | null> {
  const result = await pool.query(
    `UPDATE sessions SET group_id = $2 WHERE id = $1 RETURNING *`,
    [sessionId, groupId]
  );
  if (result.rows[0]) {
    await pruneEmptyGroups();
    return result.rows[0];
  }
  return null;
}

// Search queries
export interface SearchResult {
  type: 'session' | 'event' | 'snapshot';
  id: string;
  session_id?: string;
  score: number;
  highlight: string;
  title?: string;
  cwd?: string;
}

export async function search(
  query: string,
  options?: {
    types?: Array<'sessions' | 'events' | 'snapshots'>;
    limit?: number;
    offset?: number;
  }
): Promise<SearchResult[]> {
  const types = options?.types || ['sessions', 'events', 'snapshots'];
  const limit = Math.min(options?.limit || 50, 100);
  const offset = options?.offset || 0;
  const results: SearchResult[] = [];

  if (types.includes('sessions')) {
    const sessionResults = await pool.query(
      `SELECT id, ts_rank_cd(search_vector, plainto_tsquery('english', $1)) AS score,
              ts_headline('english', COALESCE(title, '') || ' ' || COALESCE(cwd, ''),
                          plainto_tsquery('english', $1),
                          'MaxWords=50, MinWords=10, StartSel=**, StopSel=**') AS highlight,
              title, cwd
       FROM sessions
       WHERE search_vector @@ plainto_tsquery('english', $1)
       ORDER BY score DESC
       LIMIT $2 OFFSET $3`,
      [query, limit, offset]
    );
    results.push(
      ...sessionResults.rows.map((row) => ({
        type: 'session' as const,
        id: row.id,
        score: parseFloat(row.score),
        highlight: row.highlight,
        title: row.title,
        cwd: row.cwd,
      }))
    );
  }

  if (types.includes('events')) {
    const eventResults = await pool.query(
      `SELECT id, session_id, ts_rank_cd(search_vector, plainto_tsquery('english', $1)) AS score,
              ts_headline('english', type || ' ' || COALESCE(payload::text, ''),
                          plainto_tsquery('english', $1),
                          'MaxWords=50, MinWords=10, StartSel=**, StopSel=**') AS highlight
       FROM events
       WHERE search_vector @@ plainto_tsquery('english', $1)
       ORDER BY score DESC
       LIMIT $2 OFFSET $3`,
      [query, limit, offset]
    );
    results.push(
      ...eventResults.rows.map((row) => ({
        type: 'event' as const,
        id: row.id.toString(),
        session_id: row.session_id,
        score: parseFloat(row.score),
        highlight: row.highlight,
      }))
    );
  }

  if (types.includes('snapshots')) {
    const snapshotResults = await pool.query(
      `SELECT ss.id, ss.session_id,
              ts_rank_cd(ss.search_vector, plainto_tsquery('english', $1)) AS score,
              ts_headline('english', ss.capture_text,
                          plainto_tsquery('english', $1),
                          'MaxWords=50, MinWords=10, StartSel=**, StopSel=**') AS highlight
       FROM session_snapshots ss
       WHERE ss.search_vector @@ plainto_tsquery('english', $1)
       ORDER BY score DESC
       LIMIT $2 OFFSET $3`,
      [query, limit, offset]
    );
    results.push(
      ...snapshotResults.rows.map((row) => ({
        type: 'snapshot' as const,
        id: row.id.toString(),
        session_id: row.session_id,
        score: parseFloat(row.score),
        highlight: row.highlight,
      }))
    );
  }

  // Sort all results by score and apply overall limit
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

// Fork session
export async function forkSession(
  parentSessionId: string,
  newSessionId: string,
  hostId: string,
  options?: {
    cwd?: string;
    group_id?: string;
    note?: string;
  }
): Promise<Session | null> {
  const parent = await getSessionById(parentSessionId);
  if (!parent) return null;

  const result = await pool.query(
    `INSERT INTO sessions (
       id, host_id, kind, provider, status, title, cwd, repo_root,
       git_remote, git_branch, tmux_pane_id, tmux_target, metadata,
       forked_from, fork_depth, group_id
     )
     SELECT $1, $2, kind, provider, 'STARTING',
            COALESCE($5, title) || ' (fork)',
            COALESCE($3, cwd), repo_root, git_remote, git_branch,
            NULL, NULL, metadata, id, fork_depth + 1, $4
     FROM sessions WHERE id = $6
     RETURNING *`,
    [
      newSessionId,
      hostId,
      options?.cwd || null,
      options?.group_id || null,
      options?.note || null,
      parentSessionId,
    ]
  );
  return result.rows[0] || null;
}

export async function testConnection(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

// Bulk Operations
export interface BulkOperationError {
  session_id: string;
  error: string;
}

export interface BulkOperationResult {
  success_count: number;
  error_count: number;
  errors: BulkOperationError[];
}

export async function bulkDeleteSessions(sessionIds: string[]): Promise<BulkOperationResult> {
  const errors: BulkOperationError[] = [];
  let successCount = 0;

  for (const id of sessionIds) {
    try {
      const result = await pool.query('DELETE FROM sessions WHERE id = $1', [id]);
      if (result.rowCount && result.rowCount > 0) {
        successCount++;
      } else {
        errors.push({ session_id: id, error: 'Session not found' });
      }
    } catch (err) {
      errors.push({ session_id: id, error: (err as Error).message });
    }
  }

  if (successCount > 0) {
    await pruneEmptyGroups();
  }
  return { success_count: successCount, error_count: errors.length, errors };
}

export async function bulkArchiveSessions(sessionIds: string[]): Promise<BulkOperationResult> {
  const errors: BulkOperationError[] = [];
  let successCount = 0;

  for (const id of sessionIds) {
    try {
      const result = await pool.query(
        'UPDATE sessions SET archived_at = NOW() WHERE id = $1 AND archived_at IS NULL',
        [id]
      );
      if (result.rowCount && result.rowCount > 0) {
        successCount++;
      } else {
        errors.push({ session_id: id, error: 'Session not found or already archived' });
      }
    } catch (err) {
      errors.push({ session_id: id, error: (err as Error).message });
    }
  }

  if (successCount > 0) {
    await pruneEmptyGroups();
  }
  return { success_count: successCount, error_count: errors.length, errors };
}

export async function bulkUnarchiveSessions(sessionIds: string[]): Promise<BulkOperationResult> {
  const errors: BulkOperationError[] = [];
  let successCount = 0;

  for (const id of sessionIds) {
    try {
      const result = await pool.query(
        'UPDATE sessions SET archived_at = NULL WHERE id = $1 AND archived_at IS NOT NULL',
        [id]
      );
      if (result.rowCount && result.rowCount > 0) {
        successCount++;
      } else {
        errors.push({ session_id: id, error: 'Session not found or not archived' });
      }
    } catch (err) {
      errors.push({ session_id: id, error: (err as Error).message });
    }
  }

  return { success_count: successCount, error_count: errors.length, errors };
}

export async function archiveSessions(sessionIds: string[]): Promise<void> {
  if (sessionIds.length === 0) return;
  await pool.query(
    'UPDATE sessions SET archived_at = NOW() WHERE id = ANY($1::uuid[])',
    [sessionIds]
  );
  await pruneEmptyGroups();
}

export async function bulkIdleSessions(sessionIds: string[]): Promise<BulkOperationResult> {
  const errors: BulkOperationError[] = [];
  let successCount = 0;

  for (const id of sessionIds) {
    try {
      const result = await pool.query(
        'UPDATE sessions SET idled_at = NOW(), updated_at = NOW() WHERE id = $1 AND idled_at IS NULL',
        [id]
      );
      if (result.rowCount && result.rowCount > 0) {
        successCount++;
      } else {
        errors.push({ session_id: id, error: 'Session not found or already idled' });
      }
    } catch (err) {
      errors.push({ session_id: id, error: (err as Error).message });
    }
  }

  return { success_count: successCount, error_count: errors.length, errors };
}

export async function bulkUnidleSessions(sessionIds: string[]): Promise<BulkOperationResult> {
  const errors: BulkOperationError[] = [];
  let successCount = 0;

  for (const id of sessionIds) {
    try {
      const result = await pool.query(
        'UPDATE sessions SET idled_at = NULL, updated_at = NOW() WHERE id = $1 AND idled_at IS NOT NULL',
        [id]
      );
      if (result.rowCount && result.rowCount > 0) {
        successCount++;
      } else {
        errors.push({ session_id: id, error: 'Session not found or not idled' });
      }
    } catch (err) {
      errors.push({ session_id: id, error: (err as Error).message });
    }
  }

  return { success_count: successCount, error_count: errors.length, errors };
}

export async function bulkAssignGroup(
  sessionIds: string[],
  groupId: string | null
): Promise<BulkOperationResult> {
  const errors: BulkOperationError[] = [];
  let successCount = 0;

  for (const id of sessionIds) {
    try {
      const result = await pool.query(
        'UPDATE sessions SET group_id = $2 WHERE id = $1',
        [id, groupId]
      );
      if (result.rowCount && result.rowCount > 0) {
        successCount++;
      } else {
        errors.push({ session_id: id, error: 'Session not found' });
      }
    } catch (err) {
      errors.push({ session_id: id, error: (err as Error).message });
    }
  }

  if (successCount > 0) {
    await pruneEmptyGroups();
  }
  return { success_count: successCount, error_count: errors.length, errors };
}

// Analytics queries
export interface SessionMetrics {
  id?: number;
  session_id: string;
  tokens_in: number;
  tokens_out: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  tool_calls: number;
  approvals_requested: number;
  approvals_granted: number;
  approvals_denied: number;
  first_event_at: string | null;
  last_event_at: string | null;
  estimated_cost_cents: number;
  created_at?: string;
  updated_at?: string;
}

export async function getSessionMetrics(sessionId: string): Promise<SessionMetrics | null> {
  const result = await pool.query(
    'SELECT * FROM session_metrics WHERE session_id = $1',
    [sessionId]
  );
  return result.rows[0] || null;
}

export async function recordTokenUsage(data: {
  session_id: string;
  event_id?: number;
  tokens_in?: number;
  tokens_out?: number;
  tokens_cache_read?: number;
  tokens_cache_write?: number;
  tool_name?: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO token_events (session_id, event_id, tokens_in, tokens_out, tokens_cache_read, tokens_cache_write, tool_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      data.session_id,
      data.event_id || null,
      data.tokens_in || 0,
      data.tokens_out || 0,
      data.tokens_cache_read || 0,
      data.tokens_cache_write || 0,
      data.tool_name || null,
    ]
  );
}

export async function recordProviderUsage(data: {
  provider: string;
  host_id?: string | null;
  session_id?: string | null;
  scope?: 'account' | 'session';
  reported_at?: string;
  raw_text?: string;
  raw_json?: Record<string, unknown>;
  remaining_tokens?: number;
  remaining_requests?: number;
  weekly_limit_tokens?: number;
  weekly_remaining_tokens?: number;
  weekly_remaining_cost_cents?: number;
  reset_at?: string;
  five_hour_utilization?: number;
  five_hour_reset_at?: string;
  weekly_utilization?: number;
  weekly_reset_at?: string;
  weekly_opus_utilization?: number;
  weekly_opus_reset_at?: string;
  weekly_sonnet_utilization?: number;
  weekly_sonnet_reset_at?: string;
  daily_utilization?: number;
  daily_reset_at?: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO provider_usage (
      provider,
      host_id,
      session_id,
      scope,
      reported_at,
      raw_text,
      raw_json,
      remaining_tokens,
      remaining_requests,
      weekly_limit_tokens,
      weekly_remaining_tokens,
      weekly_remaining_cost_cents,
      reset_at,
      five_hour_utilization,
      five_hour_reset_at,
      weekly_utilization,
      weekly_reset_at,
      weekly_opus_utilization,
      weekly_opus_reset_at,
      weekly_sonnet_utilization,
      weekly_sonnet_reset_at,
      daily_utilization,
      daily_reset_at
    ) VALUES ($1, $2, $3, $4, COALESCE($5, NOW()), $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)`,
    [
      data.provider,
      data.host_id || null,
      data.session_id || null,
      data.scope || 'account',
      data.reported_at || null,
      data.raw_text || null,
      data.raw_json || null,
      data.remaining_tokens ?? null,
      data.remaining_requests ?? null,
      data.weekly_limit_tokens ?? null,
      data.weekly_remaining_tokens ?? null,
      data.weekly_remaining_cost_cents ?? null,
      data.reset_at || null,
      data.five_hour_utilization ?? null,
      data.five_hour_reset_at || null,
      data.weekly_utilization ?? null,
      data.weekly_reset_at || null,
      data.weekly_opus_utilization ?? null,
      data.weekly_opus_reset_at || null,
      data.weekly_sonnet_utilization ?? null,
      data.weekly_sonnet_reset_at || null,
      data.daily_utilization ?? null,
      data.daily_reset_at || null,
    ]
  );
}

export async function getLatestProviderUsage(filters?: {
  provider?: string;
  host_id?: string;
  session_id?: string;
  scope?: 'account' | 'session';
}): Promise<Array<{
  provider: string;
  host_id: string | null;
  session_id: string | null;
  scope: string;
  reported_at: string;
  raw_text: string | null;
  raw_json: Record<string, unknown> | null;
  remaining_tokens: number | null;
  remaining_requests: number | null;
  weekly_limit_tokens: number | null;
  weekly_remaining_tokens: number | null;
  weekly_remaining_cost_cents: number | null;
  reset_at: string | null;
  five_hour_utilization: number | null;
  five_hour_reset_at: string | null;
  weekly_utilization: number | null;
  weekly_reset_at: string | null;
  weekly_opus_utilization: number | null;
  weekly_opus_reset_at: string | null;
  weekly_sonnet_utilization: number | null;
  weekly_sonnet_reset_at: string | null;
  daily_utilization: number | null;
  daily_reset_at: string | null;
}>> {
  let whereClause = 'WHERE 1=1';
  const params: (string | undefined)[] = [];
  let paramIndex = 1;

  if (filters?.provider) {
    whereClause += ` AND provider = $${paramIndex++}`;
    params.push(filters.provider);
  }
  if (filters?.host_id) {
    whereClause += ` AND host_id = $${paramIndex++}`;
    params.push(filters.host_id);
  }
  if (filters?.session_id) {
    whereClause += ` AND session_id = $${paramIndex++}`;
    params.push(filters.session_id);
  }
  if (filters?.scope) {
    whereClause += ` AND scope = $${paramIndex++}`;
    params.push(filters.scope);
  }

  const result = await pool.query(
    `SELECT DISTINCT ON (provider, host_id, scope, session_id)
      provider,
      host_id,
      session_id,
      scope,
      reported_at,
      raw_text,
      raw_json,
      remaining_tokens,
      remaining_requests,
      weekly_limit_tokens,
      weekly_remaining_tokens,
      weekly_remaining_cost_cents,
      reset_at,
      five_hour_utilization,
      five_hour_reset_at,
      weekly_utilization,
      weekly_reset_at,
      weekly_opus_utilization,
      weekly_opus_reset_at,
      weekly_sonnet_utilization,
      weekly_sonnet_reset_at,
      daily_utilization,
      daily_reset_at
     FROM provider_usage
     ${whereClause}
     ORDER BY provider, host_id, scope, session_id, reported_at DESC, (raw_json IS NOT NULL) DESC`,
    params
  );

  return result.rows;
}

// Session usage summary (latest per session)
export async function upsertSessionUsageLatest(usage: SessionUsageSummary): Promise<void> {
  await pool.query(
    `INSERT INTO session_usage_latest (
      session_id,
      provider,
      input_tokens,
      output_tokens,
      total_tokens,
      cache_read_tokens,
      cache_write_tokens,
      estimated_cost_cents,
      reported_at,
      raw_usage_line,
      session_utilization_percent,
      session_left_percent,
      session_reset_text,
      weekly_utilization_percent,
      weekly_left_percent,
      weekly_reset_text,
      weekly_sonnet_utilization_percent,
      weekly_sonnet_reset_text,
      weekly_opus_utilization_percent,
      weekly_opus_reset_text,
      context_used_tokens,
      context_total_tokens,
      context_left_percent,
      five_hour_left_percent,
      five_hour_reset_text
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25
    )
    ON CONFLICT (session_id) DO UPDATE SET
      provider = EXCLUDED.provider,
      input_tokens = EXCLUDED.input_tokens,
      output_tokens = EXCLUDED.output_tokens,
      total_tokens = EXCLUDED.total_tokens,
      cache_read_tokens = EXCLUDED.cache_read_tokens,
      cache_write_tokens = EXCLUDED.cache_write_tokens,
      estimated_cost_cents = EXCLUDED.estimated_cost_cents,
      reported_at = EXCLUDED.reported_at,
      raw_usage_line = EXCLUDED.raw_usage_line,
      session_utilization_percent = EXCLUDED.session_utilization_percent,
      session_left_percent = EXCLUDED.session_left_percent,
      session_reset_text = EXCLUDED.session_reset_text,
      weekly_utilization_percent = EXCLUDED.weekly_utilization_percent,
      weekly_left_percent = EXCLUDED.weekly_left_percent,
      weekly_reset_text = EXCLUDED.weekly_reset_text,
      weekly_sonnet_utilization_percent = EXCLUDED.weekly_sonnet_utilization_percent,
      weekly_sonnet_reset_text = EXCLUDED.weekly_sonnet_reset_text,
      weekly_opus_utilization_percent = EXCLUDED.weekly_opus_utilization_percent,
      weekly_opus_reset_text = EXCLUDED.weekly_opus_reset_text,
      context_used_tokens = EXCLUDED.context_used_tokens,
      context_total_tokens = EXCLUDED.context_total_tokens,
      context_left_percent = EXCLUDED.context_left_percent,
      five_hour_left_percent = EXCLUDED.five_hour_left_percent,
      five_hour_reset_text = EXCLUDED.five_hour_reset_text`,
    [
      usage.session_id,
      usage.provider,
      usage.input_tokens ?? null,
      usage.output_tokens ?? null,
      usage.total_tokens ?? null,
      usage.cache_read_tokens ?? null,
      usage.cache_write_tokens ?? null,
      usage.estimated_cost_cents ?? null,
      usage.reported_at,
      usage.raw_usage_line ?? null,
      usage.session_utilization_percent ?? null,
      usage.session_left_percent ?? null,
      usage.session_reset_text ?? null,
      usage.weekly_utilization_percent ?? null,
      usage.weekly_left_percent ?? null,
      usage.weekly_reset_text ?? null,
      usage.weekly_sonnet_utilization_percent ?? null,
      usage.weekly_sonnet_reset_text ?? null,
      usage.weekly_opus_utilization_percent ?? null,
      usage.weekly_opus_reset_text ?? null,
      usage.context_used_tokens ?? null,
      usage.context_total_tokens ?? null,
      usage.context_left_percent ?? null,
      usage.five_hour_left_percent ?? null,
      usage.five_hour_reset_text ?? null,
    ]
  );
}

export async function getSessionUsageLatest(sessionIds?: string[]): Promise<SessionUsageSummary[]> {
  if (sessionIds && sessionIds.length > 0) {
    const result = await pool.query(
      `SELECT * FROM session_usage_latest WHERE session_id = ANY($1::uuid[])`,
      [sessionIds]
    );
    return result.rows;
  }

  const result = await pool.query('SELECT * FROM session_usage_latest');
  return result.rows;
}

export async function updateApprovalMetrics(
  sessionId: string,
  action: 'requested' | 'granted' | 'denied'
): Promise<void> {
  const column = action === 'requested' ? 'approvals_requested'
    : action === 'granted' ? 'approvals_granted'
    : 'approvals_denied';

  await pool.query(
    `INSERT INTO session_metrics (session_id, ${column})
     VALUES ($1, 1)
     ON CONFLICT (session_id) DO UPDATE SET
       ${column} = session_metrics.${column} + 1,
       updated_at = NOW()`,
    [sessionId]
  );
}

export async function getAnalyticsSummary(filters?: {
  host_id?: string;
  provider?: string;
  since?: string;
}): Promise<{
  total_sessions: number;
  total_tokens_in: number;
  total_tokens_out: number;
  total_tool_calls: number;
  total_estimated_cost_cents: number;
  sessions_by_provider: Record<string, number>;
  sessions_by_status: Record<string, number>;
}> {
  let whereClause = 'WHERE 1=1';
  const params: (string | undefined)[] = [];
  let paramIndex = 1;

  if (filters?.host_id) {
    whereClause += ` AND s.host_id = $${paramIndex++}`;
    params.push(filters.host_id);
  }
  if (filters?.provider) {
    whereClause += ` AND s.provider = $${paramIndex++}`;
    params.push(filters.provider);
  }
  if (filters?.since) {
    whereClause += ` AND s.created_at >= $${paramIndex++}`;
    params.push(filters.since);
  }

  // Get totals
  const totalsResult = await pool.query(
    `SELECT
       COUNT(DISTINCT s.id)::INTEGER as total_sessions,
       COALESCE(SUM(m.tokens_in), 0)::BIGINT as total_tokens_in,
       COALESCE(SUM(m.tokens_out), 0)::BIGINT as total_tokens_out,
       COALESCE(SUM(m.tool_calls), 0)::BIGINT as total_tool_calls,
       COALESCE(SUM(m.estimated_cost_cents), 0)::INTEGER as total_estimated_cost_cents
     FROM sessions s
     LEFT JOIN session_metrics m ON s.id = m.session_id
     ${whereClause}`,
    params
  );

  // Get by provider
  const byProviderResult = await pool.query(
    `SELECT provider, COUNT(*)::INTEGER as count
     FROM sessions s
     ${whereClause}
     GROUP BY provider`,
    params
  );

  // Get by status
  const byStatusResult = await pool.query(
    `SELECT status, COUNT(*)::INTEGER as count
     FROM sessions s
     ${whereClause}
     GROUP BY status`,
    params
  );

  const totals = totalsResult.rows[0] || {};
  const sessionsByProvider: Record<string, number> = {};
  const sessionsByStatus: Record<string, number> = {};

  for (const row of byProviderResult.rows) {
    sessionsByProvider[row.provider] = row.count;
  }
  for (const row of byStatusResult.rows) {
    sessionsByStatus[row.status] = row.count;
  }

  return {
    total_sessions: totals.total_sessions || 0,
    total_tokens_in: Number(totals.total_tokens_in) || 0,
    total_tokens_out: Number(totals.total_tokens_out) || 0,
    total_tool_calls: Number(totals.total_tool_calls) || 0,
    total_estimated_cost_cents: totals.total_estimated_cost_cents || 0,
    sessions_by_provider: sessionsByProvider,
    sessions_by_status: sessionsByStatus,
  };
}

export async function getTokenUsageTimeSeries(
  sessionId: string,
  options?: { limit?: number }
): Promise<Array<{
  timestamp: string;
  tokens_in: number;
  tokens_out: number;
  tool_calls: number;
}>> {
  const limit = options?.limit || 100;
  const result = await pool.query(
    `SELECT
       DATE_TRUNC('minute', recorded_at) as timestamp,
       SUM(tokens_in)::INTEGER as tokens_in,
       SUM(tokens_out)::INTEGER as tokens_out,
       COUNT(CASE WHEN tool_name IS NOT NULL THEN 1 END)::INTEGER as tool_calls
     FROM token_events
     WHERE session_id = $1
     GROUP BY DATE_TRUNC('minute', recorded_at)
     ORDER BY timestamp DESC
     LIMIT $2`,
    [sessionId, limit]
  );
  return result.rows;
}

// Weekly Usage Analytics
export interface WeeklyUsageDay {
  date: string;
  tokens: number;
  tokens_in: number;
  tokens_out: number;
  cost_cents: number;
}

export interface WeeklyUsage {
  week_start: string;
  total_tokens: number;
  total_cost_cents: number;
  daily: WeeklyUsageDay[];
  by_provider: Record<string, number>;
}

export async function getWeeklyUsage(): Promise<WeeklyUsage> {
  // Get the start of the current week (Monday)
  const weekStartResult = await pool.query(
    `SELECT DATE_TRUNC('week', NOW())::DATE as week_start`
  );
  const weekStart = weekStartResult.rows[0]?.week_start || new Date().toISOString().split('T')[0];

  // Get daily breakdown for the week
  const dailyResult = await pool.query(
    `SELECT
       DATE(te.recorded_at) as date,
       SUM(te.tokens_in + te.tokens_out)::BIGINT as tokens,
       SUM(te.tokens_in)::BIGINT as tokens_in,
       SUM(te.tokens_out)::BIGINT as tokens_out,
       COALESCE(SUM(
         CASE
           WHEN s.provider = 'claude_code' THEN
             (te.tokens_in * 3 + te.tokens_out * 15) / 1000000.0 * 100
           WHEN s.provider = 'codex' THEN
             (te.tokens_in * 3 + te.tokens_out * 12) / 1000000.0 * 100
           ELSE
             (te.tokens_in * 5 + te.tokens_out * 15) / 1000000.0 * 100
         END
       ), 0)::INTEGER as cost_cents
     FROM token_events te
     JOIN sessions s ON te.session_id = s.id
     WHERE te.recorded_at >= DATE_TRUNC('week', NOW())
     GROUP BY DATE(te.recorded_at)
     ORDER BY date`
  );

  // Get totals
  const totalsResult = await pool.query(
    `SELECT
       SUM(te.tokens_in + te.tokens_out)::BIGINT as total_tokens,
       COALESCE(SUM(
         CASE
           WHEN s.provider = 'claude_code' THEN
             (te.tokens_in * 3 + te.tokens_out * 15) / 1000000.0 * 100
           WHEN s.provider = 'codex' THEN
             (te.tokens_in * 3 + te.tokens_out * 12) / 1000000.0 * 100
           ELSE
             (te.tokens_in * 5 + te.tokens_out * 15) / 1000000.0 * 100
         END
       ), 0)::INTEGER as total_cost_cents
     FROM token_events te
     JOIN sessions s ON te.session_id = s.id
     WHERE te.recorded_at >= DATE_TRUNC('week', NOW())`
  );

  // Get by provider
  const byProviderResult = await pool.query(
    `SELECT
       s.provider,
       SUM(te.tokens_in + te.tokens_out)::BIGINT as tokens
     FROM token_events te
     JOIN sessions s ON te.session_id = s.id
     WHERE te.recorded_at >= DATE_TRUNC('week', NOW())
     GROUP BY s.provider`
  );

  const totals = totalsResult.rows[0] || {};
  const byProvider: Record<string, number> = {};
  for (const row of byProviderResult.rows) {
    byProvider[row.provider] = Number(row.tokens);
  }

  return {
    week_start: weekStart,
    total_tokens: Number(totals.total_tokens) || 0,
    total_cost_cents: totals.total_cost_cents || 0,
    daily: dailyResult.rows.map((row) => ({
      date: row.date,
      tokens: Number(row.tokens),
      tokens_in: Number(row.tokens_in),
      tokens_out: Number(row.tokens_out),
      cost_cents: row.cost_cents,
    })),
    by_provider: byProvider,
  };
}

// Session Links
export interface SessionLinkWithSession {
  id: string;
  source_session_id: string;
  target_session_id: string;
  link_type: string;
  created_at: string;
  linked_session_id: string;
  linked_session_title: string | null;
  linked_session_provider: string;
  linked_session_status: string;
  linked_session_cwd: string | null;
  direction: 'outgoing' | 'incoming';
}

export async function createSessionLink(
  sourceSessionId: string,
  targetSessionId: string,
  linkType: string
): Promise<{ id: string; source_session_id: string; target_session_id: string; link_type: string; created_at: string }> {
  const result = await pool.query(
    `INSERT INTO session_links (source_session_id, target_session_id, link_type)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [sourceSessionId, targetSessionId, linkType]
  );
  return result.rows[0];
}

export async function getSessionLinks(sessionId: string): Promise<SessionLinkWithSession[]> {
  const result = await pool.query(
    `SELECT
       l.id,
       l.source_session_id,
       l.target_session_id,
       l.link_type,
       l.created_at,
       CASE
         WHEN l.source_session_id = $1 THEN l.target_session_id
         ELSE l.source_session_id
       END as linked_session_id,
       s.title as linked_session_title,
       s.provider as linked_session_provider,
       s.status as linked_session_status,
       s.cwd as linked_session_cwd,
       CASE
         WHEN l.source_session_id = $1 THEN 'outgoing'
         ELSE 'incoming'
       END as direction
     FROM session_links l
     JOIN sessions s ON (
       (l.source_session_id = $1 AND s.id = l.target_session_id) OR
       (l.target_session_id = $1 AND s.id = l.source_session_id)
     )
     WHERE l.source_session_id = $1 OR l.target_session_id = $1
     ORDER BY l.created_at DESC`,
    [sessionId]
  );
  return result.rows;
}

export async function deleteSessionLink(linkId: string): Promise<boolean> {
  const result = await pool.query(
    'DELETE FROM session_links WHERE id = $1',
    [linkId]
  );
  return (result.rowCount || 0) > 0;
}

export async function getSessionLinkById(
  linkId: string
): Promise<{ id: string; source_session_id: string; target_session_id: string; link_type: string; created_at: string } | null> {
  const result = await pool.query(
    'SELECT * FROM session_links WHERE id = $1',
    [linkId]
  );
  return result.rows[0] || null;
}

// Session Context
export interface SessionContextItem {
  id: string;
  session_id: string;
  key: string;
  value: string;
  updated_at: string;
}

export async function listSessionContext(sessionId: string): Promise<SessionContextItem[]> {
  const result = await pool.query(
    'SELECT * FROM session_context WHERE session_id = $1 ORDER BY key',
    [sessionId]
  );
  return result.rows;
}

export async function getSessionContext(sessionId: string, key: string): Promise<SessionContextItem | null> {
  const result = await pool.query(
    'SELECT * FROM session_context WHERE session_id = $1 AND key = $2',
    [sessionId, key]
  );
  return result.rows[0] || null;
}

export async function upsertSessionContext(
  sessionId: string,
  key: string,
  value: string
): Promise<SessionContextItem> {
  const result = await pool.query(
    `INSERT INTO session_context (session_id, key, value)
     VALUES ($1, $2, $3)
     ON CONFLICT (session_id, key) DO UPDATE SET
       value = EXCLUDED.value,
       updated_at = NOW()
     RETURNING *`,
    [sessionId, key, value]
  );
  return result.rows[0];
}

export async function deleteSessionContext(sessionId: string, key: string): Promise<boolean> {
  const result = await pool.query(
    'DELETE FROM session_context WHERE session_id = $1 AND key = $2',
    [sessionId, key]
  );
  return (result.rowCount || 0) > 0;
}

// Tool Event queries
export async function insertToolEventStart(payload: ToolEventStart): Promise<ToolEvent> {
  const result = await pool.query(
    `INSERT INTO tool_events (id, session_id, provider, tool_name, tool_input, started_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      payload.event_id,
      payload.session_id,
      payload.provider,
      payload.tool_name,
      payload.tool_input ? JSON.stringify(payload.tool_input) : null,
      payload.started_at,
    ]
  );
  return result.rows[0];
}

export async function completeToolEvent(payload: ToolEventComplete): Promise<ToolEvent | null> {
  const result = await pool.query(
    `UPDATE tool_events
     SET tool_output = $2, completed_at = $3, success = $4, duration_ms = $5
     WHERE id = $1
     RETURNING *`,
    [
      payload.event_id,
      payload.tool_output ? JSON.stringify(payload.tool_output) : null,
      payload.completed_at,
      payload.success,
      payload.duration_ms,
    ]
  );
  return result.rows[0] || null;
}

export async function getToolEvents(
  sessionId: string,
  cursor?: string,
  limit = 50
): Promise<{ events: ToolEvent[]; next_cursor?: string }> {
  // Cursor format: "started_at|id" for stable pagination
  let query = `SELECT * FROM tool_events WHERE session_id = $1`;
  const params: unknown[] = [sessionId];
  let paramIndex = 2;

  if (cursor) {
    const [cursorTs, cursorId] = cursor.split('|');
    query += ` AND (started_at, id) < ($${paramIndex++}, $${paramIndex++})`;
    params.push(cursorTs, cursorId);
  }

  query += ` ORDER BY started_at DESC, id DESC LIMIT $${paramIndex}`;
  params.push(limit + 1);

  const result = await pool.query(query, params);
  const rows = result.rows;

  const hasMore = rows.length > limit;
  const events = hasMore ? rows.slice(0, limit) : rows;
  const next_cursor = hasMore
    ? `${events[events.length - 1].started_at}|${events[events.length - 1].id}`
    : undefined;

  return { events, next_cursor };
}

export async function getToolEventById(eventId: string): Promise<ToolEvent | null> {
  const result = await pool.query('SELECT * FROM tool_events WHERE id = $1', [eventId]);
  return result.rows[0] || null;
}

export async function getToolStats(sessionId: string): Promise<ToolStat[]> {
  const result = await pool.query(
    `SELECT tool_name,
            COUNT(*)::INTEGER AS total_calls,
            AVG(duration_ms)::INTEGER AS avg_duration,
            SUM(CASE WHEN success THEN 1 ELSE 0 END)::INTEGER AS success_count
     FROM tool_events
     WHERE session_id = $1
     GROUP BY tool_name
     ORDER BY total_calls DESC`,
    [sessionId]
  );
  return result.rows;
}

// Summaries (AI-generated orchestrator summaries)
export interface Summary {
  id: number;
  capture_hash: string;
  session_id: string;
  action_type: string;
  summary: string;
  created_at: string;
}

export async function getSummaryByCaptureHash(captureHash: string): Promise<Summary | null> {
  const result = await pool.query(
    'SELECT * FROM summaries WHERE capture_hash = $1',
    [captureHash]
  );
  return result.rows[0] || null;
}

export async function saveSummary(
  captureHash: string,
  sessionId: string,
  actionType: string,
  summary: string
): Promise<Summary> {
  const result = await pool.query(
    `INSERT INTO summaries (capture_hash, session_id, action_type, summary)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (capture_hash) DO UPDATE SET summary = EXCLUDED.summary
     RETURNING *`,
    [captureHash, sessionId, actionType, summary]
  );
  return result.rows[0];
}
