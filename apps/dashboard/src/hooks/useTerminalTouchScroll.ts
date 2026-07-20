'use client';

import { useEffect, useRef, type RefObject } from 'react';
import type { XTerminal } from '@/components/terminal/types';

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
  };
}

export function useTerminalTouchScroll({
  enabled,
  termRef,
  terminalRef,
}: {
  enabled: boolean;
  termRef: RefObject<HTMLDivElement | null>;
  terminalRef: RefObject<XTerminal | null>;
}) {
  const touchScrollRef = useRef<TouchScrollState>(createTouchScrollState());

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

    const handleTouchStart = (event: TouchEvent) => {
      const terminal = terminalRef.current;
      if (!terminal) return;
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      if (!touch) return;
      if (touchState.momentumRaf !== null) {
        cancelAnimationFrame(touchState.momentumRaf);
        touchState.momentumRaf = null;
      }
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
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!touchState.active) return;
      const terminal = terminalRef.current;
      if (!terminal) return;
      if (terminal.hasSelection()) return;
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      if (!touch) return;
      const totalDy = touch.clientY - touchState.startY;
      const totalDx = touch.clientX - touchState.startX;

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

    const handleTouchEnd = () => {
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

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
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
    };
  }, [enabled, termRef, terminalRef]);

  return touchScrollRef;
}
