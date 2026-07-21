'use client';

import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import {
  MINIMAL_TERMINAL_RAIL_CONFIG,
  isArrowRailKey,
  resolveTerminalRailBinding,
  type TerminalRailBinding,
  type TerminalRailKey,
} from './terminalRailConfig';
import type { StickyCtrlEvent, StickyCtrlMode } from './stickyCtrl';
import { tmuxPrefixToSequence } from '@/lib/tmuxKeys';

interface TerminalKeyRailProps {
  onInput: (data: string) => void;
  onHistory: () => void;
  ctrlMode: StickyCtrlMode;
  onCtrlEvent: (event: StickyCtrlEvent) => void;
  prefix?: string;
}

type RailGesture = {
  keyId: string;
  startY: number;
  swiped: boolean;
  longPressed: boolean;
};

function hapticTick() {
  navigator.vibrate?.(8);
}

export function TerminalKeyRail({
  onInput,
  onHistory,
  ctrlMode,
  onCtrlEvent,
  prefix,
}: TerminalKeyRailProps) {
  const configuredRail = useSettingsStore((state) => state.terminalRailConfig);
  const config = configuredRail?.keys?.length ? configuredRail : MINIMAL_TERMINAL_RAIL_CONFIG;
  const [navLayer, setNavLayer] = useState(false);
  const gestureRef = useRef<RailGesture | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const lastCtrlTapRef = useRef(0);
  const ctrlActive = ctrlMode !== 'inactive';

  useEffect(() => {
    const virtualKeyboard = (navigator as Navigator & {
      virtualKeyboard?: { overlaysContent: boolean };
    }).virtualKeyboard;
    if (virtualKeyboard) virtualKeyboard.overlaysContent = true;
  }, []);

  useEffect(() => () => {
    if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current);
  }, []);

  const visibleKeys = useMemo(() => config.keys.map((key) => {
    if ((ctrlActive || navLayer) && isArrowRailKey(key) && key.popup) {
      return {
        ...key,
        label: key.popup.label,
        binding: key.popup as TerminalRailBinding,
      };
    }
    return key;
  }), [config.keys, ctrlActive, navLayer]);

  const clearLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const executeBinding = (binding: TerminalRailBinding, key: TerminalRailKey) => {
    const action = resolveTerminalRailBinding(binding, tmuxPrefixToSequence(prefix));
    hapticTick();
    if (action.type === 'input') onInput(action.data);
    else if (action.type === 'history') onHistory();
    else return;
    if (ctrlMode === 'one-shot') onCtrlEvent('consume');
    if (navLayer && isArrowRailKey(key)) setNavLayer(false);
  };

  const handleCtrlClick = () => {
    const now = performance.now();
    if (now - lastCtrlTapRef.current <= 300) {
      lastCtrlTapRef.current = 0;
      onCtrlEvent('double-tap');
    } else {
      lastCtrlTapRef.current = now;
      onCtrlEvent('tap');
    }
    hapticTick();
  };

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>, key: TerminalRailKey) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    suppressClickRef.current = false;
    gestureRef.current = {
      keyId: key.id,
      startY: event.clientY,
      swiped: false,
      longPressed: false,
    };
    clearLongPress();

    const isCtrl = key.binding.type === 'keysym' && key.binding.value === 'ctrl';
    if (isCtrl) {
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = null;
        if (!gestureRef.current || gestureRef.current.keyId !== key.id) return;
        gestureRef.current.longPressed = true;
        suppressClickRef.current = true;
        onCtrlEvent('hold-start');
        hapticTick();
      }, 450);
    } else if (isArrowRailKey(key) && !ctrlActive) {
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = null;
        if (!gestureRef.current || gestureRef.current.keyId !== key.id) return;
        gestureRef.current.longPressed = true;
        suppressClickRef.current = true;
        setNavLayer(true);
        hapticTick();
      }, 450);
    }
  };

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>, key: TerminalRailKey) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.keyId !== key.id || !key.popup || gesture.longPressed) return;
    if (gesture.startY - event.clientY < 24) return;
    gesture.swiped = true;
    suppressClickRef.current = true;
    clearLongPress();
  };

  const finishPointer = (key: TerminalRailKey) => {
    clearLongPress();
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture || gesture.keyId !== key.id) return;
    if (gesture.longPressed && key.binding.type === 'keysym' && key.binding.value === 'ctrl') {
      onCtrlEvent('hold-end');
      return;
    }
    if (gesture.swiped && key.popup) {
      executeBinding(key.popup, key);
    }
  };

  return (
    <div
      className="terminal-key-rail sticky z-40 shrink-0 border-t bg-background/95 p-1 backdrop-blur"
      data-terminal-key-controls
      data-testid="terminal-key-rail"
      role="toolbar"
      aria-label="Terminal key rail"
    >
      <div className={cn(
        config.keys.length <= 6
          ? 'grid grid-cols-6 gap-1 overflow-hidden'
          : 'flex gap-1 overflow-x-auto touch-pan-x'
      )}>
        {visibleKeys.map((key, index) => {
          const sourceKey = config.keys[index] ?? key;
          const isCtrl = sourceKey.binding.type === 'keysym' && sourceKey.binding.value === 'ctrl';
          return (
            <button
              key={key.id}
              type="button"
              className={cn(
                'flex h-11 min-w-11 items-center justify-center rounded-md border bg-background px-2 text-xs font-semibold outline-none transition-colors active:scale-95 focus-visible:ring-2 focus-visible:ring-ring',
                config.keys.length > 6 && 'shrink-0',
                isCtrl && ctrlActive && 'border-primary bg-primary text-primary-foreground',
                navLayer && isArrowRailKey(sourceKey) && 'border-primary/60 bg-primary/10 text-primary'
              )}
              aria-label={isCtrl ? `Control modifier ${ctrlMode}` : key.label}
              aria-pressed={isCtrl ? ctrlActive : undefined}
              onPointerDown={(event) => handlePointerDown(event, sourceKey)}
              onPointerMove={(event) => handlePointerMove(event, sourceKey)}
              onPointerUp={() => finishPointer(sourceKey)}
              onPointerCancel={() => finishPointer(sourceKey)}
              onClick={() => {
                if (suppressClickRef.current) {
                  suppressClickRef.current = false;
                  return;
                }
                if (isCtrl) handleCtrlClick();
                else executeBinding(key.binding, sourceKey);
              }}
            >
              {key.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
