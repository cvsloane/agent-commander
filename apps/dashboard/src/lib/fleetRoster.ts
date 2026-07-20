import type { SessionEdge, SessionWithSnapshot } from '@agent-command/schema';
import {
  buildTmuxClusters,
  getPaneData,
  type TmuxPaneView,
  type TmuxSessionCluster,
} from './tmuxRoster';
import { getSessionDisplayName } from './utils';

export interface OrchestratorFleetGroup {
  kind: 'orchestrator';
  key: string;
  title: string;
  orchestrator: TmuxPaneView;
  workers: TmuxPaneView[];
  paneCount: number;
  lastActivityAt: string;
  hostIds: string[];
}

export interface PlainTmuxFleetGroup {
  kind: 'tmux';
  key: string;
  cluster: TmuxSessionCluster;
  paneCount: number;
  lastActivityAt: string;
  hostIds: string[];
}

export type FleetRosterGroup = OrchestratorFleetGroup | PlainTmuxFleetGroup;

const WAITING_STATUSES = new Set(['WAITING_FOR_APPROVAL', 'WAITING_FOR_INPUT']);

export function fleetStatusRank(status: string): number {
  if (status === 'WAITING_FOR_APPROVAL') return 0;
  if (status === 'WAITING_FOR_INPUT') return 1;
  if (status === 'ERROR') return 2;
  if (status === 'STARTING' || status === 'RUNNING') return 3;
  if (status === 'IDLE') return 4;
  return 5;
}

function newestTimestamp(sessions: SessionWithSnapshot[]): string {
  return sessions.reduce((newest, session) => {
    const candidate = session.last_activity_at || session.updated_at;
    return new Date(candidate).getTime() > new Date(newest).getTime() ? candidate : newest;
  }, new Date(0).toISOString());
}

function groupStatusRank(group: FleetRosterGroup): number {
  if (group.kind === 'orchestrator') {
    return Math.min(
      fleetStatusRank(group.orchestrator.session.status),
      ...group.workers.map((worker) => fleetStatusRank(worker.session.status))
    );
  }
  return Math.min(
    ...group.cluster.windows.flatMap((window) => (
      window.panes.map((pane) => fleetStatusRank(pane.session.status))
    ))
  );
}

function groupLabel(group: FleetRosterGroup): string {
  return group.kind === 'orchestrator' ? group.title : group.cluster.tmuxSessionName;
}

export function buildFleetRosterGroups(
  sessions: SessionWithSnapshot[],
  edges: SessionEdge[],
  options: { allHosts?: boolean; waitingFirst?: boolean } = {}
): FleetRosterGroup[] {
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const childrenByParent = new Map<string, Set<string>>();

  for (const edge of edges) {
    if (!sessionById.has(edge.parent_session_id) || !sessionById.has(edge.child_session_id)) continue;
    const children = childrenByParent.get(edge.parent_session_id) ?? new Set<string>();
    children.add(edge.child_session_id);
    childrenByParent.set(edge.parent_session_id, children);
  }

  const claimedSessionIds = new Set<string>();
  const orchestratorGroups: OrchestratorFleetGroup[] = [];

  for (const [parentId, childIds] of childrenByParent) {
    const parent = sessionById.get(parentId);
    if (!parent) continue;
    const children = [...childIds]
      .map((childId) => sessionById.get(childId))
      .filter((child): child is SessionWithSnapshot => Boolean(child))
      .sort((left, right) => (
        fleetStatusRank(left.status) - fleetStatusRank(right.status)
        || new Date(right.last_activity_at || right.updated_at).getTime()
          - new Date(left.last_activity_at || left.updated_at).getTime()
      ));
    if (children.length === 0) continue;

    claimedSessionIds.add(parent.id);
    children.forEach((child) => claimedSessionIds.add(child.id));
    const family = [parent, ...children];
    orchestratorGroups.push({
      kind: 'orchestrator',
      key: `orchestrator:${parent.id}`,
      title: getSessionDisplayName(parent),
      orchestrator: getPaneData(parent),
      workers: children.map(getPaneData),
      paneCount: family.length,
      lastActivityAt: newestTimestamp(family),
      hostIds: [...new Set(family.map((session) => session.host_id))],
    });
  }

  const ungroupedSessions = sessions.filter((session) => !claimedSessionIds.has(session.id));
  const tmuxGroups: PlainTmuxFleetGroup[] = buildTmuxClusters(ungroupedSessions, {
    scopeByHost: options.allHosts,
  }).map((cluster) => ({
    kind: 'tmux',
    key: `tmux:${cluster.key}`,
    cluster,
    paneCount: cluster.paneCount,
    lastActivityAt: cluster.lastActivityAt,
    hostIds: [cluster.hostId],
  }));

  const groups: FleetRosterGroup[] = [...orchestratorGroups, ...tmuxGroups];
  return groups.sort((left, right) => {
    if (options.waitingFirst) {
      const rankDifference = groupStatusRank(left) - groupStatusRank(right);
      if (rankDifference !== 0) return rankDifference;
      const leftWaiting = groupSessions(left).filter((session) => WAITING_STATUSES.has(session.status)).length;
      const rightWaiting = groupSessions(right).filter((session) => WAITING_STATUSES.has(session.status)).length;
      if (leftWaiting !== rightWaiting) return rightWaiting - leftWaiting;
    }
    if (left.kind !== right.kind) return left.kind === 'orchestrator' ? -1 : 1;
    return groupLabel(left).localeCompare(groupLabel(right));
  });
}

export function groupSessions(group: FleetRosterGroup): SessionWithSnapshot[] {
  if (group.kind === 'orchestrator') {
    return [group.orchestrator.session, ...group.workers.map((worker) => worker.session)];
  }
  return group.cluster.windows.flatMap((window) => window.panes.map((pane) => pane.session));
}

/**
 * Filter at the fleet-family boundary so a matching worker never loses the
 * orchestrator context that makes the row actionable.
 */
export function filterFleetRosterGroups(
  groups: FleetRosterGroup[],
  predicate: (session: SessionWithSnapshot) => boolean
): FleetRosterGroup[] {
  return groups.flatMap((group): FleetRosterGroup[] => {
    if (group.kind === 'orchestrator') {
      return groupSessions(group).some(predicate) ? [group] : [];
    }

    const matchingSessions = groupSessions(group).filter(predicate);
    if (matchingSessions.length === 0) return [];
    const wasScopedByHost = group.cluster.key
      === `${group.cluster.hostId}:${group.cluster.tmuxSessionName}`;
    return buildTmuxClusters(matchingSessions, { scopeByHost: wasScopedByHost }).map((cluster) => ({
      kind: 'tmux' as const,
      key: `tmux:${cluster.key}`,
      cluster,
      paneCount: cluster.paneCount,
      lastActivityAt: cluster.lastActivityAt,
      hostIds: [cluster.hostId],
    }));
  });
}

export function fleetGroupForSession(
  groups: FleetRosterGroup[],
  sessionId: string
): FleetRosterGroup | undefined {
  return groups.find((group) => groupSessions(group).some((session) => session.id === sessionId));
}
