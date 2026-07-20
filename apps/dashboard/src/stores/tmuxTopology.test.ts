import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionWithSnapshot, TmuxTopologyPayload } from '@agent-command/schema';
import { useTmuxTopologyStore } from './tmuxTopology';

const hostId = '11111111-1111-4111-8111-111111111111';

function rosterSession(overrides: Partial<SessionWithSnapshot> = {}): SessionWithSnapshot {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    host_id: hostId,
    kind: 'tmux_pane',
    provider: 'codex',
    status: 'RUNNING',
    title: 'Builder',
    cwd: '/work/agent-command',
    tmux_pane_id: '%12',
    tmux_target: 'agents:1.0',
    tmux_session_name: 'agents',
    tmux_window_index: 1,
    tmux_pane_index: 0,
    metadata: {
      tmux: {
        pane_id: '%12',
        session_name: 'agents',
        window_name: 'fallback-name',
        window_index: 1,
        pane_index: 0,
      },
    },
    created_at: '2026-07-20T12:00:00.000Z',
    updated_at: '2026-07-20T12:00:00.000Z',
    fork_depth: 0,
    ...overrides,
  };
}

describe('tmux topology store', () => {
  beforeEach(() => useTmuxTopologyStore.getState().reset());

  it('uses a host topology snapshot and joins its panes to roster sessions', () => {
    const payload: TmuxTopologyPayload = {
      reason: 'hook:window-renamed',
      tmux_sessions: [
        {
          session_name: 'agents',
          attached: true,
          windows: [
            {
              window_index: 1,
              window_name: 'live-name',
              active: true,
              zoomed: false,
              layout: 'tiled',
              bell: true,
              activity: true,
              panes: [
                {
                  pane_id: '%12',
                  pane_index: 0,
                  active: true,
                  width: 190,
                  height: 45,
                  title: 'codex',
                  current_command: 'codex',
                  current_path: '/work/agent-command',
                },
              ],
            },
          ],
        },
      ],
    };

    useTmuxTopologyStore.getState().setRoster(hostId, [rosterSession()]);
    useTmuxTopologyStore.getState().receiveTopology(hostId, payload, '2026-07-20T14:00:00.000Z');

    expect(useTmuxTopologyStore.getState().hosts[hostId]).toMatchObject({
      hostId,
      source: 'topology',
      receivedAt: '2026-07-20T14:00:00.000Z',
      sessions: [
        {
          sessionName: 'agents',
          attached: true,
          windows: [
            {
              windowIndex: 1,
              windowName: 'live-name',
              active: true,
              bell: true,
              activity: true,
              panes: [{ paneId: '%12', sessionId: rosterSession().id, active: true }],
            },
          ],
        },
      ],
    });
  });

  it('derives sorted window and pane structure from roster data until a host emits topology', () => {
    const secondPane = rosterSession({
      id: '33333333-3333-4333-8333-333333333333',
      tmux_pane_id: '%13',
      tmux_target: 'agents:1.1',
      tmux_pane_index: 1,
      title: 'Reviewer',
      metadata: {
        tmux: {
          pane_id: '%13',
          session_name: 'agents',
          window_name: 'fallback-name',
          window_index: 1,
          pane_index: 1,
        },
      },
    });
    const earlierWindow = rosterSession({
      id: '44444444-4444-4444-8444-444444444444',
      tmux_pane_id: '%14',
      tmux_target: 'agents:0.0',
      tmux_window_index: 0,
      title: 'Shell',
      metadata: {
        tmux: {
          pane_id: '%14',
          session_name: 'agents',
          window_name: 'shell',
          window_index: 0,
          pane_index: 0,
        },
      },
    });

    useTmuxTopologyStore.getState().setRoster(hostId, [secondPane, rosterSession(), earlierWindow]);

    const host = useTmuxTopologyStore.getState().hosts[hostId];
    expect(host?.source).toBe('roster');
    expect(host?.sessions[0]?.windows.map((window) => window.windowIndex)).toEqual([0, 1]);
    expect(host?.sessions[0]?.windows[1]?.panes.map((pane) => pane.paneId)).toEqual(['%12', '%13']);
    expect(host?.sessions[0]?.windows[1]?.panes[1]).toMatchObject({
      sessionId: secondPane.id,
      sessionTitle: 'Reviewer',
    });
  });

  it('does not publish a new snapshot when a feed repeats the same roster session objects', () => {
    const session = rosterSession();
    useTmuxTopologyStore.getState().setRoster(hostId, [session]);
    const firstHosts = useTmuxTopologyStore.getState().hosts;
    const firstRoster = useTmuxTopologyStore.getState().rosterByHost;

    useTmuxTopologyStore.getState().setRoster(hostId, [session]);

    expect(useTmuxTopologyStore.getState().hosts).toBe(firstHosts);
    expect(useTmuxTopologyStore.getState().rosterByHost).toBe(firstRoster);
  });
});
