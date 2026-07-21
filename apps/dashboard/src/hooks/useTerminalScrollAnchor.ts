'use client';

import { useCallback, useRef } from 'react';
import type { XTerminal } from '@/components/terminal/types';

type TerminalOutput = string | Uint8Array;

export interface TerminalFreezeState {
  frozen: boolean;
  viewportY: number;
  bufferedLines: number;
}

export function createTerminalFreezeState(): TerminalFreezeState {
  return { frozen: false, viewportY: 0, bufferedLines: 0 };
}

export function countTerminalOutputLines(data: TerminalOutput): number {
  if (typeof data === 'string') return data.split('\n').length - 1;
  let lines = 0;
  for (const byte of data) {
    if (byte === 10) lines += 1;
  }
  return lines;
}

export function freezeTerminalViewport(
  state: TerminalFreezeState,
  terminal: XTerminal,
  data: TerminalOutput
): void {
  if (isTerminalViewportAtBottom(terminal)) return;
  state.frozen = true;
  state.viewportY = terminal.buffer.active.viewportY;
  state.bufferedLines += countTerminalOutputLines(data);
}

export function resetTerminalFreezeState(state: TerminalFreezeState): void {
  state.frozen = false;
  state.viewportY = 0;
  state.bufferedLines = 0;
}

function syncJumpToLiveButton(
  button: HTMLButtonElement | null,
  label: HTMLElement | null,
  state: TerminalFreezeState,
  atBottom: boolean
): void {
  if (!button) return;
  button.hidden = atBottom;
  button.style.display = atBottom ? 'none' : '';
  const lineLabel = state.bufferedLines === 1 ? '1 new line' : `${state.bufferedLines} new lines`;
  const visibleLabel = state.bufferedLines > 0 ? lineLabel : 'Live';
  if (label) label.textContent = visibleLabel;
  button.setAttribute(
    'aria-label',
    state.bufferedLines > 0
      ? `${lineLabel}; jump to live terminal output`
      : 'Jump to live terminal output'
  );
}

export function isTerminalViewportAtBottom(terminal: XTerminal): boolean {
  const buffer = terminal.buffer.active;
  return buffer.viewportY >= buffer.baseY;
}

export function syncTerminalScrollAnchor(
  terminal: XTerminal,
  jumpToLiveButton: HTMLButtonElement | null,
  jumpToLiveLabel: HTMLElement | null = null,
  freezeState: TerminalFreezeState = createTerminalFreezeState(),
  preserveFrozenViewport = false
): boolean {
  const isAtBottom = isTerminalViewportAtBottom(terminal);
  if (isAtBottom) {
    resetTerminalFreezeState(freezeState);
  } else if (!preserveFrozenViewport) {
    freezeState.frozen = true;
    freezeState.viewportY = terminal.buffer.active.viewportY;
  }
  syncJumpToLiveButton(jumpToLiveButton, jumpToLiveLabel, freezeState, isAtBottom);
  return isAtBottom;
}

export function restoreTerminalFrozenViewport(
  terminal: XTerminal,
  jumpToLiveButton: HTMLButtonElement | null,
  jumpToLiveLabel: HTMLElement | null,
  freezeState: TerminalFreezeState
): void {
  if (!freezeState.frozen) {
    syncTerminalScrollAnchor(terminal, jumpToLiveButton, jumpToLiveLabel, freezeState);
    return;
  }
  terminal.scrollToLine(freezeState.viewportY);
  syncJumpToLiveButton(jumpToLiveButton, jumpToLiveLabel, freezeState, false);
}

export function followTerminalLiveOutput(
  terminal: XTerminal,
  jumpToLiveButton: HTMLButtonElement | null,
  jumpToLiveLabel: HTMLElement | null,
  freezeState: TerminalFreezeState
): void {
  resetTerminalFreezeState(freezeState);
  terminal.scrollToBottom();
  syncTerminalScrollAnchor(
    terminal,
    jumpToLiveButton,
    jumpToLiveLabel,
    freezeState,
    true
  );
}

export function jumpTerminalToLive(
  terminal: XTerminal,
  jumpToLiveButton: HTMLButtonElement | null,
  jumpToLiveLabel: HTMLElement | null = null,
  freezeState: TerminalFreezeState = createTerminalFreezeState()
): void {
  resetTerminalFreezeState(freezeState);
  terminal.scrollToBottom();
  terminal.focus();
  syncTerminalScrollAnchor(terminal, jumpToLiveButton, jumpToLiveLabel, freezeState);
}

export function useTerminalScrollAnchor() {
  const isAtBottomRef = useRef(true);
  const jumpToLiveButtonRef = useRef<HTMLButtonElement>(null);
  const jumpToLiveLabelRef = useRef<HTMLSpanElement>(null);
  const freezeStateRef = useRef<TerminalFreezeState>(createTerminalFreezeState());
  const outputInFlightRef = useRef(false);
  const outputStartedAtBottomRef = useRef(true);

  const syncViewportPosition = useCallback((terminal: XTerminal) => {
    const isAtBottom = syncTerminalScrollAnchor(
      terminal,
      jumpToLiveButtonRef.current,
      jumpToLiveLabelRef.current,
      freezeStateRef.current,
      outputInFlightRef.current
    );
    isAtBottomRef.current = isAtBottom;
  }, []);

  const handleOutputStart = useCallback((terminal: XTerminal, data: TerminalOutput) => {
    outputInFlightRef.current = true;
    outputStartedAtBottomRef.current = isTerminalViewportAtBottom(terminal);
    freezeTerminalViewport(freezeStateRef.current, terminal, data);
  }, []);

  const handleOutputWritten = useCallback((terminal: XTerminal) => {
    if (outputStartedAtBottomRef.current) {
      followTerminalLiveOutput(
        terminal,
        jumpToLiveButtonRef.current,
        jumpToLiveLabelRef.current,
        freezeStateRef.current
      );
    } else {
      restoreTerminalFrozenViewport(
        terminal,
        jumpToLiveButtonRef.current,
        jumpToLiveLabelRef.current,
        freezeStateRef.current
      );
    }
    outputInFlightRef.current = false;
    isAtBottomRef.current = !freezeStateRef.current.frozen;
  }, []);

  const jumpToLive = useCallback((terminal: XTerminal | null) => {
    if (!terminal) return;
    jumpTerminalToLive(
      terminal,
      jumpToLiveButtonRef.current,
      jumpToLiveLabelRef.current,
      freezeStateRef.current
    );
    isAtBottomRef.current = true;
  }, []);

  return {
    isAtBottomRef,
    jumpToLiveButtonRef,
    jumpToLiveLabelRef,
    handleViewportScroll: syncViewportPosition,
    handleOutputStart,
    handleOutputWritten,
    jumpToLive,
  };
}
