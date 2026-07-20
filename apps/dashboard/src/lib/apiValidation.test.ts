import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/wsToken', () => ({
  getControlPlaneToken: vi.fn(async () => 'test-token'),
}));

import { getSessions, getTmuxRoster } from './api';

describe('hot endpoint runtime validation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('warns and passes through malformed session responses instead of breaking the UI', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      sessions: [{ id: 'not-a-uuid' }],
    }), { status: 200 })));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await getSessions();
    expect(result.sessions[0]?.id).toBe('not-a-uuid');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('accepts a database-shaped session after fork depth normalization', async () => {
    const now = new Date().toISOString();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      sessions: [{
        id: '11111111-1111-4111-8111-111111111111',
        host_id: '22222222-2222-4222-8222-222222222222',
        kind: 'tmux_pane',
        provider: 'codex',
        status: 'IDLE',
        metadata: {},
        fork_depth: 0,
        created_at: now,
        updated_at: now,
      }],
      total: 1,
    }), { status: 200 })));

    await expect(getSessions()).resolves.toMatchObject({
      sessions: [{ fork_depth: 0 }],
      total: 1,
    });
  });

  it('accepts an empty SQL-grouped roster response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      groups: [],
      sessions: [],
      total: 0,
    }), { status: 200 })));

    await expect(getTmuxRoster()).resolves.toEqual({
      groups: [],
      sessions: [],
      total: 0,
    });
  });
});
