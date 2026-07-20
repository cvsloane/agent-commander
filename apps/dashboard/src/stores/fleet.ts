import { create } from 'zustand';
import type {
  AgentTask,
  OrchestratorFleetCard,
  OrchestratorFleetResponse,
  Session,
  SessionEdge,
  SessionWithSnapshot,
  TmuxTopologyPayload,
  TmuxTopologySession,
} from '@agent-command/schema';
import {
  buildFleetRosterGroups,
  type FleetRosterGroup,
} from '@/lib/fleetRoster';

export interface FleetStoreState {
  sessionsById: Record<string, SessionWithSnapshot>;
  orchestratorsById: Record<string, OrchestratorFleetCard>;
  orchestratorIds: string[];
  rosterByHost: Record<string, SessionWithSnapshot[]>;
  hosts: Record<string, TmuxHostTopologyView>;
  liveByHost: Record<string, LiveSnapshot>;
  ingestAggregate: (response: OrchestratorFleetResponse) => void;
  setRoster: (hostId: string, sessions: SessionWithSnapshot[]) => void;
  applySessionsChanged: (sessions: Session[], deleted?: string[]) => void;
  applySessionEdges: (sessionId: string, edges: SessionEdge[]) => void;
  applyAgentTasks: (sessionId: string, agentTasks: AgentTask[]) => void;
  receiveTopology: (hostId: string, payload: TmuxTopologyPayload, receivedAt?: string) => void;
  expireStaleTopologies: (now?: number) => void;
  reset: () => void;
}

export interface TmuxPaneTopologyView {
  paneId: string;
  paneIndex: number;
  active: boolean;
  width?: number;
  height?: number;
  title: string;
  currentCommand: string;
  currentPath: string;
  sessionId?: string;
  sessionStatus?: SessionWithSnapshot['status'];
  sessionTitle?: string | null;
}

export interface TmuxWindowTopologyView {
  windowIndex: number;
  windowName: string;
  active: boolean;
  zoomed: boolean;
  layout: string;
  bell: boolean;
  activity: boolean;
  panes: TmuxPaneTopologyView[];
}

export interface TmuxSessionTopologyView {
  sessionName: string;
  attached: boolean;
  windows: TmuxWindowTopologyView[];
}

export interface TmuxHostTopologyView {
  hostId: string;
  source: 'topology' | 'roster';
  receivedAt?: string;
  sessions: TmuxSessionTopologyView[];
}

interface LiveSnapshot {
  payload: TmuxTopologyPayload;
  receivedAt: string;
}

export const TMUX_TOPOLOGY_STALE_AFTER_MS = 30_000;

function rosterIdentity(session: SessionWithSnapshot) {
  const tmux = session.metadata?.tmux;
  const indexes = session.tmux_target?.match(/:(\d+)(?:\.(\d+))?$/);
  return {
    paneId: tmux?.pane_id || session.tmux_pane_id || session.id,
    paneIndex: session.tmux_pane_index ?? tmux?.pane_index ?? Number(indexes?.[2] ?? 0),
    sessionName:
      session.tmux_session_name
      || tmux?.session_name
      || session.tmux_target?.split(':')[0]
      || 'tmux',
    windowIndex: session.tmux_window_index ?? tmux?.window_index ?? Number(indexes?.[1] ?? 0),
    windowName:
      tmux?.window_name
      || `window ${session.tmux_window_index ?? tmux?.window_index ?? Number(indexes?.[1] ?? 0)}`,
  };
}

export function buildRosterTopology(
  hostId: string,
  sessions: SessionWithSnapshot[]
): TmuxHostTopologyView {
  const sessionGroups = new Map<string, Map<number, TmuxWindowTopologyView>>();

  for (const session of sessions) {
    if (session.host_id !== hostId) continue;
    const identity = rosterIdentity(session);
    const windows = sessionGroups.get(identity.sessionName) ?? new Map<number, TmuxWindowTopologyView>();
    const window = windows.get(identity.windowIndex) ?? {
      windowIndex: identity.windowIndex,
      windowName: identity.windowName,
      active: false,
      zoomed: false,
      layout: '',
      bell: false,
      activity: false,
      panes: [],
    };
    window.panes.push({
      paneId: identity.paneId,
      paneIndex: identity.paneIndex,
      active: false,
      title: session.title || '',
      currentCommand: session.metadata?.tmux?.current_command || '',
      currentPath: session.cwd || '',
      sessionId: session.id,
      sessionStatus: session.status,
      sessionTitle: session.title,
    });
    windows.set(identity.windowIndex, window);
    sessionGroups.set(identity.sessionName, windows);
  }

  return {
    hostId,
    source: 'roster',
    sessions: [...sessionGroups.entries()]
      .map(([sessionName, windows]) => ({
        sessionName,
        attached: false,
        windows: [...windows.values()]
          .map((window) => ({
            ...window,
            panes: [...window.panes].sort((left, right) => left.paneIndex - right.paneIndex),
          }))
          .sort((left, right) => left.windowIndex - right.windowIndex),
      }))
      .sort((left, right) => left.sessionName.localeCompare(right.sessionName)),
  };
}

function joinLiveSession(
  topologySession: TmuxTopologySession,
  rosterByPaneId: Map<string, SessionWithSnapshot>
): TmuxSessionTopologyView {
  return {
    sessionName: topologySession.session_name,
    attached: topologySession.attached,
    windows: topologySession.windows
      .map((window) => ({
        windowIndex: window.window_index,
        windowName: window.window_name,
        active: window.active,
        zoomed: window.zoomed,
        layout: window.layout,
        bell: window.bell,
        activity: window.activity,
        panes: window.panes
          .map((pane) => {
            const rosterSession = rosterByPaneId.get(pane.pane_id);
            return {
              paneId: pane.pane_id,
              paneIndex: pane.pane_index,
              active: pane.active,
              width: pane.width,
              height: pane.height,
              title: pane.title,
              currentCommand: pane.current_command,
              currentPath: pane.current_path,
              sessionId: rosterSession?.id,
              sessionStatus: rosterSession?.status,
              sessionTitle: rosterSession?.title,
            };
          })
          .sort((left, right) => left.paneIndex - right.paneIndex),
      }))
      .sort((left, right) => left.windowIndex - right.windowIndex),
  };
}

export function buildLiveTopology(
  hostId: string,
  payload: TmuxTopologyPayload,
  roster: SessionWithSnapshot[],
  receivedAt: string
): TmuxHostTopologyView {
  const rosterByPaneId = new Map(
    roster.map((session) => [rosterIdentity(session).paneId, session])
  );
  return {
    hostId,
    source: 'topology',
    receivedAt,
    sessions: payload.tmux_sessions
      .map((session) => joinLiveSession(session, rosterByPaneId))
      .sort((left, right) => left.sessionName.localeCompare(right.sessionName)),
  };
}

function liveSnapshotIsFresh(snapshot: LiveSnapshot, now = Date.now()): boolean {
  const receivedAt = Date.parse(snapshot.receivedAt);
  return Number.isFinite(receivedAt) && now - receivedAt <= TMUX_TOPOLOGY_STALE_AFTER_MS;
}

function sameRosterSession(left: SessionWithSnapshot, right: SessionWithSnapshot): boolean {
  if (left === right) return true;
  const leftIdentity = rosterIdentity(left);
  const rightIdentity = rosterIdentity(right);
  return (
    left.id === right.id
    && left.host_id === right.host_id
    && left.status === right.status
    && left.title === right.title
    && left.cwd === right.cwd
    && left.archived_at === right.archived_at
    && left.metadata?.tmux?.current_command === right.metadata?.tmux?.current_command
    && leftIdentity.paneId === rightIdentity.paneId
    && leftIdentity.paneIndex === rightIdentity.paneIndex
    && leftIdentity.sessionName === rightIdentity.sessionName
    && leftIdentity.windowIndex === rightIdentity.windowIndex
    && leftIdentity.windowName === rightIdentity.windowName
  );
}

const initialState = {
  sessionsById: {} as Record<string, SessionWithSnapshot>,
  orchestratorsById: {} as Record<string, OrchestratorFleetCard>,
  orchestratorIds: [] as string[],
  rosterByHost: {} as Record<string, SessionWithSnapshot[]>,
  hosts: {} as Record<string, TmuxHostTopologyView>,
  liveByHost: {} as Record<string, LiveSnapshot>,
};

export const useFleetStore = create<FleetStoreState>((set) => ({
  ...initialState,
  ingestAggregate: (response) => set((state) => {
    const sessionsById = { ...state.sessionsById };
    const orchestratorsById: Record<string, OrchestratorFleetCard> = {};
    const orchestratorIds: string[] = [];

    for (const card of response.orchestrators) {
      orchestratorIds.push(card.session.id);
      orchestratorsById[card.session.id] = card;
      sessionsById[card.session.id] = card.session;
      for (const child of card.children) sessionsById[child.id] = child;
    }

    const rosterByHost = Object.fromEntries(
      Object.entries(state.rosterByHost).map(([hostId, roster]) => [
        hostId,
        roster.map((session) => sessionsById[session.id] ?? session),
      ])
    );
    const hosts = Object.fromEntries(
      Object.entries(rosterByHost).map(([hostId, roster]) => {
        const live = state.liveByHost[hostId];
        return [hostId, live && liveSnapshotIsFresh(live)
          ? buildLiveTopology(hostId, live.payload, roster, live.receivedAt)
          : buildRosterTopology(hostId, roster)];
      })
    );

    return { sessionsById, orchestratorsById, orchestratorIds, rosterByHost, hosts };
  }),
  setRoster: (hostId, sessions) => set((state) => {
    const currentRoster = state.rosterByHost[hostId];
    const sameRoster = Boolean(
      currentRoster
      && currentRoster.length === sessions.length
      && currentRoster.every((session, index) => sameRosterSession(session, sessions[index]!))
    );
    const live = state.liveByHost[hostId];
    const staleLive = live && !liveSnapshotIsFresh(live);
    if (sameRoster && !staleLive) return state;
    const nextLiveByHost = staleLive ? { ...state.liveByHost } : state.liveByHost;
    if (staleLive) delete nextLiveByHost[hostId];
    return {
      sessionsById: sameRoster ? state.sessionsById : {
        ...state.sessionsById,
        ...Object.fromEntries(sessions.map((session) => [session.id, session])),
      },
      rosterByHost: sameRoster
        ? state.rosterByHost
        : { ...state.rosterByHost, [hostId]: sessions },
      liveByHost: nextLiveByHost,
      hosts: {
        ...state.hosts,
        [hostId]: live && !staleLive
          ? buildLiveTopology(hostId, live.payload, sessions, live.receivedAt)
          : buildRosterTopology(hostId, sessions),
      },
    };
  }),
  applySessionsChanged: (sessions, deleted = []) => set((state) => {
    const sessionsById = { ...state.sessionsById };
    const changedById = new Map<string, SessionWithSnapshot>();
    const deletedIds = new Set(deleted);

    for (const sessionId of deletedIds) delete sessionsById[sessionId];

    for (const session of sessions) {
      const current = sessionsById[session.id];
      const changed: SessionWithSnapshot = {
        ...current,
        ...session,
        latest_snapshot: current?.latest_snapshot ?? null,
      };
      sessionsById[session.id] = changed;
      changedById.set(session.id, changed);
    }

    const rosterByHost = Object.fromEntries(
      Object.entries(state.rosterByHost).map(([hostId, roster]) => {
        const next = roster
          .filter((session) => !deletedIds.has(session.id))
          .map((session) => changedById.get(session.id) ?? session);
        for (const changed of changedById.values()) {
          if (
            changed.host_id === hostId
            && changed.kind === 'tmux_pane'
            && !changed.archived_at
            && !next.some((session) => session.id === changed.id)
          ) {
            next.push(changed);
          }
        }
        return [hostId, next];
      })
    );
    const orchestratorsById = Object.fromEntries(
      Object.entries(state.orchestratorsById)
        .filter(([, card]) => !deletedIds.has(card.session.id))
        .map(([id, card]) => [id, {
          ...card,
          session: changedById.get(card.session.id) ?? card.session,
          children: card.children
            .filter((child) => !deletedIds.has(child.id))
            .map((child) => changedById.get(child.id) ?? child),
        }])
    );
    const hosts = Object.fromEntries(
      Object.entries(rosterByHost).map(([hostId, roster]) => {
        const live = state.liveByHost[hostId];
        return [hostId, live && liveSnapshotIsFresh(live)
          ? buildLiveTopology(hostId, live.payload, roster, live.receivedAt)
          : buildRosterTopology(hostId, roster)];
      })
    );

    return {
      sessionsById,
      rosterByHost,
      orchestratorsById,
      orchestratorIds: state.orchestratorIds.filter((id) => !deletedIds.has(id)),
      hosts,
    };
  }),
  applySessionEdges: (sessionId, edges) => set((state) => {
    const current = state.orchestratorsById[sessionId];
    if (!current) return state;
    const childIds = new Set(
      edges
        .filter((edge) => edge.parent_session_id === sessionId)
        .map((edge) => edge.child_session_id)
    );
    return {
      orchestratorsById: {
        ...state.orchestratorsById,
        [sessionId]: {
          ...current,
          edges,
          children: [...childIds].flatMap((id) => {
            const child = state.sessionsById[id];
            return child ? [child] : [];
          }),
        },
      },
    };
  }),
  applyAgentTasks: (sessionId, agentTasks) => set((state) => {
    const current = state.orchestratorsById[sessionId];
    if (!current) return state;
    return {
      orchestratorsById: {
        ...state.orchestratorsById,
        [sessionId]: { ...current, agent_tasks: agentTasks },
      },
    };
  }),
  receiveTopology: (hostId, payload, receivedAt = new Date().toISOString()) => set((state) => ({
    liveByHost: {
      ...state.liveByHost,
      [hostId]: { payload, receivedAt },
    },
    hosts: {
      ...state.hosts,
      [hostId]: buildLiveTopology(hostId, payload, state.rosterByHost[hostId] ?? [], receivedAt),
    },
  })),
  expireStaleTopologies: (now = Date.now()) => set((state) => {
    const staleHostIds = Object.entries(state.liveByHost)
      .filter(([, snapshot]) => !liveSnapshotIsFresh(snapshot, now))
      .map(([hostId]) => hostId);
    if (staleHostIds.length === 0) return state;
    const liveByHost = { ...state.liveByHost };
    const hosts = { ...state.hosts };
    for (const hostId of staleHostIds) {
      delete liveByHost[hostId];
      hosts[hostId] = buildRosterTopology(hostId, state.rosterByHost[hostId] ?? []);
    }
    return { liveByHost, hosts };
  }),
  reset: () => set(initialState),
}));

type FleetCardSelectionState = Pick<
  FleetStoreState,
  'orchestratorIds' | 'orchestratorsById'
>;

type FleetRosterSelectionState = FleetCardSelectionState & Pick<
  FleetStoreState,
  'rosterByHost'
>;

export function selectFleetCards(state: FleetCardSelectionState): OrchestratorFleetCard[] {
  return state.orchestratorIds.flatMap((id) => {
    const card = state.orchestratorsById[id];
    return card ? [card] : [];
  });
}

function selectFleetEdges(state: FleetCardSelectionState): SessionEdge[] {
  return [
    ...new Map(
      selectFleetCards(state)
        .flatMap((card) => card.edges)
        .map((edge) => [
          `${edge.parent_session_id}:${edge.child_session_id}:${edge.edge_type}`,
          edge,
        ])
    ).values(),
  ];
}

export function selectFleetRosterGroups(
  state: FleetRosterSelectionState,
  hostIds: string[],
  options: { allHosts?: boolean; waitingFirst?: boolean } = {}
): FleetRosterGroup[] {
  const sessions = [
    ...new Map(
      hostIds
        .flatMap((hostId) => state.rosterByHost[hostId] ?? [])
        .map((session) => [session.id, session])
    ).values(),
  ];
  return buildFleetRosterGroups(sessions, selectFleetEdges(state), options);
}
