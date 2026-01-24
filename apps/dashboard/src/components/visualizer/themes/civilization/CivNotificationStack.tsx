'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import type { WorkshopEvent } from '@/lib/workshop/types';

interface CivNotification {
  id: string;
  title: string;
  body: string;
  type: 'info' | 'success' | 'warning' | 'error';
  timestamp: number;
}

interface CivNotificationStackProps {
  events: WorkshopEvent[];
  maxNotifications?: number;
  autoHideMs?: number;
}

export function CivNotificationStack({
  events,
  maxNotifications = 3,
  autoHideMs = 5000,
}: CivNotificationStackProps) {
  const [notifications, setNotifications] = useState<CivNotification[]>([]);
  const timersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const processedEventsRef = useRef<Set<string>>(new Set());

  // Cleanup timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  // Remove notification by ID (used by timers)
  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    timersRef.current.delete(id);
  }, []);

  // Convert events to notifications - only process new events
  useEffect(() => {
    if (events.length === 0) return;

    const latestEvent = events[events.length - 1];

    // Skip if already processed
    if (processedEventsRef.current.has(latestEvent.id)) return;
    processedEventsRef.current.add(latestEvent.id);

    // Cap processed events memory
    if (processedEventsRef.current.size > 50) {
      const arr = Array.from(processedEventsRef.current);
      processedEventsRef.current = new Set(arr.slice(-25));
    }

    const notification = eventToNotification(latestEvent);

    if (notification) {
      setNotifications((prev) => {
        // Add new notification at the start
        const updated = [notification, ...prev];
        // Keep only maxNotifications
        return updated.slice(0, maxNotifications);
      });

      // Set individual timer for this notification
      const timer = setTimeout(() => {
        removeNotification(notification.id);
      }, autoHideMs);
      timersRef.current.set(notification.id, timer);
    }
  }, [events, maxNotifications, autoHideMs, removeNotification]);

  const dismissNotification = (id: string) => {
    // Clear timer if exists
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  if (notifications.length === 0) return null;

  return (
    <div className="civ-notification-stack">
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className={`civ-notification civ-notification--${notification.type}`}
          onClick={() => dismissNotification(notification.id)}
        >
          <div className="civ-notification-icon">{getNotificationIcon(notification.type)}</div>
          <div className="civ-notification-content">
            <div className="civ-notification-title">{notification.title}</div>
            <div className="civ-notification-body">{notification.body}</div>
          </div>
          <button
            type="button"
            className="civ-notification-dismiss"
            onClick={(e) => {
              e.stopPropagation();
              dismissNotification(notification.id);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function eventToNotification(event: WorkshopEvent): CivNotification | null {
  const base = {
    id: event.id,
    timestamp: event.timestamp,
  };

  switch (event.type) {
    case 'pre_tool_use':
      return {
        ...base,
        title: 'Agent Activity',
        body: `Using ${event.tool}...`,
        type: 'info',
      };

    case 'post_tool_use':
      if (!event.success) {
        return {
          ...base,
          title: 'Tool Failed',
          body: `${event.tool} encountered an error`,
          type: 'error',
        };
      }
      // Don't show success for every tool - too noisy
      return null;

    case 'session_start':
      return {
        ...base,
        title: 'Territory Activated',
        body: `Session started (${event.source || 'new'})`,
        type: 'success',
      };

    case 'session_end':
      return {
        ...base,
        title: 'Territory Idle',
        body: `Session ended (${event.reason || 'complete'})`,
        type: 'info',
      };

    case 'user_prompt_submit':
      return {
        ...base,
        title: 'Command Issued',
        body: truncate(event.prompt, 50),
        type: 'info',
      };

    case 'stop':
      return {
        ...base,
        title: 'Agent Stopped',
        body: event.stopHookActive ? 'Awaiting approval' : 'Task complete',
        type: event.stopHookActive ? 'warning' : 'success',
      };

    case 'notification':
      return {
        ...base,
        title: event.notificationType || 'Notice',
        body: event.message || 'Notification received',
        type: 'info',
      };

    default:
      return null;
  }
}

function getNotificationIcon(type: CivNotification['type']): string {
  switch (type) {
    case 'success':
      return '✓';
    case 'warning':
      return '⚠';
    case 'error':
      return '✕';
    default:
      return '📜';
  }
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen - 3)}...`;
}
