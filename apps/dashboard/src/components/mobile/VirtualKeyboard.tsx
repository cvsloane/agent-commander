'use client';

import { useCallback, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, CornerDownLeft, Keyboard, Copy, ClipboardPaste } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/useIsMobile';
import { cn } from '@/lib/utils';
import { DEFAULT_VIRTUAL_KEY_ORDER, type VirtualKeyboardKey, useSettingsStore } from '@/stores/settings';

export interface VirtualKeyboardProps {
  /** Called when a key is pressed, with the escape sequence or character to send */
  onInput?: (data: string) => void;
  /** Called when Ctrl+C is pressed (interrupt) */
  onInterrupt?: () => void;
  /** Called when Copy is pressed */
  onCopy?: () => void;
  /** Called when Paste is pressed, with pasted text */
  onPaste?: (text: string) => void;
  /** Whether copy is available (e.g., there's a selection) */
  canCopy?: boolean;
  /** Whether paste is available */
  canPaste?: boolean;
  /** Whether the keyboard is visible */
  visible?: boolean;
  /** Toggle visibility callback */
  onToggleVisibility?: () => void;
  /** Additional class names */
  className?: string;
  /** Whether to auto-show on mobile */
  autoShowOnMobile?: boolean;
}

interface KeyButton {
  id: VirtualKeyboardKey;
  label: string;
  icon?: React.ReactNode;
  data?: string; // The escape sequence or character to send
  action?: 'interrupt'; // Special action instead of data
  variant?: 'default' | 'destructive' | 'outline';
  className?: string;
}

const KEYS: KeyButton[] = [
  { id: 'ctrl_c', label: 'Ctrl+C', action: 'interrupt', variant: 'destructive' },
  { id: 'esc', label: 'Esc', data: '\x1b' },
  { id: 'tab', label: 'Tab', data: '\t' },
  { id: 'shift_tab', label: 'S-Tab', data: '\x1b[Z' }, // Shift+Tab
  { id: 'arrow_up', label: '', icon: <ChevronUp className="h-4 w-4" />, data: '\x1b[A' }, // Up arrow
  { id: 'arrow_down', label: '', icon: <ChevronDown className="h-4 w-4" />, data: '\x1b[B' }, // Down arrow
  { id: 'arrow_left', label: '', icon: <ChevronLeft className="h-4 w-4" />, data: '\x1b[D' }, // Left arrow
  { id: 'arrow_right', label: '', icon: <ChevronRight className="h-4 w-4" />, data: '\x1b[C' }, // Right arrow
  { id: 'enter', label: '', icon: <CornerDownLeft className="h-4 w-4" />, data: '\r' }, // Enter
];

export function VirtualKeyboard({
  onInput,
  onInterrupt,
  onCopy,
  onPaste,
  canCopy = true,
  canPaste = true,
  visible: controlledVisible,
  onToggleVisibility,
  className,
  autoShowOnMobile = true,
}: VirtualKeyboardProps) {
  const isMobile = useIsMobile();
  const { virtualKeyboardKeys } = useSettingsStore();
  const [internalVisible, setInternalVisible] = useState(false);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const orderedKeys = useMemo(() => {
    const desired = virtualKeyboardKeys.length > 0 ? virtualKeyboardKeys : DEFAULT_VIRTUAL_KEY_ORDER;
    const keyMap = new Map(KEYS.map((key) => [key.id, key]));
    return desired.map((id) => keyMap.get(id)).filter(Boolean) as KeyButton[];
  }, [virtualKeyboardKeys]);

  // Use controlled visibility if provided, otherwise use internal state
  const isVisible = controlledVisible !== undefined ? controlledVisible : (autoShowOnMobile ? isMobile : internalVisible);

  const handleToggle = useCallback(() => {
    if (onToggleVisibility) {
      onToggleVisibility();
    } else {
      setInternalVisible((prev) => !prev);
    }
  }, [onToggleVisibility]);

  const handleKeyPress = useCallback((key: KeyButton) => {
    // Haptic feedback if available
    if ('vibrate' in navigator) {
      navigator.vibrate(10);
    }

    if (key.action === 'interrupt') {
      onInterrupt?.();
    } else if (key.data) {
      onInput?.(key.data);
    }
  }, [onInput, onInterrupt]);

  const handleCopy = useCallback(() => {
    if ('vibrate' in navigator) {
      navigator.vibrate(10);
    }
    onCopy?.();
  }, [onCopy]);

  const handlePaste = useCallback(async () => {
    if ('vibrate' in navigator) {
      navigator.vibrate(10);
    }
    setPasteError(null);

    // Try to read from clipboard
    if (navigator.clipboard && window.isSecureContext) {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          onPaste?.(text);
          return;
        }
      } catch {
        // Clipboard read failed (iOS Safari often blocks this)
        setPasteError('Tap and hold to paste');
        setTimeout(() => setPasteError(null), 2000);
      }
    } else {
      setPasteError('Tap and hold to paste');
      setTimeout(() => setPasteError(null), 2000);
    }
  }, [onPaste]);

  // Render toggle button for non-mobile when not visible
  if (!isVisible && !isMobile) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={handleToggle}
        className={cn('gap-1', className)}
      >
        <Keyboard className="h-4 w-4" />
        <span className="hidden sm:inline">Keys</span>
      </Button>
    );
  }

  if (!isVisible) {
    return null;
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-1 p-2 bg-muted/50 border-t',
        className
      )}
      role="toolbar"
      aria-label="Virtual keyboard"
    >
      {/* Paste error toast */}
      {pasteError && (
        <div className="text-xs text-center text-muted-foreground py-1">
          {pasteError}
        </div>
      )}

      <div className="flex items-center gap-1 overflow-x-auto touch-pan-x">
        {/* Copy/Paste buttons at the start */}
        {onCopy && (
          <Button
            variant="outline"
            size="sm"
            className={cn(
              'h-10 min-w-[44px] px-3 shrink-0',
              'active:scale-95 transition-transform',
              !canCopy && 'opacity-50'
            )}
            onClick={handleCopy}
            disabled={!canCopy}
            aria-label="Copy selection"
          >
            <Copy className="h-4 w-4" />
          </Button>
        )}

        {onPaste && (
          <Button
            variant="outline"
            size="sm"
            className={cn(
              'h-10 min-w-[44px] px-3 shrink-0',
              'active:scale-95 transition-transform',
              !canPaste && 'opacity-50'
            )}
            onClick={handlePaste}
            disabled={!canPaste}
            aria-label="Paste from clipboard"
          >
            <ClipboardPaste className="h-4 w-4" />
          </Button>
        )}

        {/* Separator if we have copy/paste buttons */}
        {(onCopy || onPaste) && (
          <div className="w-px h-6 bg-border shrink-0 mx-1" />
        )}

        {orderedKeys.map((key, index) => (
          <Button
            key={key.id || key.label || `key-${index}`}
            variant={key.variant || 'outline'}
            size="sm"
            className={cn(
              'h-10 min-w-[44px] px-3 shrink-0', // 44px minimum touch target
              'active:scale-95 transition-transform',
              key.className
            )}
            onClick={() => handleKeyPress(key)}
            aria-label={key.label || 'key'}
          >
            {key.icon || key.label}
          </Button>
        ))}

        {/* Toggle button to hide keyboard (only on desktop) */}
        {!isMobile && (
          <Button
            variant="ghost"
            size="sm"
            className="h-10 min-w-[44px] px-2 shrink-0 ml-auto"
            onClick={handleToggle}
            aria-label="Hide keyboard"
          >
            <Keyboard className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
