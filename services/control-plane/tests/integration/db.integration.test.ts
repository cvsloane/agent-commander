import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import * as db from '../../src/db/index.js';

const hostId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const otherSessionId = '44444444-4444-4444-8444-444444444444';
const userId = '33333333-3333-4333-8333-333333333333';

function sessionUpsert(overrides: Record<string, unknown> = {}) {
  return {
    id: sessionId,
    kind: 'tmux_pane' as const,
    provider: 'claude_code' as const,
    status: 'RUNNING' as const,
    title: 'integration session',
    cwd: '/home/test/dev/agent-command',
    repo_root: '/home/test/dev/agent-command',
    git_branch: 'main',
    ...overrides,
  };
}

/**
 * Truncate every application table between cases. `sessions` cascades into
 * events/approvals/snapshots, and `hosts` into sessions, so restarting identity
 * keeps sequence-dependent assertions stable.
 */
async function resetSchema(): Promise<void> {
  const { rows } = await db.pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename <> 'schema_migrations'`
  );
  if (rows.length === 0) {
    throw new Error('No application tables found -- did migrations run against INTEGRATION_DATABASE_URL?');
  }
  const targets = rows.map((r) => `public."${r.tablename}"`).join(', ');
  await db.pool.query(`TRUNCATE ${targets} RESTART IDENTITY CASCADE`);
}

beforeEach(async () => {
  await resetSchema();
});

afterAll(async () => {
  await db.pool.end();
});

describe('schema', () => {
  it('applies every migration and reports a healthy connection', async () => {
    expect(await db.testConnection()).toBe(true);

    const { rows } = await db.pool.query<{ name: string }>(
      'SELECT name FROM schema_migrations ORDER BY name'
    );
    // 039 is the grant-only migration that previously aborted on fresh databases.
    expect(rows.map((r) => r.name)).toContain('039_grant_legacy_settings_access.sql');
    expect(rows.length).toBeGreaterThanOrEqual(40);
  });

  it('reports readiness within the configured timeout', async () => {
    await expect(db.pingDatabase(2_000)).resolves.toEqual({ ok: true });
  });

  // Regression: pg returns int8/numeric as strings by default, so `tokens_in +
  // tokens_out` concatenated ("1500800") instead of adding (2300) in the session
  // analytics panel. The type parsers in db/index.ts must keep these numeric.
  it('returns BIGINT and NUMERIC columns as JS numbers', async () => {
    await db.upsertHost({ id: hostId, name: 'heavisidelinux', capabilities: {} });
    await db.upsertSession(hostId, sessionUpsert());
    await db.pool.query(
      `INSERT INTO session_metrics (session_id, tokens_in, tokens_out)
       VALUES ($1, 1500, 800)
       ON CONFLICT (session_id) DO UPDATE SET tokens_in = 1500, tokens_out = 800`,
      [sessionId]
    );

    const metrics = await db.getSessionMetrics(sessionId);
    expect(typeof metrics?.tokens_in).toBe('number');
    expect(typeof metrics?.tokens_out).toBe('number');
    expect((metrics?.tokens_in ?? 0) + (metrics?.tokens_out ?? 0)).toBe(2300);

    await db.pool.query(
      `INSERT INTO session_usage_latest (session_id, provider, weekly_utilization_percent)
       VALUES ($1, 'claude_code', 42.5)
       ON CONFLICT (session_id) DO UPDATE SET weekly_utilization_percent = 42.5`,
      [sessionId]
    );
    const { rows } = await db.pool.query(
      'SELECT weekly_utilization_percent FROM session_usage_latest WHERE session_id = $1',
      [sessionId]
    );
    expect(typeof rows[0].weekly_utilization_percent).toBe('number');
    expect(rows[0].weekly_utilization_percent).toBe(42.5);
  });
});

describe('hosts', () => {
  it('upserts idempotently and preserves the identity on conflict', async () => {
    const created = await db.upsertHost({
      id: hostId,
      name: 'heavisidelinux',
      tailscale_name: 'heavisidelinux',
      tailscale_ip: '100.64.0.10',
      capabilities: { tmux: true, terminal: true, providers: { claude_code: true } },
      agent_version: '0.1.0',
    });
    expect(created.id).toBe(hostId);
    expect(created.capabilities).toMatchObject({ tmux: true });

    const updated = await db.upsertHost({
      id: hostId,
      name: 'heavisidelinux-renamed',
      capabilities: { tmux: false, terminal: true },
      agent_version: '0.2.0',
    });
    expect(updated.id).toBe(hostId);
    expect(updated.name).toBe('heavisidelinux-renamed');
    expect(updated.agent_version).toBe('0.2.0');
    expect(updated.capabilities).toMatchObject({ tmux: false });

    const { rows } = await db.pool.query('SELECT COUNT(*)::int AS count FROM hosts');
    expect(rows[0].count).toBe(1);
  });
});

describe('sessions', () => {
  beforeEach(async () => {
    await db.upsertHost({
      id: hostId,
      name: 'heavisidelinux',
      capabilities: { tmux: true, terminal: true },
    });
  });

  it('inserts, reads back, and updates on conflict', async () => {
    const created = await db.upsertSession(hostId, sessionUpsert());
    expect(created.id).toBe(sessionId);
    expect(created.host_id).toBe(hostId);
    expect(created.status).toBe('RUNNING');

    const fetched = await db.getSessionById(sessionId);
    expect(fetched?.title).toBe('integration session');

    const updated = await db.upsertSession(hostId, sessionUpsert({ status: 'IDLE' }));
    expect(updated.status).toBe('IDLE');

    const all = await db.getSessions();
    expect(all).toHaveLength(1);
  });

  it('preserves tmux identity through the canonical target', async () => {
    const created = await db.upsertSession(
      hostId,
      sessionUpsert({ tmux_target: 'work:0.0', tmux_pane_id: '%12' })
    );
    expect(created.tmux_session_name).toBe('work');
    expect(created.tmux_window_index).toBe(0);
    expect(created.tmux_pane_index).toBe(0);
    expect(created.tmux_pane_id).toBe('%12');
  });

  it('resolves and reuses a repo row across sessions', async () => {
    await db.upsertSession(
      hostId,
      sessionUpsert({ git_remote: 'git@github.com:cvsloane/agent-commander.git' })
    );
    await db.upsertSession(
      hostId,
      sessionUpsert({
        id: otherSessionId,
        git_remote: 'git@github.com:cvsloane/agent-commander.git',
      })
    );

    const { rows } = await db.pool.query('SELECT COUNT(*)::int AS count FROM repos');
    expect(rows[0].count).toBe(1);

    const first = await db.getSessionById(sessionId);
    const second = await db.getSessionById(otherSessionId);
    expect(first?.repo_id).toBeTruthy();
    expect(second?.repo_id).toBe(first?.repo_id);
  });

  it('filters by repo root and paginates without dropping rows', async () => {
    await db.upsertSession(hostId, sessionUpsert());
    await db.upsertSession(
      hostId,
      sessionUpsert({ id: otherSessionId, repo_root: '/home/test/dev/other' })
    );

    const scoped = await db.getSessionsByRepoRoot('/home/test/dev/agent-command');
    expect(scoped.map((s) => s.id)).toEqual([sessionId]);

    expect(await db.getSessionsTotal()).toBe(2);

    const byIds = await db.getSessionsByIds([sessionId, otherSessionId]);
    expect(byIds).toHaveLength(2);
  });

  it('returns null for an unknown session rather than throwing', async () => {
    await expect(
      db.getSessionById('99999999-9999-4999-8999-999999999999')
    ).resolves.toBeNull();
  });
});

describe('events', () => {
  beforeEach(async () => {
    await db.upsertHost({ id: hostId, name: 'heavisidelinux', capabilities: {} });
    await db.upsertSession(hostId, sessionUpsert());
  });

  it('inserts events and reads them newest-first', async () => {
    await db.insertEvent(sessionId, 'status_changed', { from: 'running', to: 'idle' });
    await db.insertEvent(sessionId, 'output', { text: 'hello' });

    const events = await db.getEvents(sessionId);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('output');
    expect(events[0].payload).toMatchObject({ text: 'hello' });
  });

  it('deduplicates by event_id so agent replays are idempotent', async () => {
    const first = await db.insertEvent(sessionId, 'output', { text: 'once' }, 'evt-1');
    const replay = await db.insertEvent(sessionId, 'output', { text: 'once' }, 'evt-1');

    expect(first).not.toBeNull();
    expect(replay).toBeNull();
    expect(await db.getEvents(sessionId)).toHaveLength(1);
  });

  it('honours the cursor when paging backwards', async () => {
    for (let i = 0; i < 5; i += 1) {
      await db.insertEvent(sessionId, 'output', { i });
    }
    const page = await db.getEvents(sessionId, undefined, 2);
    expect(page).toHaveLength(2);

    const next = await db.getEvents(sessionId, page[1].id, 2);
    expect(next).toHaveLength(2);
    expect(next[0].id).toBeLessThan(page[1].id);
  });
});

describe('approvals', () => {
  beforeEach(async () => {
    await db.upsertHost({ id: hostId, name: 'heavisidelinux', capabilities: {} });
    await db.upsertSession(hostId, sessionUpsert());
  });

  it('creates a pending approval and lists it by status', async () => {
    const approval = await db.createApproval(sessionId, 'claude_code', {
      tool: 'Bash',
      command: 'ls',
    });
    expect(approval.session_id).toBe(sessionId);
    expect(approval.requested_payload).toMatchObject({ tool: 'Bash' });

    const pending = await db.getApprovals({ status: 'pending' });
    expect(pending.map((a) => a.id)).toContain(approval.id);
  });

  it('times out the previous pending approval when a new one arrives', async () => {
    const first = await db.createApproval(sessionId, 'claude_code', { tool: 'Bash' });
    const second = await db.createApproval(sessionId, 'claude_code', { tool: 'Edit' });

    const pending = await db.getApprovals({ status: 'pending' });
    const pendingIds = pending.map((a) => a.id);

    expect(pendingIds).toContain(second.id);
    expect(pendingIds).not.toContain(first.id);
  });

  it('is idempotent for a repeated approval id', async () => {
    const id = '55555555-5555-4555-8555-555555555555';
    const first = await db.createApproval(sessionId, 'claude_code', { tool: 'Bash' }, id);
    const repeat = await db.createApproval(sessionId, 'claude_code', { tool: 'Bash' }, id);

    expect(first.id).toBe(id);
    expect(repeat.id).toBe(id);

    const { rows } = await db.pool.query('SELECT COUNT(*)::int AS count FROM approvals');
    expect(rows[0].count).toBe(1);
  });
});

describe('users and settings', () => {
  it('upserts a user without duplicating on repeat', async () => {
    await db.upsertUser({ id: userId, email: 'chris@example.test', name: 'Chris', role: 'operator' });
    await db.upsertUser({ id: userId, email: 'chris@example.test', name: 'Chris S', role: 'operator' });

    const { rows } = await db.pool.query('SELECT COUNT(*)::int AS count FROM users');
    expect(rows[0].count).toBe(1);
  });
});
