'use client';

import { useCallback, type MutableRefObject } from 'react';
import { useClipboard } from '@/hooks/useClipboard';
import type { XTerminal } from '@/components/terminal/types';

export function useTerminalClipboard({
  terminalRef,
  sendInput,
}: {
  terminalRef: MutableRefObject<XTerminal | null>;
  sendInput: (data: string) => void;
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
    let pasteText = text ?? await readFromClipboard();
    if (pasteText === null) {
      pasteText = window.prompt('Clipboard access is blocked. Paste terminal text here:');
    }
    if (pasteText) {
      sendInput(pasteText);
    }
  }, [readFromClipboard, sendInput]);

  const clear = useCallback(() => {
    sendInput('\x0c');
  }, [sendInput]);

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
