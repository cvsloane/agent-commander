import { create } from 'zustand';
import type {
  SessionWithSnapshot,
  TmuxTopologyPayload,
  TmuxTopologySession,
} from '@agent-command/schema';

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

interface TmuxTopologyStore {
  hosts: Record<string, TmuxHostTopologyView>;
  rosterByHost: Record<string, SessionWithSnapshot[]>;
  liveByHost: Record<string, LiveSnapshot>;
  setRoster: (hostId: string, sessions: SessionWithSnapshot[]) => void;
  receiveTopology: (hostId: string, payload: TmuxTopologyPayload, receivedAt?: string) => void;
  reset: () => void;
}

function rosterIdentity(session: SessionWithSnapshot) {
  const tmux = session.metadata?.tmux;
  const indexes = session.tmux_target?.match(/:(\d+)(?:\.(\d+))?$/);
  return {
    paneId: tmux?.pane_id || session.tmux_pane_id || session.id,
    paneIndex: session.tmux_pane_index ?? tmux?.pane_index ?? Number(indexes?.[2] ?? 0),
    sessionName:
      session.tmux_session_name ||
      tmux?.session_name ||
      session.tmux_target?.split(':')[0] ||
      'tmux',
    windowIndex: session.tmux_window_index ?? tmux?.window_index ?? Number(indexes?.[1] ?? 0),
    windowName:
      tmux?.window_name ||
      `window ${session.tmux_window_index ?? tmux?.window_index ?? Number(indexes?.[1] ?? 0)}`,
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
    const windows =
      sessionGroups.get(identity.sessionName) ?? new Map<number, TmuxWindowTopologyView>();
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

const initialState = {
  hosts: {} as Record<string, TmuxHostTopologyView>,
  rosterByHost: {} as Record<string, SessionWithSnapshot[]>,
  liveByHost: {} as Record<string, LiveSnapshot>,
};

export const useTmuxTopologyStore = create<TmuxTopologyStore>((set) => ({
  ...initialState,
  setRoster: (hostId, sessions) =>
    set((state) => {
      const currentRoster = state.rosterByHost[hostId];
      if (
        currentRoster &&
        currentRoster.length === sessions.length &&
        currentRoster.every((session, index) => session === sessions[index])
      ) {
        return state;
      }
      const live = state.liveByHost[hostId];
      return {
        rosterByHost: { ...state.rosterByHost, [hostId]: sessions },
        hosts: {
          ...state.hosts,
          [hostId]: live
            ? buildLiveTopology(hostId, live.payload, sessions, live.receivedAt)
            : buildRosterTopology(hostId, sessions),
        },
      };
    }),
  receiveTopology: (hostId, payload, receivedAt = new Date().toISOString()) =>
    set((state) => ({
      liveByHost: {
        ...state.liveByHost,
        [hostId]: { payload, receivedAt },
      },
      hosts: {
        ...state.hosts,
        [hostId]: buildLiveTopology(hostId, payload, state.rosterByHost[hostId] ?? [], receivedAt),
      },
    })),
  reset: () => set(initialState),
}));
