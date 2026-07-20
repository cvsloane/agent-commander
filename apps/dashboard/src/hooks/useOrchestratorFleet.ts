'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AgentTask,
  AutomationRun,
  SessionEdge,
  SessionGraphRollup,
  SessionWithSnapshot,
  ServerToUIMessage,
} from '@agent-command/schema';
import { getHosts, getOrchestratorFleet } from '@/lib/api';
import { isHostOnline } from '@/lib/utils';
import { useFleetStore } from '@/stores/fleet';
import { useWebSocket } from '@/hooks/useWebSocket';

export const ORCHESTRATOR_FLEET_QUERY_KEY = ['orchestrator-fleet', 'aggregate'] as const;
const FLEET_RECONCILIATION_INTERVAL_MS = 30_000;

export interface OrchestratorFleetCardModel {
  session: SessionWithSnapshot;
  children: SessionWithSnapshot[];
  edges: SessionEdge[];
  agentTasks: AgentTask[];
  rollup: SessionGraphRollup;
  latestRun?: AutomationRun;
  isLoading: boolean;
  errors: Error[];
}

export function useOrchestratorFleet() {
  const queryClient = useQueryClient();
  const ingestAggregate = useFleetStore((state) => state.ingestAggregate);
  const applySessionsChanged = useFleetStore((state) => state.applySessionsChanged);
  const applySessionEdges = useFleetStore((state) => state.applySessionEdges);
  const applyAgentTasks = useFleetStore((state) => state.applyAgentTasks);
  const orchestratorIds = useFleetStore((state) => state.orchestratorIds);
  const orchestratorsById = useFleetStore((state) => state.orchestratorsById);
  const fleetQuery = useQuery({
    queryKey: ORCHESTRATOR_FLEET_QUERY_KEY,
    queryFn: getOrchestratorFleet,
    refetchInterval: FLEET_RECONCILIATION_INTERVAL_MS,
  });
  const hostsQuery = useQuery({
    queryKey: ['hosts'],
    queryFn: getHosts,
    refetchInterval: FLEET_RECONCILIATION_INTERVAL_MS,
  });

  useEffect(() => {
    if (fleetQuery.data) ingestAggregate(fleetQuery.data);
  }, [fleetQuery.data, ingestAggregate]);

  const cards = useMemo<OrchestratorFleetCardModel[]>(() => (
    orchestratorIds.flatMap((id) => {
      const card = orchestratorsById[id];
      return card ? [{
        session: card.session,
        children: card.children,
        edges: card.edges,
        agentTasks: card.agent_tasks,
        rollup: card.rollup,
        latestRun: card.latest_run ?? undefined,
        isLoading: false,
        errors: [],
      }] : [];
    })
  ), [orchestratorIds, orchestratorsById]);
  const runs = useMemo<AutomationRun[]>(() => [
    ...new Map(
      cards.flatMap((card) => card.latestRun ? [[card.latestRun.id, card.latestRun] as const] : [])
    ).values(),
  ], [cards]);
  const hostOnlineById = useMemo(() => Object.fromEntries(
    (hostsQuery.data?.hosts ?? []).map((host) => [
      host.id,
      isHostOnline(host.last_seen_at ?? null),
    ])
  ), [hostsQuery.data?.hosts]);

  const handleMessage = useCallback((message: ServerToUIMessage) => {
    if (message.type === 'sessions.changed') {
      applySessionsChanged(message.payload.sessions, message.payload.deleted);
      return;
    }
    if (message.type === 'session_edges.changed') {
      applySessionEdges(message.payload.session_id, message.payload.edges);
      return;
    }
    if (message.type === 'agent_tasks.changed') {
      applyAgentTasks(message.payload.session_id, message.payload.agent_tasks);
      return;
    }
    if (
      message.type === 'automation.runtime_state.updated'
      || message.type === 'automation.run.updated'
    ) {
      void queryClient.invalidateQueries({ queryKey: ORCHESTRATOR_FLEET_QUERY_KEY });
    }
  }, [applyAgentTasks, applySessionEdges, applySessionsChanged, queryClient]);

  useWebSocket(
    [
      { type: 'sessions' },
      { type: 'session_edges' },
      { type: 'agent_tasks' },
      { type: 'automation_runs' },
    ],
    handleMessage,
    true,
    'orchestrator-fleet'
  );

  const refresh = useCallback(async () => {
    await fleetQuery.refetch();
  }, [fleetQuery]);

  return {
    cards,
    runs,
    hostOnlineById,
    isLoading: fleetQuery.isLoading && cards.length === 0,
    isRefreshing: fleetQuery.isFetching || hostsQuery.isFetching,
    errors: [fleetQuery.error, hostsQuery.error]
      .filter((error): error is Error => error instanceof Error),
    refresh,
  };
}
