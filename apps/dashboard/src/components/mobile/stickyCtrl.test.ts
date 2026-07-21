import { describe, expect, it } from 'vitest';
import { applyStickyCtrl, reduceStickyCtrl } from './stickyCtrl';

describe('sticky Ctrl state machine', () => {
  it('uses a tap as a one-shot modifier and consumes the next keyboard letter', () => {
    const armed = reduceStickyCtrl('inactive', 'tap');
    expect(armed).toBe('one-shot');
    expect(applyStickyCtrl(armed, 'c')).toEqual({
      data: '\x03',
      mode: 'inactive',
      consumed: true,
    });
  });

  it('keeps chained chords active while held', () => {
    const held = reduceStickyCtrl('inactive', 'hold-start');
    expect(applyStickyCtrl(held, 'c').mode).toBe('held');
    expect(applyStickyCtrl(held, 'd').data).toBe('\x04');
    expect(reduceStickyCtrl(held, 'hold-end')).toBe('inactive');
  });

  it('locks on double-tap and unlocks on the next tap', () => {
    const locked = reduceStickyCtrl('one-shot', 'double-tap');
    expect(locked).toBe('locked');
    expect(applyStickyCtrl(locked, 'z')).toMatchObject({ data: '\x1a', mode: 'locked' });
    expect(reduceStickyCtrl(locked, 'tap')).toBe('inactive');
  });

  it('waits for a letter instead of consuming navigation input', () => {
    expect(applyStickyCtrl('one-shot', '\x1b[A')).toEqual({
      data: '\x1b[A',
      mode: 'one-shot',
      consumed: false,
    });
  });
});
