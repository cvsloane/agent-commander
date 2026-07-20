'use client';

import { useCallback, useRef, type MutableRefObject } from 'react';
import type { XFitAddon, XTerminal } from '@/components/terminal/types';
import { canFitTerminalElement } from '@/components/terminal/viewport';

export function useXtermTerminal({
  termRef,
  wsRef,
  onSelectionChange,
}: {
  termRef: MutableRefObject<HTMLDivElement | null>;
  wsRef: MutableRefObject<WebSocket | null>;
  onSelectionChange: (selection: string) => void;
}) {
  const terminalRef = useRef<XTerminal | null>(null);
  const fitAddonRef = useRef<XFitAddon | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

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
    const { WebLinksAddon } = await import('@xterm/addon-web-links');
    const fontSize = window.matchMedia('(max-width: 767px)').matches ? 11 : 14;

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      fontSize,
      lineHeight: 1.25,
      scrollback: 4000,
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
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());

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
      if (event.key === 'Tab') {
        event.preventDefault();
        return true;
      }
      if (event.key === 'Enter' && event.shiftKey) {
        event.preventDefault();
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'input', data: '\x1b[13;2u' }));
        }
        return false;
      }
      return true;
    });

    terminal.onSelectionChange(() => {
      onSelectionChange(terminal.getSelection());
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const resizeObserver = new ResizeObserver(() => {
      fitAndResize();
    });
    resizeObserver.observe(termRef.current);
    resizeObserverRef.current = resizeObserver;

    return terminal;
  }, [fitAndResize, onSelectionChange, termRef, wsRef]);

  const disposeTerminal = useCallback(() => {
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    terminalRef.current?.dispose();
    terminalRef.current = null;
    fitAddonRef.current = null;
  }, []);

  return {
    terminalRef,
    ensureTerminal,
    fitAndResize,
    getDimensions,
    disposeTerminal,
  };
}
