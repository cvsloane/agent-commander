'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { Search, X, FileText, Activity, Terminal, Loader2 } from 'lucide-react';
import { search, type SearchResult } from '@/lib/api';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { cn } from '@/lib/utils';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (match) => {
    switch (match) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return match;
    }
  });
}

function highlightToHtml(value: string): string {
  const escaped = escapeHtml(value);
  const parts = escaped.split('**');
  return parts
    .map((part, index) => (index % 2 === 1 ? `<mark>${part}</mark>` : part))
    .join('');
}

export function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { mutate: searchMutate, isPending: isSearchPending } = useMutation({
    mutationFn: (q: string) => search(q, { limit: 20 }),
    onSuccess: (data) => {
      setResults(data.results);
      setSelectedIndex(0);
    },
  });

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 0);
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Debounced search
  useEffect(() => {
    if (!isOpen) return;
    if (!query.trim()) {
      setResults((prev) => (prev.length ? [] : prev));
      return;
    }

    const timer = setTimeout(() => {
      searchMutate(query);
    }, 200);

    return () => clearTimeout(timer);
  }, [isOpen, query, searchMutate]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current && results.length > 0) {
      const selectedEl = listRef.current.children[selectedIndex] as HTMLElement;
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex, results.length]);

  const handleSelect = useCallback(
    (result: SearchResult) => {
      onClose();
      if (result.type === 'session') {
        router.push(`/sessions/${result.id}`);
      } else if (result.session_id) {
        router.push(`/sessions/${result.session_id}`);
      }
    },
    [router, onClose]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (results[selectedIndex]) {
          handleSelect(results[selectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
    }
  };

  const getResultIcon = (type: SearchResult['type']) => {
    switch (type) {
      case 'session':
        return <Terminal className="h-4 w-4 text-muted-foreground" />;
      case 'event':
        return <Activity className="h-4 w-4 text-muted-foreground" />;
      case 'snapshot':
        return <FileText className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getResultLabel = (type: SearchResult['type']) => {
    switch (type) {
      case 'session':
        return 'Session';
      case 'event':
        return 'Event';
      case 'snapshot':
        return 'Snapshot';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-xl bg-background border rounded-lg shadow-2xl overflow-hidden">
        {/* Search Input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          {isSearchPending ? (
            <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
          ) : (
            <Search className="h-4 w-4 text-muted-foreground" />
          )}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search sessions, events, snapshots..."
            className="flex-1 bg-transparent outline-none text-sm"
          />
          <button
            onClick={onClose}
            className="p-1 hover:bg-accent rounded text-muted-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          className="max-h-[50vh] overflow-y-auto"
        >
          {query && results.length === 0 && !isSearchPending && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No results found for "{query}"
            </div>
          )}

          {results.map((result, index) => (
            <div
              key={`${result.type}-${result.id}`}
              className={cn(
                'flex items-start gap-3 px-4 py-3 cursor-pointer',
                index === selectedIndex ? 'bg-accent' : 'hover:bg-accent/50'
              )}
              onClick={() => handleSelect(result)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <div className="mt-0.5">{getResultIcon(result.type)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs px-1.5 py-0.5 bg-muted rounded text-muted-foreground">
                    {getResultLabel(result.type)}
                  </span>
                  {result.title && (
                    <span className="text-sm font-medium truncate">
                      {result.title}
                    </span>
                  )}
                </div>
                <p
                  className="text-xs text-muted-foreground mt-1 line-clamp-2"
                  dangerouslySetInnerHTML={{
                    __html: highlightToHtml(result.highlight),
                  }}
                />
                {result.cwd && (
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    {result.cwd}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t bg-muted/50 flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex gap-4">
            <span>
              <kbd className="px-1 py-0.5 bg-background rounded border">↑↓</kbd> Navigate
            </span>
            <span>
              <kbd className="px-1 py-0.5 bg-background rounded border">Enter</kbd> Open
            </span>
            <span>
              <kbd className="px-1 py-0.5 bg-background rounded border">Esc</kbd> Close
            </span>
          </div>
          {results.length > 0 && (
            <span>{results.length} results</span>
          )}
        </div>
      </div>
    </div>
  );
}

// Hook to manage command palette
export function useCommandPalette() {
  const [isOpen, setIsOpen] = useState(false);

  useKeyboardShortcuts(
    [
      {
        key: 'k',
        ctrl: true,
        handler: () => setIsOpen(true),
        description: 'Open command palette',
      },
      {
        key: '/',
        handler: () => setIsOpen(true),
        description: 'Open search',
      },
    ],
    { scope: 'command-palette' }
  );

  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
  };
}
