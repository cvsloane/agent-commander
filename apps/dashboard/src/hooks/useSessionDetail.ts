'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getHosts, getSession } from '@/lib/api';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useUIStore } from '@/stores/ui';
import type { Host, ServerToUIMessage, Session } from '@agent-command/schema';

type SessionDetailData = Awaited<ReturnType<typeof getSession>>;

export function useSessionDetail(sessionId?: string | null) {
  const enabled = Boolean(sessionId);
  const queryClient = useQueryClient();
  const { addRecentSession } = useUIStore();
  const recentKeyRef = useRef<string | null>(null);
  const refetchTimerRef = useRef<number | null>(null);

  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => getSession(sessionId!),
    enabled,
    refetchInterval: false,
  });

  const { data: hostsData } = useQuery({
    queryKey: ['hosts'],
    queryFn: getHosts,
  });

  const hostById = useMemo(() => {
    const map = new Map<string, Host>();
    for (const host of hostsData?.hosts || []) {
      map.set(host.id, host);
    }
    return map;
  }, [hostsData]);

  const host = data?.session ? hostById.get(data.session.host_id) : undefined;

  const scheduleRefetch = useCallback(() => {
    if (refetchTimerRef.current || !enabled) return;
    refetchTimerRef.current = window.setTimeout(() => {
      void refetch();
      refetchTimerRef.current = null;
    }, 1000);
  }, [enabled, refetch]);

  useWebSocket(
    sessionId
      ? [
          { type: 'events', filter: { session_id: sessionId } },
          { type: 'sessions', filter: { session_id: sessionId } },
        ]
      : [],
    (message: ServerToUIMessage) => {
      if (!sessionId) return;

      if (message.type === 'sessions.changed') {
        const payload = message.payload as { sessions: Session[] };
        const updated = payload.sessions.find((session) => session.id === sessionId);
        if (updated) {
          queryClient.setQueryData(['session', sessionId], (current: SessionDetailData | undefined) => {
            if (!current) return current;
            return {
              ...current,
              session: { ...current.session, ...updated },
            };
          });
        }
      }

      if (message.type === 'events.appended') {
        scheduleRefetch();
      }
    },
    enabled
  );

  useEffect(() => {
    return () => {
      if (refetchTimerRef.current) {
        window.clearTimeout(refetchTimerRef.current);
        refetchTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!data?.session) return;
    const session = data.session;
    const tmuxMeta = session.metadata?.tmux as { session_name?: string } | undefined;
    const tmuxSessionName = tmuxMeta?.session_name?.trim()
      || session.tmux_target?.split(':')[0]
      || null;
    const key = [
      session.id,
      session.title ?? '',
      session.cwd ?? '',
      session.provider ?? '',
      session.kind ?? '',
      session.host_id ?? '',
      session.tmux_target ?? '',
      tmuxSessionName ?? '',
    ].join('|');
    if (recentKeyRef.current === key) return;
    recentKeyRef.current = key;
    addRecentSession({
      id: session.id,
      title: session.title ?? null,
      cwd: session.cwd ?? null,
      status: session.status,
      provider: session.provider,
      kind: session.kind ?? null,
      hostId: session.host_id ?? null,
      tmuxTarget: session.tmux_target ?? null,
      tmuxSessionName,
    });
  }, [addRecentSession, data?.session]);

  return {
    data,
    session: data?.session,
    snapshot: data?.snapshot ?? null,
    events: data?.events ?? [],
    approvals: data?.approvals ?? [],
    host,
    hostById,
    hosts: hostsData?.hosts ?? [],
    isLoading,
    error,
    refetch,
  };
}
