import { describe, expect, it } from 'vitest';
import type { SessionWithSnapshot } from '@agent-command/schema';
import {
  buildTmuxClusters,
  getPaneData,
  matchesTmuxFilter,
  matchesTmuxRosterFilter,
  parseTargetIndexes,
} from './tmuxRoster';

const baseTime = '2026-05-19T12:00:00.000Z';

function session(overrides: Partial<SessionWithSnapshot> = {}): SessionWithSnapshot {
  const id = overrides.id ?? crypto.randomUUID();
  return {
    id,
    host_id: '11111111-1111-4111-8111-111111111111',
    user_id: null,
    repo_id: null,
    kind: 'tmux_pane',
    provider: 'claude_code',
    status: 'RUNNING',
    title: null,
    cwd: '/home/cvsloane/dev/agent-command',
    repo_root: '/home/cvsloane/dev/agent-command',
    git_remote: 'git@github.com:cvsloane/agent-commander.git',
    git_branch: 'main',
    tmux_pane_id: `%${id.slice(0, 4)}`,
    tmux_target: 'agents:0.0',
    metadata: null,
    created_at: baseTime,
    updated_at: baseTime,
    last_activity_at: baseTime,
    idled_at: null,
    group_id: null,
    forked_from: null,
    fork_depth: 0,
    archived_at: null,
    ...overrides,
  };
}

describe('parseTargetIndexes', () => {
  it('parses tmux window and pane indexes from canonical targets', () => {
    expect(parseTargetIndexes('agents:12.3')).toEqual({ windowIndex: 12, paneIndex: 3 });
    expect(parseTargetIndexes('agents:7')).toEqual({ windowIndex: 7, paneIndex: undefined });
  });

  it('returns an empty object for missing or malformed targets', () => {
    expect(parseTargetIndexes(null)).toEqual({});
    expect(parseTargetIndexes(undefined)).toEqual({});
    expect(parseTargetIndexes('agents')).toEqual({});
    expect(parseTargetIndexes('agents:work.main')).toEqual({});
  });
});

describe('getPaneData', () => {
  it('prefers structured tmux metadata over parsed target fallback', () => {
    const pane = getPaneData(session({
      tmux_target: 'fallback:1.2',
      metadata: {
        tmux: {
          session_name: 'agents',
          window_name: 'agent-command',
          window_index: 4,
          pane_index: 9,
        },
      },
    }));

    expect(pane.tmuxSessionName).toBe('agents');
    expect(pane.windowName).toBe('agent-command');
    expect(pane.windowIndex).toBe(4);
    expect(pane.paneIndex).toBe(9);
    expect(pane.identity).toMatchObject({
      pane_id: pane.session.tmux_pane_id,
      target: 'fallback:1.2',
      session_name: 'agents',
      window_name: 'agent-command',
      window_index: 4,
      pane_index: 9,
    });
  });

  it('falls back to target indexes and default window labels', () => {
    const pane = getPaneData(session({
      tmux_target: 'work:3.2',
      metadata: null,
    }));

    expect(pane.tmuxSessionName).toBe('work');
    expect(pane.windowName).toBe('window 3');
    expect(pane.windowIndex).toBe(3);
    expect(pane.paneIndex).toBe(2);
  });

  it('marks unmanaged panes from session metadata', () => {
    const pane = getPaneData(session({
      metadata: { unmanaged: true },
    }));

    expect(pane.isUnmanaged).toBe(true);
  });
});

describe('buildTmuxClusters', () => {
  it('groups panes by tmux session and window, sorts panes by pane index, and chooses newest selected pane', () => {
    const older = session({
      id: '22222222-2222-4222-8222-222222222222',
      provider: 'claude_code',
      tmux_target: 'agents:1.1',
      last_activity_at: '2026-05-19T12:05:00.000Z',
      metadata: {
        tmux: {
          session_name: 'agents',
          window_name: 'repo',
          window_index: 1,
          pane_index: 1,
        },
      },
    });
    const newer = session({
      id: '33333333-3333-4333-8333-333333333333',
      provider: 'codex',
      tmux_target: 'agents:1.0',
      last_activity_at: '2026-05-19T12:10:00.000Z',
      metadata: {
        tmux: {
          session_name: 'agents',
          window_name: 'repo',
          window_index: 1,
          pane_index: 0,
        },
      },
    });

    const clusters = buildTmuxClusters([older, newer]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.tmuxSessionName).toBe('agents');
    expect(clusters[0]?.windowCount).toBe(1);
    expect(clusters[0]?.paneCount).toBe(2);
    expect(clusters[0]?.providerSummary).toBe('Claude, Codex');
    expect(clusters[0]?.windows[0]?.panes.map((pane) => pane.paneIndex)).toEqual([0, 1]);
    expect(clusters[0]?.windows[0]?.selectedPane.session.id).toBe(newer.id);
    expect(clusters[0]?.lastActivityAt).toBe('2026-05-19T12:10:00.000Z');
  });

  it('sorts clusters by tmux session name and windows by index then name', () => {
    const clusters = buildTmuxClusters([
      session({
        tmux_target: 'zeta:2.0',
        metadata: { tmux: { session_name: 'zeta', window_name: 'z-window', window_index: 2, pane_index: 0 } },
      }),
      session({
        tmux_target: 'alpha:2.0',
        metadata: { tmux: { session_name: 'alpha', window_name: 'b-window', window_index: 2, pane_index: 0 } },
      }),
      session({
        tmux_target: 'alpha:1.0',
        metadata: { tmux: { session_name: 'alpha', window_name: 'a-window', window_index: 1, pane_index: 0 } },
      }),
    ]);

    expect(clusters.map((cluster) => cluster.tmuxSessionName)).toEqual(['alpha', 'zeta']);
    expect(clusters[0]?.windows.map((window) => window.windowName)).toEqual(['a-window', 'b-window']);
  });

  it('propagates unmanaged state to windows and clusters', () => {
    const clusters = buildTmuxClusters([
      session({
        metadata: {
          unmanaged: true,
          tmux: { session_name: 'agents', window_name: 'repo', window_index: 0, pane_index: 0 },
        },
      }),
    ]);

    expect(clusters[0]?.hasUnmanaged).toBe(true);
    expect(clusters[0]?.windows[0]?.hasUnmanaged).toBe(true);
  });
});

describe('matchesTmuxFilter', () => {
  it('matches session, repo, cwd, branch, provider, target, and tmux metadata text case-insensitively', () => {
    const target = session({
      title: 'Production deploy',
      provider: 'codex',
      cwd: '/home/cvsloane/dev/heaviside',
      repo_root: '/home/cvsloane/dev/heaviside',
      git_branch: 'feature/mobile-tmux',
      tmux_target: 'agents:5.1',
      metadata: {
        tmux: {
          session_name: 'agents',
          window_name: 'Mobile UX',
          window_index: 5,
          pane_index: 1,
        },
      },
    });

    expect(matchesTmuxFilter(target, 'production')).toBe(true);
    expect(matchesTmuxFilter(target, 'heaviside')).toBe(true);
    expect(matchesTmuxFilter(target, 'MOBILE-TMUX')).toBe(true);
    expect(matchesTmuxFilter(target, 'codex')).toBe(true);
    expect(matchesTmuxFilter(target, 'agents:5.1')).toBe(true);
    expect(matchesTmuxFilter(target, 'mobile ux')).toBe(true);
    expect(matchesTmuxFilter(target, 'not-present')).toBe(false);
  });

  it('matches everything for blank queries', () => {
    expect(matchesTmuxFilter(session(), '')).toBe(true);
    expect(matchesTmuxFilter(session(), '   ')).toBe(true);
  });
});

describe('matchesTmuxRosterFilter', () => {
  it('matches waiting, error, active, dirty, and untracked roster filters', () => {
    expect(matchesTmuxRosterFilter(session({ status: 'WAITING_FOR_INPUT' }), 'waiting')).toBe(true);
    expect(matchesTmuxRosterFilter(session({ status: 'WAITING_FOR_APPROVAL' }), 'waiting')).toBe(true);
    expect(matchesTmuxRosterFilter(session({ status: 'ERROR' }), 'errors')).toBe(true);
    expect(matchesTmuxRosterFilter(session({ status: 'RUNNING' }), 'active')).toBe(true);
    expect(matchesTmuxRosterFilter(session({ status: 'STARTING' }), 'active')).toBe(true);
    expect(matchesTmuxRosterFilter(session({
      metadata: {
        git_status: {
          unstaged: 2,
        },
      },
    }), 'dirty')).toBe(true);
    expect(matchesTmuxRosterFilter(session({
      metadata: {
        unmanaged: true,
      },
    }), 'untracked')).toBe(true);
    expect(matchesTmuxRosterFilter(session({
      metadata: {
        git_status: {
          untracked: 3,
        },
      },
    }), 'untracked')).toBe(true);
  });

  it('does not leak sessions into unrelated roster filters', () => {
    const idleClean = session({
      status: 'IDLE',
      metadata: {
        git_status: {
          staged: 0,
          unstaged: 0,
          untracked: 0,
          unmerged: 0,
        },
      },
    });

    expect(matchesTmuxRosterFilter(idleClean, 'all')).toBe(true);
    expect(matchesTmuxRosterFilter(idleClean, 'waiting')).toBe(false);
    expect(matchesTmuxRosterFilter(idleClean, 'errors')).toBe(false);
    expect(matchesTmuxRosterFilter(idleClean, 'active')).toBe(false);
    expect(matchesTmuxRosterFilter(idleClean, 'dirty')).toBe(false);
    expect(matchesTmuxRosterFilter(idleClean, 'untracked')).toBe(false);
  });
});
