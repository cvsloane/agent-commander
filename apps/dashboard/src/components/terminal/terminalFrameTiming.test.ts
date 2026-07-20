import { describe, expect, it, vi } from 'vitest';
import { beginTerminalFrameTiming, TERMINAL_FRAME_TIMING_SAMPLE_RATE } from './terminalFrameTiming';

describe('terminal frame timing probe', () => {
  it('samples a WebSocket frame through the next xterm paint', () => {
    const report = vi.fn();
    let now = 100;
    const complete = beginTerminalFrameTiming(512, {
      random: () => 0,
      now: () => now,
      schedulePaint: (callback) => {
        now = 108.5;
        callback(now);
        return 1;
      },
      report,
    });

    complete?.();
    complete?.();

    expect(report).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith({
      name: 'terminal.frame_to_paint',
      value: 8.5,
      unit: 'ms',
      attributes: { bytes: 512, sample_rate: TERMINAL_FRAME_TIMING_SAMPLE_RATE },
    });
  });

  it('does not schedule unsampled frames', () => {
    const schedulePaint = vi.fn();
    expect(beginTerminalFrameTiming(64, {
      random: () => TERMINAL_FRAME_TIMING_SAMPLE_RATE,
      schedulePaint,
    })).toBeNull();
    expect(schedulePaint).not.toHaveBeenCalled();
  });
});
