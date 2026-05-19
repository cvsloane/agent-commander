'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ServerToUIMessage } from '@agent-command/schema';
import { getHosts, getTmuxRoster } from '@/lib/api';
import {
  buildTmuxClusters,
  matchesTmuxFilter,
  matchesTmuxRosterFilter,
  TMUX_ROSTER_FILTERS,
  type TmuxRosterFilter,
} from '@/lib/tmuxRoster';
import { isHostOnline } from '@/lib/utils';
import { useWebSocket } from '@/hooks/useWebSocket';

export function useTmuxRosterData() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const rosterRefetchTimerRef = useRef<number | null>(null);
  const previousSelectedSessionIdRef = useRef<string>('');
  const pendingSearchRef = useRef(searchParams.toString());
  const [expandedClusterKey, setExpandedClusterKey] = useState<string | null>(null);

  const hostIdParam = searchParams.get('host_id') || '';
  const sessionIdParam = searchParams.get('session_id') || '';
  const query = searchParams.get('q') || '';
  const filterParam = searchParams.get('filter') || 'all';
  const activeFilter = TMUX_ROSTER_FILTERS.includes(filterParam as TmuxRosterFilter)
    ? (filterParam as TmuxRosterFilter)
    : 'all';

  useEffect(() => {
    pendingSearchRef.current = searchParams.toString();
  }, [searchParams]);

  const {
    data: hostsData,
    isLoading: hostsLoading,
    refetch: refetchHosts,
  } = useQuery({
    queryKey: ['hosts'],
    queryFn: getHosts,
  });

  const tmuxHosts = useMemo(() => (
    hostsData?.hosts?.filter((host) => host.capabilities.tmux) ?? []
  ), [hostsData]);

  const hostById = useMemo(() => {
    const map = new Map<string, (typeof tmuxHosts)[number]>();
    for (const host of tmuxHosts) {
      map.set(host.id, host);
    }
    return map;
  }, [tmuxHosts]);

  const fallbackHostId = useMemo(() => {
    const onlineHost = tmuxHosts.find((host) => isHostOnline(host.last_seen_at ?? null));
    return onlineHost?.id ?? tmuxHosts[0]?.id ?? '';
  }, [tmuxHosts]);

  const selectedHostId = hostById.has(hostIdParam) ? hostIdParam : fallbackHostId;
  const selectedHost = selectedHostId ? hostById.get(selectedHostId) : undefined;

  const updateTmuxParams = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(pendingSearchRef.current);
    for (const [key, value] of Object.entries(updates)) {
      if (!value) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    const next = params.toString();
    pendingSearchRef.current = next;
    router.replace(`/tmux${next ? `?${next}` : ''}`);
  }, [router]);

  useEffect(() => {
    if (!selectedHostId) return;
    if (hostIdParam === selectedHostId) return;
    updateTmuxParams({
      host_id: selectedHostId,
      session_id: null,
    });
  }, [hostIdParam, selectedHostId, updateTmuxParams]);

  const {
    data: sessionsData,
    isLoading: sessionsLoading,
    error: sessionsError,
    refetch: refetchSessions,
    isFetching: sessionsFetching,
  } = useQuery({
    queryKey: ['sessions', 'tmux', selectedHostId],
    queryFn: () => getTmuxRoster({ host_id: selectedHostId }),
    enabled: Boolean(selectedHostId),
  });

  const tmuxSessions = useMemo(() => (
    sessionsData?.sessions ?? []
  ), [sessionsData]);

  const filteredSessions = useMemo(
    () => tmuxSessions.filter((session) => (
      matchesTmuxRosterFilter(session, activeFilter)
      && matchesTmuxFilter(session, query)
    )),
    [activeFilter, query, tmuxSessions]
  );

  const clusters = useMemo(
    () => buildTmuxClusters(filteredSessions),
    [filteredSessions]
  );

  const availableSessionIds = useMemo(
    () => new Set(filteredSessions.map((session) => session.id)),
    [filteredSessions]
  );

  const sessionToClusterKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const cluster of clusters) {
      for (const window of cluster.windows) {
        for (const pane of window.panes) {
          map.set(pane.session.id, cluster.key);
        }
      }
    }
    return map;
  }, [clusters]);

  const selectedSessionId = availableSessionIds.has(sessionIdParam) ? sessionIdParam : '';
  const selectedClusterKey = selectedSessionId ? sessionToClusterKey.get(selectedSessionId) ?? null : null;

  useEffect(() => {
    if (!selectedHostId) return;
    if (!availableSessionIds.has(sessionIdParam) && sessionIdParam) {
      updateTmuxParams({ session_id: null });
    }
  }, [availableSessionIds, selectedHostId, sessionIdParam, updateTmuxParams]);

  useEffect(() => {
    setExpandedClusterKey((current) => (
      current && clusters.some((cluster) => cluster.key === current) ? current : null
    ));
  }, [clusters]);

  useEffect(() => {
    if (!selectedSessionId) {
      previousSelectedSessionIdRef.current = '';
      return;
    }
    if (previousSelectedSessionIdRef.current !== selectedSessionId && selectedClusterKey) {
      setExpandedClusterKey(selectedClusterKey);
    }
    previousSelectedSessionIdRef.current = selectedSessionId;
  }, [selectedClusterKey, selectedSessionId]);

  const selectedWindowKey = useMemo(() => {
    for (const cluster of clusters) {
      for (const window of cluster.windows) {
        if (window.panes.some((pane) => pane.session.id === selectedSessionId)) {
          return window.key;
        }
      }
    }
    return null;
  }, [clusters, selectedSessionId]);

  const invalidateRoster = useCallback(() => {
    if (!selectedHostId) return;
    void queryClient.invalidateQueries({ queryKey: ['sessions', 'tmux', selectedHostId] });
  }, [queryClient, selectedHostId]);

  const scheduleRosterRefresh = useCallback(() => {
    if (rosterRefetchTimerRef.current || !selectedHostId) return;
    rosterRefetchTimerRef.current = window.setTimeout(() => {
      invalidateRoster();
      rosterRefetchTimerRef.current = null;
    }, 750);
  }, [invalidateRoster, selectedHostId]);

  useWebSocket(
    [{ type: 'sessions' }],
    (message: ServerToUIMessage) => {
      if (message.type === 'sessions.changed') {
        scheduleRosterRefresh();
      }
    },
    Boolean(selectedHostId)
  );

  useEffect(() => {
    return () => {
      if (rosterRefetchTimerRef.current) {
        window.clearTimeout(rosterRefetchTimerRef.current);
        rosterRefetchTimerRef.current = null;
      }
    };
  }, []);

  const refreshRoster = useCallback(() => {
    void refetchHosts();
    if (selectedHostId) {
      void refetchSessions();
    }
  }, [refetchHosts, refetchSessions, selectedHostId]);

  const selectHost = useCallback((hostId: string) => {
    updateTmuxParams({
      host_id: hostId,
      session_id: null,
    });
  }, [updateTmuxParams]);

  const selectSession = useCallback((sessionId: string) => {
    const clusterKey = sessionToClusterKey.get(sessionId);
    if (clusterKey) {
      setExpandedClusterKey(clusterKey);
    }
    updateTmuxParams({ session_id: sessionId });
  }, [sessionToClusterKey, updateTmuxParams]);

  return {
    query,
    activeFilter,
    updateTmuxParams,
    hostsLoading,
    tmuxHosts,
    selectedHostId,
    selectedHost,
    sessionsLoading,
    sessionsError,
    sessionsFetching,
    tmuxSessions,
    filteredSessions,
    clusters,
    selectedSessionId,
    selectedClusterKey,
    selectedWindowKey,
    expandedClusterKey,
    setExpandedClusterKey,
    refreshRoster,
    invalidateRoster,
    selectHost,
    selectSession,
  };
}
