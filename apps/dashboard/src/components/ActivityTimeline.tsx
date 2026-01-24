'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  Wrench,
  BookOpen,
  Terminal,
  FileEdit,
  FilePlus,
  Search,
  Globe,
  FileCode,
  FolderSearch,
  MessageSquare,
  ClipboardList,
  HelpCircle,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn, formatRelativeTime } from '@/lib/utils';
import { getToolEvents, type ToolEvent } from '@/lib/api';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useHydrated } from '@/hooks/useHydrated';
import type { ServerToUIMessage } from '@agent-command/schema';

/**
 * Map tool names to icons and human-readable labels
 */
const TOOL_ICONS: Record<string, { icon: typeof Wrench; label: string }> = {
  Read: { icon: BookOpen, label: 'Reading file' },
  Write: { icon: FilePlus, label: 'Writing file' },
  Edit: { icon: FileEdit, label: 'Editing file' },
  Bash: { icon: Terminal, label: 'Running command' },
  Grep: { icon: Search, label: 'Searching' },
  Glob: { icon: FolderSearch, label: 'Finding files' },
  WebFetch: { icon: Globe, label: 'Fetching URL' },
  WebSearch: { icon: Globe, label: 'Web search' },
  Task: { icon: ClipboardList, label: 'Running task' },
  TodoWrite: { icon: ClipboardList, label: 'Updating todos' },
  AskUserQuestion: { icon: HelpCircle, label: 'Asking question' },
  NotebookEdit: { icon: FileCode, label: 'Editing notebook' },
  EnterPlanMode: { icon: ClipboardList, label: 'Planning' },
  ExitPlanMode: { icon: CheckCircle, label: 'Exiting plan mode' },
};

/**
 * Get icon and label for a tool
 */
function getToolConfig(toolName: string): { icon: typeof Wrench; label: string } {
  return TOOL_ICONS[toolName] || { icon: Wrench, label: toolName };
}

/**
 * Get a short preview of tool input
 */
function getInputPreview(toolName: string, input: Record<string, unknown> | undefined): string | null {
  if (!input) return null;

  switch (toolName) {
    case 'Read':
    case 'Write':
    case 'Edit':
      if (typeof input.file_path === 'string') {
        // Show just the filename, not full path
        const parts = input.file_path.split('/');
        return parts[parts.length - 1] || input.file_path;
      }
      break;
    case 'Bash':
      if (typeof input.command === 'string') {
        // Truncate long commands
        const cmd = input.command;
        return cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd;
      }
      break;
    case 'Grep':
      if (typeof input.pattern === 'string') {
        return `/${input.pattern}/`;
      }
      break;
    case 'Glob':
      if (typeof input.pattern === 'string') {
        return input.pattern;
      }
      break;
    case 'WebFetch':
    case 'WebSearch':
      if (typeof input.url === 'string') {
        try {
          const url = new URL(input.url);
          return url.hostname;
        } catch {
          return input.url.slice(0, 40);
        }
      }
      if (typeof input.query === 'string') {
        return input.query.length > 50 ? input.query.slice(0, 47) + '...' : input.query;
      }
      break;
  }

  return null;
}

interface ActivityTimelineProps {
  sessionId: string;
  className?: string;
  maxItems?: number;
  showLoadMore?: boolean;
}

export function ActivityTimeline({
  sessionId,
  className,
  maxItems = 20,
  showLoadMore = true,
}: ActivityTimelineProps) {
  const [events, setEvents] = useState<ToolEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Initial fetch
  useEffect(() => {
    let cancelled = false;

    async function fetchEvents() {
      try {
        setLoading(true);
        setError(null);
        const result = await getToolEvents(sessionId, undefined, maxItems);
        if (!cancelled) {
          setEvents(result.events);
          setNextCursor(result.next_cursor);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load events');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchEvents();

    return () => {
      cancelled = true;
    };
  }, [sessionId, maxItems]);

  // Handle WebSocket messages for real-time updates
  const handleMessage = useCallback(
    (message: ServerToUIMessage) => {
      if (
        message.type === 'tool_event.started' ||
        message.type === 'tool_event.completed'
      ) {
        const payload = message.payload as { session_id: string; event: ToolEvent };
        if (payload.session_id !== sessionId) return;

        setEvents((prev) => {
          // For completed events, update the existing event
          if (message.type === 'tool_event.completed') {
            return prev.map((e) => (e.id === payload.event.id ? payload.event : e));
          }

          // For started events, prepend to the list
          const exists = prev.some((e) => e.id === payload.event.id);
          if (exists) return prev;

          return [payload.event, ...prev].slice(0, maxItems);
        });
      }
    },
    [sessionId, maxItems]
  );

  // Subscribe to tool events
  const topics = useMemo(
    () => [{ type: 'tool_events', filter: { session_id: sessionId } }],
    [sessionId]
  );
  useWebSocket(topics, handleMessage);

  // Load more events
  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;

    setLoadingMore(true);
    try {
      const result = await getToolEvents(sessionId, nextCursor, maxItems);
      setEvents((prev) => [...prev, ...result.events]);
      setNextCursor(result.next_cursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more');
    } finally {
      setLoadingMore(false);
    }
  };

  // Toggle event expansion
  const toggleExpanded = (eventId: string) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Wrench className="h-4 w-4" />
            Activity Timeline
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Wrench className="h-4 w-4" />
            Activity Timeline
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (events.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Wrench className="h-4 w-4" />
            Activity Timeline
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            No tool activity yet
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Wrench className="h-4 w-4" />
          Activity Timeline
          <span className="text-xs text-muted-foreground font-normal">
            ({events.length} events)
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border">
          {events.map((event) => (
            <ActivityTimelineItem
              key={event.id}
              event={event}
              expanded={expandedEvents.has(event.id)}
              onToggle={() => toggleExpanded(event.id)}
            />
          ))}
        </div>

        {showLoadMore && nextCursor && (
          <div className="p-4 border-t">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={loadMore}
              disabled={loadingMore}
            >
              {loadingMore ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Loading...
                </>
              ) : (
                'Load more'
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface ActivityTimelineItemProps {
  event: ToolEvent;
  expanded: boolean;
  onToggle: () => void;
}

/**
 * Render tool output - uses markdown for string content, JSON for objects
 */
function ToolOutput({ output }: { output: Record<string, unknown> }) {
  // Check for string content that could be rendered as markdown
  const text =
    typeof output?.content === 'string'
      ? output.content
      : typeof output?.message === 'string'
        ? output.message
        : typeof output?.text === 'string'
          ? output.text
          : null;

  if (!text) {
    return (
      <pre className="p-2 bg-muted rounded-md text-xs overflow-auto max-h-40">
        {JSON.stringify(output, null, 2)}
      </pre>
    );
  }

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none text-xs [&>*]:my-1 [&_pre]:p-2 [&_pre]:bg-muted [&_pre]:overflow-auto [&_pre]:max-h-32 [&_code]:text-xs [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

function ActivityTimelineItem({ event, expanded, onToggle }: ActivityTimelineItemProps) {
  const isRunning = !event.completed_at;
  const hasDetails = event.tool_input || event.tool_output;
  const toolConfig = getToolConfig(event.tool_name);
  const ToolIcon = toolConfig.icon;
  const inputPreview = getInputPreview(event.tool_name, event.tool_input);
  const hydrated = useHydrated();

  // Format duration nicely
  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div className="px-4 py-3">
      <div
        className={cn(
          'flex items-start gap-3',
          hasDetails && 'cursor-pointer'
        )}
        onClick={hasDetails ? onToggle : undefined}
      >
        {/* Status/Tool icon */}
        <div className="mt-0.5 flex items-center justify-center w-5 h-5">
          {isRunning ? (
            <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
          ) : event.success ? (
            <ToolIcon className="h-4 w-4 text-green-500" />
          ) : (
            <XCircle className="h-4 w-4 text-red-500" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">
              {isRunning ? (
                <span className="inline-flex items-center gap-1">
                  {toolConfig.label}
                  <span className="animate-pulse">...</span>
                </span>
              ) : (
                event.tool_name
              )}
            </span>
            {inputPreview && (
              <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded truncate max-w-[200px]">
                {inputPreview}
              </code>
            )}
            {event.duration_ms !== undefined && !isRunning && (
              <span className="text-xs text-muted-foreground px-1.5 py-0.5 bg-muted rounded">
                {formatDuration(event.duration_ms)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
            <Clock className="h-3 w-3" />
            <span suppressHydrationWarning>
              {hydrated ? formatRelativeTime(event.started_at) : '—'}
            </span>
            {isRunning && (
              <span className="text-blue-500 font-medium animate-pulse">Running</span>
            )}
          </div>
        </div>

        {/* Expand/collapse toggle */}
        {hasDetails && (
          <button className="text-muted-foreground hover:text-foreground shrink-0">
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        )}
      </div>

      {/* Expanded details */}
      {expanded && hasDetails && (
        <div className="mt-3 ml-8 space-y-3">
          {event.tool_input && Object.keys(event.tool_input).length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Input:</p>
              <pre className="p-2 bg-muted rounded-md text-xs overflow-auto max-h-32">
                {JSON.stringify(event.tool_input, null, 2)}
              </pre>
            </div>
          )}

          {event.tool_output && Object.keys(event.tool_output).length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Output:</p>
              <ToolOutput output={event.tool_output} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
