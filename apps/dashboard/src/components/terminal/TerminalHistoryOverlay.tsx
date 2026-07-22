'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, Loader2, RotateCcw } from 'lucide-react';
import type { TranscriptEntry } from '@agent-command/schema';
import { Button } from '@/components/ui/button';
import { getSessionScrollback, getSessionTranscript } from '@/lib/api';
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
import { formatTranscriptEntries } from './transcriptFormatter';

interface TerminalHistoryOverlayProps {
  sessionId: string;
  open: boolean;
  fontSize: number;
  preferChat?: boolean;
  refreshToken?: number;
  onScrollModeResolved: (mode: TerminalScrollMode) => void;
  onClose: () => void;
}

interface HistoryPage {
  type: 'history';
  range: ScrollbackRange;
  lines: string[];
}

export interface ChatPage {
  type: 'chat';
  entries: TranscriptEntry[];
  firstEntry: number;
  totalEntries: number;
}

const OVERSCAN_LINES = 12;
const TRANSCRIPT_PAGE_ENTRIES = 200;

type OverlayPage = HistoryPage | ChatPage;

export function mergeLatestChatPage(pages: OverlayPage[], latest: ChatPage): OverlayPage[] {
  const preserved = pages.flatMap((page): OverlayPage[] => {
    if (page.type !== 'chat') return [page];
    const keepCount = Math.max(0, Math.min(page.entries.length, latest.firstEntry - page.firstEntry));
    if (keepCount === 0) return [];
    return [{
      ...page,
      entries: page.entries.slice(0, keepCount),
      totalEntries: latest.totalEntries,
    }];
  });
  return [...preserved, latest];
}

interface OverlayLine {
  key: string;
  text: string;
  dim: boolean;
}

export function TerminalHistoryOverlay({
  sessionId,
  open,
  fontSize,
  preferChat = false,
  refreshToken = 0,
  onScrollModeResolved,
  onClose,
}: TerminalHistoryOverlayProps) {
  const [pages, setPages] = useState<OverlayPage[]>([]);
  const [mode, setMode] = useState<'history' | 'chat' | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unreadEntries, setUnreadEntries] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const generationRef = useRef(0);
  const loadingOlderRef = useRef(false);
  const overscrollStartRef = useRef<{ y: number; atBottom: boolean } | null>(null);
  const lastRefreshTokenRef = useRef(refreshToken);
  const followLatestRef = useRef(true);
  const lineHeight = Math.max(16, Math.round(fontSize * 1.2));

  const fetchHistoryPage = useCallback(
    async (range: ScrollbackRange): Promise<{ page: HistoryPage; scrollMode: TerminalScrollMode }> => {
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
        page: {
          type: 'history',
          range,
          lines: contentScrollbackLines(content),
        },
        scrollMode: classifyTerminalScrollMode(content),
      };
    },
    [sessionId]
  );

  const fetchChatPage = useCallback(
    async (beforeEntry?: number): Promise<ChatPage> => {
      const response = await getSessionTranscript(sessionId, {
        page_size: TRANSCRIPT_PAGE_ENTRIES,
        ...(beforeEntry !== undefined ? { before_entry: beforeEntry } : {}),
      });
      if (!response.ok) {
        throw new Error(response.error.message);
      }
      return {
        type: 'chat',
        entries: response.result.entries,
        firstEntry: response.result.first_entry,
        totalEntries: response.result.total_entries,
      };
    },
    [sessionId]
  );

  const loadInitial = useCallback(async () => {
    const generation = ++generationRef.current;
    setLoadingInitial(true);
    setError(null);
    setPages([]);
    setMode(null);
    setHasOlder(true);
    setUnreadEntries(0);
    followLatestRef.current = true;
    setScrollTop(0);
    const showChat = (chatPage: ChatPage) => {
      followLatestRef.current = true;
      setMode('chat');
      setPages([chatPage]);
      setHasOlder(chatPage.firstEntry > 0);
      onScrollModeResolved('chat');
      requestAnimationFrame(() => {
        const element = scrollRef.current;
        if (!element || generationRef.current !== generation) return;
        element.scrollTop = element.scrollHeight;
        setScrollTop(element.scrollTop);
        setViewportHeight(element.clientHeight);
        setViewportWidth(element.clientWidth);
      });
    };
    try {
      let chatAttempted = false;
      if (preferChat) {
        chatAttempted = true;
        try {
          const chatPage = await fetchChatPage();
          if (generationRef.current !== generation) return;
          showChat(chatPage);
          return;
        } catch (chatError) {
          if (generationRef.current !== generation) return;
          setMode('chat');
          setHasOlder(false);
          onScrollModeResolved('chat');
          setError(
            chatError instanceof Error
              ? `Claude chat is unavailable: ${chatError.message}`
              : 'Claude chat is unavailable.'
          );
          return;
        }
      }
      const { page, scrollMode } = await fetchHistoryPage(initialScrollbackRange());
      if (generationRef.current !== generation) return;
      if (scrollMode === 'app-scroll') {
        if (chatAttempted) {
          onScrollModeResolved('app-scroll');
          onClose();
          return;
        }
        try {
          const chatPage = await fetchChatPage();
          if (generationRef.current !== generation) return;
          showChat(chatPage);
        } catch {
          if (generationRef.current !== generation) return;
          onScrollModeResolved('app-scroll');
          onClose();
        }
        return;
      }
      setMode('history');
      setPages([page]);
      setHasOlder(page.lines.length >= SCROLLBACK_PAGE_LINES);
      onScrollModeResolved('history');
      requestAnimationFrame(() => {
        const element = scrollRef.current;
        if (!element || generationRef.current !== generation) return;
        element.scrollTop = element.scrollHeight;
        setScrollTop(element.scrollTop);
        setViewportHeight(element.clientHeight);
        setViewportWidth(element.clientWidth);
      });
    } catch (loadError) {
      if (generationRef.current !== generation) return;
      setError(
        loadError instanceof Error ? loadError.message : 'Terminal history could not be loaded.'
      );
    } finally {
      if (generationRef.current === generation) setLoadingInitial(false);
    }
  }, [fetchChatPage, fetchHistoryPage, onClose, onScrollModeResolved, preferChat]);

  const refreshLatestChat = useCallback(async () => {
    const generation = generationRef.current;
    const element = scrollRef.current;
    const wasFollowing = !element
      || element.scrollHeight - element.clientHeight - element.scrollTop <= lineHeight * 2;
    followLatestRef.current = wasFollowing;
    const previousTotal = pages.reduce((total, page) => (
      page.type === 'chat' ? Math.max(total, page.totalEntries) : total
    ), 0);
    try {
      const latest = await fetchChatPage();
      if (generationRef.current !== generation) return;
      const added = Math.max(0, latest.totalEntries - previousTotal);
      setPages((current) => mergeLatestChatPage(current, latest));
      setHasOlder((current) => current || latest.firstEntry > 0);
      setError(null);
      requestAnimationFrame(() => {
        if (!element || generationRef.current !== generation) return;
        if (wasFollowing) {
          element.scrollTop = element.scrollHeight;
          setScrollTop(element.scrollTop);
          setUnreadEntries(0);
        } else if (added > 0) {
          setUnreadEntries((current) => current + added);
        }
        setViewportHeight(element.clientHeight);
        setViewportWidth(element.clientWidth);
      });
    } catch (refreshError) {
      if (generationRef.current !== generation) return;
      setError(
        refreshError instanceof Error
          ? `Claude chat could not refresh: ${refreshError.message}`
          : 'Claude chat could not refresh.'
      );
    }
  }, [fetchChatPage, lineHeight, pages]);

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
    if (!open) lastRefreshTokenRef.current = refreshToken;
  }, [open, refreshToken]);

  useEffect(() => {
    if (!open || mode !== 'chat' || refreshToken === lastRefreshTokenRef.current) return;
    lastRefreshTokenRef.current = refreshToken;
    void refreshLatestChat();
  }, [mode, open, refreshLatestChat, refreshToken]);

  useEffect(() => {
    if (!open) return;
    const element = scrollRef.current;
    if (!element) return;
    const updateViewport = () => {
      setViewportHeight(element.clientHeight);
      setViewportWidth(element.clientWidth);
    };
    updateViewport();
    const observer = new ResizeObserver(updateViewport);
    observer.observe(element);
    return () => observer.disconnect();
  }, [open]);

  const loadOlder = useCallback(async () => {
    if (loadingOlderRef.current || !hasOlder || mode === null) return;
    const generation = generationRef.current;
    const element = scrollRef.current;
    const previousHeight = element?.scrollHeight ?? 0;
    followLatestRef.current = false;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    setError(null);
    try {
      let page: OverlayPage;
      let olderAvailable: boolean;
      if (mode === 'chat') {
        const currentOldest = pages[0]?.type === 'chat' ? pages[0].firstEntry : 0;
        page = await fetchChatPage(currentOldest);
        olderAvailable = page.firstEntry > 0;
      } else {
        const currentOldest = pages[0]?.type === 'history'
          ? pages[0].range
          : initialScrollbackRange();
        const range = olderScrollbackRange(currentOldest);
        const historyPage = await fetchHistoryPage(range);
        page = historyPage.page;
        olderAvailable = page.lines.length >= SCROLLBACK_PAGE_LINES;
      }
      if (generationRef.current !== generation) return;
      setPages((current) => [page, ...current]);
      setHasOlder(olderAvailable);
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
        loadError instanceof Error
          ? loadError.message
          : mode === 'chat'
            ? 'Older chat could not be loaded.'
            : 'Older history could not be loaded.'
      );
    } finally {
      if (generationRef.current === generation) {
        loadingOlderRef.current = false;
        setLoadingOlder(false);
      }
    }
  }, [fetchChatPage, fetchHistoryPage, hasOlder, mode, pages]);

  const transcriptColumns = Math.max(
    20,
    Math.floor((viewportWidth || 320) / Math.max(1, fontSize * 0.62)) - 2
  );
  const allLines = useMemo<OverlayLine[]>(
    () => pages.flatMap((page) => {
      if (page.type === 'history') {
        return numberScrollbackLines(page.range, page.lines).map((line) => ({
          key: `history:${line.lineNumber}`,
          text: line.text,
          dim: false,
        }));
      }
      return page.entries.flatMap((entry, entryOffset) => (
        formatTranscriptEntries([entry], transcriptColumns).map((line, lineOffset) => ({
          key: `chat:${page.firstEntry + entryOffset}:${lineOffset}`,
          text: line.text,
          dim: line.dim,
        }))
      ));
    }),
    [pages, transcriptColumns]
  );
  const virtualWindow = resolveScrollbackVirtualWindow({
    lineCount: allLines.length,
    scrollTop,
    viewportHeight,
    lineHeight,
    overscan: OVERSCAN_LINES,
  });
  const visibleLines = allLines.slice(virtualWindow.startIndex, virtualWindow.endIndex);

  useEffect(() => {
    if (!open || mode !== 'chat' || !followLatestRef.current) return;
    const frame = requestAnimationFrame(() => {
      const element = scrollRef.current;
      if (!element || !followLatestRef.current) return;
      element.scrollTop = element.scrollHeight;
      setScrollTop(element.scrollTop);
      setViewportHeight(element.clientHeight);
      setViewportWidth(element.clientWidth);
    });
    return () => cancelAnimationFrame(frame);
  }, [allLines.length, mode, open]);

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
          {loadingOlder
            ? 'Loading older…'
            : hasOlder
              ? mode === 'chat' ? 'Chat' : 'History'
              : mode === 'chat' ? 'Start of chat' : 'Start of history'}
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          {unreadEntries > 0 && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-8 rounded-full border border-sky-300/30 bg-sky-950 px-3 text-sky-100 hover:bg-sky-900"
              onClick={() => {
                const element = scrollRef.current;
                if (!element) return;
                followLatestRef.current = true;
                element.scrollTop = element.scrollHeight;
                setScrollTop(element.scrollTop);
                setUnreadEntries(0);
              }}
            >
              {unreadEntries} new
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-8 gap-1.5 rounded-full border border-white/15 bg-zinc-100 px-3 text-zinc-950 shadow-lg hover:bg-white focus-visible:ring-2 focus-visible:ring-sky-400"
            onClick={onClose}
            aria-label={preferChat ? 'Terminal' : 'Live terminal'}
          >
            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
            {preferChat ? 'Terminal' : 'Live'}
          </Button>
        </div>
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
          followLatestRef.current = element.scrollHeight
            - element.clientHeight
            - element.scrollTop <= lineHeight * 2;
          setScrollTop(element.scrollTop);
          setViewportHeight(element.clientHeight);
          setViewportWidth(element.clientWidth);
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
            {preferChat ? 'Loading Claude chat…' : 'Loading terminal history…'}
          </div>
        ) : allLines.length === 0 ? (
          <div className="flex h-full min-h-48 items-center justify-center px-4 text-center text-sm text-white/60">
            {mode === 'chat' ? 'No chat messages were captured.' : 'No terminal history was captured.'}
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
                  key={line.key}
                  className={`absolute left-0 min-w-full whitespace-pre px-1.5 ${line.dim ? 'text-white/50' : ''}`}
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
