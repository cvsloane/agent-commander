'use client';

import { useEffect, useCallback, useMemo, useRef } from 'react';
import type { ServerToUIMessage } from '@agent-command/schema';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useWorkshopStore } from '@/stores/workshop';
import { getToolEvents, type ToolEvent } from '@/lib/api';

// Delay before clearing current tool after completion (for animation)
const TOOL_COMPLETE_DELAY_MS = 1500;

/**
 * Hook to track the current tool being used by a session.
 * Subscribes to tool_events WebSocket topic and updates the workshop store.
 */
export function useCurrentTool(sessionId: string | null) {
  const { currentToolEventId, toolStartedAt, setCurrentTool } = useWorkshopStore();
  const clearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Handle WebSocket messages for tool events
  const handleMessage = useCallback(
    (message: ServerToUIMessage) => {
      if (!sessionId) return;

      if (message.type === 'tool_event.started') {
        const payload = message.payload as { session_id: string; event: ToolEvent };
        if (payload.session_id !== sessionId) return;

        // Clear any pending timeout
        if (clearTimeoutRef.current) {
          clearTimeout(clearTimeoutRef.current);
          clearTimeoutRef.current = null;
        }

        // Set the current tool
        setCurrentTool(
          payload.event.tool_name,
          payload.event.started_at,
          payload.event.id
        );
      }

      if (message.type === 'tool_event.completed') {
        const payload = message.payload as { session_id: string; event: ToolEvent };
        if (payload.session_id !== sessionId) return;
        if (currentToolEventId && payload.event.id !== currentToolEventId) return;
        if (!currentToolEventId && toolStartedAt && payload.event.started_at !== toolStartedAt) {
          return;
        }

        // Clear after a delay to allow animation to complete
        if (clearTimeoutRef.current) {
          clearTimeout(clearTimeoutRef.current);
        }
        const completionEventId = payload.event.id;
        clearTimeoutRef.current = setTimeout(() => {
          const latestEventId = useWorkshopStore.getState().currentToolEventId;
          if (latestEventId && latestEventId !== completionEventId) {
            return;
          }
          setCurrentTool(null);
          clearTimeoutRef.current = null;
        }, TOOL_COMPLETE_DELAY_MS);
      }
    },
    [currentToolEventId, toolStartedAt, sessionId, setCurrentTool]
  );

  // Subscribe to tool events for the selected session
  const topics = useMemo(
    () =>
      sessionId
        ? [{ type: 'tool_events', filter: { session_id: sessionId } }]
        : [],
    [sessionId]
  );

  useWebSocket(topics, handleMessage);

  // Clear current tool when session changes
  useEffect(() => {
    let cancelled = false;

    setCurrentTool(null);
    if (clearTimeoutRef.current) {
      clearTimeout(clearTimeoutRef.current);
      clearTimeoutRef.current = null;
    }

    if (!sessionId) {
      return () => {
        cancelled = true;
      };
    }

    const hydrateCurrentTool = async () => {
      try {
        const result = await getToolEvents(sessionId, undefined, 1);
        if (cancelled) return;
        const latestEvent = result.events?.[0];
        if (!latestEvent || latestEvent.completed_at) return;

        const latestEventId = useWorkshopStore.getState().currentToolEventId;
        if (latestEventId && latestEventId !== latestEvent.id) return;

        setCurrentTool(latestEvent.tool_name, latestEvent.started_at, latestEvent.id);
      } catch {
        // Ignore hydration errors; live updates will fill in
      }
    };

    hydrateCurrentTool();

    return () => {
      cancelled = true;
    };
  }, [sessionId, setCurrentTool]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (clearTimeoutRef.current) {
        clearTimeout(clearTimeoutRef.current);
      }
    };
  }, []);
}
