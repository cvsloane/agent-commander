'use client';

import { useCallback, useState } from 'react';
import { updateSession } from '@/lib/api';
import { useSessionStore } from '@/stores/session';
import { useOrchestratorStore } from '@/stores/orchestrator';

export function useSessionIdle() {
  const updateSessions = useSessionStore((state) => state.updateSessions);
  const applySessionIdle = useOrchestratorStore((s) => s.applySessionIdle);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const setSessionIdle = useCallback(
    async (sessionId: string, idle: boolean) => {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.add(sessionId);
        return next;
      });

      try {
        const result = await updateSession(sessionId, { idle });
        updateSessions([result.session]);
        const idledAt = result.session.idled_at
          ? new Date(result.session.idled_at).getTime()
          : undefined;
        applySessionIdle(sessionId, idledAt);
        return result.session;
      } finally {
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(sessionId);
          return next;
        });
      }
    },
    [applySessionIdle, updateSessions]
  );

  const isSessionIdlePending = useCallback(
    (sessionId: string) => pendingIds.has(sessionId),
    [pendingIds]
  );

  return { setSessionIdle, isSessionIdlePending };
}
