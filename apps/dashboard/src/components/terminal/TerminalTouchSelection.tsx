'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from 'react';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { XTerminal } from './types';
import {
  orderTerminalCellRange,
  pointToTerminalCell,
  terminalCellHandlePosition,
  terminalCellRangeLength,
  terminalWordRange,
  type TerminalCellGeometry,
  type TerminalCellRange,
} from './touchSelection';

const DOUBLE_TAP_MS = 325;
const DOUBLE_TAP_DISTANCE = 24;

function terminalGeometry(container: HTMLElement, terminal: XTerminal): TerminalCellGeometry {
  const screen = container.querySelector<HTMLElement>('.xterm-screen');
  const rect = (screen ?? container).getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    cols: terminal.cols,
    rows: terminal.rows,
    viewportY: terminal.buffer.active.viewportY,
  };
}

function selectTerminalRange(terminal: XTerminal, range: TerminalCellRange): string {
  const ordered = orderTerminalCellRange(range.start, range.end, terminal.cols);
  terminal.select(
    ordered.start.column,
    ordered.start.row,
    terminalCellRangeLength(ordered, terminal.cols)
  );
  return terminal.getSelection();
}

interface TerminalTouchSelectionProps {
  enabled: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  terminalRef: RefObject<XTerminal | null>;
  onCopy: (text: string) => void;
}

export function TerminalTouchSelection({
  enabled,
  containerRef,
  terminalRef,
  onCopy,
}: TerminalTouchSelectionProps) {
  const [range, setRange] = useState<TerminalCellRange | null>(null);
  const [selectedText, setSelectedText] = useState('');
  const [copied, setCopied] = useState(false);
  const [geometry, setGeometry] = useState<TerminalCellGeometry | null>(null);
  const lastTapRef = useRef<{ at: number; x: number; y: number } | null>(null);
  const draggingHandleRef = useRef<'start' | 'end' | null>(null);
  const rangeRef = useRef<TerminalCellRange | null>(null);

  const copySelection = useCallback((text = selectedText) => {
    if (!text) return;
    onCopy(text);
    setCopied(true);
    navigator.vibrate?.(10);
  }, [onCopy, selectedText]);

  const commitRange = useCallback((nextRange: TerminalCellRange, copy = false) => {
    const terminal = terminalRef.current;
    const container = containerRef.current;
    if (!terminal || !container) return;
    const ordered = orderTerminalCellRange(nextRange.start, nextRange.end, terminal.cols);
    const text = selectTerminalRange(terminal, ordered);
    rangeRef.current = ordered;
    setRange(ordered);
    setGeometry(terminalGeometry(container, terminal));
    setSelectedText(text);
    setCopied(false);
    if (copy && text) {
      onCopy(text);
      setCopied(true);
      navigator.vibrate?.(10);
    }
  }, [containerRef, onCopy, terminalRef]);

  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;

    const handleTouchEnd = (event: TouchEvent) => {
      if (event.changedTouches?.length !== 1 || draggingHandleRef.current) return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      const now = performance.now();
      const previous = lastTapRef.current;
      lastTapRef.current = { at: now, x: touch.clientX, y: touch.clientY };
      if (
        !previous
        || now - previous.at > DOUBLE_TAP_MS
        || Math.hypot(touch.clientX - previous.x, touch.clientY - previous.y) > DOUBLE_TAP_DISTANCE
      ) return;

      const terminal = terminalRef.current;
      if (!terminal) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      lastTapRef.current = null;
      const nextGeometry = terminalGeometry(container, terminal);
      const cell = pointToTerminalCell(nextGeometry, { x: touch.clientX, y: touch.clientY });
      const line = terminal.buffer.active.getLine(cell.row)?.translateToString(true) ?? '';
      const wordRange = terminalWordRange(line, cell.column, cell.row);
      if (!wordRange) return;
      commitRange(wordRange, true);
    };

    const handleSelectionCleared = () => {
      rangeRef.current = null;
      setRange(null);
      setSelectedText('');
      setCopied(false);
    };

    container.addEventListener('touchend', handleTouchEnd, { passive: false });
    container.addEventListener('terminal-cursor-mode-start', handleSelectionCleared);
    return () => {
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('terminal-cursor-mode-start', handleSelectionCleared);
    };
  }, [commitRange, containerRef, enabled, terminalRef]);

  const moveHandle = (event: PointerEvent<HTMLButtonElement>) => {
    const handle = draggingHandleRef.current;
    const currentRange = rangeRef.current;
    const terminal = terminalRef.current;
    const container = containerRef.current;
    if (!handle || !currentRange || !terminal || !container) return;
    const nextGeometry = terminalGeometry(container, terminal);
    const cell = pointToTerminalCell(nextGeometry, { x: event.clientX, y: event.clientY });
    commitRange({ ...currentRange, [handle]: cell });
  };

  const finishHandle = (event: PointerEvent<HTMLButtonElement>) => {
    if (!draggingHandleRef.current) return;
    draggingHandleRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const text = terminalRef.current?.getSelection() ?? selectedText;
    setSelectedText(text);
    copySelection(text);
  };

  if (!range || !geometry) return null;
  const start = terminalCellHandlePosition(geometry, range.start, 'start');
  const end = terminalCellHandlePosition(geometry, range.end, 'end');
  const renderHandle = (edge: 'start' | 'end', position: { x: number; y: number }) => (
    <button
      type="button"
      className="pointer-events-auto absolute z-30 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
      style={{ left: position.x, top: position.y }}
      aria-label={`Drag ${edge} selection handle`}
      onPointerDown={(event) => {
        draggingHandleRef.current = edge;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={moveHandle}
      onPointerUp={finishHandle}
      onPointerCancel={finishHandle}
    >
      <span className="h-4 w-4 rounded-full border-2 border-white bg-sky-500 shadow" aria-hidden="true" />
    </button>
  );

  return (
    <div className="pointer-events-none absolute inset-0 z-20" data-testid="terminal-touch-selection">
      {renderHandle('start', start)}
      {renderHandle('end', end)}
      <div
        className="pointer-events-auto absolute bottom-3 left-1/2 flex min-h-11 -translate-x-1/2 items-center gap-2 rounded-full border border-white/15 bg-zinc-900/95 py-1.5 pl-3 pr-1.5 text-xs text-white shadow-xl backdrop-blur"
        role="status"
        data-testid="terminal-selection-toast"
      >
        <span>{copied ? 'Selection copied' : 'Text selected'}</span>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-8 gap-1 rounded-full px-3"
          onClick={() => copySelection()}
        >
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          Copy
        </Button>
      </div>
    </div>
  );
}
