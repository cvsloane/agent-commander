'use client';

import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AgentTask,
  AutomationAgent,
  AutomationRun,
  ServerToUIMessage,
  SessionEdge,
  SessionWithSnapshot,
} from '@agent-command/schema';
import {
  getAllSessions,
  getAutomationAgents,
  getAutomationRuns,
  getSessionAgentTasks,
  getSessionGraph,
  type SessionGraphResponse,
  type SessionGraphRollup,
} from '@/lib/api';
import { useWebSocket } from '@/hooks/useWebSocket';

const EMPTY_SESSIONS: SessionWithSnapshot[] = [];
const EMPTY_RUNS: AutomationRun[] = [];
const FLEET_DETAIL_CONCURRENCY = 4;

interface OrchestratorFleetDetail {
  graph?: SessionGraphResponse;
  agentTasks: AgentTask[];
  latestRun?: AutomationRun;
  errors: Error[];
}

export interface OrchestratorFleetCardModel {
  session: SessionWithSnapshot;
  children: SessionWithSnapshot[];
  edges: SessionEdge[];
  agentTasks: AgentTask[];
  rollup?: SessionGraphRollup;
  latestRun?: AutomationRun;
  isLoading: boolean;
  errors: Error[];
}

function runTimestamp(run: AutomationRun): number {
  const value = run.ended_at || run.started_at;
  return value ? new Date(value).getTime() : 0;
}

function asError(reason: unknown, fallback: string): Error {
  return reason instanceof Error ? reason : new Error(fallback);
}

async function loadFleetDetails(
  orchestrators: SessionWithSnapshot[],
  agents: AutomationAgent[]
): Promise<Map<string, OrchestratorFleetDetail>> {
  const details = new Map<string, OrchestratorFleetDetail>();

  for (let index = 0; index < orchestrators.length; index += FLEET_DETAIL_CONCURRENCY) {
    const batch = orchestrators.slice(index, index + FLEET_DETAIL_CONCURRENCY);
    const entries = await Promise.all(batch.map(async (session) => {
      const [graphResult, taskResult] = await Promise.allSettled([
        getSessionGraph(session.id),
        getSessionAgentTasks(session.id),
      ]);
      const graph = graphResult.status === 'fulfilled' ? graphResult.value : undefined;
      const agentTasks = taskResult.status === 'fulfilled' ? taskResult.value.agent_tasks : [];
      const errors: Error[] = [];
      if (graphResult.status === 'rejected') {
        errors.push(asError(graphResult.reason, 'Could not load the session graph.'));
      }
      if (taskResult.status === 'rejected') {
        errors.push(asError(taskResult.reason, 'Could not load agent tasks.'));
      }

      const familySessionIds = new Set([
        session.id,
        ...(graph?.edges ?? [])
          .filter((edge) => edge.parent_session_id === session.id)
          .map((edge) => edge.child_session_id),
      ]);
      const automationAgent = agents.find((agent) => {
        const runtime = agent.runtime_state;
        return Boolean(
          (runtime?.active_session_id && familySessionIds.has(runtime.active_session_id))
          || (runtime?.last_session_id && familySessionIds.has(runtime.last_session_id))
        );
      });

      let latestRun: AutomationRun | undefined;
      if (automationAgent) {
        const reportResult = await Promise.allSettled([
          getAutomationRuns({ automation_agent_id: automationAgent.id, limit: 1 }),
        ]);
        if (reportResult[0]?.status === 'fulfilled') {
          latestRun = reportResult[0].value.runs[0];
        } else if (reportResult[0]?.status === 'rejected') {
          errors.push(asError(reportResult[0].reason, 'Could not load the latest report.'));
        }
      }

      return [session.id, { graph, agentTasks, latestRun, errors }] as const;
    }));
    entries.forEach(([sessionId, detail]) => details.set(sessionId, detail));
  }

  return details;
}

export function useOrchestratorFleet() {
  const queryClient = useQueryClient();
  const sessionsQuery = useQuery({
    queryKey: ['orchestrator-fleet', 'sessions'],
    queryFn: () => getAllSessions({ include_archived: false }),
  });
  const runsQuery = useQuery({
    queryKey: ['orchestrator-fleet', 'runs'],
    queryFn: () => getAutomationRuns({ limit: 100 }),
  });
  const agentsQuery = useQuery({
    queryKey: ['orchestrator-fleet', 'automation-agents'],
    queryFn: getAutomationAgents,
  });

  const sessions = sessionsQuery.data?.sessions ?? EMPTY_SESSIONS;
  const orchestrators = useMemo(
    () => sessions.filter((session) => session.role === 'orchestrator'),
    [sessions]
  );
  const sessionById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions]
  );
  const automationAgents = agentsQuery.data?.agents ?? [];
  const detailsQuery = useQuery({
    queryKey: [
      'orchestrator-fleet',
      'details',
      orchestrators.map((session) => session.id),
      automationAgents.map((agent) => [
        agent.id,
        agent.runtime_state?.active_session_id,
        agent.runtime_state?.last_session_id,
      ]),
    ],
    queryFn: () => loadFleetDetails(orchestrators, automationAgents),
    enabled: orchestrators.length > 0 && !agentsQuery.isLoading,
  });

  const runs = runsQuery.data?.runs ?? EMPTY_RUNS;
  const cards = useMemo<OrchestratorFleetCardModel[]>(() => orchestrators.map((session) => {
    const detail = detailsQuery.data?.get(session.id);
    const edges = detail?.graph?.edges ?? [];
    const children = edges
      .filter((edge) => edge.parent_session_id === session.id)
      .map((edge) => sessionById.get(edge.child_session_id))
      .filter((child): child is SessionWithSnapshot => Boolean(child));
    const familyIds = new Set([session.id, ...children.map((child) => child.id)]);
    const recentFamilyRun = runs
      .filter((run) => run.session_id && familyIds.has(run.session_id))
      .sort((left, right) => runTimestamp(right) - runTimestamp(left))[0];

    return {
      session,
      children: [...new Map(children.map((child) => [child.id, child])).values()],
      edges,
      agentTasks: detail?.agentTasks ?? [],
      rollup: detail?.graph?.rollup,
      latestRun: detail?.latestRun ?? recentFamilyRun,
      isLoading: detailsQuery.isLoading || (agentsQuery.isLoading && !detail),
      errors: detail?.errors ?? [],
    };
  }), [agentsQuery.isLoading, detailsQuery.data, detailsQuery.isLoading, orchestrators, runs, sessionById]);

  const handleMessage = useCallback((message: ServerToUIMessage) => {
    if (message.type === 'sessions.changed') {
      void queryClient.invalidateQueries({ queryKey: ['orchestrator-fleet', 'sessions'] });
      return;
    }
    if (message.type === 'session_edges.changed' || message.type === 'agent_tasks.changed') {
      void queryClient.invalidateQueries({ queryKey: ['orchestrator-fleet', 'details'] });
      return;
    }
    if (message.type === 'automation.runtime_state.updated') {
      void queryClient.invalidateQueries({ queryKey: ['orchestrator-fleet', 'automation-agents'] });
      return;
    }
    if (message.type === 'automation.run.updated') {
      void queryClient.invalidateQueries({ queryKey: ['orchestrator-fleet', 'runs'] });
      void queryClient.invalidateQueries({ queryKey: ['orchestrator-fleet', 'details'] });
    }
  }, [queryClient]);

  useWebSocket([{ type: 'sessions' }, { type: 'automation_runs' }], handleMessage);
  useWebSocket(
    [{ type: 'session_edges' }, { type: 'agent_tasks' }],
    handleMessage,
    true,
    'orchestrator-fleet'
  );

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['orchestrator-fleet'] });
  }, [queryClient]);

  return {
    cards,
    runs,
    isLoading: sessionsQuery.isLoading,
    isRefreshing:
      sessionsQuery.isFetching ||
      runsQuery.isFetching ||
      agentsQuery.isFetching ||
      detailsQuery.isFetching,
    errors: [sessionsQuery.error, runsQuery.error, agentsQuery.error, detailsQuery.error]
      .filter((error): error is Error => error instanceof Error),
    refresh,
  };
}
