'use client';

import { useState, useEffect } from 'react';
import { X, Keyboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';

interface ShortcutItem {
  key: string;
  description: string;
  modifiers?: string[];
}

interface ShortcutGroup {
  name: string;
  shortcuts: ShortcutItem[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    name: 'Search & UI',
    shortcuts: [
      { key: '/', description: 'Open search' },
      { key: 'k', description: 'Open command palette', modifiers: ['Cmd/Ctrl'] },
      { key: '?', description: 'Show this help', modifiers: ['Shift'] },
      { key: 'Escape', description: 'Close modal / unfocus' },
    ],
  },
  {
    name: 'Status Filters',
    shortcuts: [
      { key: '!', description: 'Filter: Running sessions', modifiers: ['Shift'] },
      { key: '@', description: 'Filter: Waiting sessions', modifiers: ['Shift'] },
      { key: '#', description: 'Filter: Idle sessions', modifiers: ['Shift'] },
      { key: '$', description: 'Filter: Error sessions', modifiers: ['Shift'] },
    ],
  },
  {
    name: 'Bulk & Drag',
    shortcuts: [
      { key: 's', description: 'Toggle selection mode' },
      { key: 'a', description: 'Select/deselect all (in selection mode)' },
      { key: 'd', description: 'Toggle drag-and-drop mode' },
      { key: 'Escape', description: 'Exit selection/drag mode' },
    ],
  },
  {
    name: 'Session Tools',
    shortcuts: [
      { key: 'i', description: 'Import orphan panes' },
    ],
  },
];

interface ShortcutsHelpProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ShortcutsHelp({ isOpen, onClose }: ShortcutsHelpProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border rounded-lg shadow-lg w-full max-w-lg max-h-[80vh] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            <Keyboard className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Keyboard Shortcuts</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-accent rounded">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-4 space-y-6">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.name}>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">
                {group.name}
              </h3>
              <div className="space-y-1">
                {group.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.key + shortcut.description}
                    className="flex items-center justify-between py-1"
                  >
                    <span className="text-sm">{shortcut.description}</span>
                    <div className="flex gap-1">
                      {shortcut.modifiers?.map((mod) => (
                        <kbd
                          key={mod}
                          className="px-2 py-0.5 text-xs bg-muted rounded border"
                        >
                          {mod}
                        </kbd>
                      ))}
                      <kbd className="px-2 py-0.5 text-xs bg-muted rounded border min-w-[24px] text-center">
                        {shortcut.key}
                      </kbd>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="px-4 py-3 border-t bg-muted/50">
          <p className="text-xs text-muted-foreground">
            Press <kbd className="px-1 py-0.5 bg-muted rounded border text-xs">?</kbd> at
            any time to show this help
          </p>
        </div>
      </div>
    </div>
  );
}

// Hook to manage shortcuts help modal
export function useShortcutsHelp() {
  const [isOpen, setIsOpen] = useState(false);

  useKeyboardShortcuts(
    [
      {
        key: '?',
        shift: true,
        handler: () => setIsOpen(true),
        description: 'Show keyboard shortcuts help',
      },
      {
        key: 'Escape',
        handler: () => setIsOpen(false),
        description: 'Close help',
      },
    ],
    { scope: 'help' }
  );

  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
  };
}
