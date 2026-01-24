'use client';

import { useCallback } from 'react';
import type { ServerToUIMessage } from '@agent-command/schema';
import { useWebSocket } from '@/hooks/useWebSocket';
import type { ToolEvent } from '@/lib/api';
import { parseWorkshopEvent } from '@/lib/workshop/events';
import type { WorkshopEvent } from '@/lib/workshop/types';

export function useWorkshopEventStream(
  onWorkshopEvent: (event: WorkshopEvent) => void,
  onToolEvent?: (event: ToolEvent, phase: 'started' | 'completed') => void
) {
  const handleMessage = useCallback(
    (message: ServerToUIMessage) => {
      if (message.type === 'events.appended') {
        const payload = message.payload as {
          session_id: string;
          event: { id: number; ts: string; type: string; payload: Record<string, unknown> };
        };
        const parsed = parseWorkshopEvent(
          {
            id: String(payload.event.id),
            ts: payload.event.ts,
            type: payload.event.type,
            payload: payload.event.payload,
          },
          payload.session_id
        );
        if (parsed) {
          onWorkshopEvent(parsed);
        }
        return;
      }

      if (message.type === 'tool_event.started' || message.type === 'tool_event.completed') {
        if (!onToolEvent) return;
        const payload = message.payload as { session_id: string; event: ToolEvent };
        onToolEvent(payload.event, message.type === 'tool_event.started' ? 'started' : 'completed');
      }
    },
    [onWorkshopEvent, onToolEvent]
  );

  useWebSocket([
    { type: 'events' },
    { type: 'tool_events' },
  ], handleMessage);
}
