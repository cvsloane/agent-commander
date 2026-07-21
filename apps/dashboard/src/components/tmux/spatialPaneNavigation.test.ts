import { describe, expect, it } from 'vitest';
import type { TmuxPaneTopologyView } from '@/stores/tmuxTopology';
import {
  parseTmuxWindowLayout,
  resolveDirectionalPaneTargets,
} from './spatialPaneNavigation';

const panes = ['%0', '%1', '%2'].map((paneId, paneIndex) => ({
  paneId,
  paneIndex,
})) as TmuxPaneTopologyView[];
const layout = 'abcd,120x40,0,0{59x40,0,0,0,60x40,60,0[60x19,60,0,1,60x20,60,20,2]}';

describe('spatial pane navigation', () => {
  it('parses leaf pane geometry from tmux window_layout', () => {
    expect([...parseTmuxWindowLayout(layout).values()]).toEqual([
      { paneId: '%0', left: 0, top: 0, width: 59, height: 40 },
      { paneId: '%1', left: 60, top: 0, width: 60, height: 19 },
      { paneId: '%2', left: 60, top: 20, width: 60, height: 20 },
    ]);
  });

  it('chooses panes by real direction instead of array position', () => {
    const targets = resolveDirectionalPaneTargets(panes, '%1', layout);
    expect(targets.left?.paneId).toBe('%0');
    expect(targets.down?.paneId).toBe('%2');
    expect(targets.up).toBeUndefined();
    expect(targets.right).toBeUndefined();
  });

  it('falls back to the prior linear behavior when layout is unavailable', () => {
    const targets = resolveDirectionalPaneTargets(panes, '%1', '');
    expect(targets.left?.paneId).toBe('%0');
    expect(targets.up?.paneId).toBe('%0');
    expect(targets.down?.paneId).toBe('%2');
    expect(targets.right?.paneId).toBe('%2');
  });
});
