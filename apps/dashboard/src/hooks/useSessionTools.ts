'use client';

import { useEffect, useCallback, useMemo, useRef } from 'react';
import type { ServerToUIMessage } from '@agent-command/schema';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useWorkshopStore } from '@/stores/workshop';
import { getToolEvents, type ToolEvent } from '@/lib/api';

// Delay before clearing current tool after completion (for animation)
const TOOL_COMPLETE_DELAY_MS = 1500;

interface SessionToolState {
  eventId: string | null;
  startedAt: string | null;
  clearTimeout: ReturnType<typeof setTimeout> | null;
}

/**
 * Hook to track the current tool being used by ALL active sessions.
 * Subscribes to tool_events WebSocket topic for each session and updates the workshop store.
 */
export function useSessionTools(sessionIds: string[]) {
  const { sessionTools, setSessionTool, clearSessionTools, pruneSessionTools } = useWorkshopStore();
  const sessionStateRef = useRef<Record<string, SessionToolState>>({});
  const sessionIdSet = useMemo(() => new Set(sessionIds), [sessionIds]);

  // Handle WebSocket messages for tool events
  const handleMessage = useCallback(
    (message: ServerToUIMessage) => {
      if (message.type === 'tool_event.started') {
        const payload = message.payload as { session_id: string; event: ToolEvent };
        const sessionId = payload.session_id;

        if (!sessionIdSet.has(sessionId)) return;

        // Clear any pending timeout for this session
        const state = sessionStateRef.current[sessionId];
        if (state?.clearTimeout) {
          clearTimeout(state.clearTimeout);
        }

        // Update state
        sessionStateRef.current[sessionId] = {
          eventId: payload.event.id,
          startedAt: payload.event.started_at,
          clearTimeout: null,
        };

        // Set the current tool for this session
        setSessionTool(sessionId, payload.event.tool_name);
      }

      if (message.type === 'tool_event.completed') {
        const payload = message.payload as { session_id: string; event: ToolEvent };
        const sessionId = payload.session_id;

        if (!sessionIdSet.has(sessionId)) return;

        const state = sessionStateRef.current[sessionId];

        // Validate this completion matches current tool
        if (state?.eventId && payload.event.id !== state.eventId) return;
        if (!state?.eventId && state?.startedAt && payload.event.started_at !== state.startedAt) {
          return;
        }

        // Clear after a delay to allow animation to complete
        if (state?.clearTimeout) {
          clearTimeout(state.clearTimeout);
        }

        const completionEventId = payload.event.id;
        const timeoutId = setTimeout(() => {
          const currentState = sessionStateRef.current[sessionId];
          if (currentState?.eventId && currentState.eventId !== completionEventId) {
            return;
          }
          setSessionTool(sessionId, null);
          if (sessionStateRef.current[sessionId]) {
            sessionStateRef.current[sessionId].clearTimeout = null;
          }
        }, TOOL_COMPLETE_DELAY_MS);

        sessionStateRef.current[sessionId] = {
          ...state,
          clearTimeout: timeoutId,
        };
      }
    },
    [sessionIdSet, setSessionTool]
  );

  // Subscribe to tool events for all sessions
  const topics = useMemo(
    () =>
      sessionIds.map((sessionId) => ({
        type: 'tool_events',
        filter: { session_id: sessionId },
      })),
    [sessionIds]
  );

  useWebSocket(topics, handleMessage);

  // Hydrate current tools on mount or when sessions change
  useEffect(() => {
    // Prune removed sessions and clear any pending timeouts for them
    const activeSet = new Set(sessionIds);
    Object.entries(sessionStateRef.current).forEach(([sessionId, state]) => {
      if (activeSet.has(sessionId)) return;
      if (state.clearTimeout) {
        clearTimeout(state.clearTimeout);
      }
      delete sessionStateRef.current[sessionId];
    });
    pruneSessionTools(sessionIds);
  }, [sessionIds, pruneSessionTools]);

  useEffect(() => {
    let cancelled = false;

    const hydrateSessionTools = async () => {
      for (const sessionId of sessionIds) {
        if (cancelled) return;

        try {
          const result = await getToolEvents(sessionId, undefined, 1);
          if (cancelled) return;

          const latestEvent = result.events?.[0];
          if (!latestEvent || latestEvent.completed_at) continue;

          // Only set if no newer event has come in
          const currentEventId = sessionStateRef.current[sessionId]?.eventId;
          if (currentEventId && currentEventId !== latestEvent.id) continue;

          sessionStateRef.current[sessionId] = {
            eventId: latestEvent.id,
            startedAt: latestEvent.started_at,
            clearTimeout: null,
          };
          setSessionTool(sessionId, latestEvent.tool_name);
        } catch {
          // Ignore hydration errors; live updates will fill in
        }
      }
    };

    hydrateSessionTools();

    return () => {
      cancelled = true;
    };
  }, [sessionIds, setSessionTool]);

  // Cleanup on unmount
  useEffect(() => {
    const sessionState = sessionStateRef.current;
    return () => {
      // Clear all pending timeouts
      Object.values(sessionState).forEach((state) => {
        if (state.clearTimeout) {
          clearTimeout(state.clearTimeout);
        }
      });
      clearSessionTools();
    };
  }, [clearSessionTools]);

  return sessionTools;
}
