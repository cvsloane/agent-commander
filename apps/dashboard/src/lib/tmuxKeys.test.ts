import { describe, expect, it } from 'vitest';
import { TMUX_PREFIX, TMUX_SHORTCUT_KEYS } from './tmuxKeys';

describe('TMUX_SHORTCUT_KEYS', () => {
  it('starts every tmux shortcut with the configured prefix', () => {
    expect(TMUX_PREFIX).toBe('\x02');
    expect(TMUX_SHORTCUT_KEYS.every((key) => key.data.startsWith(TMUX_PREFIX))).toBe(true);
  });

  it('includes mobile operator shortcuts for windows, panes, splits, zoom, and copy mode', () => {
    const byLabel = new Map(TMUX_SHORTCUT_KEYS.map((key) => [key.ariaLabel, key.data]));

    expect(byLabel.get('tmux prefix')).toBe('\x02');
    expect(byLabel.get('tmux previous window')).toBe('\x02p');
    expect(byLabel.get('tmux next window')).toBe('\x02n');
    expect(byLabel.get('tmux copy mode')).toBe('\x02[');
    expect(byLabel.get('tmux zoom pane')).toBe('\x02z');
    expect(byLabel.get('tmux split horizontal')).toBe('\x02"');
    expect(byLabel.get('tmux split vertical')).toBe('\x02%');
    expect(byLabel.get('tmux pane left')).toBe('\x02\x1b[D');
    expect(byLabel.get('tmux pane down')).toBe('\x02\x1b[B');
    expect(byLabel.get('tmux pane up')).toBe('\x02\x1b[A');
    expect(byLabel.get('tmux pane right')).toBe('\x02\x1b[C');
  });
});
