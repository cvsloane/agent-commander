import type { SessionWithSnapshot, TmuxPaneIdentity } from '@agent-command/schema';
import { getProviderDisplayName, getSessionDisplayName } from '@/lib/utils';

export interface TmuxPaneView {
  session: SessionWithSnapshot;
  identity: TmuxPaneIdentity;
  tmuxSessionName: string;
  windowName: string;
  windowIndex: number;
  paneIndex: number;
  lastActivityAt: string;
  isUnmanaged: boolean;
}

export interface TmuxWindowView {
  key: string;
  tmuxSessionName: string;
  windowName: string;
  windowIndex: number;
  panes: TmuxPaneView[];
  selectedPane: TmuxPaneView;
  lastActivityAt: string;
  providerSummary: string;
  repoOrCwd: string;
  branch: string | null;
  hasUnmanaged: boolean;
}

export interface TmuxSessionCluster {
  key: string;
  hostId: string;
  tmuxSessionName: string;
  windows: TmuxWindowView[];
  paneCount: number;
  windowCount: number;
  lastActivityAt: string;
  providerSummary: string;
  repoOrCwd: string;
  branch: string | null;
  hasUnmanaged: boolean;
}

export const TMUX_ROSTER_FILTERS = ['all', 'waiting', 'errors', 'active', 'dirty', 'untracked'] as const;
export type TmuxRosterFilter = (typeof TMUX_ROSTER_FILTERS)[number];

export function parseTargetIndexes(target: string | null | undefined): { windowIndex?: number; paneIndex?: number } {
  if (!target) return {};
  const match = target.match(/:(\d+)(?:\.(\d+))?$/);
  if (!match) return {};
  return {
    windowIndex: match[1] ? Number(match[1]) : undefined,
    paneIndex: match[2] ? Number(match[2]) : undefined,
  };
}

export function getPaneData(session: SessionWithSnapshot): TmuxPaneView {
  const tmuxMeta = session.metadata?.tmux as {
    session_name?: string;
    window_name?: string;
    window_index?: number;
    pane_index?: number;
    pane_id?: string;
    target?: string;
  } | undefined;
  const parsedTarget = parseTargetIndexes(session.tmux_target);
  const tmuxSessionName = session.tmux_session_name?.trim()
    || tmuxMeta?.session_name?.trim()
    || session.tmux_target?.split(':')[0]
    || 'tmux';
  const windowIndex = typeof session.tmux_window_index === 'number'
    ? session.tmux_window_index
    : typeof tmuxMeta?.window_index === 'number'
    ? tmuxMeta.window_index
    : parsedTarget.windowIndex ?? 0;
  const paneIndex = typeof session.tmux_pane_index === 'number'
    ? session.tmux_pane_index
    : typeof tmuxMeta?.pane_index === 'number'
    ? tmuxMeta.pane_index
    : parsedTarget.paneIndex ?? 0;
  const rawWindowName = tmuxMeta?.window_name?.trim();
  const windowName = rawWindowName || `window ${windowIndex}`;
  const target = tmuxMeta?.target
    || session.tmux_target
    || `${tmuxSessionName}:${windowIndex}.${paneIndex}`;

  return {
    session,
    identity: {
      pane_id: tmuxMeta?.pane_id || session.tmux_pane_id || session.id,
      target,
      session_name: tmuxSessionName,
      window_name: windowName,
      window_index: windowIndex,
      pane_index: paneIndex,
    },
    tmuxSessionName,
    windowName,
    windowIndex,
    paneIndex,
    lastActivityAt: session.last_activity_at || session.updated_at,
    isUnmanaged: Boolean(session.metadata?.unmanaged),
  };
}

function compareByNewest(a: { lastActivityAt: string }, b: { lastActivityAt: string }) {
  return new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
}

export function buildTmuxClusters(
  sessions: SessionWithSnapshot[],
  options: { scopeByHost?: boolean } = {}
): TmuxSessionCluster[] {
  const sessionMap = new Map<string, Map<string, TmuxPaneView[]>>();

  for (const session of sessions) {
    const pane = getPaneData(session);
    const clusterKey = options.scopeByHost
      ? `${session.host_id}:${pane.tmuxSessionName}`
      : pane.tmuxSessionName;
    const windowKey = `${pane.windowIndex}:${pane.windowName}`;
    if (!sessionMap.has(clusterKey)) {
      sessionMap.set(clusterKey, new Map());
    }
    const windowMap = sessionMap.get(clusterKey)!;
    if (!windowMap.has(windowKey)) {
      windowMap.set(windowKey, []);
    }
    windowMap.get(windowKey)!.push(pane);
  }

  return Array.from(sessionMap.entries())
    .map(([clusterKey, windowMap]) => {
      const allPanes = Array.from(windowMap.values()).flat();
      const tmuxSessionName = allPanes[0]?.tmuxSessionName ?? 'tmux';
      return {
        key: clusterKey,
        hostId: allPanes[0]?.session.host_id ?? '',
        tmuxSessionName,
        windows: Array.from(windowMap.entries())
        .map(([windowKey, panes]) => {
          const sortedPanes = [...panes].sort((a, b) => a.paneIndex - b.paneIndex);
          const selectedPane = [...panes].sort(compareByNewest)[0] ?? panes[0]!;
          const providerSummary = Array.from(
            new Set(sortedPanes.map((pane) => getProviderDisplayName(pane.session.provider)))
          ).join(', ');
          return {
            key: windowKey,
            tmuxSessionName,
            windowName: selectedPane.windowName,
            windowIndex: selectedPane.windowIndex,
            panes: sortedPanes,
            selectedPane,
            lastActivityAt: selectedPane.lastActivityAt,
            providerSummary,
            repoOrCwd: selectedPane.session.cwd || 'No working directory',
            branch: selectedPane.session.git_branch || null,
            hasUnmanaged: sortedPanes.some((pane) => pane.isUnmanaged),
          } satisfies TmuxWindowView;
        })
        .sort((a, b) => a.windowIndex - b.windowIndex || a.windowName.localeCompare(b.windowName)),
        paneCount: Array.from(windowMap.values()).reduce((count, panes) => count + panes.length, 0),
        windowCount: windowMap.size,
        lastActivityAt: Array.from(windowMap.values())
          .flat()
          .sort(compareByNewest)[0]?.lastActivityAt ?? new Date(0).toISOString(),
        providerSummary: Array.from(
          new Set(
            Array.from(windowMap.values())
              .flat()
              .map((pane) => getProviderDisplayName(pane.session.provider))
          )
        ).join(', '),
        repoOrCwd:
          Array.from(windowMap.values())
            .flat()
            .sort(compareByNewest)[0]?.session.cwd || 'No working directory',
        branch:
          Array.from(windowMap.values())
          .flat()
            .sort(compareByNewest)[0]?.session.git_branch || null,
        hasUnmanaged: Array.from(windowMap.values()).some((panes) => panes.some((pane) => pane.isUnmanaged)),
      };
    })
    .sort((a, b) => a.tmuxSessionName.localeCompare(b.tmuxSessionName));
}

export function matchesTmuxFilter(session: SessionWithSnapshot, query: string): boolean {
  if (!query.trim()) return true;

  const tmuxMeta = session.metadata?.tmux as {
    session_name?: string;
    window_name?: string;
  } | undefined;
  const haystack = [
    session.title,
    session.cwd,
    session.repo_root,
    session.git_branch,
    session.provider,
    session.tmux_target,
    tmuxMeta?.session_name,
    tmuxMeta?.window_name,
    getSessionDisplayName(session),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(query.trim().toLowerCase());
}

function getGitStatus(session: SessionWithSnapshot) {
  return session.metadata?.git_status as {
    staged?: number;
    unstaged?: number;
    untracked?: number;
    unmerged?: number;
  } | undefined;
}

export function isTmuxSessionDirty(session: SessionWithSnapshot): boolean {
  const gitStatus = getGitStatus(session);
  if (!gitStatus) return false;
  return Boolean(
    gitStatus.staged ||
    gitStatus.unstaged ||
    gitStatus.untracked ||
    gitStatus.unmerged
  );
}

export function matchesTmuxRosterFilter(session: SessionWithSnapshot, filter: TmuxRosterFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'waiting':
      return session.status === 'WAITING_FOR_INPUT' || session.status === 'WAITING_FOR_APPROVAL';
    case 'errors':
      return session.status === 'ERROR';
    case 'active':
      return session.status === 'RUNNING' || session.status === 'STARTING';
    case 'dirty':
      return isTmuxSessionDirty(session);
    case 'untracked':
      return Boolean(session.metadata?.unmanaged || getGitStatus(session)?.untracked);
  }
}
