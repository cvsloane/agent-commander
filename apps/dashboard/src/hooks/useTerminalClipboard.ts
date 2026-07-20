'use client';

import { useCallback, type MutableRefObject } from 'react';
import { useClipboard } from '@/hooks/useClipboard';
import type { XTerminal } from '@/components/terminal/types';

export function useTerminalClipboard({
  terminalRef,
  readOnlyRef,
  wsRef,
}: {
  terminalRef: MutableRefObject<XTerminal | null>;
  readOnlyRef: MutableRefObject<boolean>;
  wsRef: MutableRefObject<WebSocket | null>;
}) {
  const { copyToClipboard, readFromClipboard } = useClipboard();

  const copySelection = useCallback(() => {
    const selection = terminalRef.current?.getSelection();
    if (selection) {
      copyToClipboard(selection);
    }
  }, [copyToClipboard, terminalRef]);

  const copyLastLines = useCallback((lines: number) => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    const buffer = terminal.buffer.active;
    const totalLines = buffer.length;
    const startLine = Math.max(0, totalLines - lines);
    const content: string[] = [];

    for (let i = startLine; i < totalLines; i += 1) {
      const line = buffer.getLine(i);
      if (line) {
        content.push(line.translateToString(true));
      }
    }

    copyToClipboard(content.join('\n'));
  }, [copyToClipboard, terminalRef]);

  const copyAll = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    const buffer = terminal.buffer.active;
    const content: string[] = [];

    for (let i = 0; i < buffer.length; i += 1) {
      const line = buffer.getLine(i);
      if (line) {
        content.push(line.translateToString(true));
      }
    }

    copyToClipboard(content.join('\n'));
  }, [copyToClipboard, terminalRef]);

  const paste = useCallback(async (text?: string) => {
    if (readOnlyRef.current) return;

    const pasteText = text || await readFromClipboard();
    if (pasteText && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input', data: pasteText }));
    }
  }, [readFromClipboard, readOnlyRef, wsRef]);

  const clear = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input', data: '\x0c' }));
    }
  }, [wsRef]);

  const copyText = useCallback((text: string) => {
    copyToClipboard(text);
  }, [copyToClipboard]);

  return {
    copySelection,
    copyLastLines,
    copyAll,
    paste,
    clear,
    copyText,
  };
}
