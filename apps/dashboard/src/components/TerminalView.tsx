'use client';

import { useState, useRef, useEffect, useCallback, type MutableRefObject } from 'react';
import { cn } from '@/lib/utils';
import { TerminalSurface } from '@/components/terminal/TerminalSurface';
import { TerminalToolbar } from '@/components/terminal/TerminalToolbar';
import type { TerminalController } from '@/components/terminal/types';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useTerminalClipboard } from '@/hooks/useTerminalClipboard';
import { useTerminalConnection } from '@/hooks/useTerminalConnection';
import { useTerminalTouchScroll } from '@/hooks/useTerminalTouchScroll';
import { useXtermTerminal } from '@/hooks/useXtermTerminal';

interface TerminalViewProps {
  sessionId: string;
  paneId?: string;
  className?: string;
  autoAttach?: boolean;
  controllerRef?: MutableRefObject<TerminalController | null>;
}

export type { TerminalController } from '@/components/terminal/types';

export function TerminalView({ sessionId, paneId, className, autoAttach = false, controllerRef }: TerminalViewProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const [selectionText, setSelectionText] = useState('');
  const [selectionAnchor, setSelectionAnchor] = useState<{ x: number; y: number } | null>(null);
  const isMobile = useIsMobile();
  const handleTerminalSelectionChange = useCallback((selection: string) => {
    const hasText = selection.length > 0;
    setHasSelection(hasText);
    setSelectionText(hasText ? selection : '');
  }, []);
  const {
    terminalRef,
    ensureTerminal,
    fitAndResize,
    disposeTerminal,
  } = useXtermTerminal({
    termRef,
    wsRef,
    onSelectionChange: handleTerminalSelectionChange,
  });
  const {
    readOnlyRef,
    status,
    errorMessage,
    readOnly,
    connect,
    disconnect,
    takeControl,
    sendInput,
  } = useTerminalConnection({
    sessionId,
    paneId,
    autoAttach,
    wsRef,
    terminalRef,
    ensureTerminal,
    fitAndResize,
  });
  const touchScrollRef = useTerminalTouchScroll({
    enabled: isMobile,
    termRef,
    terminalRef,
    hasSelection,
  });

  // Virtual keyboard handlers
  const handleVirtualInput = useCallback((data: string) => {
    sendInput(data);
  }, [sendInput]);

  const handleVirtualInterrupt = useCallback(() => {
    sendInput('\x03');
  }, [sendInput]);

  const terminalClipboard = useTerminalClipboard({
    terminalRef,
    readOnlyRef,
    wsRef,
  });

  useEffect(() => {
    if (!controllerRef) return;
    const controller: TerminalController = {
      attach: () => void connect(),
      detach: disconnect,
      takeControl,
      focus: () => terminalRef.current?.focus(),
      copySelection: terminalClipboard.copySelection,
      copyLastLines: (lines = 50) => terminalClipboard.copyLastLines(lines),
      copyAll: terminalClipboard.copyAll,
      paste: () => void terminalClipboard.paste(),
    };
    controllerRef.current = controller;
    return () => {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
  }, [
    connect,
    controllerRef,
    disconnect,
    terminalClipboard,
    takeControl,
  ]);

  useEffect(() => {
    const touchState = touchScrollRef.current;
    return () => {
      if (touchState.momentumRaf !== null) {
        cancelAnimationFrame(touchState.momentumRaf);
        touchState.momentumRaf = null;
      }
      disposeTerminal();
    };
  }, [disposeTerminal, touchScrollRef]);

  if (!paneId) {
    return (
      <div className={cn('flex flex-col h-full', className)}>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p>Terminal not available - session has no tmux pane</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full min-h-0', className)}>
      <TerminalToolbar
        status={status}
        readOnly={readOnly}
        errorMessage={errorMessage}
        onConnect={() => void connect()}
        onDisconnect={disconnect}
        onTakeControl={takeControl}
        onFocus={() => terminalRef.current?.focus()}
      />
      <TerminalSurface
        termRef={termRef}
        terminalRef={terminalRef}
        isMobile={isMobile}
        status={status}
        readOnly={readOnly}
        paneId={paneId}
        hasSelection={hasSelection}
        selectionText={selectionText}
        selectionAnchor={selectionAnchor}
        onSelectionAnchorChange={setSelectionAnchor}
        onVirtualInput={handleVirtualInput}
        onVirtualInterrupt={handleVirtualInterrupt}
        onCopySelection={terminalClipboard.copySelection}
        onCopyLastLines={terminalClipboard.copyLastLines}
        onCopyAll={terminalClipboard.copyAll}
        onPaste={terminalClipboard.paste}
        onClear={terminalClipboard.clear}
        onCopySelectionText={terminalClipboard.copyText}
      />
    </div>
  );
}
