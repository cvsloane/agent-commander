import { describe, expect, it, vi } from 'vitest';
import type { XTerminal } from '@/components/terminal/types';
import { jumpTerminalToLive, syncTerminalScrollAnchor } from './useTerminalScrollAnchor';

describe('terminal scroll anchoring', () => {
  it('does not yank a scrolled-back viewport and jumps only on explicit request', () => {
    const viewport = { viewportY: 12, baseY: 20 };
    const scrollToBottom = vi.fn(() => {
      viewport.viewportY = viewport.baseY;
    });
    const focus = vi.fn();
    const terminal = {
      buffer: { active: viewport },
      scrollToBottom,
      focus,
    } as unknown as XTerminal;
    const jumpButton = { hidden: true } as HTMLButtonElement;

    expect(syncTerminalScrollAnchor(terminal, jumpButton)).toBe(false);
    expect(jumpButton.hidden).toBe(false);
    expect(scrollToBottom).not.toHaveBeenCalled();

    viewport.baseY = 21;
    expect(syncTerminalScrollAnchor(terminal, jumpButton)).toBe(false);
    expect(scrollToBottom).not.toHaveBeenCalled();

    jumpTerminalToLive(terminal, jumpButton);
    expect(scrollToBottom).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
    expect(jumpButton.hidden).toBe(true);
  });
});
