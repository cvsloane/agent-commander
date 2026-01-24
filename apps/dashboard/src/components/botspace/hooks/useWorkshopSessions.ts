'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SessionWithSnapshot } from '@agent-command/schema';
import type { ServerToUIMessage } from '@agent-command/schema';
import { getSessions } from '@/lib/api';
import { useWebSocket } from '@/hooks/useWebSocket';

export function useWorkshopSessions() {
  const { data } = useQuery({
    queryKey: ['sessions', 'workshop-botspace'],
    queryFn: () => getSessions({ include_archived: false }),
    refetchInterval: 30000,
  });

  const [sessions, setSessions] = useState<SessionWithSnapshot[]>([]);

  useEffect(() => {
    if (data?.sessions) {
      setSessions(data.sessions);
    }
  }, [data?.sessions]);

  const handleMessage = useCallback((message: ServerToUIMessage) => {
    if (message.type !== 'sessions.changed') return;
    const payload = message.payload as { sessions: SessionWithSnapshot[]; deleted?: string[] };
    setSessions((prev) => {
      const map = new Map(prev.map((s) => [s.id, s]));
      for (const session of payload.sessions) {
        map.set(session.id, session);
      }
      if (payload.deleted) {
        for (const id of payload.deleted) {
          map.delete(id);
        }
      }
      return Array.from(map.values());
    });
  }, []);

  useWebSocket([{ type: 'sessions' }], handleMessage);

  return useMemo(() => sessions, [sessions]);
}
