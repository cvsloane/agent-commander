'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkshopEvent } from '@/lib/workshop/types';
import { NoActivityState } from '@/components/visualizer/shared/EmptyState';

interface LCARSActivityFeedProps {
  events: WorkshopEvent[];
  maxEvents?: number;
}

export function LCARSActivityFeed({ events, maxEvents = 20 }: LCARSActivityFeedProps) {
  const displayEvents = events.slice(-maxEvents).reverse();
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const listRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (displayEvents.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex((prev) => Math.min(prev + 1, displayEvents.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(prev - 1, 0));
        break;
      case 'Home':
        e.preventDefault();
        setFocusedIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setFocusedIndex(displayEvents.length - 1);
        break;
    }
  }, [displayEvents.length]);

  useEffect(() => {
    if (displayEvents.length === 0) {
      if (focusedIndex !== -1) setFocusedIndex(-1);
      return;
    }
    if (focusedIndex >= displayEvents.length) {
      setFocusedIndex(displayEvents.length - 1);
    }
  }, [displayEvents.length, focusedIndex]);

  useEffect(() => {
    if (focusedIndex < 0 || !listRef.current) return;
    const target = listRef.current.querySelector<HTMLElement>(
      `[data-activity-id="lcars-activity-${focusedIndex}"]`
    );
    if (target) {
      target.scrollIntoView({ block: 'nearest' });
    }
  }, [focusedIndex]);

  if (displayEvents.length === 0) {
    return (
      <div className="lcars-activity-feed" role="log" aria-label="Activity log" aria-live="polite">
        <NoActivityState />
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      className="lcars-activity-feed"
      role="log"
      aria-label="Activity log"
      aria-live="polite"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onFocus={() => {
        if (focusedIndex === -1 && displayEvents.length > 0) {
          setFocusedIndex(0);
        }
      }}
      aria-activedescendant={
        focusedIndex >= 0 ? `lcars-activity-${focusedIndex}` : undefined
      }
    >
      {displayEvents.map((event, index) => (
        <div
          key={event.id}
          id={`lcars-activity-${index}`}
          data-activity-id={`lcars-activity-${index}`}
          className={`lcars-activity-item ${focusedIndex === index ? 'lcars-activity-item--focused' : ''}`}
          role="article"
          aria-label={`${getEventTitle(event)} at ${formatTime(event.timestamp)}`}
          tabIndex={-1}
        >
          <div
            className={`lcars-activity-category ${getCategoryClass(event)}`}
            aria-hidden="true"
          />
          <div className="lcars-activity-content">
            <div className="lcars-activity-tool">{getEventTitle(event)}</div>
            <div className="lcars-activity-context">{getEventContext(event)}</div>
          </div>
          <div className="lcars-activity-time" aria-label={`Time: ${formatTime(event.timestamp)}`}>
            {formatTime(event.timestamp)}
          </div>
        </div>
      ))}
    </div>
  );
}

function getCategoryClass(event: WorkshopEvent): string {
  if (event.type === 'pre_tool_use' || event.type === 'post_tool_use') {
    const tool = 'tool' in event ? event.tool : '';
    if (tool === 'Read' || tool === 'Glob' || tool === 'Grep') return 'read';
    if (tool === 'Write' || tool === 'Edit' || tool === 'NotebookEdit') return 'write';
    if (tool === 'Bash') return 'bash';
    if (tool === 'WebFetch' || tool === 'WebSearch') return 'web';
    if (tool === 'Task' || tool === 'TodoWrite') return 'search';
    return 'search';
  }
  if (event.type === 'user_prompt_submit') return 'write';
  if (event.type === 'stop' || event.type === 'subagent_stop') return 'bash';
  return 'search';
}

function getEventTitle(event: WorkshopEvent): string {
  switch (event.type) {
    case 'pre_tool_use':
      return `${event.tool} INITIATED`;
    case 'post_tool_use':
      return event.success ? `${event.tool} COMPLETE` : `${event.tool} FAILED`;
    case 'user_prompt_submit':
      return 'COMMAND RECEIVED';
    case 'stop':
      return event.stopHookActive ? 'AWAITING AUTHORIZATION' : 'OPERATION COMPLETE';
    case 'subagent_stop':
      return 'SUBAGENT TERMINATED';
    case 'session_start':
      return 'SESSION INITIALIZED';
    case 'session_end':
      return 'SESSION TERMINATED';
    case 'notification':
      return 'SYSTEM NOTIFICATION';
    default:
      return 'ACTIVITY LOGGED';
  }
}

function getEventContext(event: WorkshopEvent): string {
  switch (event.type) {
    case 'pre_tool_use':
    case 'post_tool_use': {
      const input = 'toolInput' in event ? event.toolInput : undefined;
      if (!input) return '—';
      // Extract meaningful context from tool input
      if ('file_path' in input) return String(input.file_path).split('/').pop() || '—';
      if ('pattern' in input) return String(input.pattern);
      if ('command' in input) return truncate(String(input.command), 40);
      if ('url' in input) return String(input.url);
      if ('query' in input) return truncate(String(input.query), 40);
      return '—';
    }
    case 'user_prompt_submit':
      return truncate(event.prompt, 50);
    case 'stop':
      return event.response ? truncate(event.response, 50) : '—';
    case 'session_start':
      return event.source || 'new session';
    case 'session_end':
      return event.reason || 'completed';
    case 'notification':
      return event.message || '—';
    default:
      return '—';
  }
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen - 3)}...`;
}
