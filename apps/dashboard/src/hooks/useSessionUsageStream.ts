'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ServerToUIMessage, SessionUsageSummary } from '@agent-command/schema';
import { getSessionUsageLatest } from '@/lib/api';
import { useUsageStore } from '@/stores/usage';
import { useWebSocket } from '@/hooks/useWebSocket';

interface SessionUsageStreamOptions {
  sessionIds?: string[];
  enabled?: boolean;
  subscribeAll?: boolean;
  seed?: boolean;
  batchMs?: number;
}

export function useSessionUsageStream({
  sessionIds,
  enabled = true,
  subscribeAll = false,
  seed = true,
  batchMs = 750,
}: SessionUsageStreamOptions) {
  const updateBatch = useUsageStore((state) => state.updateSessionUsageBatch);
  const pendingRef = useRef<Map<string, SessionUsageSummary>>(new Map());
  const flushTimerRef = useRef<number | null>(null);
  const flushDueAtRef = useRef<number | null>(null);

  const normalizedIds = useMemo(() => {
    if (!sessionIds || sessionIds.length === 0) return [];
    const unique = Array.from(new Set(sessionIds));
    unique.sort();
    return unique;
  }, [sessionIds]);

  const flush = useCallback(() => {
    flushTimerRef.current = null;
    flushDueAtRef.current = null;
    if (pendingRef.current.size === 0) return;
    const batch = Array.from(pendingRef.current.values());
    pendingRef.current.clear();
    updateBatch(batch as unknown as SessionUsageSummary[]);
  }, [updateBatch]);

  const scheduleFlush = useCallback((delayMs: number) => {
    const dueAt = Date.now() + delayMs;
    if (flushTimerRef.current && flushDueAtRef.current && flushDueAtRef.current <= dueAt) {
      return;
    }
    if (flushTimerRef.current) {
      window.clearTimeout(flushTimerRef.current);
    }
    flushDueAtRef.current = dueAt;
    flushTimerRef.current = window.setTimeout(flush, delayMs);
  }, [flush]);

  const queueUsage = useCallback((usage: SessionUsageSummary) => {
    pendingRef.current.set(usage.session_id, usage);
    scheduleFlush(batchMs);
  }, [batchMs, scheduleFlush]);

  const topics = useMemo(() => {
    if (!enabled) return [];
    if (normalizedIds.length > 0) {
      return [{ type: 'session_usage', filter: { session_ids: normalizedIds } }];
    }
    if (subscribeAll) {
      return [{ type: 'session_usage' }];
    }
    return [];
  }, [enabled, subscribeAll, normalizedIds]);

  useWebSocket(
    topics,
    (message: ServerToUIMessage) => {
      if (message.type !== 'session_usage.updated') return;
      queueUsage(message.payload as SessionUsageSummary);
    },
    enabled && topics.length > 0
  );

  useEffect(() => {
    if (!enabled || !seed) return;
    if (normalizedIds.length === 0 && !subscribeAll) return;
    let cancelled = false;
    const ids = normalizedIds.length > 0 ? normalizedIds : undefined;
    getSessionUsageLatest(ids)
      .then(({ usage }) => {
        if (cancelled || !usage?.length) return;
        updateBatch(usage as unknown as SessionUsageSummary[]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled, seed, subscribeAll, normalizedIds, updateBatch]);

  useEffect(() => {
    return () => {
      if (flushTimerRef.current) {
        window.clearTimeout(flushTimerRef.current);
      }
    };
  }, []);
}
