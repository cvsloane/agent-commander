import { describe, expect, it } from 'vitest';
import { calculateTerminalViewportHeight, canFitTerminalElement } from './viewport';

describe('terminal visual viewport layout', () => {
  it('uses the visible space below the terminal when the OS keyboard opens', () => {
    expect(calculateTerminalViewportHeight({ height: 480, offsetTop: 44 }, 120)).toBe(404);
    expect(calculateTerminalViewportHeight({ height: 844, offsetTop: 0 }, 120)).toBe(724);
  });

  it('does not fit a CSS-hidden terminal to the xterm 2x1 minimum', () => {
    expect(canFitTerminalElement({ clientWidth: 0, clientHeight: 0 })).toBe(false);
    expect(canFitTerminalElement({ clientWidth: 320, clientHeight: 0 })).toBe(false);
    expect(canFitTerminalElement({ clientWidth: 320, clientHeight: 480 })).toBe(true);
  });
});
