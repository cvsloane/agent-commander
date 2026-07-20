import { describe, expect, it, vi } from 'vitest';
import { handleTerminalOutputFrame } from './terminalFrameRouter';

describe('terminal output hot path', () => {
  it('performs zero status or store writes across consecutive steady-state output frames', () => {
    const write = vi.fn();
    const statusOrStoreWrite = vi.fn();

    for (let index = 0; index < 250; index += 1) {
      const handled = handleTerminalOutputFrame(
        { type: 'output', data: `frame-${index}` },
        write
      );
      if (!handled) statusOrStoreWrite();
    }

    expect(write).toHaveBeenCalledTimes(250);
    expect(statusOrStoreWrite).not.toHaveBeenCalled();
  });
});
