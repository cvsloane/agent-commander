import { describe, expect, it, vi } from 'vitest';
import type { XTerminal } from '@/components/terminal/types';
import {
  buildSgrWheelReports,
  calculatePinchFontSize,
  dispatchTerminalTouchScroll,
  mapTouchScrollPixelsToLines,
  mapScrollLinesToWheelReports,
  resolveTerminalHorizontalSwipe,
  resolveTerminalTouchScrollPath,
  resolveTouchCell,
  synthesizeCursorDragInput,
} from './useTerminalTouchScroll';

function terminalForScroll(
  bufferType: 'normal' | 'alternate',
  mouseTrackingMode: 'none' | 'x10' | 'vt200' | 'drag' | 'any'
): XTerminal {
  return {
    buffer: { active: { type: bufferType } },
    modes: { mouseTrackingMode },
    scrollLines: vi.fn(),
  } as unknown as XTerminal;
}

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

describe('terminal horizontal swipe', () => {
  it('navigates only for a decisive gesture that is not letterbox panning', () => {
    expect(resolveTerminalHorizontalSwipe(-80, 10, false)).toBe('next');
    expect(resolveTerminalHorizontalSwipe(80, -10, false)).toBe('previous');
    expect(resolveTerminalHorizontalSwipe(-80, 10, true)).toBeNull();
    expect(resolveTerminalHorizontalSwipe(-40, 2, false)).toBeNull();
    expect(resolveTerminalHorizontalSwipe(-80, 70, false)).toBeNull();
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

describe('terminal touch wheel synthesis', () => {
  it('maps signed line deltas to five-line wheel reports with a remainder', () => {
    expect(mapScrollLinesToWheelReports(-2)).toEqual({ reportDelta: 0, remainder: -2 });
    expect(mapScrollLinesToWheelReports(-3, -2)).toEqual({
      reportDelta: -1,
      remainder: 0,
    });
    expect(mapScrollLinesToWheelReports(11)).toEqual({ reportDelta: 2, remainder: 1 });
  });

  it('builds repeated SGR wheel-up and wheel-down reports at the touch cell', () => {
    expect(buildSgrWheelReports(-2, 12, 7)).toBe(
      '\x1b[<64;12;7M\x1b[<64;12;7M'
    );
    expect(buildSgrWheelReports(1, 3, 4)).toBe('\x1b[<65;3;4M');
    expect(buildSgrWheelReports(0, 3, 4)).toBe('');
  });

  it('derives one-based touch cells and clamps them to the terminal grid', () => {
    const rect = { left: 100, top: 50 };
    expect(resolveTouchCell(124, 90, rect, 8, 20, 80, 24)).toEqual({
      column: 4,
      row: 3,
    });
    expect(resolveTouchCell(20, 10, rect, 8, 20, 80, 24)).toEqual({
      column: 1,
      row: 1,
    });
    expect(resolveTouchCell(2_000, 2_000, rect, 8, 20, 80, 24)).toEqual({
      column: 80,
      row: 24,
    });
  });
});

describe('native terminal touch scroll mapping', () => {
  it('maps pixel motion to one line per row while carrying sub-line pixels', () => {
    expect(mapTouchScrollPixelsToLines(8, 0, 16)).toEqual({ lines: 0, remainder: 8 });
    expect(mapTouchScrollPixelsToLines(12, 8, 16)).toEqual({ lines: 1, remainder: 4 });
    expect(mapTouchScrollPixelsToLines(-36, 4, 16)).toEqual({ lines: -2, remainder: 0 });
  });

  it('routes attached tmux history ahead of buffer and permission state', () => {
    expect(
      resolveTerminalTouchScrollPath({
        bufferType: 'normal',
        mouseTrackingMode: 'any',
        writable: true,
        tmuxAttached: true,
        historyAvailable: true,
      })
    ).toBe('history');
    expect(
      resolveTerminalTouchScrollPath({
        bufferType: 'alternate',
        mouseTrackingMode: 'none',
        writable: false,
        tmuxAttached: true,
        historyAvailable: true,
      })
    ).toBe('history');
    expect(
      resolveTerminalTouchScrollPath({
        bufferType: 'alternate',
        mouseTrackingMode: 'drag',
        writable: true,
        tmuxAttached: true,
        historyAvailable: false,
      })
    ).toBe('none');
  });

  it('keeps non-tmux local and SGR paths unchanged', () => {
    expect(
      resolveTerminalTouchScrollPath({
        bufferType: 'normal',
        mouseTrackingMode: 'any',
        writable: true,
        tmuxAttached: false,
        historyAvailable: false,
      })
    ).toBe('local');
    expect(
      resolveTerminalTouchScrollPath({
        bufferType: 'alternate',
        mouseTrackingMode: 'drag',
        writable: true,
        tmuxAttached: false,
        historyAvailable: false,
      })
    ).toBe('sgr');
    expect(
      resolveTerminalTouchScrollPath({
        bufferType: 'alternate',
        mouseTrackingMode: 'none',
        writable: true,
        tmuxAttached: false,
        historyAvailable: false,
      })
    ).toBe('local');
    expect(
      resolveTerminalTouchScrollPath({
        bufferType: 'alternate',
        mouseTrackingMode: 'drag',
        writable: false,
        tmuxAttached: false,
        historyAvailable: false,
      })
    ).toBe('none');
  });
});

describe('terminal touch scroll dispatch', () => {
  it('keeps normal-buffer scrolling in xterm', () => {
    const terminal = terminalForScroll('normal', 'none');
    const onInput = vi.fn();

    expect(dispatchTerminalTouchScroll({
      terminal,
      lineDelta: -4,
      wheelRemainder: 0,
      column: 2,
      row: 3,
      writable: true,
      onInput,
    })).toBe(0);
    expect(terminal.scrollLines).toHaveBeenCalledWith(-4);
    expect(onInput).not.toHaveBeenCalled();
  });

  it('sends SGR reports for a writable alternate buffer with mouse tracking', () => {
    const terminal = terminalForScroll('alternate', 'drag');
    const onInput = vi.fn();
    const remainder = dispatchTerminalTouchScroll({
      terminal,
      lineDelta: -3,
      wheelRemainder: 0,
      column: 12,
      row: 7,
      writable: true,
      onInput,
    });

    expect(dispatchTerminalTouchScroll({
      terminal,
      lineDelta: -2,
      wheelRemainder: remainder,
      column: 12,
      row: 7,
      writable: true,
      onInput,
    })).toBe(0);
    expect(terminal.scrollLines).not.toHaveBeenCalled();
    expect(onInput).toHaveBeenCalledOnce();
    expect(onInput).toHaveBeenCalledWith('\x1b[<64;12;7M');
  });

  it('opens history without terminal input for an attached tmux terminal', () => {
    const terminal = terminalForScroll('alternate', 'drag');
    const onInput = vi.fn();
    const onOpenHistory = vi.fn();

    expect(
      dispatchTerminalTouchScroll({
        terminal,
        lineDelta: 2,
        wheelRemainder: 4,
        column: 12,
        row: 7,
        writable: true,
        onInput,
        tmuxAttached: true,
        historyAvailable: true,
        onOpenHistory,
      })
    ).toBe(0);
    expect(onOpenHistory).toHaveBeenCalledOnce();
    expect(onInput).not.toHaveBeenCalled();
    expect(terminal.scrollLines).not.toHaveBeenCalled();
  });

  it('opens attached tmux history while read-only and ignores downward swipes', () => {
    const terminal = terminalForScroll('normal', 'none');
    const onInput = vi.fn();
    const onOpenHistory = vi.fn();

    dispatchTerminalTouchScroll({
      terminal,
      lineDelta: 3,
      wheelRemainder: 0,
      column: 2,
      row: 3,
      writable: false,
      onInput,
      tmuxAttached: true,
      historyAvailable: true,
      onOpenHistory,
    });
    dispatchTerminalTouchScroll({
      terminal,
      lineDelta: -3,
      wheelRemainder: 0,
      column: 2,
      row: 3,
      writable: false,
      onInput,
      tmuxAttached: true,
      historyAvailable: true,
      onOpenHistory,
    });

    expect(onOpenHistory).toHaveBeenCalledOnce();
    expect(onInput).not.toHaveBeenCalled();
    expect(terminal.scrollLines).not.toHaveBeenCalled();
  });

  it('does nothing for an attached tmux terminal without a history session', () => {
    const terminal = terminalForScroll('alternate', 'drag');
    const onInput = vi.fn();
    const onOpenHistory = vi.fn();

    dispatchTerminalTouchScroll({
      terminal,
      lineDelta: 4,
      wheelRemainder: 0,
      column: 2,
      row: 3,
      writable: true,
      onInput,
      tmuxAttached: true,
      historyAvailable: false,
      onOpenHistory,
    });

    expect(onOpenHistory).not.toHaveBeenCalled();
    expect(onInput).not.toHaveBeenCalled();
    expect(terminal.scrollLines).not.toHaveBeenCalled();
  });

  it('falls back to xterm scrolling when the alternate buffer has no mouse tracking', () => {
    const terminal = terminalForScroll('alternate', 'none');
    const onInput = vi.fn();

    dispatchTerminalTouchScroll({
      terminal,
      lineDelta: 6,
      wheelRemainder: 0,
      column: 2,
      row: 3,
      writable: true,
      onInput,
    });

    expect(terminal.scrollLines).toHaveBeenCalledWith(6);
    expect(onInput).not.toHaveBeenCalled();
  });

  it('does nothing for a read-only or disconnected mouse-tracked alternate buffer', () => {
    const terminal = terminalForScroll('alternate', 'drag');
    const onInput = vi.fn();

    expect(dispatchTerminalTouchScroll({
      terminal,
      lineDelta: -5,
      wheelRemainder: 0,
      column: 2,
      row: 3,
      writable: false,
      onInput,
    })).toBe(0);
    expect(terminal.scrollLines).not.toHaveBeenCalled();
    expect(onInput).not.toHaveBeenCalled();
  });
});
