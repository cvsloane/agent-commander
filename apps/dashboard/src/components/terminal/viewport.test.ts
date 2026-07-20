import { describe, expect, it } from 'vitest';
import {
  calculateKeyboardInset,
  calculateTerminalViewportHeight,
  canFitTerminalElement,
} from './viewport';

describe('terminal visual viewport layout', () => {
  it('uses the visible space below the terminal when the OS keyboard opens', () => {
    expect(calculateTerminalViewportHeight({ height: 480, offsetTop: 44 }, 120)).toBe(404);
    expect(calculateTerminalViewportHeight({ height: 844, offsetTop: 0 }, 120)).toBe(724);
    expect(calculateTerminalViewportHeight({ height: 480, offsetTop: 44 }, 120, 96)).toBe(308);
  });

  it('positions bottom sheets above the visual viewport keyboard inset', () => {
    expect(calculateKeyboardInset(844, { height: 480, offsetTop: 44 })).toBe(320);
    expect(calculateKeyboardInset(844, { height: 844, offsetTop: 0 })).toBe(0);
  });

  it('does not fit a CSS-hidden terminal to the xterm 2x1 minimum', () => {
    expect(canFitTerminalElement({ clientWidth: 0, clientHeight: 0 })).toBe(false);
    expect(canFitTerminalElement({ clientWidth: 320, clientHeight: 0 })).toBe(false);
    expect(canFitTerminalElement({ clientWidth: 320, clientHeight: 480 })).toBe(true);
  });
});
