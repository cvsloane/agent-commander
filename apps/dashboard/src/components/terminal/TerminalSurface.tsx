'use client';

import { useEffect, type RefObject } from 'react';
import { ArrowDown, Loader2, MessageSquareText } from 'lucide-react';
import { SelectionPopup, TerminalContextMenu } from '@/components/mobile';
import type { SelectionPopupHandle } from '@/components/mobile';
import { TerminalKeyRail } from '@/components/mobile/TerminalKeyRail';
import type { StickyCtrlEvent, StickyCtrlMode } from '@/components/mobile/stickyCtrl';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ConnectionStatus, XTerminal } from './types';
import { TerminalHistoryOverlay } from './TerminalHistoryOverlay';
import type { TerminalScrollMode } from './terminalScrollMode';
import { TerminalSearchSheet, type TerminalSearchControlsProps } from './TerminalSearch';
import { TerminalTouchSelection } from './TerminalTouchSelection';
import type { TerminalCommandMarkView } from './commandMarks';

interface TerminalSurfaceProps {
  termRef: RefObject<HTMLDivElement | null>;
  terminalRef: RefObject<XTerminal | null>;
  isMobile: boolean;
  touchInputModeEnabled: boolean;
  status: ConnectionStatus;
  readOnly: boolean;
  selectionTextRef: RefObject<string>;
  selectionPopupRef: RefObject<SelectionPopupHandle | null>;
  onSelectionStart: (anchor: { x: number; y: number }) => void;
  onSelectionCommit: () => void;
  onVirtualInput: (data: string) => void;
  keyboardActive: boolean;
  onKeyboardToggle: () => void;
  cursorArmed: boolean;
  onCursorToggle: () => void;
  stickyCtrlMode: StickyCtrlMode;
  onStickyCtrlEvent: (event: StickyCtrlEvent) => void;
  onOpenHistory: () => void;
  historyOverlayOpen: boolean;
  historySessionId: string;
  historyFontSize: number;
  preferLocalChat: boolean;
  chatRefreshToken: number;
  interactionBlocked: boolean;
  onOpenChat: () => void;
  onHistoryScrollModeResolved: (mode: TerminalScrollMode) => void;
  onCloseHistoryOverlay: () => void;
  tmuxPrefix?: string;
  onPreviousMark: () => void;
  onNextMark: () => void;
  hasCommandMarks: boolean;
  currentCommandMark: TerminalCommandMarkView | null;
  onCopySelection: () => void;
  onCopyLastLines: (lines: number) => void;
  onCopyAll: () => void;
  onPaste: (text?: string) => void;
  onClear: () => void;
  onCopySelectionText: (text: string) => void;
  jumpToLiveButtonRef: RefObject<HTMLButtonElement | null>;
  jumpToLiveLabelRef: RefObject<HTMLSpanElement | null>;
  onJumpToLive: () => void;
  search: TerminalSearchControlsProps;
}

export function TerminalSurface({
  termRef,
  terminalRef,
  isMobile,
  touchInputModeEnabled,
  status,
  readOnly,
  selectionTextRef,
  selectionPopupRef,
  onSelectionStart,
  onSelectionCommit,
  onVirtualInput,
  keyboardActive,
  onKeyboardToggle,
  cursorArmed,
  onCursorToggle,
  stickyCtrlMode,
  onStickyCtrlEvent,
  onOpenHistory,
  historyOverlayOpen,
  historySessionId,
  historyFontSize,
  preferLocalChat,
  chatRefreshToken,
  interactionBlocked,
  onOpenChat,
  onHistoryScrollModeResolved,
  onCloseHistoryOverlay,
  tmuxPrefix,
  onPreviousMark,
  onNextMark,
  hasCommandMarks,
  currentCommandMark,
  onCopySelection,
  onCopyLastLines,
  onCopyAll,
  onPaste,
  onClear,
  onCopySelectionText,
  jumpToLiveButtonRef,
  jumpToLiveLabelRef,
  onJumpToLive,
  search,
}: TerminalSurfaceProps) {
  useEffect(() => {
    if (!touchInputModeEnabled) return;
    const container = termRef.current;
    if (!container) return;
    const applyInputMode = () => {
      const textarea = container.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
      if (textarea) textarea.inputMode = keyboardActive ? 'text' : 'none';
    };
    applyInputMode();
    const observer = new MutationObserver(applyInputMode);
    observer.observe(container, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      container
        .querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')
        ?.removeAttribute('inputmode');
    };
  }, [keyboardActive, termRef, touchInputModeEnabled]);

  return (
    <>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-[#0a0a0a]">
        <div
          ref={termRef as RefObject<HTMLDivElement>}
          tabIndex={0}
          onMouseDown={(event) => {
            onSelectionStart({ x: event.clientX, y: event.clientY });
            terminalRef.current?.focus();
            window.setTimeout(() => terminalRef.current?.focus(), 0);
          }}
          onMouseUp={onSelectionCommit}
          className={cn(
            'relative h-full w-full cursor-text overflow-hidden bg-[#0a0a0a] p-1 focus:outline-none',
            isMobile && 'touch-none',
            interactionBlocked && 'pointer-events-none',
            status === 'connected' &&
              'border-l-2 border-emerald-500 shadow-[inset_2px_0_0_rgba(16,185,129,0.35)]'
          )}
          aria-label="Interactive terminal"
          aria-busy={interactionBlocked}
          aria-disabled={interactionBlocked}
        />

        {interactionBlocked && (
          <div
            className="absolute inset-0 z-20 flex items-center justify-center bg-black/55 text-sm text-white backdrop-blur-[1px]"
            role="status"
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/80 px-3 py-2">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Switching pane — input paused
            </span>
          </div>
        )}

        <TerminalTouchSelection
          enabled={isMobile && status === 'connected' && !interactionBlocked}
          containerRef={termRef}
          terminalRef={terminalRef}
          onCopy={onCopySelectionText}
        />

        {currentCommandMark && (
          <div
            className="pointer-events-none absolute left-2 right-2 top-1 z-10 flex h-7 items-center gap-2 rounded border border-white/10 bg-zinc-950/90 px-2 font-mono text-[10px] text-white shadow backdrop-blur"
            data-testid="terminal-command-header"
            aria-label={`${currentCommandMark.approximate ? 'Approximate agent turn' : 'Shell command'}: ${currentCommandMark.label}`}
          >
            <span
              className={cn(
                'shrink-0 rounded px-1 py-0.5 font-sans text-[8px] font-bold uppercase tracking-wide',
                currentCommandMark.approximate
                  ? 'bg-violet-500/20 text-violet-200'
                  : 'bg-emerald-500/20 text-emerald-200'
              )}
            >
              {currentCommandMark.approximate ? 'Approx.' : 'Command'}
            </span>
            <span className="truncate">{currentCommandMark.label}</span>
          </div>
        )}

        <Button
          ref={jumpToLiveButtonRef}
          type="button"
          size="sm"
          variant="secondary"
          hidden
          style={{ display: 'none' }}
          onClick={onJumpToLive}
          className="absolute bottom-3 right-3 z-10 gap-1.5 border shadow-lg"
          aria-label="Jump to live terminal output"
        >
          <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
          <span ref={jumpToLiveLabelRef}>Live</span>
        </Button>

        {preferLocalChat && status === 'connected' && !historyOverlayOpen && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="absolute right-3 top-3 z-10 gap-1.5 border shadow-lg"
            onClick={onOpenChat}
            aria-label="Claude chat"
          >
            <MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" />
            Chat
          </Button>
        )}

        <TerminalHistoryOverlay
          sessionId={historySessionId}
          open={historyOverlayOpen}
          fontSize={historyFontSize}
          preferChat={preferLocalChat}
          refreshToken={chatRefreshToken}
          onScrollModeResolved={onHistoryScrollModeResolved}
          onClose={onCloseHistoryOverlay}
        />
      </div>

      {isMobile && <TerminalSearchSheet {...search} />}

      {isMobile && status === 'connected' && (
        <>
          <SelectionPopup
            ref={selectionPopupRef}
            containerRef={termRef as RefObject<HTMLElement>}
            onCopy={onCopySelectionText}
            imperative
          />
          <TerminalContextMenu
            containerRef={termRef as RefObject<HTMLElement>}
            onCopySelection={onCopySelection}
            onCopyLastLines={onCopyLastLines}
            onCopyAll={onCopyAll}
            onPaste={() => onPaste()}
            onClear={onClear}
            canPaste={!readOnly && !interactionBlocked}
            selectionRef={selectionTextRef}
          />
        </>
      )}

      {status === 'connected' && !readOnly && !interactionBlocked && (
        <TerminalKeyRail
          onInput={onVirtualInput}
          onHistory={onOpenHistory}
          ctrlMode={stickyCtrlMode}
          onCtrlEvent={onStickyCtrlEvent}
          prefix={tmuxPrefix}
          onPreviousMark={onPreviousMark}
          onNextMark={onNextMark}
          hasCommandMarks={hasCommandMarks}
          keyboardActive={keyboardActive}
          onKeyboardToggle={onKeyboardToggle}
          cursorArmed={cursorArmed}
          onCursorToggle={onCursorToggle}
        />
      )}
    </>
  );
}
