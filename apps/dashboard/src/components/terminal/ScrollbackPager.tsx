'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Clipboard, History, Loader2, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getSessionScrollback } from '@/lib/api';
import { useNotifications } from '@/stores/notifications';
import {
  SCROLLBACK_PAGE_LINES,
  advanceScrollbackSelection,
  initialScrollbackRange,
  numberScrollbackLines,
  olderScrollbackRange,
  selectedScrollbackLines,
  type ScrollbackLineSelection,
  type ScrollbackRange,
} from './scrollbackPaging';

interface ScrollbackPagerProps {
  sessionId: string;
  open: boolean;
  onClose: () => void;
}

interface HistoryPage {
  range: ScrollbackRange;
  lines: string[];
}

const LINE_HEIGHT = 32;
const OVERSCAN = 12;
const VIEWPORT_LINE_ESTIMATE = 30;

function contentLines(content: unknown): string[] {
  if (typeof content !== 'string' || content.length === 0) return [];
  const lines = content.split('\n');
  if (content.endsWith('\n')) lines.pop();
  return lines;
}

export function ScrollbackPager({ sessionId, open, onClose }: ScrollbackPagerProps) {
  const [pages, setPages] = useState<HistoryPage[]>([]);
  const [filter, setFilter] = useState('');
  const [loadingInitial, setLoadingInitial] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [copied, setCopied] = useState(false);
  const [copiedSelection, setCopiedSelection] = useState(false);
  const [lineSelection, setLineSelection] = useState<ScrollbackLineSelection | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const generationRef = useRef(0);
  const notifications = useNotifications();

  const fetchPage = useCallback(
    async (range: ScrollbackRange): Promise<HistoryPage> => {
      const response = await getSessionScrollback(sessionId, {
        mode: 'range',
        start_line: range.startLine,
        end_line: range.endLine,
        strip_ansi: true,
      });
      if (!response.ok) {
        throw new Error(response.error?.message || 'Scrollback capture failed.');
      }
      return {
        range,
        lines: contentLines(response.result?.content),
      };
    },
    [sessionId]
  );

  const loadInitial = useCallback(async () => {
    const generation = ++generationRef.current;
    setLoadingInitial(true);
    setError(null);
    setPages([]);
    setHasOlder(true);
    setScrollTop(0);
    setLineSelection(null);
    try {
      const page = await fetchPage(initialScrollbackRange());
      if (generationRef.current !== generation) return;
      setPages([page]);
      setHasOlder(page.lines.length >= SCROLLBACK_PAGE_LINES);
      requestAnimationFrame(() => {
        const element = scrollRef.current;
        if (element) element.scrollTop = element.scrollHeight;
      });
    } catch (loadError) {
      if (generationRef.current !== generation) return;
      setError(
        loadError instanceof Error ? loadError.message : 'Terminal history could not be loaded.'
      );
    } finally {
      if (generationRef.current === generation) setLoadingInitial(false);
    }
  }, [fetchPage]);

  useEffect(() => {
    if (!open) {
      generationRef.current += 1;
      return;
    }
    setFilter('');
    setCopied(false);
    setCopiedSelection(false);
    setLineSelection(null);
    void loadInitial();
  }, [loadInitial, open]);

  const loadOlder = async () => {
    if (loadingOlder || !hasOlder) return;
    const currentOldest = pages[0]?.range ?? initialScrollbackRange();
    const range = olderScrollbackRange(currentOldest);
    const element = scrollRef.current;
    const previousHeight = element?.scrollHeight ?? 0;
    setLoadingOlder(true);
    setError(null);
    try {
      const page = await fetchPage(range);
      setPages((current) => [page, ...current]);
      setHasOlder(page.lines.length >= SCROLLBACK_PAGE_LINES);
      requestAnimationFrame(() => {
        if (element) element.scrollTop += element.scrollHeight - previousHeight;
      });
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : 'Older history could not be loaded.'
      );
    } finally {
      setLoadingOlder(false);
    }
  };

  const allLines = useMemo(
    () => pages.flatMap((page) => numberScrollbackLines(page.range, page.lines)),
    [pages]
  );
  const filteredLines = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return allLines
      .filter((line) => !query || line.text.toLowerCase().includes(query));
  }, [allLines, filter]);
  const selectedLines = useMemo(
    () => selectedScrollbackLines(allLines, lineSelection),
    [allLines, lineSelection]
  );
  const selectedLineNumbers = useMemo(
    () => new Set(selectedLines.map((line) => line.lineNumber)),
    [selectedLines]
  );
  const startIndex = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(
    filteredLines.length,
    startIndex + VIEWPORT_LINE_ESTIMATE + OVERSCAN * 2
  );
  const visibleLines = filteredLines.slice(startIndex, endIndex);

  const changeFilter = (value: string) => {
    setFilter(value);
    setLineSelection(null);
    setCopiedSelection(false);
    setScrollTop(0);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };

  const copyHistory = async () => {
    try {
      await navigator.clipboard.writeText(filteredLines.map((line) => line.text).join('\n'));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (copyError) {
      notifications.error(
        'Could not copy terminal history',
        copyError instanceof Error ? copyError.message : 'Clipboard access was denied.',
        { sessionId }
      );
    }
  };

  const copySelectedLines = async () => {
    try {
      await navigator.clipboard.writeText(selectedLines.map((line) => line.text).join('\n'));
      setCopiedSelection(true);
    } catch (copyError) {
      notifications.error(
        'Could not copy selected history lines',
        copyError instanceof Error ? copyError.message : 'Clipboard access was denied.',
        { sessionId }
      );
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed inset-0 z-[81] flex flex-col border bg-background shadow-2xl outline-none sm:inset-6 sm:rounded-xl lg:inset-auto lg:left-1/2 lg:top-1/2 lg:h-[82dvh] lg:max-h-[900px] lg:w-[min(1100px,calc(100vw-4rem))] lg:-translate-x-1/2 lg:-translate-y-1/2"
          data-testid="scrollback-pager"
        >
          <div className="flex shrink-0 items-start gap-3 border-b px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <History className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <Dialog.Title className="font-semibold">Terminal history</Dialog.Title>
              <Dialog.Description className="text-xs text-muted-foreground">
                Older tmux scrollback is paged separately from the live terminal buffer.
              </Dialog.Description>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 w-9 p-0"
              onClick={onClose}
              aria-label="Close terminal history"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
            <label className="relative min-w-48 flex-1">
              <span className="sr-only">Filter terminal history</span>
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={filter}
                onChange={(event) => changeFilter(event.target.value)}
                placeholder="Filter captured history…"
                className="h-9 pl-8"
              />
            </label>
            <span className="text-xs text-muted-foreground" aria-live="polite">
              {filteredLines.length.toLocaleString()} {filter ? 'matches' : 'lines'}
            </span>
            {lineSelection && (
              <Button
                type="button"
                variant="default"
                size="sm"
                className="h-9 gap-1.5"
                onClick={() => void copySelectedLines()}
                disabled={selectedLines.length === 0}
              >
                <Clipboard className="h-4 w-4" aria-hidden="true" />
                {copiedSelection ? 'Selected lines copied' : 'Copy selected lines'}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 gap-1.5"
              onClick={() => void copyHistory()}
              disabled={filteredLines.length === 0}
            >
              <Clipboard className="h-4 w-4" aria-hidden="true" />
              {copied ? 'Copied' : filter ? 'Copy matches' : 'Copy all'}
            </Button>
          </div>

          {lineSelection && (
            <div
              className="shrink-0 border-b bg-sky-500/10 px-4 py-1.5 text-xs text-sky-700 dark:text-sky-300"
              aria-live="polite"
            >
              {lineSelection.awaitingExtent
                ? `Line ${lineSelection.anchorLine} anchored · tap another line to extend`
                : `${selectedLines.length} lines selected · tap a line to start a new range`}
            </div>
          )}

          {error && (
            <div
              className="flex shrink-0 items-center justify-between gap-3 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive"
              role="alert"
            >
              <span>{error}</span>
              {pages.length === 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void loadInitial()}
                >
                  Retry
                </Button>
              )}
            </div>
          )}

          <div
            ref={scrollRef}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            className="min-h-0 flex-1 overflow-auto bg-[#0a0a0a] text-[#f2f2f2] selection:bg-sky-600/70"
            tabIndex={0}
            aria-label="Captured terminal history"
          >
            <div className="sticky top-0 z-10 flex min-h-11 items-center justify-center border-b border-white/10 bg-[#0a0a0a]/95 px-3 backdrop-blur">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => void loadOlder()}
                disabled={loadingInitial || loadingOlder || !hasOlder}
              >
                {loadingOlder && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                )}
                {loadingOlder ? 'Loading older…' : hasOlder ? 'Load older' : 'Start of history'}
              </Button>
            </div>

            {loadingInitial ? (
              <div
                className="flex h-full min-h-48 items-center justify-center gap-2 text-sm text-white/60"
                role="status"
              >
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading terminal history…
              </div>
            ) : filteredLines.length === 0 ? (
              <div className="flex h-full min-h-48 items-center justify-center px-4 text-center text-sm text-white/60">
                {allLines.length === 0
                  ? 'No older history was captured.'
                  : 'No history lines match this filter.'}
              </div>
            ) : (
              <div
                className="relative min-w-full font-mono text-xs"
                style={{ height: `${filteredLines.length * LINE_HEIGHT}px` }}
              >
                {visibleLines.map((line, offset) => {
                  const virtualIndex = startIndex + offset;
                  return (
                    <button
                      key={line.lineNumber}
                      type="button"
                      className={`absolute left-0 grid min-w-full grid-cols-[4.5rem_minmax(max-content,1fr)] items-center whitespace-pre text-left leading-8 outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400 ${
                        selectedLineNumbers.has(line.lineNumber)
                          ? 'bg-sky-600/35'
                          : 'hover:bg-white/5'
                      }`}
                      style={{ top: `${virtualIndex * LINE_HEIGHT}px`, height: `${LINE_HEIGHT}px` }}
                      onClick={() => {
                        setCopiedSelection(false);
                        setLineSelection((current) =>
                          advanceScrollbackSelection(current, line.lineNumber)
                        );
                      }}
                      aria-pressed={selectedLineNumbers.has(line.lineNumber)}
                      aria-label={`Select history line ${line.lineNumber}`}
                    >
                      <span
                        className="select-none border-r border-white/10 px-2 text-right text-white/40"
                        aria-hidden="true"
                      >
                        {line.lineNumber}
                      </span>
                      <span className="px-3">{line.text || ' '}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
