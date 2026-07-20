import { afterEach, describe, expect, it, vi } from 'vitest';
import * as db from '../src/db/index.js';

const hostId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';

describe('tmux SQL data contracts', () => {
  afterEach(() => vi.restoreAllMocks());

  it('promotes typed identity and revives a known AC_SESSION_ID when its pane returns', async () => {
    const query = vi.spyOn(db.pool, 'query').mockResolvedValue({
      rows: [{
        id: sessionId,
        host_id: hostId,
        kind: 'tmux_pane',
        provider: 'codex',
        status: 'RUNNING',
        tmux_pane_id: '%9',
        tmux_target: 'agents:4.1',
        tmux_session_name: 'agents',
        tmux_window_index: 4,
        tmux_pane_index: 1,
        archived_at: null,
      }],
      rowCount: 1,
      command: 'INSERT',
      oid: 0,
      fields: [],
    });

    const rebound = await db.upsertSession(hostId, {
      id: sessionId,
      kind: 'tmux_pane',
      provider: 'codex',
      status: 'RUNNING',
      tmux_pane_id: '%9',
      tmux_target: 'agents:4.1',
      metadata: {
        unmanaged: false,
        tmux: {
          pane_id: '%9',
          target: 'agents:4.1',
          session_name: 'agents',
          window_name: 'agent-command',
          window_index: 4,
          pane_index: 1,
        },
      },
    });

    const [sql, values] = query.mock.calls[0]!;
    expect(String(sql)).toContain("EXCLUDED.kind = 'tmux_pane' AND EXCLUDED.tmux_pane_id IS NOT NULL AND $27 THEN NULL");
    expect(values).toEqual(expect.arrayContaining([sessionId, '%9', 'agents', 4, 1]));
    expect(rebound).toMatchObject({ id: sessionId, archived_at: null, tmux_pane_id: '%9' });
  });

  it('recovers zero-valued indexes omitted by the Go tmux identity JSON', async () => {
    const query = vi.spyOn(db.pool, 'query').mockResolvedValue({
      rows: [{ id: sessionId, archived_at: null }],
      rowCount: 1,
      command: 'INSERT',
      oid: 0,
      fields: [],
    });

    await db.upsertSession(hostId, {
      id: sessionId,
      kind: 'tmux_pane',
      provider: 'codex',
      status: 'RUNNING',
      tmux_pane_id: '%0',
      tmux_target: 'agents:0.0',
      metadata: {
        unmanaged: false,
        tmux: {
          pane_id: '%0',
          target: 'agents:0.0',
          session_name: 'agents',
          window_name: 'agent-command',
        },
      },
    });

    expect(query.mock.calls[0]?.[1]).toEqual(expect.arrayContaining(['agents', 0, 0]));
  });

  it('rejects a known session id owned by another host', async () => {
    const query = vi.spyOn(db.pool, 'query').mockResolvedValue({
      rows: [],
      rowCount: 0,
      command: 'INSERT',
      oid: 0,
      fields: [],
    });

    await expect(db.upsertSession(hostId, {
      id: sessionId,
      kind: 'tmux_pane',
      provider: 'codex',
      status: 'RUNNING',
      tmux_pane_id: '%9',
    })).rejects.toThrow('Session id is already owned by another host');

    expect(String(query.mock.calls[0]?.[0])).toContain(
      'WHERE sessions.host_id = EXCLUDED.host_id'
    );
  });

  it('returns SQL-grouped roster rows with the same pane membership as legacy client grouping', async () => {
    const sessions = [
      { id: sessionId, host_id: hostId, tmux_session_name: 'agents', tmux_window_index: 1, tmux_pane_index: 0 },
      { id: '33333333-3333-4333-8333-333333333333', host_id: hostId, tmux_session_name: 'agents', tmux_window_index: 1, tmux_pane_index: 1 },
    ];
    const query = vi.spyOn(db.pool, 'query').mockResolvedValue({
      rows: [{
        host_id: hostId,
        tmux_session_name: 'agents',
        window_count: 1,
        pane_count: 2,
        sessions,
      }],
      rowCount: 1,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });

    const groups = await db.getTmuxRosterGroups(hostId);
    const legacyMembership = sessions.reduce<Record<string, typeof sessions>>((groups, session) => {
      const key = `${session.host_id}:${session.tmux_session_name}`;
      (groups[key] ??= []).push(session);
      return groups;
    }, {});

    expect(groups).toHaveLength(Object.keys(legacyMembership).length);
    expect(groups[0]?.sessions.map((session) => session.id)).toEqual(
      legacyMembership[`${hostId}:agents`]?.map((session) => session.id)
    );
    expect(groups[0]).toMatchObject({ window_count: 1, pane_count: 2 });
    expect(String(query.mock.calls[0]?.[0])).toContain('GROUP BY host_id, roster_tmux_session_name');
    expect(query.mock.calls[0]?.[1]).toEqual([hostId]);
  });
});
