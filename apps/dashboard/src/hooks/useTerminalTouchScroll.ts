'use client';

import { useEffect, useRef, type RefObject } from 'react';
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
  cursorTimer: number | null;
  cursorArmed: boolean;
  cursorMode: boolean;
  cursorSentX: number;
  cursorSentY: number;
  cellWidth: number;
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
    cursorTimer: null,
    cursorArmed: false,
    cursorMode: false,
    cursorSentX: 0,
    cursorSentY: 0,
    cellWidth: 8,
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

export function useTerminalTouchScroll({
  enabled,
  termRef,
  terminalRef,
  fontSize,
  onFontSizeChange,
  cursorEnabled,
  onCursorInput,
}: {
  enabled: boolean;
  termRef: RefObject<HTMLDivElement | null>;
  terminalRef: RefObject<XTerminal | null>;
  fontSize: number;
  onFontSizeChange: (fontSize: number) => void;
  cursorEnabled: boolean;
  onCursorInput: (data: string) => void;
}) {
  const touchScrollRef = useRef<TouchScrollState>(createTouchScrollState());
  const fontSizeRef = useRef(fontSize);
  const onFontSizeChangeRef = useRef(onFontSizeChange);
  const cursorEnabledRef = useRef(cursorEnabled);
  const onCursorInputRef = useRef(onCursorInput);
  fontSizeRef.current = fontSize;
  onFontSizeChangeRef.current = onFontSizeChange;
  cursorEnabledRef.current = cursorEnabled;
  onCursorInputRef.current = onCursorInput;

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

    const clearCursorTimer = () => {
      if (touchState.cursorTimer !== null) {
        window.clearTimeout(touchState.cursorTimer);
        touchState.cursorTimer = null;
      }
    };

    const handleTouchStart = (event: TouchEvent) => {
      const terminal = terminalRef.current;
      if (!terminal) return;
      if (touchState.momentumRaf !== null) {
        cancelAnimationFrame(touchState.momentumRaf);
        touchState.momentumRaf = null;
      }
      if (event.touches.length === 2) {
        clearCursorTimer();
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
      touchState.cursorArmed = false;
      touchState.cursorMode = false;
      touchState.cursorSentX = 0;
      touchState.cursorSentY = 0;
      clearCursorTimer();
      if (cursorEnabledRef.current) {
        touchState.cursorTimer = window.setTimeout(() => {
          touchState.cursorTimer = null;
          if (!touchState.active || touchState.axis) return;
          touchState.cursorArmed = true;
          navigator.vibrate?.(8);
        }, 450);
      }
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
      if (!touchState.cursorArmed && movedDistance > 10) clearCursorTimer();

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
          return;
        }
        if (absDx > absDy * AXIS_RATIO) {
          touchState.axis = 'horizontal';
          touchState.lastY = touch.clientY;
          touchState.lastX = touch.clientX;
          touchState.lastTime = performance.now();
          touchState.velocity = 0;
          touchState.remainder = 0;
          return;
        }

        touchState.lastY = touch.clientY;
        touchState.lastX = touch.clientX;
        touchState.lastTime = performance.now();
        return;
      }

      if (touchState.axis === 'horizontal') {
        touchState.lastY = touch.clientY;
        touchState.lastX = touch.clientX;
        touchState.lastTime = performance.now();
        touchState.velocity = 0;
        touchState.remainder = 0;
        return;
      }

      event.preventDefault();

      const deltaY = touch.clientY - touchState.lastY;
      const lineHeight = touchState.lineHeight > 0 ? touchState.lineHeight : 16;
      const totalDelta = deltaY + touchState.remainder;
      const lines = Math.trunc(totalDelta / lineHeight);
      touchState.remainder = totalDelta - lines * lineHeight;
      if (lines !== 0) {
        terminal.scrollLines(-lines);
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
      clearCursorTimer();
      if (touchState.pinching) {
        if (event.touches.length < 2) touchState.pinching = false;
        touchState.active = false;
        touchState.axis = null;
        touchState.remainder = 0;
        touchState.velocity = 0;
        return;
      }
      if (touchState.cursorMode) {
        touchState.cursorMode = false;
        touchState.cursorArmed = false;
        touchState.active = false;
        touchState.axis = null;
        container.dispatchEvent(new CustomEvent('terminal-cursor-mode-end'));
        return;
      }
      touchState.cursorArmed = false;
      touchState.active = false;
      const axis = touchState.axis;
      touchState.axis = null;

      if (axis !== 'vertical') {
        touchState.remainder = 0;
        touchState.velocity = 0;
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
      const lineHeight = touchState.lineHeight > 0 ? touchState.lineHeight : 16;

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
        const lines = Math.trunc(accum / lineHeight);
        if (lines !== 0) {
          terminal.scrollLines(-lines);
          accum -= lines * lineHeight;
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
      clearCursorTimer();
    };
  }, [enabled, termRef, terminalRef]);

  return touchScrollRef;
}
