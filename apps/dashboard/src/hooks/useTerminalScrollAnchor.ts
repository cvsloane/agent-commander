'use client';

import { useCallback, useRef } from 'react';
import type { XTerminal } from '@/components/terminal/types';

export function isTerminalViewportAtBottom(terminal: XTerminal): boolean {
  const buffer = terminal.buffer.active;
  return buffer.viewportY >= buffer.baseY;
}

export function syncTerminalScrollAnchor(
  terminal: XTerminal,
  jumpToLiveButton: HTMLButtonElement | null
): boolean {
  const isAtBottom = isTerminalViewportAtBottom(terminal);
  if (jumpToLiveButton) {
    jumpToLiveButton.hidden = isAtBottom;
  }
  return isAtBottom;
}

export function jumpTerminalToLive(
  terminal: XTerminal,
  jumpToLiveButton: HTMLButtonElement | null
): void {
  terminal.scrollToBottom();
  terminal.focus();
  syncTerminalScrollAnchor(terminal, jumpToLiveButton);
}

export function useTerminalScrollAnchor() {
  const isAtBottomRef = useRef(true);
  const jumpToLiveButtonRef = useRef<HTMLButtonElement>(null);

  const syncViewportPosition = useCallback((terminal: XTerminal) => {
    const isAtBottom = syncTerminalScrollAnchor(terminal, jumpToLiveButtonRef.current);
    isAtBottomRef.current = isAtBottom;
  }, []);

  const jumpToLive = useCallback((terminal: XTerminal | null) => {
    if (!terminal) return;
    jumpTerminalToLive(terminal, jumpToLiveButtonRef.current);
    isAtBottomRef.current = true;
  }, []);

  return {
    isAtBottomRef,
    jumpToLiveButtonRef,
    handleViewportScroll: syncViewportPosition,
    handleOutputWritten: syncViewportPosition,
    jumpToLive,
  };
}
