import { describe, expect, it } from 'vitest';
import type { SessionWithSnapshot } from '@agent-command/schema';
import { getPaneSnapshotPreview, getThumbnailSwitcherPanes } from './paneSwitcher';

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
});
