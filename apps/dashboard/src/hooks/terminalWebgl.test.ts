import { describe, expect, it, vi } from 'vitest';
import type { XTerminal } from '@/components/terminal/types';
import {
  installResilientTerminalWebgl,
  TERMINAL_WEBGL_RETRY_DELAY_MS,
} from './terminalWebgl';

function addon() {
  let contextLoss: (() => void) | undefined;
  return {
    dispose: vi.fn(),
    onContextLoss: vi.fn((listener: () => void) => {
      contextLoss = listener;
      return { dispose: vi.fn() };
    }),
    loseContext: () => contextLoss?.(),
  };
}

describe('terminal WebGL resilience', () => {
  it('recreates once after the backoff and reports permanent DOM fallback after another loss', () => {
    const first = addon();
    const second = addon();
    const createAddon = vi.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const scheduled: Array<() => void> = [];
    const report = vi.fn();
    const terminal = { loadAddon: vi.fn() } as unknown as XTerminal;
    const cleanup = installResilientTerminalWebgl(terminal, createAddon, {
      schedule: (callback, delayMs) => {
        expect(delayMs).toBe(TERMINAL_WEBGL_RETRY_DELAY_MS);
        scheduled.push(callback);
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      report,
    });

    first.loseContext();
    expect(createAddon).toHaveBeenCalledOnce();
    expect(report).not.toHaveBeenCalled();
    scheduled[0]?.();
    expect(createAddon).toHaveBeenCalledTimes(2);

    second.loseContext();
    expect(createAddon).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({
      name: 'terminal.webgl_permanent_fallback',
      attributes: expect.objectContaining({ reason: 'context_loss_after_retry' }),
    }));
    cleanup();
  });

  it('does not recreate after disposal during the backoff', () => {
    const first = addon();
    let retry: (() => void) | undefined;
    const createAddon = vi.fn().mockReturnValue(first);
    const cancel = vi.fn();
    const cleanup = installResilientTerminalWebgl(
      { loadAddon: vi.fn() } as unknown as XTerminal,
      createAddon,
      {
        schedule: (callback) => {
          retry = callback;
          return 2 as unknown as ReturnType<typeof setTimeout>;
        },
        cancel,
      }
    );

    first.loseContext();
    cleanup();
    retry?.();
    expect(cancel).toHaveBeenCalled();
    expect(createAddon).toHaveBeenCalledOnce();
  });
});
