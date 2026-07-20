'use client';

import { useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface TerminalSearchControlsProps {
  open: boolean;
  query: string;
  resultIndex: number;
  resultCount: number;
  onOpen: () => void;
  onClose: () => void;
  onQueryChange: (query: string) => void;
  onNext: () => void;
  onPrevious: () => void;
}

function getResultLabel(query: string, resultIndex: number, resultCount: number): string {
  if (!query) return 'Find in buffer';
  if (resultCount === 0) return 'No matches';
  if (resultIndex < 0) return `${resultCount} matches`;
  return `${resultIndex + 1} / ${resultCount}`;
}

function SearchInput({
  query,
  resultIndex,
  resultCount,
  onQueryChange,
  onNext,
  onPrevious,
  onClose,
  mobile,
}: Omit<TerminalSearchControlsProps, 'open' | 'onOpen'> & { mobile?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className={mobile ? 'space-y-3' : 'flex min-w-0 items-center gap-1'}>
      <div className={mobile ? 'flex items-center gap-2' : 'flex min-w-0 items-center gap-1'}>
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            } else if (event.key === 'Enter') {
              event.preventDefault();
              if (event.shiftKey) onPrevious();
              else onNext();
            }
          }}
          placeholder="Search scrollback"
          aria-label="Search terminal scrollback"
          className={mobile
            ? 'h-11 min-w-0 flex-1 rounded-md border bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring'
            : 'h-8 w-44 min-w-24 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring'
          }
        />
      </div>

      <div className={mobile ? 'flex items-center gap-2' : 'contents'}>
        <span
          className="min-w-16 text-center text-xs tabular-nums text-muted-foreground"
          aria-live="polite"
        >
          {getResultLabel(query, resultIndex, resultCount)}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            size={mobile ? 'mobile-icon' : 'icon'}
            variant="ghost"
            onClick={onPrevious}
            disabled={!query}
            className={mobile ? undefined : 'h-8 w-8'}
            aria-label="Previous terminal search match"
          >
            <ChevronUp className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size={mobile ? 'mobile-icon' : 'icon'}
            variant="ghost"
            onClick={onNext}
            disabled={!query}
            className={mobile ? undefined : 'h-8 w-8'}
            aria-label="Next terminal search match"
          >
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size={mobile ? 'mobile-icon' : 'icon'}
            variant="ghost"
            onClick={onClose}
            className={mobile ? undefined : 'h-8 w-8'}
            aria-label="Close terminal search"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function TerminalSearchInline(props: TerminalSearchControlsProps) {
  if (!props.open) return null;
  return <SearchInput {...props} />;
}

export function TerminalSearchSheet(props: TerminalSearchControlsProps) {
  if (!props.open) return null;

  return (
    <section
      className="fixed inset-x-0 bottom-0 z-[70] rounded-t-xl border bg-background p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl md:hidden"
      role="dialog"
      aria-modal="false"
      aria-label="Search terminal scrollback"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Search terminal</h2>
        <span className="text-xs text-muted-foreground">10,000-line buffer</span>
      </div>
      <SearchInput {...props} mobile />
    </section>
  );
}
