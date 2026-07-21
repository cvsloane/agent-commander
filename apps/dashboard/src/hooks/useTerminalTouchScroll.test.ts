import { describe, expect, it } from 'vitest';
import { calculatePinchFontSize, synthesizeCursorDragInput } from './useTerminalTouchScroll';

describe('terminal pinch font sizing', () => {
  it('scales from the gesture origin and clamps to the configured range', () => {
    expect(calculatePinchFontSize(14, 100, 115)).toBe(16);
    expect(calculatePinchFontSize(14, 100, 25)).toBe(11);
    expect(calculatePinchFontSize(14, 100, 200)).toBe(18);
  });

  it('keeps the starting size for an invalid distance', () => {
    expect(calculatePinchFontSize(15, 0, 120)).toBe(15);
  });
});

describe('terminal cursor drag synthesis', () => {
  it('emits incremental cell-based arrow sequences', () => {
    const first = synthesizeCursorDragInput(16, -20, 8, 20);
    expect(first).toEqual({
      data: '\x1b[C\x1b[C\x1b[A',
      sentX: 2,
      sentY: -1,
    });

    const next = synthesizeCursorDragInput(24, -20, 8, 20, first.sentX, first.sentY);
    expect(next.data).toBe('\x1b[C');
  });

  it('uses faster tiers for longer drags', () => {
    const accelerated = synthesizeCursorDragInput(40, 240, 8, 20);
    expect(accelerated.sentX).toBe(10);
    expect(accelerated.sentY).toBe(36);
  });
});
