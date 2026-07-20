import { describe, expect, it } from 'vitest';
import type { SessionWithSnapshot } from '@agent-command/schema';
import { deriveSessionHealthBadges } from './SessionHealthBadges';

function session(overrides: Partial<SessionWithSnapshot> = {}): SessionWithSnapshot {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    host_id: '11111111-1111-4111-8111-111111111111',
    kind: 'tmux_pane',
    provider: 'codex',
    status: 'RUNNING',
    role: 'standalone',
    title: 'Builder',
    cwd: '/repo',
    tmux_pane_id: '%1',
    tmux_target: 'agents:0.0',
    metadata: {},
    created_at: '2026-07-20T12:00:00.000Z',
    updated_at: '2026-07-20T12:00:00.000Z',
    last_activity_at: '2026-07-20T12:00:00.000Z',
    fork_depth: 0,
    latest_snapshot: null,
    ...overrides,
  };
}

describe('session health badges', () => {
  it('derives operational and metadata health from one session model', () => {
    const badges = deriveSessionHealthBadges(session({
      status: 'ERROR',
      metadata: {
        unmanaged: true,
        git_status: { unstaged: 2 },
      },
    }), { hostOnline: false });

    expect(badges.map((badge) => badge.kind)).toEqual([
      'error',
      'dirty-git',
      'host-offline',
      'unmanaged',
    ]);
  });

  it('uses distinct badges for input, approval, and idle states', () => {
    expect(deriveSessionHealthBadges(session({ status: 'WAITING_FOR_INPUT' }))[0]?.kind)
      .toBe('waiting-input');
    expect(deriveSessionHealthBadges(session({ status: 'WAITING_FOR_APPROVAL' }))[0]?.kind)
      .toBe('waiting-approval');
    expect(deriveSessionHealthBadges(session({ status: 'IDLE' }))[0]?.kind)
      .toBe('idle');
  });
});
