'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ServerToUIMessage, SessionWithSnapshot } from '@agent-command/schema';
import { getHosts, getSessionGraph, getTmuxRoster } from '@/lib/api';
import {
  matchesTmuxFilter,
  matchesTmuxRosterFilter,
  TMUX_ROSTER_FILTERS,
  type TmuxRosterFilter,
} from '@/lib/tmuxRoster';
import {
  buildFleetRosterGroups,
  filterFleetRosterGroups,
  fleetGroupForSession,
  groupSessions,
} from '@/lib/fleetRoster';
import { isHostOnline } from '@/lib/utils';
import { useWebSocket } from '@/hooks/useWebSocket';

export const ALL_TMUX_HOSTS_ID = 'all';

interface TmuxRosterQueryData {
  sessions: SessionWithSnapshot[];
  total: number;
  failedHostIds?: string[];
}

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
  const [requestedHostId, setRequestedHostId] = useState<string | null>(null);

  useEffect(() => {
    pendingSearchRef.current = searchParams.toString();
  }, [searchParams]);

  useEffect(() => {
    if (requestedHostId && requestedHostId === hostIdParam) {
      setRequestedHostId(null);
    }
  }, [hostIdParam, requestedHostId]);

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
  const onlineTmuxHosts = useMemo(
    () => tmuxHosts.filter((host) => isHostOnline(host.last_seen_at ?? null)),
    [tmuxHosts]
  );

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

  const effectiveHostId = requestedHostId ?? hostIdParam;
  const allHostsSelected = effectiveHostId === ALL_TMUX_HOSTS_ID && onlineTmuxHosts.length > 0;
  const selectedHostId = allHostsSelected
    ? ALL_TMUX_HOSTS_ID
    : hostById.has(effectiveHostId) ? effectiveHostId : fallbackHostId;
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

  const {
    data: sessionsData,
    isLoading: sessionsLoading,
    error: sessionsError,
    refetch: refetchSessions,
    isFetching: sessionsFetching,
  } = useQuery<TmuxRosterQueryData>({
    queryKey: [
      'sessions',
      'tmux',
      selectedHostId,
      ...(allHostsSelected ? onlineTmuxHosts.map((host) => host.id).sort() : []),
    ],
    queryFn: async () => {
      if (!allHostsSelected) return getTmuxRoster({ host_id: selectedHostId });
      const results = await Promise.allSettled(
        onlineTmuxHosts.map(async (host) => ({
          hostId: host.id,
          roster: await getTmuxRoster({ host_id: host.id }),
        }))
      );
      const successful = results
        .filter((result): result is PromiseFulfilledResult<{ hostId: string; roster: TmuxRosterQueryData }> => result.status === 'fulfilled')
        .map((result) => result.value);
      if (successful.length === 0) {
        throw new Error('Could not load the tmux roster from any online machine.');
      }
      const failedHostIds = results.flatMap((result, index) => (
        result.status === 'rejected' ? [onlineTmuxHosts[index]?.id ?? 'unknown'] : []
      ));
      const sessions = successful.flatMap(({ roster }) => roster.sessions);
      return {
        sessions: [...new Map(sessions.map((session) => [session.id, session])).values()],
        total: sessions.length,
        failedHostIds,
      };
    },
    enabled: Boolean(selectedHostId),
  });

  const tmuxSessions = useMemo(() => (
    sessionsData?.sessions ?? []
  ), [sessionsData]);

  const matchesActiveFilter = useCallback(
    (session: SessionWithSnapshot) => (
      matchesTmuxRosterFilter(session, activeFilter)
      && matchesTmuxFilter(session, query)
    ),
    [activeFilter, query]
  );

  const orchestratorSessions = useMemo(
    () => tmuxSessions.filter((session) => session.role === 'orchestrator'),
    [tmuxSessions]
  );
  const graphQueries = useQueries({
    queries: orchestratorSessions.map((session) => ({
      queryKey: ['sessions', session.id, 'graph'],
      queryFn: () => getSessionGraph(session.id),
    })),
  });
  const sessionEdges = useMemo(
    () => [...new Map(
      graphQueries
        .flatMap((result) => result.data?.edges ?? [])
        .map((edge) => [`${edge.parent_session_id}:${edge.child_session_id}:${edge.edge_type}`, edge])
    ).values()],
    [graphQueries]
  );

  const rosterGroups = useMemo(
    () => buildFleetRosterGroups(tmuxSessions, sessionEdges, {
      allHosts: allHostsSelected,
      waitingFirst: allHostsSelected,
    }),
    [allHostsSelected, sessionEdges, tmuxSessions]
  );
  const groups = useMemo(
    () => filterFleetRosterGroups(rosterGroups, matchesActiveFilter),
    [matchesActiveFilter, rosterGroups]
  );
  const filteredSessions = useMemo(
    () => [...new Map(
      groups.flatMap(groupSessions).map((session) => [session.id, session])
    ).values()],
    [groups]
  );

  const availableSessionIds = useMemo(
    () => new Set(filteredSessions.map((session) => session.id)),
    [filteredSessions]
  );

  const sessionToClusterKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of groups) {
      if (group.kind === 'orchestrator') {
        map.set(group.orchestrator.session.id, group.key);
        group.workers.forEach((worker) => map.set(worker.session.id, group.key));
        continue;
      }
      for (const window of group.cluster.windows) {
        for (const pane of window.panes) map.set(pane.session.id, group.key);
      }
    }
    return map;
  }, [groups]);

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
      current && groups.some((group) => group.key === current) ? current : null
    ));
  }, [groups]);

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
    const selectedGroup = fleetGroupForSession(groups, selectedSessionId);
    if (selectedGroup?.kind === 'tmux') {
      for (const window of selectedGroup.cluster.windows) {
        if (window.panes.some((pane) => pane.session.id === selectedSessionId)) {
          return window.key;
        }
      }
    }
    return null;
  }, [groups, selectedSessionId]);

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
    [{ type: 'sessions' }, { type: 'hosts' }],
    (message: ServerToUIMessage) => {
      if (message.type === 'sessions.changed') {
        scheduleRosterRefresh();
      } else if (message.type === 'hosts.changed') {
        void queryClient.invalidateQueries({ queryKey: ['hosts'] });
      }
    },
    Boolean(selectedHostId)
  );
  useWebSocket(
    [{ type: 'session_edges' }],
    (message: ServerToUIMessage) => {
      if (message.type !== 'session_edges.changed') return;
      void queryClient.invalidateQueries({
        queryKey: ['sessions', message.payload.session_id, 'graph'],
      });
    },
    Boolean(selectedHostId),
    'tmux-session-edges'
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
    setRequestedHostId(hostId);
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
    groups,
    allHostsSelected,
    partialHostFailureCount: sessionsData?.failedHostIds?.length ?? 0,
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
