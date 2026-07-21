'use client';

import { useState, useRef, useEffect, useCallback, type MutableRefObject } from 'react';
import { cn } from '@/lib/utils';
import type { SelectionPopupHandle } from '@/components/mobile';
import { TerminalSurface } from '@/components/terminal/TerminalSurface';
import { TerminalToolbar } from '@/components/terminal/TerminalToolbar';
import { ScrollbackPager } from '@/components/terminal/ScrollbackPager';
import { initialScrollbackRange } from '@/components/terminal/scrollbackPaging';
import {
  classifyTerminalScrollMode,
  type TerminalScrollMode,
} from '@/components/terminal/terminalScrollMode';
import type { TerminalController, XSearchResult, XTerminal } from '@/components/terminal/types';
import {
  applyStickyCtrl,
  reduceStickyCtrl,
  type StickyCtrlEvent,
  type StickyCtrlMode,
} from '@/components/mobile/stickyCtrl';
import { COMMAND_CENTER_SHELL_BREAKPOINT, useIsMobile } from '@/hooks/useIsMobile';
import { useTerminalClipboard } from '@/hooks/useTerminalClipboard';
import { useTerminalConnection } from '@/hooks/useTerminalConnection';
import { useTerminalScrollAnchor } from '@/hooks/useTerminalScrollAnchor';
import { useTerminalTouchScroll } from '@/hooks/useTerminalTouchScroll';
import { useTerminalCommandMarks } from '@/hooks/useTerminalCommandMarks';
import { useXtermTerminal } from '@/hooks/useXtermTerminal';
import { getSessionScrollback } from '@/lib/api';
import { useSettingsStore } from '@/stores/settings';

interface TerminalViewProps {
  sessionId: string;
  historySessionId?: string;
  hostId?: string;
  paneId?: string;
  tmuxSessionKey?: string;
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
  historySessionId = sessionId,
  hostId,
  paneId,
  tmuxSessionKey,
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
  const scrollModeCacheRef = useRef(new Map<string, TerminalScrollMode>());
  const [searchOpen, setSearchOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyOverlaySessionId, setHistoryOverlaySessionId] = useState<string | null>(null);
  const [, setScrollModeCacheVersion] = useState(0);
  const [stickyCtrlMode, setStickyCtrlMode] = useState<StickyCtrlMode>('inactive');
  const [keyboardActive, setKeyboardActive] = useState(false);
  const [cursorArmed, setCursorArmed] = useState(false);
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
  const keyboardActiveRef = useRef(false);
  const cursorArmedRef = useRef(false);
  const isMobile = useIsMobile();
  const touchInputModeEnabled = useIsMobile(COMMAND_CENTER_SHELL_BREAKPOINT);
  const terminalFontSize = useSettingsStore((state) => state.terminalFontSize);
  const setTerminalFontSize = useSettingsStore((state) => state.setTerminalFontSize);
  const tmuxPrefix = useSettingsStore((state) =>
    hostId ? state.tmuxPrefixByHost[hostId] : undefined
  );
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

  const {
    jumpToLiveButtonRef,
    jumpToLiveLabelRef,
    handleViewportScroll,
    handleOutputStart,
    handleOutputWritten: handleScrollOutputWritten,
    jumpToLive,
  } = useTerminalScrollAnchor();
  const {
    bindTerminal: bindCommandMarks,
    handleOutputWritten: handleCommandMarksOutput,
    previousMark,
    nextMark,
    hasMarks,
    currentMark,
  } = useTerminalCommandMarks();
  const handleTerminalInstanceChange = useCallback(
    (terminal: XTerminal | null) => {
      bindCommandMarks(terminal);
      onTerminalInstanceChange(terminal);
    },
    [bindCommandMarks, onTerminalInstanceChange]
  );
  const handleTerminalOutputWritten = useCallback(
    (terminal: XTerminal, data: string | Uint8Array) => {
      handleScrollOutputWritten(terminal);
      handleCommandMarksOutput(terminal, data);
    },
    [handleCommandMarksOutput, handleScrollOutputWritten]
  );
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
    onViewportScroll: handleViewportScroll,
    onTerminalInstanceChange: handleTerminalInstanceChange,
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
  const handleSearchQueryChange = useCallback(
    (query: string) => {
      setSearchQuery(query);
      if (!query) {
        clearSearch();
        setSearchResults({ resultIndex: -1, resultCount: 0 });
        return;
      }
      findNext(query, true);
    },
    [clearSearch, findNext]
  );
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
        selectionPopupRef.current?.showSelection(
          selection,
          selectionAnchorRef.current ?? undefined
        );
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
    navigate,
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
    onOutputStart: handleOutputStart,
    onOutputWritten: handleTerminalOutputWritten,
  });
  const terminalWritable = status === 'connected' && !readOnly;
  controllerReadOnlyRef.current = readOnly;
  const cacheScrollMode = useCallback((targetSessionId: string, mode: TerminalScrollMode) => {
    scrollModeCacheRef.current.set(targetSessionId, mode);
    setScrollModeCacheVersion((version) => version + 1);
  }, []);
  const terminalScrollMode = scrollModeCacheRef.current.get(historySessionId);
  useEffect(() => {
    scrollModeCacheRef.current.delete(historySessionId);
    setScrollModeCacheVersion((version) => version + 1);
    if (!touchInputModeEnabled || status !== 'connected' || !tmuxSessionKey || !historySessionId) {
      return;
    }

    let cancelled = false;
    const primeScrollMode = async () => {
      try {
        const range = initialScrollbackRange();
        const response = await getSessionScrollback(historySessionId, {
          mode: 'range',
          start_line: range.startLine,
          end_line: range.endLine,
          strip_ansi: true,
        });
        if (cancelled || !response.ok) return;
        const mode = classifyTerminalScrollMode(response.result?.content);
        if (mode === 'history') cacheScrollMode(historySessionId, mode);
      } catch {
        // Transport failure leaves the pane unclassified; the overlay path re-probes.
      }
    };
    void primeScrollMode();
    return () => {
      cancelled = true;
    };
  }, [cacheScrollMode, historySessionId, status, tmuxSessionKey, touchInputModeEnabled]);
  const handleHistoryScrollModeResolved = useCallback(
    (mode: TerminalScrollMode) => {
      cacheScrollMode(historySessionId, mode);
    },
    [cacheScrollMode, historySessionId]
  );
  const dispatchStickyCtrl = useCallback((event: StickyCtrlEvent) => {
    const nextMode = reduceStickyCtrl(stickyCtrlModeRef.current, event);
    stickyCtrlModeRef.current = nextMode;
    setStickyCtrlMode(nextMode);
  }, []);
  const handlePhysicalInput = useCallback(
    (data: string) => {
      const result = applyStickyCtrl(stickyCtrlModeRef.current, data);
      if (result.mode !== stickyCtrlModeRef.current) {
        stickyCtrlModeRef.current = result.mode;
        setStickyCtrlMode(result.mode);
      }
      sendInput(result.data);
    },
    [sendInput]
  );
  useEffect(() => {
    sendInputRef.current = handlePhysicalInput;
  }, [handlePhysicalInput]);
  const applyTouchInputMode = useCallback(
    (active: boolean) => {
      if (!touchInputModeEnabled) return;
      const textarea =
        termRef.current?.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
      if (textarea) textarea.inputMode = active ? 'text' : 'none';
    },
    [touchInputModeEnabled]
  );
  const resetTouchModes = useCallback(() => {
    keyboardActiveRef.current = false;
    cursorArmedRef.current = false;
    setKeyboardActive(false);
    setCursorArmed(false);
    applyTouchInputMode(false);
  }, [applyTouchInputMode]);
  const handleKeyboardToggle = useCallback(() => {
    const next = !keyboardActiveRef.current;
    keyboardActiveRef.current = next;
    setKeyboardActive(next);
    applyTouchInputMode(next);
    terminalRef.current?.focus();
  }, [applyTouchInputMode, terminalRef]);
  const handleCursorToggle = useCallback(() => {
    const next = !cursorArmedRef.current;
    cursorArmedRef.current = next;
    setCursorArmed(next);
    terminalRef.current?.focus();
  }, [terminalRef]);
  const handleCursorDisarm = useCallback(() => {
    if (!cursorArmedRef.current) return;
    cursorArmedRef.current = false;
    setCursorArmed(false);
  }, []);
  useEffect(() => {
    if (status === 'connected') return;
    stickyCtrlModeRef.current = 'inactive';
    setStickyCtrlMode('inactive');
    resetTouchModes();
    setHistoryOverlaySessionId(null);
  }, [resetTouchModes, status]);
  const closeHistoryOverlay = useCallback(() => setHistoryOverlaySessionId(null), []);
  const openHistoryOverlay = useCallback(() => {
    if (!tmuxSessionKey || !historySessionId) return;
    setHistoryOverlaySessionId(historySessionId);
  }, [historySessionId, tmuxSessionKey]);
  const historyOverlayOpen = historyOverlaySessionId === historySessionId;
  useEffect(() => {
    if (historyOverlaySessionId && historyOverlaySessionId !== historySessionId) {
      setHistoryOverlaySessionId(null);
    }
  }, [historyOverlaySessionId, historySessionId]);
  const handleNavigateScroll = useCallback(
    (lines: number) => {
      navigate({ type: 'navigate', op: 'scroll', lines });
    },
    [navigate]
  );
  const touchScrollRef = useTerminalTouchScroll({
    enabled: touchInputModeEnabled,
    termRef,
    terminalRef,
    fontSize: terminalFontSize,
    onFontSizeChange: setTerminalFontSize,
    cursorArmed,
    onCursorInput: sendInput,
    onCursorDisarm: handleCursorDisarm,
    writable: terminalWritable,
    onScrollInput: sendInput,
    tmuxSessionKey,
    historySessionId,
    historyScrollMode: terminalScrollMode,
    onOpenHistory: openHistoryOverlay,
    onNavigateScroll: handleNavigateScroll,
    onHorizontalSwipe: (direction) => {
      termRef.current?.dispatchEvent(
        new CustomEvent('terminal-window-swipe', {
          bubbles: true,
          detail: { direction, sessionId },
        })
      );
    },
  });

  // Virtual keyboard handlers
  const handleVirtualInput = useCallback(
    (data: string) => {
      sendInput(data);
    },
    [sendInput]
  );

  const terminalClipboard = useTerminalClipboard({
    terminalRef,
    sendInput,
  });
  const { copySelection, copyLastLines, copyAll, paste } = terminalClipboard;

  useEffect(() => {
    if (!controllerRef && !onControllerChange) return;
    const controller: TerminalController = {
      status,
      readOnly: controllerReadOnlyRef.current,
      attach: () => void connect(),
      detach: disconnect,
      suspend,
      takeControl,
      navigate,
      resetTouchModes,
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
    navigate,
    paste,
    resetTouchModes,
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
    <div
      ref={containerRef}
      className={cn('terminal-viewport flex flex-col h-full min-h-0', className)}
    >
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
        touchInputModeEnabled={touchInputModeEnabled}
        status={status}
        readOnly={readOnly}
        selectionTextRef={selectionTextRef}
        selectionPopupRef={selectionPopupRef}
        onSelectionStart={handleSelectionStart}
        onSelectionCommit={handleSelectionCommit}
        onVirtualInput={handleVirtualInput}
        keyboardActive={keyboardActive}
        onKeyboardToggle={handleKeyboardToggle}
        cursorArmed={cursorArmed}
        onCursorToggle={handleCursorToggle}
        stickyCtrlMode={stickyCtrlMode}
        onStickyCtrlEvent={dispatchStickyCtrl}
        onOpenHistory={() => setHistoryOpen(true)}
        historyOverlayOpen={historyOverlayOpen}
        historySessionId={historySessionId}
        historyFontSize={terminalFontSize}
        onHistoryScrollModeResolved={handleHistoryScrollModeResolved}
        onCloseHistoryOverlay={closeHistoryOverlay}
        tmuxPrefix={tmuxPrefix}
        onPreviousMark={previousMark}
        onNextMark={nextMark}
        hasCommandMarks={hasMarks}
        currentCommandMark={currentMark}
        onCopySelection={terminalClipboard.copySelection}
        onCopyLastLines={terminalClipboard.copyLastLines}
        onCopyAll={terminalClipboard.copyAll}
        onPaste={terminalClipboard.paste}
        onClear={terminalClipboard.clear}
        onCopySelectionText={terminalClipboard.copyText}
        jumpToLiveButtonRef={jumpToLiveButtonRef}
        jumpToLiveLabelRef={jumpToLiveLabelRef}
        onJumpToLive={() => jumpToLive(terminalRef.current)}
        search={searchControls}
      />
      <ScrollbackPager
        sessionId={historySessionId}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
      />
    </div>
  );
}
