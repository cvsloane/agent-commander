'use client';

import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import type { XFitAddon, XSearchAddon, XSearchResult, XTerminal } from '@/components/terminal/types';
import { canFitTerminalElement } from '@/components/terminal/viewport';
import {
  shouldDispatchTerminalResize,
  type TerminalGridDimensions,
} from './terminalGrid';
import { useTerminalGrid, useTerminalWarmKey } from './terminalGridContext';
import { paintTerminalWarmBuffer } from './terminalWarmCache';
import { DEFAULT_TERMINAL_WARM_TIMEOUT_MINUTES, useSettingsStore } from '@/stores/settings';
import { installResilientTerminalWebgl } from './terminalWebgl';

export function useXtermTerminal({
  termRef,
  wsRef,
  sendInputRef,
  onSelectionChange,
  onViewportScroll,
  onTerminalInstanceChange,
  onSearchRequested,
  onSearchResultsChange,
}: {
  termRef: MutableRefObject<HTMLDivElement | null>;
  wsRef: MutableRefObject<WebSocket | null>;
  sendInputRef: MutableRefObject<(data: string) => void>;
  onSelectionChange: (selection: string) => void;
  onViewportScroll: (terminal: XTerminal) => void;
  onTerminalInstanceChange: (terminal: XTerminal | null) => void;
  onSearchRequested: () => void;
  onSearchResultsChange: (results: XSearchResult) => void;
}) {
  const letterbox = useTerminalGrid();
  const warmKey = useTerminalWarmKey();
  const terminalWarmTimeoutMinutes = useSettingsStore(
    (state) => state.terminalWarmTimeoutMinutes ?? DEFAULT_TERMINAL_WARM_TIMEOUT_MINUTES
  );
  const terminalRef = useRef<XTerminal | null>(null);
  const fitAddonRef = useRef<XFitAddon | null>(null);
  const searchAddonRef = useRef<XSearchAddon | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const fontFitRafRef = useRef<number | null>(null);
  const fontSize = useSettingsStore((state) => state.terminalFontSize);
  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;
  const baseFontSizeRef = useRef<number | null>(null);
  const lastSentDimensionsRef = useRef<TerminalGridDimensions | undefined>(undefined);
  const webglCleanupRef = useRef<(() => void) | null>(null);

  const applyLetterbox = useCallback(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    const element = termRef.current;
    if (!letterbox || !terminal || !fitAddon || !element || !canFitTerminalElement(element)) return;

    const baseFontSize = baseFontSizeRef.current ?? terminal.options.fontSize ?? 14;
    terminal.options.fontSize = baseFontSize;
    const proposed = fitAddon.proposeDimensions();
    const widthScale = proposed ? Math.min(1, proposed.cols / letterbox.cols) : 1;
    const scaledFontSize = Math.max(4, Math.floor(baseFontSize * widthScale * 10) / 10);
    terminal.options.fontSize = scaledFontSize;
    terminal.resize(letterbox.cols, letterbox.rows);

    const scrollContainer = element.parentElement;
    if (scrollContainer) scrollContainer.style.overflowY = 'auto';
    const screenHeight = element.querySelector<HTMLElement>('.xterm-screen')?.offsetHeight;
    element.style.height = `${Math.ceil(screenHeight || letterbox.rows * scaledFontSize * 1.25) + 8}px`;
  }, [letterbox, termRef]);

  const fitAndResize = useCallback(() => {
    if (!fitAddonRef.current || !termRef.current || !canFitTerminalElement(termRef.current)) return;
    if (letterbox) {
      applyLetterbox();
      return;
    }
    const nextDimensions = fitAddonRef.current.proposeDimensions();
    if (!nextDimensions) return;
    const currentDimensions = terminalRef.current
      ? { cols: terminalRef.current.cols, rows: terminalRef.current.rows }
      : undefined;
    if (!shouldDispatchTerminalResize(currentDimensions, nextDimensions)) return;
    fitAddonRef.current.fit();
    if (
      wsRef.current?.readyState === WebSocket.OPEN
      && shouldDispatchTerminalResize(lastSentDimensionsRef.current, nextDimensions)
    ) {
      wsRef.current.send(JSON.stringify({
        type: 'resize',
        cols: nextDimensions.cols,
        rows: nextDimensions.rows,
      }));
      lastSentDimensionsRef.current = nextDimensions;
    }
  }, [applyLetterbox, letterbox, termRef, wsRef]);

  const getDimensions = useCallback(() => {
    if (letterbox) return letterbox;
    if (!fitAddonRef.current || !termRef.current || !canFitTerminalElement(termRef.current)) {
      return undefined;
    }
    return fitAddonRef.current.proposeDimensions() ?? undefined;
  }, [letterbox, termRef]);

  const ensureTerminal = useCallback(async () => {
    if (!termRef.current) return null;
    if (terminalRef.current) return terminalRef.current;

    const { Terminal } = await import('@xterm/xterm');
    const { FitAddon } = await import('@xterm/addon-fit');
    const { SearchAddon } = await import('@xterm/addon-search');
    const { WebLinksAddon } = await import('@xterm/addon-web-links');
    const terminal = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      fontSize: fontSizeRef.current,
      lineHeight: 1.15,
      scrollback: 10000,
      convertEol: true,
      theme: {
        background: '#0a0a0a',
        foreground: '#e5e5e5',
        cursor: '#e5e5e5',
        cursorAccent: '#0a0a0a',
        selectionBackground: '#3b3b3b',
        black: '#000000',
        red: '#ff5555',
        green: '#50fa7b',
        yellow: '#f1fa8c',
        blue: '#bd93f9',
        magenta: '#ff79c6',
        cyan: '#8be9fd',
        white: '#bbbbbb',
        brightBlack: '#555555',
        brightRed: '#ff5555',
        brightGreen: '#50fa7b',
        brightYellow: '#f1fa8c',
        brightBlue: '#bd93f9',
        brightMagenta: '#ff79c6',
        brightCyan: '#8be9fd',
        brightWhite: '#ffffff',
      },
    });
    baseFontSizeRef.current = fontSize;

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(new WebLinksAddon());
    searchAddon.onDidChangeResults(onSearchResultsChange);

    terminal.open(termRef.current);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;
    if (letterbox) {
      applyLetterbox();
    } else if (canFitTerminalElement(termRef.current)) {
      fitAddon.fit();
    }
    if (warmKey) {
      paintTerminalWarmBuffer(
        warmKey,
        terminal,
        terminalWarmTimeoutMinutes * 60 * 1000
      );
    }
    try {
      const { WebglAddon } = await import('@xterm/addon-webgl');
      webglCleanupRef.current = installResilientTerminalWebgl(
        terminal,
        () => new WebglAddon()
      );
    } catch {
      // The built-in DOM renderer remains active when WebGL is unavailable.
    }
    terminal.attachCustomKeyEventHandler((event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        onSearchRequested();
        return false;
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        return true;
      }
      if (event.key === 'Enter' && event.shiftKey) {
        event.preventDefault();
        sendInputRef.current('\x1b[13;2u');
        return false;
      }
      return true;
    });

    terminal.onSelectionChange(() => {
      onSelectionChange(terminal.getSelection());
    });
    terminal.onData((data) => {
      sendInputRef.current(data);
    });
    terminal.onScroll(() => {
      onViewportScroll(terminal);
    });

    onTerminalInstanceChange(terminal);

    return terminal;
  }, [
    applyLetterbox,
    letterbox,
    onSearchRequested,
    onSearchResultsChange,
    onSelectionChange,
    onTerminalInstanceChange,
    onViewportScroll,
    sendInputRef,
    terminalWarmTimeoutMinutes,
    termRef,
    warmKey,
  ]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || terminal.options.fontSize === fontSize) return;
    terminal.options.fontSize = fontSize;
    fontFitRafRef.current = window.requestAnimationFrame(() => {
      fontFitRafRef.current = null;
      fitAndResize();
    });
    return () => {
      if (fontFitRafRef.current !== null) {
        window.cancelAnimationFrame(fontFitRafRef.current);
        fontFitRafRef.current = null;
      }
    };
  }, [fitAndResize, fontSize]);

  const findNext = useCallback((query: string, incremental = false) => {
    if (!query || !searchAddonRef.current) return false;
    return searchAddonRef.current.findNext(query, {
      incremental,
      decorations: {
        matchBackground: '#665c20',
        matchOverviewRuler: '#facc15',
        activeMatchBackground: '#2563eb',
        activeMatchColorOverviewRuler: '#60a5fa',
      },
    });
  }, []);

  const findPrevious = useCallback((query: string) => {
    if (!query || !searchAddonRef.current) return false;
    return searchAddonRef.current.findPrevious(query, {
      decorations: {
        matchBackground: '#665c20',
        matchOverviewRuler: '#facc15',
        activeMatchBackground: '#2563eb',
        activeMatchColorOverviewRuler: '#60a5fa',
      },
    });
  }, []);

  const clearSearch = useCallback(() => {
    searchAddonRef.current?.clearDecorations();
  }, []);

  const disposeTerminal = useCallback(() => {
    if (fontFitRafRef.current !== null) {
      window.cancelAnimationFrame(fontFitRafRef.current);
      fontFitRafRef.current = null;
    }
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    const element = termRef.current;
    if (element) {
      element.style.removeProperty('height');
      element.parentElement?.style.removeProperty('overflow-y');
    }
    webglCleanupRef.current?.();
    webglCleanupRef.current = null;
    terminalRef.current?.dispose();
    terminalRef.current = null;
    fitAddonRef.current = null;
    searchAddonRef.current = null;
    lastSentDimensionsRef.current = undefined;
    onTerminalInstanceChange(null);
  }, [onTerminalInstanceChange, termRef]);

  return {
    terminalRef,
    ensureTerminal,
    fitAndResize,
    getDimensions,
    findNext,
    findPrevious,
    clearSearch,
    disposeTerminal,
  };
}
