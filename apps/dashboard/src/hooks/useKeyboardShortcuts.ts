'use client';

import { useEffect, useCallback, useRef } from 'react';

type ShortcutHandler = () => void;

interface ShortcutDefinition {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: ShortcutHandler;
  description: string;
  scope?: string;
}

interface UseKeyboardShortcutsOptions {
  enabled?: boolean;
  scope?: string;
}

// Global registry for shortcuts documentation
const shortcutRegistry: Map<string, ShortcutDefinition[]> = new Map();

export function registerShortcuts(scope: string, shortcuts: ShortcutDefinition[]) {
  shortcutRegistry.set(scope, shortcuts);
}

export function getShortcuts(): Map<string, ShortcutDefinition[]> {
  return shortcutRegistry;
}

export function useKeyboardShortcuts(
  shortcuts: ShortcutDefinition[],
  options: UseKeyboardShortcutsOptions = {}
) {
  const { enabled = true, scope = 'global' } = options;
  const handlersRef = useRef<ShortcutDefinition[]>(shortcuts);

  // Update handlers ref when shortcuts change
  useEffect(() => {
    handlersRef.current = shortcuts;
    if (scope) {
      registerShortcuts(scope, shortcuts);
    }
  }, [shortcuts, scope]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;

      // Don't trigger shortcuts when typing in inputs
      const target = event.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        // Allow Escape to work even in inputs
        if (event.key !== 'Escape') return;
      }

      for (const shortcut of handlersRef.current) {
        const keyMatches =
          event.key.toLowerCase() === shortcut.key.toLowerCase();
        const ctrlMatches = shortcut.ctrl ? event.ctrlKey || event.metaKey : true;
        const metaMatches = shortcut.meta ? event.metaKey : true;
        const shiftMatches = shortcut.shift ? event.shiftKey : !event.shiftKey;
        const altMatches = shortcut.alt ? event.altKey : !event.altKey;

        // For simple keys (single letter), ensure no modifiers unless specified
        if (
          shortcut.key.length === 1 &&
          !shortcut.ctrl &&
          !shortcut.meta &&
          !shortcut.shift &&
          !shortcut.alt
        ) {
          if (event.ctrlKey || event.metaKey || event.altKey) continue;
        }

        if (keyMatches && ctrlMatches && metaMatches && shiftMatches && altMatches) {
          event.preventDefault();
          shortcut.handler();
          return;
        }
      }
    },
    [enabled]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}

// Hook for session list navigation
export function useSessionListShortcuts(options: {
  sessions: { id: string }[];
  selectedIndex: number;
  setSelectedIndex: (fn: (prev: number) => number) => void;
  onOpen: (id: string) => void;
  onRefresh: () => void;
}) {
  const { sessions, selectedIndex, setSelectedIndex, onOpen, onRefresh } = options;

  const shortcuts: ShortcutDefinition[] = [
    {
      key: 'j',
      handler: () =>
        setSelectedIndex((i) => Math.min(i + 1, sessions.length - 1)),
      description: 'Move down',
    },
    {
      key: 'k',
      handler: () => setSelectedIndex((i) => Math.max(i - 1, 0)),
      description: 'Move up',
    },
    {
      key: 'Enter',
      handler: () => {
        if (sessions[selectedIndex]) {
          onOpen(sessions[selectedIndex].id);
        }
      },
      description: 'Open selected session',
    },
    {
      key: 'g',
      handler: () => setSelectedIndex(() => 0),
      description: 'Go to top',
    },
    {
      key: 'G',
      shift: true,
      handler: () => setSelectedIndex(() => sessions.length - 1),
      description: 'Go to bottom',
    },
    {
      key: 'r',
      handler: onRefresh,
      description: 'Refresh',
    },
  ];

  useKeyboardShortcuts(shortcuts, { scope: 'session-list' });

  return { selectedIndex };
}
