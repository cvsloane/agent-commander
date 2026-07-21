import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { XTerminal } from '@/components/terminal/types';
import {
  captureTerminalWarmBuffer,
  clearProvisionalTerminalWarmBuffer,
  getTerminalWarmResumeToken,
  getTerminalResumeNotice,
  paintTerminalWarmBuffer,
  resetTerminalWarmCache,
  setTerminalWarmResumeToken,
} from './terminalWarmCache';

function sourceTerminal(lines: Array<{ text: string; wrapped?: boolean }>) {
  return {
    buffer: {
      active: {
        length: lines.length,
        getLine: (index: number) => {
          const line = lines[index];
          return line && {
            isWrapped: line.wrapped ?? false,
            translateToString: () => line.text,
          };
        },
      },
    },
  } as unknown as XTerminal;
}

describe('terminal warm cache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    resetTerminalWarmCache();
  });
  afterEach(() => vi.useRealTimers());

  it('paints a serialized pane immediately and clears it before live capture replay', () => {
    const terminal = sourceTerminal([
      { text: '$ pnpm test' },
      { text: 'all ', wrapped: false },
      { text: 'passed', wrapped: true },
    ]);
    captureTerminalWarmBuffer('pane-1', terminal, 1_000);

    const target = { write: vi.fn(), reset: vi.fn() } as unknown as XTerminal;
    expect(paintTerminalWarmBuffer('pane-1', target, 10_000)).toBe(true);
    expect(target.write).toHaveBeenCalledWith('$ pnpm test\r\nall passed');
    expect(clearProvisionalTerminalWarmBuffer('pane-1', target)).toBe(true);
    expect(target.reset).toHaveBeenCalledOnce();
  });

  it('keeps a pane resume token only inside the configured warm window', () => {
    vi.setSystemTime(2_000);
    setTerminalWarmResumeToken('pane-1', 'resume-1', 1_000);
    expect(getTerminalWarmResumeToken('pane-1', 1_001)).toBe('resume-1');
    expect(getTerminalWarmResumeToken('pane-1', 999)).toBeUndefined();
  });

  it('distinguishes a true resume from a fresh attach after warm state was lost', () => {
    expect(getTerminalResumeNotice({
      resumed: true,
      requestedResume: true,
      hadWarmBuffer: true,
      restartedAfterFailure: false,
    })).toBe('resumed');
    expect(getTerminalResumeNotice({
      resumed: false,
      requestedResume: false,
      hadWarmBuffer: true,
      restartedAfterFailure: false,
    })).toBe('restarted');
    expect(getTerminalResumeNotice({
      resumed: false,
      requestedResume: false,
      hadWarmBuffer: false,
      restartedAfterFailure: false,
    })).toBeUndefined();
  });
});
