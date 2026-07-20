'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ServerToUIMessage, SessionWithSnapshot } from '@agent-command/schema';
import { getHosts, getOrchestratorFleet, getTmuxRoster } from '@/lib/api';
import {
  matchesTmuxFilter,
  matchesTmuxRosterFilter,
  TMUX_ROSTER_FILTERS,
  type TmuxRosterFilter,
} from '@/lib/tmuxRoster';
import {
  filterFleetRosterGroups,
  fleetGroupForSession,
  groupSessions,
} from '@/lib/fleetRoster';
import { isHostOnline } from '@/lib/utils';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useTmuxTopologyFeed } from '@/hooks/useTmuxTopology';
import { getAttachedTmuxSelectionUpdates } from '@/hooks/tmuxNavigation';
import { selectFleetRosterGroups, useFleetStore } from '@/stores/fleet';
import {
  useSettingsStore,
  type TmuxSavedRosterFilter,
} from '@/stores/settings';

export const ALL_TMUX_HOSTS_ID = 'all';
export const FLEET_ROSTER_FILTERS = [
  ...TMUX_ROSTER_FILTERS,
  'this_host',
  'recent',
] as const;
export type FleetRosterFilter = (typeof FLEET_ROSTER_FILTERS)[number];
export const RECENT_SESSION_WINDOW_MS = 30 * 60 * 1000;

export function matchesFleetRosterFilter(
  session: SessionWithSnapshot,
  filter: FleetRosterFilter,
  context: { thisHostId: string | null; now: number }
): boolean {
  if (filter === 'this_host') {
    return Boolean(context.thisHostId && session.host_id === context.thisHostId);
  }
  if (filter === 'recent') {
    const activityAt = Date.parse(session.last_activity_at || session.updated_at);
    return Number.isFinite(activityAt) && context.now - activityAt <= RECENT_SESSION_WINDOW_MS;
  }
  return matchesTmuxRosterFilter(session, filter as TmuxRosterFilter);
}

export function buildCanonicalTmuxHref(search: string): string {
  return `/${search ? `?${search}` : ''}`;
}

interface TmuxRosterQueryData {
  sessions: SessionWithSnapshot[];
  total: number;
  failedHostIds?: string[];
}

export function useTmuxRosterData() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const previousSelectedSessionIdRef = useRef<string>('');
  const pendingSearchRef = useRef(searchParams.toString());
  const [expandedClusterKey, setExpandedClusterKey] = useState<string | null>(null);
  const [recentFilterNow, setRecentFilterNow] = useState(() => Date.now());
  const ingestAggregate = useFleetStore((state) => state.ingestAggregate);
  const applySessionsChanged = useFleetStore((state) => state.applySessionsChanged);
  const applySessionEdges = useFleetStore((state) => state.applySessionEdges);
  const rosterByHost = useFleetStore((state) => state.rosterByHost);
  const orchestratorsById = useFleetStore((state) => state.orchestratorsById);
  const orchestratorIds = useFleetStore((state) => state.orchestratorIds);
  const setRoster = useFleetStore((state) => state.setRoster);
  const savedFilter = useSettingsStore((state) => state.tmuxRosterFilter);
  const setSavedFilter = useSettingsStore((state) => state.setTmuxRosterFilter);
  const savedThisHostId = useSettingsStore((state) => state.tmuxThisHostId);
  const setSavedThisHostId = useSettingsStore((state) => state.setTmuxThisHostId);

  const hostIdParam = searchParams.get('host_id') || '';
  const sessionIdParam = searchParams.get('session_id') || '';
  const query = searchParams.get('q') || '';
  const filterParam = searchParams.get('filter');
  const activeFilter = filterParam
    && FLEET_ROSTER_FILTERS.includes(filterParam as FleetRosterFilter)
    ? filterParam as FleetRosterFilter
    : savedFilter;
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

  const fleetQuery = useQuery({
    queryKey: ['orchestrator-fleet', 'aggregate'],
    queryFn: getOrchestratorFleet,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (fleetQuery.data) ingestAggregate(fleetQuery.data);
  }, [fleetQuery.data, ingestAggregate]);

  const tmuxHosts = useMemo(
    () => hostsData?.hosts?.filter((host) => host.capabilities.tmux) ?? [],
    [hostsData]
  );
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
    : hostById.has(effectiveHostId)
      ? effectiveHostId
      : fallbackHostId;
  const selectedHost = selectedHostId ? hostById.get(selectedHostId) : undefined;

  useEffect(() => {
    if (selectedHostId && selectedHostId !== ALL_TMUX_HOSTS_ID) {
      setSavedThisHostId(selectedHostId);
    }
  }, [selectedHostId, setSavedThisHostId]);

  useEffect(() => {
    if (activeFilter !== 'recent') return;
    setRecentFilterNow(Date.now());
    const interval = window.setInterval(() => setRecentFilterNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, [activeFilter]);

  const updateTmuxParams = useCallback(
    (updates: Record<string, string | null>) => {
      if (Object.prototype.hasOwnProperty.call(updates, 'filter')) {
        const requestedFilter = updates.filter;
        setSavedFilter(
          requestedFilter && FLEET_ROSTER_FILTERS.includes(requestedFilter as FleetRosterFilter)
            ? requestedFilter as TmuxSavedRosterFilter
            : 'all'
        );
      }
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
      router.replace(buildCanonicalTmuxHref(next));
    },
    [router, setSavedFilter]
  );

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
        .filter(
          (
            result
          ): result is PromiseFulfilledResult<{ hostId: string; roster: TmuxRosterQueryData }> =>
            result.status === 'fulfilled'
        )
        .map((result) => result.value);
      if (successful.length === 0) {
        throw new Error('Could not load the tmux roster from any online machine.');
      }
      const failedHostIds = results.flatMap((result, index) =>
        result.status === 'rejected' ? [onlineTmuxHosts[index]?.id ?? 'unknown'] : []
      );
      const sessions = successful.flatMap(({ roster }) => roster.sessions);
      return {
        sessions: [...new Map(sessions.map((session) => [session.id, session])).values()],
        total: sessions.length,
        failedHostIds,
      };
    },
    enabled: Boolean(selectedHostId),
    refetchInterval: 30_000,
  });

  const trackedHostIds = useMemo(
    () => allHostsSelected
      ? onlineTmuxHosts.map((host) => host.id)
      : selectedHostId
        ? [selectedHostId]
        : [],
    [allHostsSelected, onlineTmuxHosts, selectedHostId]
  );

  useEffect(() => {
    if (!sessionsData) return;
    const failedHostIds = new Set(sessionsData.failedHostIds ?? []);
    for (const hostId of trackedHostIds) {
      if (failedHostIds.has(hostId)) continue;
      setRoster(
        hostId,
        sessionsData.sessions.filter((session) => session.host_id === hostId)
      );
    }
  }, [sessionsData, setRoster, trackedHostIds]);

  const tmuxSessions = useMemo(() => [
    ...new Map(
      trackedHostIds
        .flatMap((hostId) => rosterByHost[hostId] ?? [])
        .map((session) => [session.id, session])
    ).values(),
  ], [rosterByHost, trackedHostIds]);
  const quickSwitchSessions = useMemo(() => [
    ...new Map(
      Object.values(rosterByHost)
        .flat()
        .filter((session) => Boolean(session.tmux_pane_id) && !session.archived_at)
        .map((session) => [session.id, session])
    ).values(),
  ], [rosterByHost]);
  useTmuxTopologyFeed(
    trackedHostIds,
    tmuxSessions
  );

  const matchesActiveFilter = useCallback(
    (session: SessionWithSnapshot) =>
      matchesFleetRosterFilter(session, activeFilter, {
        thisHostId: savedThisHostId
          || (selectedHostId !== ALL_TMUX_HOSTS_ID ? selectedHostId : null),
        now: recentFilterNow,
      }) && matchesTmuxFilter(session, query),
    [activeFilter, query, recentFilterNow, savedThisHostId, selectedHostId]
  );

  const rosterGroups = useMemo(
    () => selectFleetRosterGroups({
      rosterByHost,
      orchestratorsById,
      orchestratorIds,
    }, trackedHostIds, {
        allHosts: allHostsSelected,
        waitingFirst: allHostsSelected,
      }),
    [allHostsSelected, orchestratorIds, orchestratorsById, rosterByHost, trackedHostIds]
  );
  const groups = useMemo(
    () => filterFleetRosterGroups(rosterGroups, matchesActiveFilter),
    [matchesActiveFilter, rosterGroups]
  );
  const filteredSessions = useMemo(
    () => [
      ...new Map(groups.flatMap(groupSessions).map((session) => [session.id, session])).values(),
    ],
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
  const selectedClusterKey = selectedSessionId
    ? (sessionToClusterKey.get(selectedSessionId) ?? null)
    : null;

  useEffect(() => {
    if (!selectedHostId) return;
    if (!availableSessionIds.has(sessionIdParam) && sessionIdParam) {
      updateTmuxParams({ session_id: null });
    }
  }, [availableSessionIds, selectedHostId, sessionIdParam, updateTmuxParams]);

  useEffect(() => {
    setExpandedClusterKey((current) =>
      current && groups.some((group) => group.key === current) ? current : null
    );
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

  useWebSocket(
    [{ type: 'sessions' }, { type: 'hosts' }],
    (message: ServerToUIMessage) => {
      if (message.type === 'sessions.changed') {
        applySessionsChanged(message.payload.sessions, message.payload.deleted);
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
      applySessionEdges(message.payload.session_id, message.payload.edges);
    },
    Boolean(selectedHostId),
    'tmux-session-edges'
  );

  const refreshRoster = useCallback(() => {
    void refetchHosts();
    void fleetQuery.refetch();
    if (selectedHostId) {
      void refetchSessions();
    }
  }, [fleetQuery, refetchHosts, refetchSessions, selectedHostId]);

  const selectHost = useCallback(
    (hostId: string) => {
      setRequestedHostId(hostId);
      updateTmuxParams({
        host_id: hostId,
        session_id: null,
      });
    },
    [updateTmuxParams]
  );

  const selectSession = useCallback(
    (sessionId: string) => {
      const clusterKey = sessionToClusterKey.get(sessionId);
      if (clusterKey) {
        setExpandedClusterKey(clusterKey);
      }
      const session = quickSwitchSessions.find((candidate) => candidate.id === sessionId);
      updateTmuxParams(getAttachedTmuxSelectionUpdates({
        sessionId,
        hostId: session?.host_id,
      }));
    },
    [quickSwitchSessions, sessionToClusterKey, updateTmuxParams]
  );

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
    quickSwitchSessions,
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
