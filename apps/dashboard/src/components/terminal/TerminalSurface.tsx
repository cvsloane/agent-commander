'use client';

import type { RefObject } from 'react';
import { ArrowDown } from 'lucide-react';
import { SelectionPopup, TerminalContextMenu, VirtualKeyboard } from '@/components/mobile';
import type { SelectionPopupHandle } from '@/components/mobile';
import { TmuxKeyBar } from '@/components/tmux/TmuxKeyBar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ConnectionStatus, XTerminal } from './types';
import { TerminalSearchSheet, type TerminalSearchControlsProps } from './TerminalSearch';

interface TerminalSurfaceProps {
  termRef: RefObject<HTMLDivElement | null>;
  terminalRef: RefObject<XTerminal | null>;
  isMobile: boolean;
  status: ConnectionStatus;
  readOnly: boolean;
  paneId?: string;
  hasSelection: boolean;
  selectionTextRef: RefObject<string>;
  selectionPopupRef: RefObject<SelectionPopupHandle | null>;
  onSelectionStart: (anchor: { x: number; y: number }) => void;
  onSelectionCommit: () => void;
  onVirtualInput: (data: string) => void;
  onVirtualInterrupt: () => void;
  onCopySelection: () => void;
  onCopyLastLines: (lines: number) => void;
  onCopyAll: () => void;
  onPaste: (text?: string) => void;
  onClear: () => void;
  onCopySelectionText: (text: string) => void;
  jumpToLiveButtonRef: RefObject<HTMLButtonElement | null>;
  onJumpToLive: () => void;
  search: TerminalSearchControlsProps;
}

export function TerminalSurface({
  termRef,
  terminalRef,
  isMobile,
  status,
  readOnly,
  paneId,
  hasSelection,
  selectionTextRef,
  selectionPopupRef,
  onSelectionStart,
  onSelectionCommit,
  onVirtualInput,
  onVirtualInterrupt,
  onCopySelection,
  onCopyLastLines,
  onCopyAll,
  onPaste,
  onClear,
  onCopySelectionText,
  jumpToLiveButtonRef,
  onJumpToLive,
  search,
}: TerminalSurfaceProps) {
  return (
    <>
      <div className="relative flex-1 min-h-0 overflow-hidden bg-[#0a0a0a]">
        <div
          ref={termRef as RefObject<HTMLDivElement>}
          tabIndex={0}
          onMouseDown={(event) => {
            onSelectionStart({ x: event.clientX, y: event.clientY });
            terminalRef.current?.focus();
            window.setTimeout(() => terminalRef.current?.focus(), 0);
          }}
          onMouseUp={onSelectionCommit}
          onTouchStart={(event) => {
            const touch = event.touches[0];
            if (touch) {
              onSelectionStart({ x: touch.clientX, y: touch.clientY });
            }
            terminalRef.current?.focus();
            window.setTimeout(() => terminalRef.current?.focus(), 0);
          }}
          onTouchEnd={onSelectionCommit}
          className={cn(
            'relative h-full w-full cursor-text overflow-hidden bg-[#0a0a0a] p-1 focus:outline-none',
            isMobile && 'touch-none',
            status === 'connected' && 'border-l-2 border-emerald-500 shadow-[inset_2px_0_0_rgba(16,185,129,0.35)]'
          )}
          aria-label="Interactive terminal"
        />

        <Button
          ref={jumpToLiveButtonRef}
          type="button"
          size="sm"
          variant="secondary"
          hidden
          onClick={onJumpToLive}
          className="absolute bottom-3 right-3 z-10 gap-1.5 border shadow-lg"
          aria-label="Jump to live terminal output"
        >
          <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
          Live
        </Button>
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
            canPaste={!readOnly}
            selectionRef={selectionTextRef}
          />
        </>
      )}

      {status === 'connected' && !readOnly && (
        <div className="sticky bottom-0 z-20 shrink-0 bg-background">
          {paneId && (
            <TmuxKeyBar onInput={onVirtualInput} collapsible={!isMobile} />
          )}
          <VirtualKeyboard
            onInput={onVirtualInput}
            onInterrupt={onVirtualInterrupt}
            onCopy={onCopySelection}
            onPaste={onPaste}
            canCopy={hasSelection}
            canPaste={!readOnly}
            autoShowOnMobile={isMobile}
          />
        </div>
      )}
    </>
  );
}
