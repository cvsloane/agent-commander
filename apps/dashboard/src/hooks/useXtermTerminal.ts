'use client';

import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import type { XFitAddon, XSearchAddon, XSearchResult, XTerminal } from '@/components/terminal/types';
import { canFitTerminalElement } from '@/components/terminal/viewport';
import { useSettingsStore } from '@/stores/settings';

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
  const terminalRef = useRef<XTerminal | null>(null);
  const fitAddonRef = useRef<XFitAddon | null>(null);
  const searchAddonRef = useRef<XSearchAddon | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const fontFitRafRef = useRef<number | null>(null);
  const fontSize = useSettingsStore((state) => state.terminalFontSize);
  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;

  const fitAndResize = useCallback(() => {
    if (!fitAddonRef.current || !termRef.current || !canFitTerminalElement(termRef.current)) return;
    fitAddonRef.current.fit();
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const dims = fitAddonRef.current.proposeDimensions();
      if (dims) {
        wsRef.current.send(JSON.stringify({
          type: 'resize',
          cols: dims.cols,
          rows: dims.rows,
        }));
      }
    }
  }, [termRef, wsRef]);

  const getDimensions = useCallback(() => {
    if (!fitAddonRef.current || !termRef.current || !canFitTerminalElement(termRef.current)) {
      return undefined;
    }
    return fitAddonRef.current.proposeDimensions() ?? undefined;
  }, [termRef]);

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

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(new WebLinksAddon());
    searchAddon.onDidChangeResults(onSearchResultsChange);

    terminal.open(termRef.current);
    try {
      const { WebglAddon } = await import('@xterm/addon-webgl');
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => webglAddon.dispose());
      terminal.loadAddon(webglAddon);
    } catch {
      // The built-in DOM renderer remains active when WebGL is unavailable.
    }
    if (canFitTerminalElement(termRef.current)) {
      fitAddon.fit();
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

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;
    onTerminalInstanceChange(terminal);

    const resizeObserver = new ResizeObserver(() => {
      fitAndResize();
    });
    resizeObserver.observe(termRef.current);
    resizeObserverRef.current = resizeObserver;

    return terminal;
  }, [
    fitAndResize,
    onSearchRequested,
    onSearchResultsChange,
    onSelectionChange,
    onTerminalInstanceChange,
    onViewportScroll,
    sendInputRef,
    termRef,
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
    terminalRef.current?.dispose();
    terminalRef.current = null;
    fitAddonRef.current = null;
    searchAddonRef.current = null;
    onTerminalInstanceChange(null);
  }, [onTerminalInstanceChange]);

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
