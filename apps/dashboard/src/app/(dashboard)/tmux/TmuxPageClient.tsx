'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Monitor,
  Moon,
  Plug,
  Power,
  RefreshCw,
  Rows3,
  Search,
  Send,
  Sun,
} from 'lucide-react';
import { assignSessionGroup, getAllSessions, getHosts } from '@/lib/api';
import { useSessionDetail } from '@/hooks/useSessionDetail';
import { useSessionIdle } from '@/hooks/useSessionIdle';
import { useTerminateSession } from '@/hooks/useTerminateSession';
import { useWebSocket } from '@/hooks/useWebSocket';
import { MCPManagerModal, useMCPManager } from '@/components/mcp/MCPManagerModal';
import { SendToSessionDialog } from '@/components/SendToSessionDialog';
import { SessionWorkbench } from '@/components/session/SessionWorkbench';
import { StatusBadge } from '@/components/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  cn,
  formatRelativeTime,
  getProviderDisplayName,
  getProviderIcon,
  getSessionDisplayName,
  getStatusIndicator,
  isHostOnline,
} from '@/lib/utils';
import { useHydrated } from '@/hooks/useHydrated';
import type { Host, ServerToUIMessage, SessionWithSnapshot } from '@agent-command/schema';

interface TmuxPaneView {
  session: SessionWithSnapshot;
  tmuxSessionName: string;
  windowName: string;
  windowIndex: number;
  paneIndex: number;
  lastActivityAt: string;
  isUnmanaged: boolean;
}

interface TmuxWindowView {
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

interface TmuxSessionCluster {
  key: string;
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

function parseTargetIndexes(target: string | null | undefined): { windowIndex?: number; paneIndex?: number } {
  if (!target) return {};
  const match = target.match(/:(\d+)(?:\.(\d+))?$/);
  if (!match) return {};
  return {
    windowIndex: match[1] ? Number(match[1]) : undefined,
    paneIndex: match[2] ? Number(match[2]) : undefined,
  };
}

function getPaneData(session: SessionWithSnapshot): TmuxPaneView {
  const tmuxMeta = session.metadata?.tmux as {
    session_name?: string;
    window_name?: string;
    window_index?: number;
    pane_index?: number;
  } | undefined;
  const parsedTarget = parseTargetIndexes(session.tmux_target);
  const tmuxSessionName = tmuxMeta?.session_name?.trim()
    || session.tmux_target?.split(':')[0]
    || 'tmux';
  const windowIndex = typeof tmuxMeta?.window_index === 'number'
    ? tmuxMeta.window_index
    : parsedTarget.windowIndex ?? 0;
  const paneIndex = typeof tmuxMeta?.pane_index === 'number'
    ? tmuxMeta.pane_index
    : parsedTarget.paneIndex ?? 0;
  const rawWindowName = tmuxMeta?.window_name?.trim();
  const windowName = rawWindowName || `window ${windowIndex}`;

  return {
    session,
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

function buildTmuxClusters(sessions: SessionWithSnapshot[]): TmuxSessionCluster[] {
  const sessionMap = new Map<string, Map<string, TmuxPaneView[]>>();

  for (const session of sessions) {
    const pane = getPaneData(session);
    const clusterKey = pane.tmuxSessionName;
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
    .map(([tmuxSessionName, windowMap]) => ({
      key: tmuxSessionName,
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
    }))
    .sort((a, b) => a.tmuxSessionName.localeCompare(b.tmuxSessionName));
}

function matchesTmuxFilter(session: SessionWithSnapshot, query: string): boolean {
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

export default function TmuxPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const hydrated = useHydrated();
  const mcpManager = useMCPManager();
  const { setSessionIdle, isSessionIdlePending } = useSessionIdle();
  const { terminateSession, isTerminating } = useTerminateSession();
  const rosterRefetchTimerRef = useRef<number | null>(null);
  const [workbenchViewMode, setWorkbenchViewMode] = useState<'console' | 'terminal'>('terminal');
  const [sendToDialogOpen, setSendToDialogOpen] = useState(false);
  const [sendToTargetId, setSendToTargetId] = useState<string | undefined>(undefined);
  const [expandedClusterKey, setExpandedClusterKey] = useState<string | null>(null);
  const previousSelectedSessionIdRef = useRef<string>('');

  const hostIdParam = searchParams.get('host_id') || '';
  const sessionIdParam = searchParams.get('session_id') || '';
  const query = searchParams.get('q') || '';

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
    const map = new Map<string, Host>();
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
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (!value) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    const next = params.toString();
    router.replace(`/tmux${next ? `?${next}` : ''}`);
  }, [router, searchParams]);

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
    queryFn: () => getAllSessions({ host_id: selectedHostId }),
    enabled: Boolean(selectedHostId),
  });

  const tmuxSessions = useMemo(() => (
    sessionsData?.sessions?.filter((session) => session.kind === 'tmux_pane' && !session.archived_at) ?? []
  ), [sessionsData]);

  const filteredSessions = useMemo(
    () => tmuxSessions.filter((session) => matchesTmuxFilter(session, query)),
    [query, tmuxSessions]
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

  const {
    data: sessionDetailData,
    session: selectedSession,
    snapshot,
    events,
    host: selectedSessionHost,
    isLoading: selectedSessionLoading,
    refetch: refetchSelectedSession,
  } = useSessionDetail(selectedSessionId || null);

  const scheduleRosterRefresh = useCallback(() => {
    if (rosterRefetchTimerRef.current || !selectedHostId) return;
    rosterRefetchTimerRef.current = window.setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: ['sessions', 'tmux', selectedHostId] });
      rosterRefetchTimerRef.current = null;
    }, 750);
  }, [queryClient, selectedHostId]);

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

  const handleRefresh = useCallback(() => {
    void refetchHosts();
    if (selectedHostId) {
      void refetchSessions();
    }
    if (selectedSessionId) {
      void refetchSelectedSession();
    }
  }, [refetchHosts, refetchSelectedSession, refetchSessions, selectedHostId, selectedSessionId]);

  const handleSelectHost = (hostId: string) => {
    updateTmuxParams({
      host_id: hostId,
      session_id: null,
    });
  };

  const handleSelectPane = (sessionId: string) => {
    const clusterKey = sessionToClusterKey.get(sessionId);
    if (clusterKey) {
      setExpandedClusterKey(clusterKey);
    }
    updateTmuxParams({ session_id: sessionId });
  };

  const handleSelectWindow = (sessionId: string) => {
    const clusterKey = sessionToClusterKey.get(sessionId);
    if (clusterKey) {
      setExpandedClusterKey(clusterKey);
    }
    updateTmuxParams({ session_id: sessionId });
  };

  const handleToggleCluster = (clusterKey: string) => {
    setExpandedClusterKey((current) => (current === clusterKey ? null : clusterKey));
  };

  const handleAssignGroup = async (groupId: string | null) => {
    if (!selectedSessionId) return;
    try {
      await assignSessionGroup(selectedSessionId, groupId);
      await refetchSelectedSession();
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      queryClient.invalidateQueries({ queryKey: ['sessions', 'tmux', selectedHostId] });
    } catch (error) {
      console.error('Failed to assign session to group:', error);
    }
  };

  const handleSendToFromLinks = (targetSessionId: string) => {
    setSendToTargetId(targetSessionId);
    setSendToDialogOpen(true);
  };

  const handleCloseSendToDialog = () => {
    setSendToDialogOpen(false);
    setSendToTargetId(undefined);
  };

  const handleIdleToggle = async () => {
    if (!selectedSession || !selectedSessionId) return;
    const pending = isSessionIdlePending(selectedSessionId);
    if (pending) return;
    try {
      await setSessionIdle(selectedSessionId, !selectedSession.idled_at);
      await refetchSelectedSession();
      queryClient.invalidateQueries({ queryKey: ['sessions', 'tmux', selectedHostId] });
    } catch (error) {
      console.error('Failed to update idle state:', error);
    }
  };

  const handleTerminate = async () => {
    if (!selectedSession || isTerminating) return;
    const confirmed = window.confirm(
      `Terminate "${getSessionDisplayName(selectedSession)}"? This will archive the session.`
    );
    if (!confirmed) return;
    try {
      await terminateSession(selectedSession);
      queryClient.invalidateQueries({ queryKey: ['sessions', 'tmux', selectedHostId] });
    } catch (error) {
      console.error('Failed to terminate session:', error);
    }
  };

  if (!hostsLoading && tmuxHosts.length === 0) {
    return (
      <div className="container mx-auto px-4 py-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-3 text-xl">
              <Rows3 className="h-5 w-5 text-primary" />
              tmux
            </CardTitle>
            <CardDescription>
              No tmux-capable hosts are registered yet. Connect an `agentd` host with tmux support to use the tmux manager.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Rows3 className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">tmux</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Work from the machine’s live tmux windows directly. Sessions and automation remain available as separate operator views.
          </p>
        </div>
        <Button variant="outline" onClick={handleRefresh} className="gap-2 self-start">
          <RefreshCw className={cn('h-4 w-4', sessionsFetching && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Hosts</CardTitle>
          <CardDescription>Select a machine, then drill into its live tmux windows.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {tmuxHosts.map((host) => {
            const online = isHostOnline(host.last_seen_at ?? null);
            const active = host.id === selectedHostId;
            return (
              <button
                key={host.id}
                type="button"
                onClick={() => handleSelectHost(host.id)}
                className={cn(
                  'inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'bg-background hover:bg-accent hover:text-accent-foreground'
                )}
              >
                <span
                  className={cn(
                    'h-2 w-2 rounded-full',
                    online ? 'bg-green-500' : active ? 'bg-primary-foreground/70' : 'bg-gray-400'
                  )}
                />
                <span className="font-medium">{host.name}</span>
                {host.tailscale_name && (
                  <span className={cn('text-xs', active ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                    {host.tailscale_name}
                  </span>
                )}
              </button>
            );
          })}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Live tmux Sessions</CardTitle>
              <CardDescription>
                {selectedHost
                  ? `${selectedHost.name}${selectedHost.tailscale_name ? ` · ${selectedHost.tailscale_name}` : ''}`
                  : 'Select a host'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => updateTmuxParams({ q: event.target.value || null })}
                  placeholder="Filter by tmux session, cwd, branch, repo, provider..."
                  className="pl-9"
                />
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {clusters.length} sessions · {filteredSessions.length} panes
                </span>
                {selectedHost && (
                  <span suppressHydrationWarning>
                    {hydrated && selectedHost.last_seen_at
                      ? `Last seen ${formatRelativeTime(selectedHost.last_seen_at)}`
                      : 'Waiting for host heartbeat'}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="min-h-[480px]">
            <CardContent className="p-0">
              {sessionsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : sessionsError ? (
                <div className="p-6 text-sm text-destructive">
                  Failed to load tmux sessions for this host.
                </div>
              ) : clusters.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground">
                  No tmux panes matched this host and filter.
                </div>
              ) : (
                <div className="space-y-4 p-3">
                  <div className="space-y-2">
                    {clusters.map((cluster) => {
                      const expanded = expandedClusterKey === cluster.key;
                      const active = cluster.key === selectedClusterKey;
                      return (
                        <div
                          key={cluster.key}
                          className={cn(
                            'rounded-xl border bg-background transition-colors',
                            active && 'border-primary bg-primary/5'
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => handleToggleCluster(cluster.key)}
                            className={cn(
                              'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left transition-colors',
                              expanded ? 'bg-accent/40' : 'hover:bg-accent/30'
                            )}
                          >
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex items-center gap-2">
                                <Monitor className="h-4 w-4 text-primary" />
                                <span className="truncate font-medium">{cluster.tmuxSessionName}</span>
                                {cluster.hasUnmanaged && (
                                  <Badge variant="outline" className="text-[10px]">
                                    Untracked
                                  </Badge>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <span>{cluster.windowCount} windows</span>
                                <span>•</span>
                                <span>{cluster.paneCount} panes</span>
                                <span>•</span>
                                <span>{cluster.providerSummary || 'Unknown provider'}</span>
                                {cluster.branch && (
                                  <>
                                    <span>•</span>
                                    <span>{cluster.branch}</span>
                                  </>
                                )}
                              </div>
                              <div className="truncate text-xs text-muted-foreground">
                                {cluster.repoOrCwd}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <span className="text-[11px] text-muted-foreground" suppressHydrationWarning>
                                {hydrated ? formatRelativeTime(cluster.lastActivityAt) : '—'}
                              </span>
                              {expanded ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              )}
                            </div>
                          </button>

                          {expanded && (
                            <div className="space-y-3 border-t px-3 pb-3 pt-3">
                              <div className="text-xs text-muted-foreground">
                                Click a window or pane below to open it in the workbench.
                              </div>
                              <div className="space-y-3">
                                {cluster.windows.map((window) => {
                                  const windowSelected = window.key === selectedWindowKey;
                                  const paneCount = window.panes.length;
                                  const windowLabel = `${window.windowIndex}${window.windowName !== `window ${window.windowIndex}` ? ` · ${window.windowName}` : ''}`;
                                  return (
                                    <div key={window.key} className="rounded-lg border bg-background">
                                      <button
                                        type="button"
                                        onClick={() => handleSelectWindow(window.selectedPane.session.id)}
                                        className={cn(
                                          'w-full rounded-lg p-3 text-left transition-colors',
                                          windowSelected ? 'bg-accent/70' : 'hover:bg-accent/40'
                                        )}
                                      >
                                        <div className="flex items-start justify-between gap-3">
                                          <div className="min-w-0 space-y-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                              <span className="font-medium">{windowLabel}</span>
                                              <Badge variant="outline">{paneCount} pane{paneCount === 1 ? '' : 's'}</Badge>
                                              {window.hasUnmanaged && (
                                                <Badge variant="outline" className="text-xs">
                                                  Untracked pane
                                                </Badge>
                                              )}
                                            </div>
                                            <div className="truncate text-xs text-muted-foreground">
                                              {window.repoOrCwd}
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                              <span>{window.providerSummary || 'Unknown provider'}</span>
                                              {window.branch && (
                                                <>
                                                  <span>•</span>
                                                  <span>{window.branch}</span>
                                                </>
                                              )}
                                              <span>•</span>
                                              <span suppressHydrationWarning>
                                                {hydrated ? formatRelativeTime(window.lastActivityAt) : '—'}
                                              </span>
                                            </div>
                                          </div>
                                          <span className={cn('text-xs font-mono', getStatusIndicator(window.selectedPane.session.status).textColor)}>
                                            {getStatusIndicator(window.selectedPane.session.status).symbol}
                                          </span>
                                        </div>
                                      </button>

                                      <div className="space-y-1 px-2 pb-2">
                                        {window.panes.map((pane) => {
                                          const paneActive = pane.session.id === selectedSessionId;
                                          const status = getStatusIndicator(pane.session.status);
                                          return (
                                            <button
                                              key={pane.session.id}
                                              type="button"
                                              onClick={() => handleSelectPane(pane.session.id)}
                                              className={cn(
                                                'flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition-colors',
                                                paneActive ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                                              )}
                                            >
                                              <div className="min-w-0 space-y-1">
                                                <div className="flex items-center gap-2">
                                                  <span
                                                    className={cn(
                                                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-mono',
                                                      paneActive ? 'bg-primary-foreground/15 text-primary-foreground' : 'bg-muted'
                                                    )}
                                                  >
                                                    {getProviderIcon(pane.session.provider)}
                                                  </span>
                                                  <span className="truncate text-sm font-medium">
                                                    {getSessionDisplayName(pane.session)}
                                                  </span>
                                                  {pane.isUnmanaged && (
                                                    <Badge variant="outline" className="text-[10px]">
                                                      Untracked
                                                    </Badge>
                                                  )}
                                                </div>
                                                <div
                                                  className={cn(
                                                    'truncate text-xs',
                                                    paneActive ? 'text-primary-foreground/80' : 'text-muted-foreground'
                                                  )}
                                                >
                                                  pane {pane.paneIndex}
                                                  {pane.session.cwd ? ` · ${pane.session.cwd}` : ''}
                                                </div>
                                              </div>
                                              <div className="shrink-0 text-right">
                                                <div className={cn('text-xs font-mono', paneActive ? 'text-primary-foreground' : status.textColor)}>
                                                  {status.symbol} {status.label}
                                                </div>
                                                <div className={cn('text-[11px]', paneActive ? 'text-primary-foreground/80' : 'text-muted-foreground')} suppressHydrationWarning>
                                                  {hydrated ? formatRelativeTime(pane.lastActivityAt) : '—'}
                                                </div>
                                              </div>
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {!selectedSessionId ? (
            <Card>
              <CardHeader>
                <CardTitle>Select a Pane</CardTitle>
                <CardDescription>Choose a tmux pane from the roster to open its inline workbench.</CardDescription>
              </CardHeader>
            </Card>
          ) : selectedSessionLoading || !selectedSession || !sessionDetailData ? (
            <Card>
              <CardContent className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted text-lg font-mono">
                          {getProviderIcon(selectedSession.provider)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h2 className="truncate text-xl font-semibold">
                              {getSessionDisplayName(selectedSession)}
                            </h2>
                            <StatusBadge
                              status={selectedSession.status}
                              host={selectedSessionHost || selectedHost}
                              className="h-7 px-2 py-0 text-xs"
                            />
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {selectedSession.tmux_target || selectedSession.cwd || 'No working directory'}
                          </div>
                          {selectedSession.git_branch && (
                            <div className="text-xs text-muted-foreground">
                              {selectedSession.git_branch}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleIdleToggle}
                        disabled={isSessionIdlePending(selectedSession.id)}
                        className="gap-1"
                        title={selectedSession.idled_at ? 'Wake session' : 'Mark idle'}
                      >
                        {selectedSession.idled_at ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                        {selectedSession.idled_at ? 'Wake' : 'Idle'}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSendToDialogOpen(true)}
                        className="gap-1"
                      >
                        <Send className="h-4 w-4" />
                        Send to...
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => mcpManager.open(selectedSession.id, selectedSession.repo_root || undefined)}
                        className="gap-1"
                      >
                        <Plug className="h-4 w-4" />
                        MCP
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleTerminate}
                        disabled={isTerminating}
                        className="gap-1 text-destructive hover:text-destructive"
                      >
                        <Power className="h-4 w-4" />
                        Terminate
                      </Button>
                      <Button asChild variant="outline" size="sm" className="gap-1">
                        <Link href={`/sessions/${selectedSession.id}`}>
                          <ExternalLink className="h-4 w-4" />
                          Full page
                        </Link>
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <SessionWorkbench
                session={selectedSession}
                snapshot={snapshot}
                events={events}
                onAssignGroup={handleAssignGroup}
                onSendToLinkedSession={handleSendToFromLinks}
                viewMode={workbenchViewMode}
                onViewModeChange={setWorkbenchViewMode}
                initialView="terminal"
              />
            </>
          )}
        </div>
      </div>

      {mcpManager.sessionId && (
        <MCPManagerModal
          isOpen={mcpManager.isOpen}
          onClose={mcpManager.close}
          sessionId={mcpManager.sessionId}
          repoRoot={mcpManager.repoRoot}
        />
      )}

      {selectedSession && (
        <SendToSessionDialog
          isOpen={sendToDialogOpen}
          onClose={handleCloseSendToDialog}
          sourceSession={selectedSession}
          initialTargetSessionId={sendToTargetId}
        />
      )}
    </div>
  );
}
