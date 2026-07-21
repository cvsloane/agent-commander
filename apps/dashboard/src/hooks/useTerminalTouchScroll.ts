'use client';

import { useEffect, useRef, type RefObject } from 'react';
import type { TerminalScrollMode } from '@/components/terminal/terminalScrollMode';
import type { XTerminal } from '@/components/terminal/types';
import { clampTerminalFontSize } from '@/stores/settings';

type TouchScrollState = {
  startY: number;
  startX: number;
  lastY: number;
  lastX: number;
  remainder: number;
  active: boolean;
  axis: 'vertical' | 'horizontal' | null;
  velocity: number;
  lastTime: number;
  momentumRaf: number | null;
  lineHeight: number;
  pinching: boolean;
  pinchStartDistance: number;
  pinchStartFontSize: number;
  cursorArmed: boolean;
  cursorMode: boolean;
  cursorSentX: number;
  cursorSentY: number;
  cellWidth: number;
  wheelRemainder: number;
  wheelColumn: number;
  wheelRow: number;
  panning: boolean;
  scrollPath: TerminalTouchScrollPath;
  historyOpened: boolean;
  navigateRaf: number | null;
  navigateCoalescer: TerminalScrollCoalescerState;
};

const TMUX_LINES_PER_WHEEL_REPORT = 5;
const MAX_NAVIGATE_SCROLL_LINES = 120;

export type TerminalTouchScrollPath = 'local' | 'history' | 'navigate' | 'sgr' | 'none';

export type TerminalScrollCoalescerState = {
  pendingLines: number;
  scheduled: boolean;
};

export type TerminalScrollCoalescerTransition = {
  state: TerminalScrollCoalescerState;
  schedule: boolean;
  sendLines: number;
};

const INITIAL_SCROLL_COALESCER: TerminalScrollCoalescerState = {
  pendingLines: 0,
  scheduled: false,
};

function createTouchScrollState(): TouchScrollState {
  return {
    startY: 0,
    startX: 0,
    lastY: 0,
    lastX: 0,
    remainder: 0,
    active: false,
    axis: null,
    velocity: 0,
    lastTime: 0,
    momentumRaf: null,
    lineHeight: 16,
    pinching: false,
    pinchStartDistance: 0,
    pinchStartFontSize: 14,
    cursorArmed: false,
    cursorMode: false,
    cursorSentX: 0,
    cursorSentY: 0,
    cellWidth: 8,
    wheelRemainder: 0,
    wheelColumn: 1,
    wheelRow: 1,
    panning: false,
    scrollPath: 'none',
    historyOpened: false,
    navigateRaf: null,
    navigateCoalescer: { ...INITIAL_SCROLL_COALESCER },
  };
}

function touchDistance(first: Touch, second: Touch): number {
  return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
}

export function calculatePinchFontSize(
  startFontSize: number,
  startDistance: number,
  currentDistance: number
): number {
  if (startDistance <= 0 || currentDistance <= 0) return clampTerminalFontSize(startFontSize);
  return clampTerminalFontSize(startFontSize * (currentDistance / startDistance));
}

function acceleratedCellDelta(deltaPixels: number, cellSize: number): number {
  if (cellSize <= 0) return 0;
  const cells = Math.abs(deltaPixels) / cellSize;
  const multiplier = cells >= 12 ? 3 : cells >= 5 ? 2 : 1;
  return Math.sign(deltaPixels) * Math.trunc(cells * multiplier);
}

export function synthesizeCursorDragInput(
  deltaX: number,
  deltaY: number,
  cellWidth: number,
  cellHeight: number,
  sentX = 0,
  sentY = 0
): { data: string; sentX: number; sentY: number } {
  const nextX = Math.max(-120, Math.min(120, acceleratedCellDelta(deltaX, cellWidth)));
  const nextY = Math.max(-120, Math.min(120, acceleratedCellDelta(deltaY, cellHeight)));
  const stepX = nextX - sentX;
  const stepY = nextY - sentY;
  const horizontal = stepX < 0 ? '\x1b[D'.repeat(-stepX) : '\x1b[C'.repeat(stepX);
  const vertical = stepY < 0 ? '\x1b[A'.repeat(-stepY) : '\x1b[B'.repeat(stepY);
  return { data: `${horizontal}${vertical}`, sentX: nextX, sentY: nextY };
}

export function mapScrollLinesToWheelReports(
  lineDelta: number,
  remainder = 0
): { reportDelta: number; remainder: number } {
  const total = lineDelta + remainder;
  const reportDelta = Math.trunc(total / TMUX_LINES_PER_WHEEL_REPORT) || 0;
  return {
    reportDelta,
    remainder: total - reportDelta * TMUX_LINES_PER_WHEEL_REPORT,
  };
}

export function mapTouchScrollPixelsToLines(
  deltaPixels: number,
  remainder: number,
  lineHeight: number
): { lines: number; remainder: number } {
  const safeLineHeight = lineHeight > 0 ? lineHeight : 16;
  const total = deltaPixels + remainder;
  const lines = Math.trunc(total / safeLineHeight);
  return { lines, remainder: total - lines * safeLineHeight };
}

export function resolveTerminalTouchScrollPath({
  bufferType,
  mouseTrackingMode,
  writable,
  tmuxAttached,
  historyAvailable,
  historyScrollMode,
  hasTmuxNavigate,
}: {
  bufferType: 'normal' | 'alternate';
  mouseTrackingMode: 'none' | 'x10' | 'vt200' | 'drag' | 'any';
  writable: boolean;
  tmuxAttached: boolean;
  historyAvailable: boolean;
  historyScrollMode?: TerminalScrollMode;
  hasTmuxNavigate?: boolean;
}): TerminalTouchScrollPath {
  if (tmuxAttached) {
    if (!historyAvailable) return 'none';
    if (historyScrollMode === 'app-scroll') {
      return writable && hasTmuxNavigate ? 'navigate' : 'none';
    }
    return 'history';
  }
  if (bufferType === 'normal') return 'local';
  if (mouseTrackingMode !== 'none') return writable ? 'sgr' : 'none';
  return 'local';
}

export function reduceTerminalScrollCoalescer(
  state: TerminalScrollCoalescerState,
  event: { type: 'enqueue'; lines: number } | { type: 'flush' }
): TerminalScrollCoalescerTransition {
  if (event.type === 'enqueue') {
    const pendingLines = state.pendingLines + event.lines;
    const schedule = !state.scheduled && pendingLines !== 0;
    return {
      state: {
        pendingLines,
        scheduled: state.scheduled || schedule,
      },
      schedule,
      sendLines: 0,
    };
  }

  const sendLines = Math.max(
    -MAX_NAVIGATE_SCROLL_LINES,
    Math.min(MAX_NAVIGATE_SCROLL_LINES, state.pendingLines)
  );
  const pendingLines = state.pendingLines - sendLines;
  return {
    state: {
      pendingLines,
      scheduled: pendingLines !== 0,
    },
    schedule: pendingLines !== 0,
    sendLines,
  };
}

export function shouldOpenHistoryOnGesture(
  scrollPath: TerminalTouchScrollPath,
  totalDy: number,
  historyOpened: boolean
): boolean {
  return scrollPath === 'history' && totalDy > 0 && !historyOpened;
}

export function resolveTouchCell(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, 'left' | 'top'>,
  cellWidth: number,
  lineHeight: number,
  cols: number,
  rows: number
): { column: number; row: number } {
  const safeCellWidth = cellWidth > 0 ? cellWidth : 1;
  const safeLineHeight = lineHeight > 0 ? lineHeight : 1;
  const maxColumn = Math.max(1, cols);
  const maxRow = Math.max(1, rows);
  return {
    column: Math.max(1, Math.min(maxColumn, Math.floor((clientX - rect.left) / safeCellWidth) + 1)),
    row: Math.max(1, Math.min(maxRow, Math.floor((clientY - rect.top) / safeLineHeight) + 1)),
  };
}

export function buildSgrWheelReports(
  reportDelta: number,
  column: number,
  row: number
): string {
  if (reportDelta === 0) return '';
  const button = reportDelta < 0 ? 64 : 65;
  return `\x1b[<${button};${column};${row}M`.repeat(Math.abs(reportDelta));
}

export function dispatchTerminalTouchScroll({
  terminal,
  lineDelta,
  wheelRemainder,
  column,
  row,
  writable,
  onInput,
  tmuxAttached = false,
  historyAvailable = false,
  historyScrollMode,
  onOpenHistory = () => undefined,
  hasTmuxNavigate = false,
  onNavigateScroll = () => undefined,
}: {
  terminal: XTerminal;
  lineDelta: number;
  wheelRemainder: number;
  column: number;
  row: number;
  writable: boolean;
  onInput: (data: string) => void;
  tmuxAttached?: boolean;
  historyAvailable?: boolean;
  historyScrollMode?: TerminalScrollMode;
  onOpenHistory?: () => void;
  hasTmuxNavigate?: boolean;
  onNavigateScroll?: (lines: number) => void;
}): number {
  const path = resolveTerminalTouchScrollPath({
    bufferType: terminal.buffer.active.type,
    mouseTrackingMode: terminal.modes.mouseTrackingMode,
    writable,
    tmuxAttached,
    historyAvailable,
    historyScrollMode,
    hasTmuxNavigate,
  });

  if (path === 'local') terminal.scrollLines(lineDelta);
  if (path === 'history' && lineDelta < 0) onOpenHistory();
  if (path === 'navigate') onNavigateScroll(lineDelta);
  if (path !== 'sgr') return 0;

  const mapped = mapScrollLinesToWheelReports(lineDelta, wheelRemainder);
  const data = buildSgrWheelReports(mapped.reportDelta, column, row);
  if (data) onInput(data);
  return mapped.remainder;
}

export function resolveTerminalHorizontalSwipe(
  deltaX: number,
  deltaY: number,
  panning: boolean
): 'previous' | 'next' | null {
  if (panning || Math.abs(deltaX) < 56 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.25) {
    return null;
  }
  return deltaX < 0 ? 'next' : 'previous';
}

export function useTerminalTouchScroll({
  enabled,
  termRef,
  terminalRef,
  fontSize,
  onFontSizeChange,
  cursorArmed = false,
  onCursorInput,
  onCursorDisarm,
  writable = false,
  onScrollInput = onCursorInput,
  tmuxSessionKey,
  historySessionId,
  historyScrollMode,
  onOpenHistory,
  onNavigateScroll,
  onHorizontalSwipe,
}: {
  enabled: boolean;
  termRef: RefObject<HTMLDivElement | null>;
  terminalRef: RefObject<XTerminal | null>;
  fontSize: number;
  onFontSizeChange: (fontSize: number) => void;
  cursorArmed?: boolean;
  onCursorInput: (data: string) => void;
  onCursorDisarm?: () => void;
  writable?: boolean;
  onScrollInput?: (data: string) => void;
  tmuxSessionKey?: string;
  historySessionId?: string;
  historyScrollMode?: TerminalScrollMode;
  onOpenHistory?: () => void;
  onNavigateScroll?: (lines: number) => void;
  onHorizontalSwipe?: (direction: 'previous' | 'next') => void;
}) {
  const touchScrollRef = useRef<TouchScrollState>(createTouchScrollState());
  const fontSizeRef = useRef(fontSize);
  const onFontSizeChangeRef = useRef(onFontSizeChange);
  const cursorArmedRef = useRef(cursorArmed);
  const onCursorInputRef = useRef(onCursorInput);
  const onCursorDisarmRef = useRef(onCursorDisarm);
  const writableRef = useRef(writable);
  const onScrollInputRef = useRef(onScrollInput);
  const tmuxSessionKeyRef = useRef(tmuxSessionKey);
  const historySessionIdRef = useRef(historySessionId);
  const historyScrollModeRef = useRef(historyScrollMode);
  const onOpenHistoryRef = useRef(onOpenHistory);
  const onNavigateScrollRef = useRef(onNavigateScroll);
  const onHorizontalSwipeRef = useRef(onHorizontalSwipe);
  fontSizeRef.current = fontSize;
  onFontSizeChangeRef.current = onFontSizeChange;
  cursorArmedRef.current = cursorArmed;
  onCursorInputRef.current = onCursorInput;
  onCursorDisarmRef.current = onCursorDisarm;
  writableRef.current = writable;
  onScrollInputRef.current = onScrollInput;
  tmuxSessionKeyRef.current = tmuxSessionKey;
  historySessionIdRef.current = historySessionId;
  historyScrollModeRef.current = historyScrollMode;
  onOpenHistoryRef.current = onOpenHistory;
  onNavigateScrollRef.current = onNavigateScroll;
  onHorizontalSwipeRef.current = onHorizontalSwipe;

  useEffect(() => {
    if (!enabled) return;
    const container = termRef.current;
    if (!container) return;
    const touchState = touchScrollRef.current;

    const computeLineHeight = (terminal: XTerminal): number => {
      const row = container.querySelector<HTMLElement>('.xterm-rows > div');
      const rowHeight = row?.getBoundingClientRect().height;
      if (rowHeight && rowHeight > 0) return rowHeight;

      const style = window.getComputedStyle(container);
      const paddingTop = Number.parseFloat(style.paddingTop || '0') || 0;
      const paddingBottom = Number.parseFloat(style.paddingBottom || '0') || 0;
      const height = container.clientHeight - paddingTop - paddingBottom;
      const rows = terminal.rows || 0;
      if (rows > 0 && height > 0) return height / rows;
      return 16;
    };

    const computeCellWidth = (terminal: XTerminal): number => {
      const measure = container.querySelector<HTMLElement>('.xterm-char-measure-element');
      const measuredWidth = measure?.getBoundingClientRect().width;
      if (measuredWidth && measuredWidth > 0) return measuredWidth;
      const width = container.clientWidth;
      return terminal.cols > 0 && width > 0 ? width / terminal.cols : 8;
    };

    const scheduleNavigateFlush = () => {
      if (touchState.navigateRaf !== null) return;
      touchState.navigateRaf = requestAnimationFrame(() => {
        touchState.navigateRaf = null;
        const transition = reduceTerminalScrollCoalescer(touchState.navigateCoalescer, {
          type: 'flush',
        });
        touchState.navigateCoalescer = transition.state;
        if (transition.sendLines !== 0) {
          onNavigateScrollRef.current?.(transition.sendLines);
        }
        if (transition.schedule) scheduleNavigateFlush();
      });
    };

    const enqueueNavigateScroll = (lines: number) => {
      const transition = reduceTerminalScrollCoalescer(touchState.navigateCoalescer, {
        type: 'enqueue',
        lines,
      });
      touchState.navigateCoalescer = transition.state;
      if (transition.schedule) scheduleNavigateFlush();
    };

    const disarmCursorGesture = () => {
      cursorArmedRef.current = false;
      onCursorDisarmRef.current?.();
    };

    const handleTouchStart = (event: TouchEvent) => {
      const terminal = terminalRef.current;
      if (!terminal) return;
      if (touchState.momentumRaf !== null) {
        cancelAnimationFrame(touchState.momentumRaf);
        touchState.momentumRaf = null;
      }
      if (event.touches.length === 2) {
        if (cursorArmedRef.current) disarmCursorGesture();
        touchState.cursorArmed = false;
        touchState.cursorMode = false;
        const first = event.touches[0];
        const second = event.touches[1];
        if (!first || !second) return;
        event.preventDefault();
        touchState.active = false;
        touchState.pinching = true;
        touchState.pinchStartDistance = touchDistance(first, second);
        touchState.pinchStartFontSize = fontSizeRef.current;
        return;
      }
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      if (!touch) return;
      touchState.pinching = false;
      touchState.active = true;
      touchState.axis = null;
      touchState.startY = touch.clientY;
      touchState.startX = touch.clientX;
      touchState.lastY = touch.clientY;
      touchState.lastX = touch.clientX;
      touchState.remainder = 0;
      touchState.velocity = 0;
      touchState.lastTime = performance.now();
      touchState.lineHeight = computeLineHeight(terminal);
      touchState.cellWidth = computeCellWidth(terminal);
      const touchCell = resolveTouchCell(
        touch.clientX,
        touch.clientY,
        container.getBoundingClientRect(),
        touchState.cellWidth,
        touchState.lineHeight,
        terminal.cols,
        terminal.rows
      );
      touchState.wheelRemainder = 0;
      touchState.wheelColumn = touchCell.column;
      touchState.wheelRow = touchCell.row;
      touchState.cursorArmed = cursorArmedRef.current;
      touchState.cursorMode = false;
      touchState.cursorSentX = 0;
      touchState.cursorSentY = 0;
      touchState.panning = false;
      touchState.scrollPath = resolveTerminalTouchScrollPath({
        bufferType: terminal.buffer.active.type,
        mouseTrackingMode: terminal.modes.mouseTrackingMode,
        writable: writableRef.current,
        tmuxAttached: Boolean(tmuxSessionKeyRef.current),
        historyAvailable: Boolean(historySessionIdRef.current),
        historyScrollMode: historyScrollModeRef.current,
        hasTmuxNavigate: Boolean(onNavigateScrollRef.current),
      });
      touchState.historyOpened = false;
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (touchState.pinching) {
        if (event.touches.length !== 2) return;
        const first = event.touches[0];
        const second = event.touches[1];
        if (!first || !second) return;
        event.preventDefault();
        const nextFontSize = calculatePinchFontSize(
          touchState.pinchStartFontSize,
          touchState.pinchStartDistance,
          touchDistance(first, second)
        );
        if (nextFontSize !== fontSizeRef.current) {
          fontSizeRef.current = nextFontSize;
          onFontSizeChangeRef.current(nextFontSize);
        }
        return;
      }
      if (!touchState.active) return;
      const terminal = terminalRef.current;
      if (!terminal) return;
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      if (!touch) return;
      const totalDy = touch.clientY - touchState.startY;
      const totalDx = touch.clientX - touchState.startX;
      const movedDistance = Math.hypot(totalDx, totalDy);

      if (touchState.cursorArmed && movedDistance > 10) {
        touchState.cursorArmed = false;
        touchState.cursorMode = true;
        touchState.axis = null;
        touchState.remainder = 0;
        touchState.velocity = 0;
        container.dispatchEvent(new CustomEvent('terminal-cursor-mode-start'));
      }

      if (touchState.cursorMode) {
        event.preventDefault();
        const synthesized = synthesizeCursorDragInput(
          totalDx,
          totalDy,
          touchState.cellWidth,
          touchState.lineHeight,
          touchState.cursorSentX,
          touchState.cursorSentY
        );
        touchState.cursorSentX = synthesized.sentX;
        touchState.cursorSentY = synthesized.sentY;
        if (synthesized.data) onCursorInputRef.current(synthesized.data);
        return;
      }

      if (terminal.hasSelection()) return;
      if (!touchState.axis) {
        const absDy = Math.abs(totalDy);
        const absDx = Math.abs(totalDx);
        const MOVE_THRESHOLD = 4;
        const AXIS_RATIO = 1.2;

        if (absDy < MOVE_THRESHOLD && absDx < MOVE_THRESHOLD) {
          touchState.lastY = touch.clientY;
          touchState.lastX = touch.clientX;
          return;
        }

        if (absDy > absDx * AXIS_RATIO) {
          touchState.axis = 'vertical';
          touchState.lastY = touch.clientY;
          touchState.lastX = touch.clientX;
          touchState.lastTime = performance.now();
          touchState.velocity = 0;
          touchState.remainder = 0;
          touchState.wheelRemainder = 0;
          if (touchState.scrollPath === 'history' || touchState.scrollPath === 'none') {
            event.preventDefault();
            if (shouldOpenHistoryOnGesture(touchState.scrollPath, totalDy, touchState.historyOpened)) {
              touchState.historyOpened = true;
              onOpenHistoryRef.current?.();
            }
          }
          return;
        }
        if (absDx > absDy * AXIS_RATIO) {
          touchState.axis = 'horizontal';
          touchState.lastY = touch.clientY;
          touchState.lastX = touch.clientX;
          touchState.lastTime = performance.now();
          touchState.velocity = 0;
          touchState.remainder = 0;
          touchState.wheelRemainder = 0;
          return;
        }

        touchState.lastY = touch.clientY;
        touchState.lastX = touch.clientX;
        touchState.lastTime = performance.now();
        return;
      }

      if (touchState.axis === 'horizontal') {
        const panContainer = container.parentElement;
        const canPan = Boolean(
          panContainer && panContainer.scrollWidth > panContainer.clientWidth + 1
        );
        if (panContainer && canPan) {
          event.preventDefault();
          panContainer.scrollLeft -= touch.clientX - touchState.lastX;
          touchState.panning = true;
        }
        touchState.lastY = touch.clientY;
        touchState.lastX = touch.clientX;
        touchState.lastTime = performance.now();
        touchState.velocity = 0;
        touchState.remainder = 0;
        touchState.wheelRemainder = 0;
        return;
      }

      event.preventDefault();

      if (touchState.scrollPath === 'history' || touchState.scrollPath === 'none') {
        if (shouldOpenHistoryOnGesture(touchState.scrollPath, totalDy, touchState.historyOpened)) {
          touchState.historyOpened = true;
          onOpenHistoryRef.current?.();
        }
        touchState.lastY = touch.clientY;
        touchState.lastX = touch.clientX;
        touchState.lastTime = performance.now();
        touchState.velocity = 0;
        return;
      }

      const deltaY = touch.clientY - touchState.lastY;
      const mapped = mapTouchScrollPixelsToLines(
        deltaY,
        touchState.remainder,
        touchState.lineHeight
      );
      const lines = mapped.lines;
      touchState.remainder = mapped.remainder;
      if (lines !== 0) {
        touchState.wheelRemainder = dispatchTerminalTouchScroll({
          terminal,
          lineDelta: -lines,
          wheelRemainder: touchState.wheelRemainder,
          column: touchState.wheelColumn,
          row: touchState.wheelRow,
          writable: writableRef.current,
          onInput: onScrollInputRef.current,
          tmuxAttached: Boolean(tmuxSessionKeyRef.current),
          historyAvailable: Boolean(historySessionIdRef.current),
          historyScrollMode: historyScrollModeRef.current,
          hasTmuxNavigate: Boolean(onNavigateScrollRef.current),
          onNavigateScroll: enqueueNavigateScroll,
        });
      }
      const now = performance.now();
      const dt = now - touchState.lastTime;
      if (dt > 0) {
        touchState.velocity = deltaY / dt;
      }
      touchState.lastTime = now;
      touchState.lastY = touch.clientY;
      touchState.lastX = touch.clientX;
    };

    const handleTouchEnd = (event: TouchEvent) => {
      const cursorGestureArmed = touchState.cursorArmed || touchState.cursorMode;
      if (touchState.pinching) {
        if (event.touches.length < 2) touchState.pinching = false;
        touchState.active = false;
        touchState.axis = null;
        touchState.remainder = 0;
        touchState.wheelRemainder = 0;
        touchState.velocity = 0;
        return;
      }
      if (touchState.cursorMode) {
        touchState.cursorMode = false;
        touchState.cursorArmed = false;
        touchState.active = false;
        touchState.axis = null;
        container.dispatchEvent(new CustomEvent('terminal-cursor-mode-end'));
        disarmCursorGesture();
        return;
      }
      touchState.cursorArmed = false;
      if (cursorGestureArmed) disarmCursorGesture();
      touchState.active = false;
      const axis = touchState.axis;
      touchState.axis = null;

      if (axis === 'horizontal') {
        const deltaX = touchState.lastX - touchState.startX;
        const deltaY = touchState.lastY - touchState.startY;
        const direction = resolveTerminalHorizontalSwipe(deltaX, deltaY, touchState.panning);
        if (direction) onHorizontalSwipeRef.current?.(direction);
      }

      if (axis !== 'vertical') {
        touchState.remainder = 0;
        touchState.wheelRemainder = 0;
        touchState.velocity = 0;
        return;
      }

      if (touchState.scrollPath === 'history' || touchState.scrollPath === 'none') {
        touchState.remainder = 0;
        touchState.wheelRemainder = 0;
        touchState.velocity = 0;
        touchState.historyOpened = false;
        return;
      }

      const velocity = touchState.velocity;
      const VELOCITY_THRESHOLD = 0.5;
      const FRICTION = 0.95;
      const MIN_VELOCITY = 0.1;

      if (Math.abs(velocity) < VELOCITY_THRESHOLD) {
        touchState.remainder = 0;
        return;
      }

      let currentVelocity = velocity;
      let accum = 0;
      let lastFrame = performance.now();

      const tick = () => {
        const terminal = terminalRef.current;
        if (!terminal) {
          touchState.momentumRaf = null;
          return;
        }
        const now = performance.now();
        const dt = now - lastFrame;
        lastFrame = now;
        currentVelocity *= FRICTION;
        if (Math.abs(currentVelocity) < MIN_VELOCITY) {
          touchState.momentumRaf = null;
          return;
        }
        accum += currentVelocity * dt;
        const mapped = mapTouchScrollPixelsToLines(0, accum, touchState.lineHeight);
        const lines = mapped.lines;
        accum = mapped.remainder;
        if (lines !== 0) {
          touchState.wheelRemainder = dispatchTerminalTouchScroll({
            terminal,
            lineDelta: -lines,
            wheelRemainder: touchState.wheelRemainder,
            column: touchState.wheelColumn,
            row: touchState.wheelRow,
            writable: writableRef.current,
            onInput: onScrollInputRef.current,
            tmuxAttached: Boolean(tmuxSessionKeyRef.current),
            historyAvailable: Boolean(historySessionIdRef.current),
            historyScrollMode: historyScrollModeRef.current,
            hasTmuxNavigate: Boolean(onNavigateScrollRef.current),
            onNavigateScroll: enqueueNavigateScroll,
          });
        }
        touchState.momentumRaf = requestAnimationFrame(tick);
      };
      touchState.momentumRaf = requestAnimationFrame(tick);
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);
    container.addEventListener('touchcancel', handleTouchEnd);

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
      if (touchState.momentumRaf !== null) {
        cancelAnimationFrame(touchState.momentumRaf);
        touchState.momentumRaf = null;
      }
      if (touchState.navigateRaf !== null) {
        cancelAnimationFrame(touchState.navigateRaf);
        touchState.navigateRaf = null;
      }
      touchState.navigateCoalescer = { ...INITIAL_SCROLL_COALESCER };
    };
  }, [enabled, termRef, terminalRef]);

  return touchScrollRef;
}
