import { describe, expect, it, vi } from 'vitest';
import type { XTerminal } from '@/components/terminal/types';
import {
  createTerminalFreezeState,
  followTerminalLiveOutput,
  freezeTerminalViewport,
  jumpTerminalToLive,
  restoreTerminalFrozenViewport,
  syncTerminalScrollAnchor,
} from './useTerminalScrollAnchor';

describe('terminal scroll anchoring', () => {
  it('does not yank a scrolled-back viewport and jumps only on explicit request', () => {
    const viewport = { viewportY: 12, baseY: 20 };
    const scrollToLine = vi.fn((line: number) => {
      viewport.viewportY = line;
    });
    const scrollToBottom = vi.fn(() => {
      viewport.viewportY = viewport.baseY;
    });
    const focus = vi.fn();
    const terminal = {
      buffer: { active: viewport },
      scrollToLine,
      scrollToBottom,
      focus,
    } as unknown as XTerminal;
    const jumpButton = {
      hidden: true,
      style: { display: 'none' },
      setAttribute: vi.fn(),
    } as unknown as HTMLButtonElement;

    expect(syncTerminalScrollAnchor(terminal, jumpButton)).toBe(false);
    expect(jumpButton.hidden).toBe(false);
    expect(jumpButton.style.display).toBe('');
    expect(scrollToBottom).not.toHaveBeenCalled();

    viewport.baseY = 21;
    expect(syncTerminalScrollAnchor(terminal, jumpButton)).toBe(false);
    expect(scrollToBottom).not.toHaveBeenCalled();

    jumpTerminalToLive(terminal, jumpButton);
    expect(scrollToBottom).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
    expect(jumpButton.hidden).toBe(true);
    expect(jumpButton.style.display).toBe('none');
  });

  it('freezes the viewport while frames buffer and reports new lines until explicit release', () => {
    const viewport = { viewportY: 8, baseY: 20 };
    const scrollToLine = vi.fn((line: number) => {
      viewport.viewportY = line;
    });
    const scrollToBottom = vi.fn(() => {
      viewport.viewportY = viewport.baseY;
    });
    const terminal = {
      buffer: { active: viewport },
      scrollToLine,
      scrollToBottom,
      focus: vi.fn(),
    } as unknown as XTerminal;
    const jumpButton = {
      hidden: true,
      style: { display: 'none' },
      setAttribute: vi.fn(),
    } as unknown as HTMLButtonElement;
    const jumpLabel = { textContent: '' } as HTMLSpanElement;
    const state = createTerminalFreezeState();

    freezeTerminalViewport(state, terminal, 'first\nsecond\n');
    viewport.viewportY = 10;
    viewport.baseY = 22;
    restoreTerminalFrozenViewport(terminal, jumpButton, jumpLabel, state);

    expect(scrollToLine).toHaveBeenCalledWith(8);
    expect(state).toEqual({ frozen: true, viewportY: 8, bufferedLines: 2 });
    expect(jumpLabel.textContent).toBe('2 new lines');
    expect(jumpButton.hidden).toBe(false);
    expect(jumpButton.style.display).toBe('');

    jumpTerminalToLive(terminal, jumpButton, jumpLabel, state);
    expect(state).toEqual({ frozen: false, viewportY: 0, bufferedLines: 0 });
    expect(jumpButton.hidden).toBe(true);
    expect(jumpButton.style.display).toBe('none');
  });

  it('keeps following output that started live despite intermediate xterm scroll events', () => {
    const viewport = { viewportY: 20, baseY: 20 };
    const terminal = {
      buffer: { active: viewport },
      scrollToLine: vi.fn(),
      scrollToBottom: vi.fn(() => {
        viewport.viewportY = viewport.baseY;
      }),
      focus: vi.fn(),
    } as unknown as XTerminal;
    const jumpButton = {
      hidden: true,
      style: { display: 'none' },
      setAttribute: vi.fn(),
    } as unknown as HTMLButtonElement;
    const jumpLabel = { textContent: '' } as HTMLSpanElement;
    const state = createTerminalFreezeState();

    freezeTerminalViewport(state, terminal, 'live line\n');
    viewport.baseY = 22;
    syncTerminalScrollAnchor(terminal, jumpButton, jumpLabel, state, true);

    expect(state.frozen).toBe(false);
    followTerminalLiveOutput(terminal, jumpButton, jumpLabel, state);
    expect(terminal.scrollToBottom).toHaveBeenCalledOnce();
    expect(terminal.focus).not.toHaveBeenCalled();
    expect(jumpButton.hidden).toBe(true);
  });
});
