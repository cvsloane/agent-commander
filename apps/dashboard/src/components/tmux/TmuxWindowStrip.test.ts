import { describe, expect, it } from 'vitest';
import type { TmuxWindowTopologyView } from '@/stores/tmuxTopology';
import { getWindowViewerSessionId } from './TmuxWindowStrip';

describe('tmux window viewer retargeting', () => {
  it('targets the selected window active pane, with a tracked-pane fallback', () => {
    const window = {
      panes: [
        { active: false, sessionId: 'session-1' },
        { active: true, sessionId: 'session-2' },
      ],
    } as TmuxWindowTopologyView;

    expect(getWindowViewerSessionId(window)).toBe('session-2');
    expect(getWindowViewerSessionId({
      ...window,
      panes: [{ active: true }, { active: false, sessionId: 'session-3' }],
    } as TmuxWindowTopologyView)).toBe('session-3');
  });
});
