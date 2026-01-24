'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Copy, ClipboardPaste, Trash2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ContextMenuItem {
  label: string;
  icon: React.ReactNode;
  action: () => void;
  disabled?: boolean;
}

interface TerminalContextMenuProps {
  /** Container element to attach long-press to */
  containerRef: React.RefObject<HTMLElement>;
  /** Called to copy current selection */
  onCopySelection?: () => void;
  /** Called to copy last N lines */
  onCopyLastLines?: (lines: number) => void;
  /** Called to copy all content */
  onCopyAll?: () => void;
  /** Called when paste is requested */
  onPaste?: () => void;
  /** Called to clear/send Ctrl+L */
  onClear?: () => void;
  /** Whether paste is available */
  canPaste?: boolean;
  /** Whether a selection is currently active */
  selectionActive?: boolean;
  /** Additional class names */
  className?: string;
}

interface Position {
  x: number;
  y: number;
}

const LONG_PRESS_DURATION = 500; // ms

/**
 * Context menu that appears on long-press (when no selection is active).
 * Actions: Copy selection, Copy last 50 lines, Copy all, Paste, Clear.
 */
export function TerminalContextMenu({
  containerRef,
  onCopySelection,
  onCopyLastLines,
  onCopyAll,
  onPaste,
  onClear,
  canPaste = true,
  selectionActive,
  className,
}: TerminalContextMenuProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<Position>({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const touchStartPosRef = useRef<Position | null>(null);

  const hideMenu = useCallback(() => {
    setVisible(false);
  }, []);

  const showMenu = useCallback((x: number, y: number) => {
    // Check if there's an active selection - if so, don't show context menu
    if (selectionActive !== undefined) {
      if (selectionActive) {
        return; // Let SelectionPopup handle this instead
      }
    } else {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.toString().trim()) {
        return; // Let SelectionPopup handle this instead
      }
    }

    // Clamp position to viewport
    const menuWidth = 200;
    const menuHeight = 220;
    const padding = 8;

    let clampedX = Math.max(padding, Math.min(x, window.innerWidth - menuWidth - padding));
    let clampedY = Math.max(padding, Math.min(y, window.innerHeight - menuHeight - padding));

    setPosition({ x: clampedX, y: clampedY });
    setVisible(true);

    // Haptic feedback
    if ('vibrate' in navigator) {
      navigator.vibrate(20);
    }
  }, [selectionActive]);

  // Handle long press start
  const handleTouchStart = useCallback((e: TouchEvent) => {
    const touch = e.touches[0];
    touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };

    longPressTimerRef.current = window.setTimeout(() => {
      if (touchStartPosRef.current) {
        showMenu(touchStartPosRef.current.x, touchStartPosRef.current.y);
      }
    }, LONG_PRESS_DURATION);
  }, [showMenu]);

  // Handle touch move (cancel long press if finger moves too much)
  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!touchStartPosRef.current) return;

    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - touchStartPosRef.current.x);
    const dy = Math.abs(touch.clientY - touchStartPosRef.current.y);

    // Cancel long press if moved more than 10px
    if (dx > 10 || dy > 10) {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    }
  }, []);

  // Handle touch end (cancel long press timer)
  const handleTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    touchStartPosRef.current = null;
  }, []);

  // Also support right-click on desktop
  const handleContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault();
    showMenu(e.clientX, e.clientY);
  }, [showMenu]);

  // Attach event listeners to container
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: true });
    container.addEventListener('touchend', handleTouchEnd);
    container.addEventListener('touchcancel', handleTouchEnd);
    container.addEventListener('contextmenu', handleContextMenu);

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
      container.removeEventListener('contextmenu', handleContextMenu);

      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
      }
    };
  }, [containerRef, handleTouchStart, handleTouchMove, handleTouchEnd, handleContextMenu]);

  // Hide when clicking outside
  useEffect(() => {
    if (!visible) return;

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (menuRef.current && !menuRef.current.contains(target)) {
        hideMenu();
      }
    };

    // Delay adding listener to avoid immediate dismiss
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [visible, hideMenu]);

  // Hide on escape
  useEffect(() => {
    if (!visible) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        hideMenu();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [visible, hideMenu]);

  const handleAction = useCallback((action: () => void) => {
    action();
    hideMenu();
  }, [hideMenu]);

  // Check if there's a selection
  const hasSelection = (() => {
    if (selectionActive !== undefined) {
      return selectionActive;
    }
    const selection = window.getSelection();
    return !!(selection && !selection.isCollapsed && selection.toString().trim());
  })();

  const menuItems: ContextMenuItem[] = [
    ...(onCopySelection ? [{
      label: 'Copy Selection',
      icon: <Copy className="h-4 w-4" />,
      action: onCopySelection,
      disabled: !hasSelection,
    }] : []),
    ...(onCopyLastLines ? [{
      label: 'Copy Last 50 Lines',
      icon: <FileText className="h-4 w-4" />,
      action: () => onCopyLastLines(50),
    }] : []),
    ...(onCopyAll ? [{
      label: 'Copy All',
      icon: <Copy className="h-4 w-4" />,
      action: onCopyAll,
    }] : []),
    ...(onPaste ? [{
      label: 'Paste',
      icon: <ClipboardPaste className="h-4 w-4" />,
      action: onPaste,
      disabled: !canPaste,
    }] : []),
    ...(onClear ? [{
      label: 'Clear (Ctrl+L)',
      icon: <Trash2 className="h-4 w-4" />,
      action: onClear,
    }] : []),
  ];

  if (!visible || menuItems.length === 0) return null;

  return (
    <div
      ref={menuRef}
      className={cn(
        'fixed z-50 min-w-[180px] p-1 rounded-lg border bg-popover shadow-lg',
        'animate-in fade-in-0 zoom-in-95 duration-150',
        className
      )}
      style={{
        left: position.x,
        top: position.y,
      }}
      role="menu"
      aria-label="Context menu"
    >
      {menuItems.map((item, index) => (
        <Button
          key={index}
          variant="ghost"
          size="sm"
          className={cn(
            'w-full justify-start gap-2 h-11 px-3',
            item.disabled && 'opacity-50'
          )}
          onClick={() => handleAction(item.action)}
          disabled={item.disabled}
          role="menuitem"
        >
          {item.icon}
          <span>{item.label}</span>
        </Button>
      ))}
    </div>
  );
}
