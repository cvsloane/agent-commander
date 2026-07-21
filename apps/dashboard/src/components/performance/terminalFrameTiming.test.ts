import { afterEach, describe, expect, it, vi } from 'vitest';
import { beginTerminalFrameTimingIfEnabled } from './terminalFrameTiming';

describe('enabled terminal frame timing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does no sampling work while performance telemetry is disabled', () => {
    vi.stubGlobal('window', { location: { search: '' } });
    const begin = vi.fn();

    expect(beginTerminalFrameTimingIfEnabled(512, begin)).toBeNull();
    expect(begin).not.toHaveBeenCalled();
  });

  it('starts the existing probe when the perf query flag is enabled', () => {
    vi.stubGlobal('window', { location: { search: '?perf=1' } });
    const complete = vi.fn();
    const begin = vi.fn(() => complete);

    expect(beginTerminalFrameTimingIfEnabled(512, begin)).toBe(complete);
    expect(begin).toHaveBeenCalledWith(512);
  });
});
