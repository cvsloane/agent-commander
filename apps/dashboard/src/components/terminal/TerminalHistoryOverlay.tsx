'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getSessionScrollback } from '@/lib/api';
import {
  SCROLLBACK_PAGE_LINES,
  compensateScrollbackPrepend,
  contentScrollbackLines,
  initialScrollbackRange,
  isNearScrollbackTop,
  numberScrollbackLines,
  olderScrollbackRange,
  resolveScrollbackVirtualWindow,
  shouldDismissHistoryOverscroll,
  type ScrollbackRange,
} from './scrollbackPaging';
import { classifyTerminalScrollMode, type TerminalScrollMode } from './terminalScrollMode';

interface TerminalHistoryOverlayProps {
  sessionId: string;
  open: boolean;
  fontSize: number;
  onScrollModeResolved: (mode: TerminalScrollMode) => void;
  onClose: () => void;
}

interface HistoryPage {
  range: ScrollbackRange;
  lines: string[];
  scrollMode: TerminalScrollMode;
}

const OVERSCAN_LINES = 12;

export function TerminalHistoryOverlay({
  sessionId,
  open,
  fontSize,
  onScrollModeResolved,
  onClose,
}: TerminalHistoryOverlayProps) {
  const [pages, setPages] = useState<HistoryPage[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const generationRef = useRef(0);
  const loadingOlderRef = useRef(false);
  const overscrollStartRef = useRef<{ y: number; atBottom: boolean } | null>(null);
  const lineHeight = Math.max(16, Math.round(fontSize * 1.2));

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
      const content = response.result?.content;
      return {
        range,
        lines: contentScrollbackLines(content),
        scrollMode: classifyTerminalScrollMode(content),
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
    try {
      const page = await fetchPage(initialScrollbackRange());
      onScrollModeResolved(page.scrollMode);
      if (generationRef.current !== generation) return;
      if (page.scrollMode === 'app-scroll') {
        onClose();
        return;
      }
      setPages([page]);
      setHasOlder(page.lines.length >= SCROLLBACK_PAGE_LINES);
      requestAnimationFrame(() => {
        const element = scrollRef.current;
        if (!element || generationRef.current !== generation) return;
        element.scrollTop = element.scrollHeight;
        setScrollTop(element.scrollTop);
        setViewportHeight(element.clientHeight);
      });
    } catch (loadError) {
      if (generationRef.current !== generation) return;
      setError(
        loadError instanceof Error ? loadError.message : 'Terminal history could not be loaded.'
      );
    } finally {
      if (generationRef.current === generation) setLoadingInitial(false);
    }
  }, [fetchPage, onClose, onScrollModeResolved]);

  useEffect(() => {
    if (!open) {
      generationRef.current += 1;
      loadingOlderRef.current = false;
      overscrollStartRef.current = null;
      setLoadingOlder(false);
      return;
    }
    void loadInitial();
  }, [loadInitial, open]);

  useEffect(() => {
    if (!open) return;
    const element = scrollRef.current;
    if (!element) return;
    const updateHeight = () => setViewportHeight(element.clientHeight);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, [open]);

  const loadOlder = useCallback(async () => {
    if (loadingOlderRef.current || !hasOlder) return;
    const generation = generationRef.current;
    const currentOldest = pages[0]?.range ?? initialScrollbackRange();
    const range = olderScrollbackRange(currentOldest);
    const element = scrollRef.current;
    const previousHeight = element?.scrollHeight ?? 0;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    setError(null);
    try {
      const page = await fetchPage(range);
      if (generationRef.current !== generation) return;
      setPages((current) => [page, ...current]);
      setHasOlder(page.lines.length >= SCROLLBACK_PAGE_LINES);
      requestAnimationFrame(() => {
        if (!element || generationRef.current !== generation) return;
        const nextTop = compensateScrollbackPrepend(
          element.scrollTop,
          previousHeight,
          element.scrollHeight
        );
        element.scrollTop = nextTop;
        setScrollTop(nextTop);
      });
    } catch (loadError) {
      if (generationRef.current !== generation) return;
      setError(
        loadError instanceof Error ? loadError.message : 'Older history could not be loaded.'
      );
    } finally {
      if (generationRef.current === generation) {
        loadingOlderRef.current = false;
        setLoadingOlder(false);
      }
    }
  }, [fetchPage, hasOlder, pages]);

  const allLines = useMemo(
    () => pages.flatMap((page) => numberScrollbackLines(page.range, page.lines)),
    [pages]
  );
  const virtualWindow = resolveScrollbackVirtualWindow({
    lineCount: allLines.length,
    scrollTop,
    viewportHeight,
    lineHeight,
    overscan: OVERSCAN_LINES,
  });
  const visibleLines = allLines.slice(virtualWindow.startIndex, virtualWindow.endIndex);

  if (!open) return null;

  return (
    <section
      className="absolute inset-0 z-30 flex min-h-0 flex-col overflow-hidden bg-[#0a0a0a] text-[#f2f2f2]"
      data-testid="terminal-history-overlay"
      aria-label="Terminal history overlay"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 bg-gradient-to-b from-black/80 to-transparent px-2 pb-6 pt-2">
        <div
          className="rounded-full border border-white/10 bg-black/75 px-2.5 py-1 font-sans text-[10px] font-medium text-white/65 shadow-sm backdrop-blur"
          aria-live="polite"
        >
          {loadingOlder ? 'Loading older…' : hasOlder ? 'History' : 'Start of history'}
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="pointer-events-auto h-8 gap-1.5 rounded-full border border-white/15 bg-zinc-100 px-3 text-zinc-950 shadow-lg hover:bg-white focus-visible:ring-2 focus-visible:ring-sky-400"
          onClick={onClose}
          aria-label="Live terminal"
        >
          <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
          Live
        </Button>
      </div>

      {error && (
        <div
          className="absolute inset-x-2 top-12 z-20 flex items-center justify-between gap-3 rounded border border-red-400/30 bg-red-950/95 px-3 py-2 text-xs text-red-100 shadow-lg"
          role="alert"
        >
          <span>{error}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 shrink-0 gap-1 border-red-200/30 bg-transparent px-2 text-red-50 hover:bg-red-900"
            onClick={() => void (pages.length === 0 ? loadInitial() : loadOlder())}
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            Retry
          </Button>
        </div>
      )}

      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col overflow-auto overscroll-contain bg-[#0a0a0a] selection:bg-sky-600/70"
        style={{ WebkitOverflowScrolling: 'touch', overflowAnchor: 'none' }}
        tabIndex={0}
        aria-label="Inline terminal history"
        onScroll={(event) => {
          const element = event.currentTarget;
          setScrollTop(element.scrollTop);
          setViewportHeight(element.clientHeight);
          if (isNearScrollbackTop(element.scrollTop, lineHeight)) void loadOlder();
        }}
        onTouchStart={(event) => {
          const touch = event.touches[0];
          const element = event.currentTarget;
          if (!touch) return;
          overscrollStartRef.current = {
            y: touch.clientY,
            atBottom: element.scrollHeight - element.clientHeight - element.scrollTop <= 2,
          };
        }}
        onTouchMove={(event) => {
          const start = overscrollStartRef.current;
          const touch = event.touches[0];
          if (!start || !touch) return;
          if (shouldDismissHistoryOverscroll(start.atBottom, touch.clientY - start.y)) {
            overscrollStartRef.current = null;
            onClose();
          }
        }}
        onTouchEnd={() => {
          overscrollStartRef.current = null;
        }}
        onTouchCancel={() => {
          overscrollStartRef.current = null;
        }}
      >
        {loadingInitial ? (
          <div
            className="flex h-full min-h-48 items-center justify-center gap-2 px-4 text-sm text-white/60"
            role="status"
          >
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading terminal history…
          </div>
        ) : allLines.length === 0 ? (
          <div className="flex h-full min-h-48 items-center justify-center px-4 text-center text-sm text-white/60">
            No terminal history was captured.
          </div>
        ) : (
          <div
            className="relative mt-auto min-w-full shrink-0 font-mono"
            style={{
              height: `${allLines.length * lineHeight}px`,
              fontSize: `${fontSize}px`,
              lineHeight: `${lineHeight}px`,
            }}
          >
            {visibleLines.map((line, offset) => {
              const virtualIndex = virtualWindow.startIndex + offset;
              return (
                <div
                  key={line.lineNumber}
                  className="absolute left-0 min-w-full whitespace-pre px-1.5"
                  style={{
                    top: `${virtualIndex * lineHeight}px`,
                    height: `${lineHeight}px`,
                  }}
                >
                  {line.text || ' '}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
