'use client';

import { useCallback, useRef, useState } from 'react';
import type { IDecoration, IDisposable, IMarker } from '@xterm/xterm';
import type { XTerminal } from '@/components/terminal/types';
import {
  commandLabelFromTerminalLine,
  detectAgentTurnMarks,
  getAgentTurnLabel,
  type TerminalCommandMarkView,
} from '@/components/terminal/commandMarks';

interface TerminalCommandMark extends TerminalCommandMarkView {
  marker: IMarker;
  decoration?: IDecoration;
}

function currentBufferLine(terminal: XTerminal): number {
  return terminal.buffer.active.baseY + terminal.buffer.active.cursorY;
}

function shellCommandLabel(terminal: XTerminal): string {
  const line = currentBufferLine(terminal);
  for (let candidate = line; candidate >= Math.max(0, line - 3); candidate -= 1) {
    const text = terminal.buffer.active.getLine(candidate)?.translateToString(true) ?? '';
    if (text.trim()) return commandLabelFromTerminalLine(text);
  }
  return 'Shell command';
}

export function useTerminalCommandMarks() {
  const terminalRef = useRef<XTerminal | null>(null);
  const marksRef = useRef<TerminalCommandMark[]>([]);
  const disposablesRef = useRef<IDisposable[]>([]);
  const seenRef = useRef(new Set<string>());
  const oscSeenRef = useRef(false);
  const initialBufferScannedRef = useRef(false);
  const [marks, setMarks] = useState<TerminalCommandMarkView[]>([]);
  const [currentMark, setCurrentMark] = useState<TerminalCommandMarkView | null>(null);

  const syncStickyMark = useCallback((terminal: XTerminal) => {
    const viewportY = terminal.buffer.active.viewportY;
    const active = [...marksRef.current]
      .filter((mark) => !mark.marker.isDisposed && mark.marker.line < viewportY)
      .sort((left, right) => left.marker.line - right.marker.line)
      .at(-1);
    const next = active
      ? { id: active.id, label: active.label, approximate: active.approximate }
      : null;
    setCurrentMark((current) => current?.id === next?.id ? current : next);
  }, []);

  const addMark = useCallback((
    terminal: XTerminal,
    lineOffset: number,
    label: string,
    approximate: boolean
  ) => {
    const marker = terminal.registerMarker(lineOffset);
    if (!marker || marker.line < 0) return;
    const signature = `${marker.line}:${approximate ? 'approx' : 'exact'}:${label}`;
    if (seenRef.current.has(signature)) {
      marker.dispose();
      return;
    }
    seenRef.current.add(signature);
    const decoration = terminal.registerDecoration({
      marker,
      width: 1,
      backgroundColor: approximate ? '#7c3aed' : '#059669',
      overviewRulerOptions: {
        color: approximate ? '#a78bfa' : '#34d399',
        position: 'left',
      },
    });
    decoration?.onRender((element) => {
      element.title = approximate ? `Approx. agent turn: ${label}` : `Shell command: ${label}`;
      element.dataset.commandMark = approximate ? 'approximate' : 'exact';
    });
    const mark: TerminalCommandMark = {
      id: marker.id,
      marker,
      decoration,
      label,
      approximate,
    };
    marksRef.current = [...marksRef.current, mark]
      .filter((candidate) => !candidate.marker.isDisposed)
      .sort((left, right) => left.marker.line - right.marker.line)
      .slice(-200);
    setMarks(marksRef.current.map(({ id, label: markLabel, approximate: isApproximate }) => ({
      id,
      label: markLabel,
      approximate: isApproximate,
    })));
    marker.onDispose(() => {
      marksRef.current = marksRef.current.filter((candidate) => candidate.id !== marker.id);
      setMarks(marksRef.current.map(({ id, label: markLabel, approximate: isApproximate }) => ({
        id,
        label: markLabel,
        approximate: isApproximate,
      })));
    });
  }, []);

  const scanInitialBuffer = useCallback((terminal: XTerminal) => {
    if (initialBufferScannedRef.current || oscSeenRef.current) return;
    initialBufferScannedRef.current = true;
    const buffer = terminal.buffer.active;
    const currentLine = currentBufferLine(terminal);
    for (let line = Math.max(0, buffer.length - 200); line < buffer.length; line += 1) {
      const label = getAgentTurnLabel(buffer.getLine(line)?.translateToString(true) ?? '');
      if (label) addMark(terminal, line - currentLine, label, true);
    }
  }, [addMark]);

  const bindTerminal = useCallback((terminal: XTerminal | null) => {
    for (const disposable of disposablesRef.current) disposable.dispose();
    disposablesRef.current = [];
    terminalRef.current = terminal;
    marksRef.current = [];
    seenRef.current.clear();
    oscSeenRef.current = false;
    initialBufferScannedRef.current = false;
    setMarks([]);
    setCurrentMark(null);
    if (!terminal) return;

    disposablesRef.current = [
      terminal.parser.registerOscHandler(133, (data) => {
        const action = data.split(';')[0];
        if (action !== 'C') return true;
        oscSeenRef.current = true;
        addMark(terminal, 0, shellCommandLabel(terminal), false);
        return true;
      }),
      terminal.onScroll(() => syncStickyMark(terminal)),
      terminal.onWriteParsed(() => {
        scanInitialBuffer(terminal);
        syncStickyMark(terminal);
      }),
    ];
  }, [addMark, scanInitialBuffer, syncStickyMark]);

  const handleOutputWritten = useCallback((
    terminal: XTerminal,
    data: string | Uint8Array
  ) => {
    if (!oscSeenRef.current) {
      for (const mark of detectAgentTurnMarks(data)) {
        addMark(terminal, mark.lineOffset, mark.label, true);
      }
    }
    syncStickyMark(terminal);
  }, [addMark, syncStickyMark]);

  const jumpToMark = useCallback((direction: 'previous' | 'next') => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const viewportY = terminal.buffer.active.viewportY;
    const available = marksRef.current
      .filter((mark) => !mark.marker.isDisposed && mark.marker.line >= 0)
      .sort((left, right) => left.marker.line - right.marker.line);
    const target = direction === 'previous'
      ? available.filter((mark) => mark.marker.line < viewportY).at(-1)
      : available.find((mark) => mark.marker.line > viewportY);
    if (!target) return;
    terminal.scrollToLine(target.marker.line);
    terminal.focus();
    syncStickyMark(terminal);
  }, [syncStickyMark]);
  const previousMark = useCallback(() => jumpToMark('previous'), [jumpToMark]);
  const nextMark = useCallback(() => jumpToMark('next'), [jumpToMark]);

  return {
    bindTerminal,
    handleOutputWritten,
    previousMark,
    nextMark,
    hasMarks: marks.length > 0,
    currentMark,
  };
}
