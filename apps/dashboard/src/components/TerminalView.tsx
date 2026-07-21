'use client';

import { useState, useRef, useEffect, useCallback, type MutableRefObject } from 'react';
import { cn } from '@/lib/utils';
import type { SelectionPopupHandle } from '@/components/mobile';
import { TerminalSurface } from '@/components/terminal/TerminalSurface';
import { TerminalToolbar } from '@/components/terminal/TerminalToolbar';
import { ScrollbackPager } from '@/components/terminal/ScrollbackPager';
import type { TerminalController, XSearchResult, XTerminal } from '@/components/terminal/types';
import {
  applyStickyCtrl,
  reduceStickyCtrl,
  type StickyCtrlEvent,
  type StickyCtrlMode,
} from '@/components/mobile/stickyCtrl';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useTerminalClipboard } from '@/hooks/useTerminalClipboard';
import { useTerminalConnection } from '@/hooks/useTerminalConnection';
import { useTerminalScrollAnchor } from '@/hooks/useTerminalScrollAnchor';
import { useTerminalTouchScroll } from '@/hooks/useTerminalTouchScroll';
import { useXtermTerminal } from '@/hooks/useXtermTerminal';
import { useSettingsStore } from '@/stores/settings';

interface TerminalViewProps {
  sessionId: string;
  hostId?: string;
  paneId?: string;
  className?: string;
  autoAttach?: boolean;
  controllerRef?: MutableRefObject<TerminalController | null>;
  onControllerChange?: (controller: TerminalController | null) => void;
  onTerminalInstanceChange?: (terminal: XTerminal | null) => void;
}

const noopTerminalInstanceChange = () => undefined;

export type { TerminalController } from '@/components/terminal/types';

export function TerminalView({
  sessionId,
  hostId,
  paneId,
  className,
  autoAttach = false,
  controllerRef,
  onControllerChange,
  onTerminalInstanceChange = noopTerminalInstanceChange,
}: TerminalViewProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sendInputRef = useRef<(data: string) => void>(() => undefined);
  const controllerInstanceRef = useRef<TerminalController | null>(null);
  const controllerReadOnlyRef = useRef(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [stickyCtrlMode, setStickyCtrlMode] = useState<StickyCtrlMode>('inactive');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<XSearchResult>({
    resultIndex: -1,
    resultCount: 0,
  });
  const selectionTextRef = useRef('');
  const selectionAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const selectionPopupRef = useRef<SelectionPopupHandle>(null);
  const hasCommittedSelectionRef = useRef(false);
  const stickyCtrlModeRef = useRef<StickyCtrlMode>('inactive');
  const isMobile = useIsMobile();
  const terminalFontSize = useSettingsStore((state) => state.terminalFontSize);
  const setTerminalFontSize = useSettingsStore((state) => state.setTerminalFontSize);
  const tmuxPrefix = useSettingsStore((state) => (
    hostId ? state.tmuxPrefixByHost[hostId] : undefined
  ));
  const handleTerminalSelectionChange = useCallback((selection: string) => {
    selectionTextRef.current = selection;
    if (selection || !hasCommittedSelectionRef.current) return;
    hasCommittedSelectionRef.current = false;
    selectionPopupRef.current?.hide();
  }, []);

  const handleSelectionStart = useCallback((anchor: { x: number; y: number }) => {
    selectionAnchorRef.current = anchor;
    selectionPopupRef.current?.hide();
  }, []);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const handleSearchResultsChange = useCallback((results: XSearchResult) => {
    setSearchResults(results);
  }, []);

  const scrollAnchor = useTerminalScrollAnchor();
  const {
    terminalRef,
    ensureTerminal,
    fitAndResize,
    getDimensions,
    findNext,
    findPrevious,
    clearSearch,
    disposeTerminal,
  } = useXtermTerminal({
    termRef,
    wsRef,
    sendInputRef,
    onSelectionChange: handleTerminalSelectionChange,
    onViewportScroll: scrollAnchor.handleViewportScroll,
    onTerminalInstanceChange,
    onSearchRequested: openSearch,
    onSearchResultsChange: handleSearchResultsChange,
  });
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults({ resultIndex: -1, resultCount: 0 });
    clearSearch();
    terminalRef.current?.focus();
  }, [clearSearch, terminalRef]);
  const handleSearchQueryChange = useCallback((query: string) => {
    setSearchQuery(query);
    if (!query) {
      clearSearch();
      setSearchResults({ resultIndex: -1, resultCount: 0 });
      return;
    }
    findNext(query, true);
  }, [clearSearch, findNext]);
  const handleSearchNext = useCallback(() => {
    if (searchQuery) findNext(searchQuery);
  }, [findNext, searchQuery]);
  const handleSearchPrevious = useCallback(() => {
    if (searchQuery) findPrevious(searchQuery);
  }, [findPrevious, searchQuery]);
  const searchControls = {
    open: searchOpen,
    query: searchQuery,
    resultIndex: searchResults.resultIndex,
    resultCount: searchResults.resultCount,
    onOpen: openSearch,
    onClose: closeSearch,
    onQueryChange: handleSearchQueryChange,
    onNext: handleSearchNext,
    onPrevious: handleSearchPrevious,
  };
  const handleSelectionCommit = useCallback(() => {
    window.setTimeout(() => {
      const selection = terminalRef.current?.getSelection() || '';
      selectionTextRef.current = selection;
      const hasSelection = selection.length > 0;
      if (hasCommittedSelectionRef.current !== hasSelection) {
        hasCommittedSelectionRef.current = hasSelection;
      }
      if (hasSelection) {
        selectionPopupRef.current?.showSelection(selection, selectionAnchorRef.current ?? undefined);
      } else {
        selectionPopupRef.current?.hide();
      }
    }, 0);
  }, [terminalRef]);
  const {
    status,
    errorMessage,
    lagMessage,
    readOnly,
    connect,
    disconnect,
    suspend,
    takeControl,
    sendInput,
  } = useTerminalConnection({
    sessionId,
    paneId,
    autoAttach,
    wsRef,
    terminalRef,
    containerRef,
    ensureTerminal,
    fitAndResize,
    getDimensions,
    onOutputWritten: scrollAnchor.handleOutputWritten,
  });
  controllerReadOnlyRef.current = readOnly;
  const dispatchStickyCtrl = useCallback((event: StickyCtrlEvent) => {
    const nextMode = reduceStickyCtrl(stickyCtrlModeRef.current, event);
    stickyCtrlModeRef.current = nextMode;
    setStickyCtrlMode(nextMode);
  }, []);
  const handlePhysicalInput = useCallback((data: string) => {
    const result = applyStickyCtrl(stickyCtrlModeRef.current, data);
    if (result.mode !== stickyCtrlModeRef.current) {
      stickyCtrlModeRef.current = result.mode;
      setStickyCtrlMode(result.mode);
    }
    sendInput(result.data);
  }, [sendInput]);
  useEffect(() => {
    sendInputRef.current = handlePhysicalInput;
  }, [handlePhysicalInput]);
  useEffect(() => {
    if (status === 'connected') return;
    stickyCtrlModeRef.current = 'inactive';
    setStickyCtrlMode('inactive');
  }, [status]);
  const touchScrollRef = useTerminalTouchScroll({
    enabled: isMobile,
    termRef,
    terminalRef,
    fontSize: terminalFontSize,
    onFontSizeChange: setTerminalFontSize,
    cursorEnabled: status === 'connected' && !readOnly,
    onCursorInput: sendInput,
  });

  // Virtual keyboard handlers
  const handleVirtualInput = useCallback((data: string) => {
    sendInput(data);
  }, [sendInput]);

  const terminalClipboard = useTerminalClipboard({
    terminalRef,
    sendInput,
  });
  const {
    copySelection,
    copyLastLines,
    copyAll,
    paste,
  } = terminalClipboard;

  useEffect(() => {
    if (!controllerRef && !onControllerChange) return;
    const controller: TerminalController = {
      status,
      readOnly: controllerReadOnlyRef.current,
      attach: () => void connect(),
      detach: disconnect,
      suspend,
      takeControl,
      focus: () => terminalRef.current?.focus(),
      copySelection,
      copyLastLines: (lines = 50) => copyLastLines(lines),
      copyAll,
      paste: () => void paste(),
    };
    if (controllerRef) {
      controllerRef.current = controller;
    }
    controllerInstanceRef.current = controller;
    onControllerChange?.(controller);
    return () => {
      if (controllerInstanceRef.current === controller) {
        controllerInstanceRef.current = null;
      }
      if (controllerRef?.current === controller) {
        controllerRef.current = null;
      }
      onControllerChange?.(null);
    };
  }, [
    connect,
    controllerRef,
    copyAll,
    copyLastLines,
    copySelection,
    disconnect,
    onControllerChange,
    paste,
    terminalRef,
    suspend,
    takeControl,
    status,
  ]);

  useEffect(() => {
    const controller = controllerInstanceRef.current;
    if (!controller || (controller.readOnly === readOnly && controller.status === status)) return;
    controller.readOnly = readOnly;
    controller.status = status;
    onControllerChange?.(controller);
  }, [onControllerChange, readOnly, status]);

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
    <div ref={containerRef} className={cn('terminal-viewport flex flex-col h-full min-h-0', className)}>
      <TerminalToolbar
        status={status}
        readOnly={readOnly}
        errorMessage={errorMessage}
        lagMessage={lagMessage}
        onConnect={() => void connect()}
        onDisconnect={disconnect}
        onTakeControl={takeControl}
        onFocus={() => terminalRef.current?.focus()}
        search={searchControls}
        isMobile={isMobile}
      />
      <TerminalSurface
        termRef={termRef}
        terminalRef={terminalRef}
        isMobile={isMobile}
        status={status}
        readOnly={readOnly}
        selectionTextRef={selectionTextRef}
        selectionPopupRef={selectionPopupRef}
        onSelectionStart={handleSelectionStart}
        onSelectionCommit={handleSelectionCommit}
        onVirtualInput={handleVirtualInput}
        stickyCtrlMode={stickyCtrlMode}
        onStickyCtrlEvent={dispatchStickyCtrl}
        onOpenHistory={() => setHistoryOpen(true)}
        tmuxPrefix={tmuxPrefix}
        onCopySelection={terminalClipboard.copySelection}
        onCopyLastLines={terminalClipboard.copyLastLines}
        onCopyAll={terminalClipboard.copyAll}
        onPaste={terminalClipboard.paste}
        onClear={terminalClipboard.clear}
        onCopySelectionText={terminalClipboard.copyText}
        jumpToLiveButtonRef={scrollAnchor.jumpToLiveButtonRef}
        onJumpToLive={() => scrollAnchor.jumpToLive(terminalRef.current)}
        search={searchControls}
      />
      <ScrollbackPager
        sessionId={sessionId}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
      />
    </div>
  );
}
