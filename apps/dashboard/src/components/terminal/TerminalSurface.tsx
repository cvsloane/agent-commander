'use client';

import type { RefObject } from 'react';
import { SelectionPopup, TerminalContextMenu, VirtualKeyboard } from '@/components/mobile';
import { TmuxKeyBar } from '@/components/tmux/TmuxKeyBar';
import { cn } from '@/lib/utils';
import type { ConnectionStatus, XTerminal } from './types';

interface TerminalSurfaceProps {
  termRef: RefObject<HTMLDivElement | null>;
  terminalRef: RefObject<XTerminal | null>;
  isMobile: boolean;
  status: ConnectionStatus;
  readOnly: boolean;
  paneId?: string;
  hasSelection: boolean;
  selectionText: string;
  selectionAnchor: { x: number; y: number } | null;
  onSelectionAnchorChange: (anchor: { x: number; y: number }) => void;
  onVirtualInput: (data: string) => void;
  onVirtualInterrupt: () => void;
  onCopySelection: () => void;
  onCopyLastLines: (lines: number) => void;
  onCopyAll: () => void;
  onPaste: (text?: string) => void;
  onClear: () => void;
  onCopySelectionText: (text: string) => void;
}

export function TerminalSurface({
  termRef,
  terminalRef,
  isMobile,
  status,
  readOnly,
  paneId,
  hasSelection,
  selectionText,
  selectionAnchor,
  onSelectionAnchorChange,
  onVirtualInput,
  onVirtualInterrupt,
  onCopySelection,
  onCopyLastLines,
  onCopyAll,
  onPaste,
  onClear,
  onCopySelectionText,
}: TerminalSurfaceProps) {
  return (
    <>
      <div
        ref={termRef as RefObject<HTMLDivElement>}
        tabIndex={0}
        onMouseDown={(event) => {
          onSelectionAnchorChange({ x: event.clientX, y: event.clientY });
          terminalRef.current?.focus();
          window.setTimeout(() => terminalRef.current?.focus(), 0);
        }}
        onTouchStart={(event) => {
          const touch = event.touches[0];
          if (touch) {
            onSelectionAnchorChange({ x: touch.clientX, y: touch.clientY });
          }
          terminalRef.current?.focus();
          window.setTimeout(() => terminalRef.current?.focus(), 0);
        }}
        className={cn(
          'relative flex-1 min-h-0 cursor-text overflow-hidden bg-[#0a0a0a] p-1 focus:outline-none',
          isMobile && 'touch-none',
          status === 'connected' && 'border-l-2 border-emerald-500 shadow-[inset_2px_0_0_rgba(16,185,129,0.35)]'
        )}
        aria-label="Interactive terminal"
      />

      {isMobile && status === 'connected' && (
        <>
          <SelectionPopup
            containerRef={termRef as RefObject<HTMLElement>}
            onCopy={onCopySelectionText}
            selectionText={selectionText}
            anchorPosition={selectionAnchor ?? undefined}
          />
          <TerminalContextMenu
            containerRef={termRef as RefObject<HTMLElement>}
            onCopySelection={onCopySelection}
            onCopyLastLines={onCopyLastLines}
            onCopyAll={onCopyAll}
            onPaste={() => onPaste()}
            onClear={onClear}
            canPaste={!readOnly}
            selectionActive={hasSelection}
          />
        </>
      )}

      {status === 'connected' && !readOnly && (
        <>
          {isMobile && paneId && (
            <TmuxKeyBar onInput={onVirtualInput} />
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
        </>
      )}
    </>
  );
}
