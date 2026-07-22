import { describe, expect, it } from 'vitest';
import type { SessionWithSnapshot } from '@agent-command/schema';
import {
  filterThumbnailPanes,
  getPaneSnapshotFreshness,
  getPaneSnapshotPreview,
  getPaneSwitcherGroup,
  getThumbnailSwitcherPanes,
} from './paneSwitcher';

function pane(id: string, status = 'RUNNING'): SessionWithSnapshot {
  return { id, status, tmux_pane_id: `%${id}` } as SessionWithSnapshot;
}

describe('thumbnail pane switcher', () => {
  it('orders the selected pane, waiting panes, recent panes, then the remaining live roster', () => {
    const panes = [pane('idle', 'IDLE'), pane('recent'), pane('waiting', 'WAITING_FOR_INPUT'), pane('selected')];
    const recent = [{ id: 'recent' }] as Parameters<typeof getThumbnailSwitcherPanes>[0];
    expect(getThumbnailSwitcherPanes(recent, panes, 'selected').map((session) => session.id)).toEqual([
      'selected',
      'waiting',
      'recent',
      'idle',
    ]);
  });

  it('renders only the last six clean capture lines in a thumbnail', () => {
    const capture = ['one', 'two', 'three', 'four', 'five', 'six', '\x1b[31mseven\x1b[0m'].join('\n');
    expect(getPaneSnapshotPreview(capture)).toBe('two\nthree\nfour\nfive\nsix\nseven');
  });

  it('never truncates panes from the currently attached tmux session', () => {
    const panes = Array.from({ length: 14 }, (_, index) => ({
      ...pane(`pane-${index}`),
      host_id: 'host-1',
      tmux_session_name: 'agents',
      tmux_window_index: Math.floor(index / 2),
      tmux_pane_index: index % 2,
    })) as SessionWithSnapshot[];

    expect(getThumbnailSwitcherPanes([], panes, 'pane-0')).toHaveLength(14);
  });

  it('groups panes by tmux session and window', () => {
    const session = {
      ...pane('claude'),
      host_id: 'host-1',
      tmux_session_name: 'agents',
      tmux_window_index: 2,
      metadata: { tmux: { window_name: 'verification' } },
    } as SessionWithSnapshot;

    expect(getPaneSwitcherGroup(session)).toEqual({
      key: 'host-1\u0000agents\u00002',
      label: 'agents · 2 verification',
    });
  });

  it('searches pane identity, target, and captured text', () => {
    const claude = {
      ...pane('claude'),
      title: 'Claude Code',
      provider: 'claude_code',
      tmux_target: 'agents:1.0',
      latest_snapshot: { capture_text: 'release verification' },
    } as SessionWithSnapshot;
    const shell = { ...pane('shell'), title: 'Shell' } as SessionWithSnapshot;

    expect(filterThumbnailPanes([claude, shell], 'verification')).toEqual([claude]);
    expect(filterThumbnailPanes([claude, shell], 'agents:1')).toEqual([claude]);
  });

  it('labels capture freshness without treating an old preview as live', () => {
    const now = Date.parse('2026-07-22T12:00:00.000Z');
    expect(getPaneSnapshotFreshness('2026-07-22T11:59:45.000Z', now)).toEqual({
      label: 'Fresh',
      stale: false,
    });
    expect(getPaneSnapshotFreshness('2026-07-22T11:57:00.000Z', now)).toEqual({
      label: '3m old',
      stale: true,
    });
  });
});
