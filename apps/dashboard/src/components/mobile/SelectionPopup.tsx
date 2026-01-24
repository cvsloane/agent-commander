'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface SelectionPopupProps {
  /** Container element to track selections within */
  containerRef: React.RefObject<HTMLElement>;
  /** Called when copy is triggered with the selected text */
  onCopy: (text: string) => void;
  /** External selection text (e.g., terminal selection) */
  selectionText?: string;
  /** Optional anchor position when using external selection */
  anchorPosition?: { x: number; y: number };
  /** Additional class names */
  className?: string;
}

interface Position {
  x: number;
  y: number;
}

/**
 * Floating copy button that appears when text is selected.
 * Position is clamped to viewport bounds.
 */
export function SelectionPopup({
  containerRef,
  onCopy,
  selectionText,
  anchorPosition,
  className,
}: SelectionPopupProps) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [position, setPosition] = useState<Position>({ x: 0, y: 0 });
  const [selectedText, setSelectedText] = useState('');
  const popupRef = useRef<HTMLDivElement>(null);
  const usesExternalSelection = selectionText !== undefined;

  const handleSelectionChange = useCallback(() => {
    if (usesExternalSelection) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      setVisible(false);
      setSelectedText('');
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    // Check if selection is within our container
    const range = selection.getRangeAt(0);
    const commonAncestor = range.commonAncestorContainer;
    const node = commonAncestor.nodeType === Node.TEXT_NODE
      ? commonAncestor.parentElement
      : commonAncestor as Element;

    if (!node || !container.contains(node)) {
      setVisible(false);
      return;
    }

    const text = selection.toString();
    setSelectedText(text);

    // Position popup above the selection
    const rect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    // Calculate position (centered above selection)
    let x = rect.left + rect.width / 2;
    let y = rect.top - 8; // 8px above selection

    // Clamp to viewport bounds
    const popupWidth = 44; // Button width
    const popupHeight = 40; // Button height

    // Clamp X
    x = Math.max(popupWidth / 2 + 8, Math.min(x, window.innerWidth - popupWidth / 2 - 8));

    // If not enough space above, position below
    if (y < popupHeight + 8) {
      y = rect.bottom + 8;
    }

    setPosition({ x, y });
    setVisible(true);
    setCopied(false);
  }, [containerRef, usesExternalSelection]);

  // Listen for selection changes
  useEffect(() => {
    if (usesExternalSelection) return;
    document.addEventListener('selectionchange', handleSelectionChange);

    // Also listen for mouseup/touchend to catch final selection
    const handlePointerUp = () => {
      // Small delay to let selection finalize
      setTimeout(handleSelectionChange, 50);
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener('mouseup', handlePointerUp);
      container.addEventListener('touchend', handlePointerUp);
    }

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      if (container) {
        container.removeEventListener('mouseup', handlePointerUp);
        container.removeEventListener('touchend', handlePointerUp);
      }
    };
  }, [handleSelectionChange, containerRef, usesExternalSelection]);

  // External selection support (e.g., xterm)
  useEffect(() => {
    if (!usesExternalSelection) return;
    const text = selectionText || '';

    if (!text.trim()) {
      setVisible(false);
      setSelectedText('');
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    setSelectedText(text);
    setCopied(false);

    const containerRect = container.getBoundingClientRect();
    const fallback = {
      x: containerRect.left + containerRect.width / 2,
      y: containerRect.top + 16,
    };
    const anchor = anchorPosition || fallback;

    // Position popup near anchor, clamp to viewport bounds
    const popupWidth = 44;
    const popupHeight = 40;

    let x = Math.max(popupWidth / 2 + 8, Math.min(anchor.x, window.innerWidth - popupWidth / 2 - 8));
    let y = anchor.y - 8;
    if (y < popupHeight + 8) {
      y = anchor.y + 8;
    }

    setPosition({ x, y });
    setVisible(true);
  }, [selectionText, anchorPosition, containerRef, usesExternalSelection]);

  // Hide popup when clicking outside
  useEffect(() => {
    if (!visible) return;

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (popupRef.current && !popupRef.current.contains(target)) {
        // Don't hide if user is still selecting
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) {
          setVisible(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [visible]);

  const handleCopy = useCallback(() => {
    if (!selectedText) return;

    onCopy(selectedText);
    setCopied(true);

    // Haptic feedback
    if ('vibrate' in navigator) {
      navigator.vibrate(10);
    }

    // Clear selection after a short delay
    setTimeout(() => {
      if (!usesExternalSelection) {
        window.getSelection()?.removeAllRanges();
      }
      setVisible(false);
    }, 500);
  }, [selectedText, onCopy, usesExternalSelection]);

  if (!visible) return null;

  return (
    <div
      ref={popupRef}
      className={cn(
        'fixed z-50 transform -translate-x-1/2 -translate-y-full',
        'animate-in fade-in-0 zoom-in-95 duration-150',
        className
      )}
      style={{
        left: position.x,
        top: position.y,
      }}
    >
      <Button
        variant="default"
        size="sm"
        className={cn(
          'h-10 min-w-[44px] px-3 shadow-lg',
          'active:scale-95 transition-transform',
          copied && 'bg-green-600 hover:bg-green-600'
        )}
        onClick={handleCopy}
        aria-label="Copy selected text"
      >
        {copied ? (
          <Check className="h-4 w-4" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}
