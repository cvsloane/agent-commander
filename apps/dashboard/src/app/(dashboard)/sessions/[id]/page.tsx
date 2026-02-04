'use client';

import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Check, X, Plug, Send, ChevronLeft, Moon, Sun, Power } from 'lucide-react';
import Link from 'next/link';
import { assignSessionGroup, getGroups, getHosts, getSession, updateSession } from '@/lib/api';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConsoleView } from '@/components/ConsoleView';
import { TerminalView } from '@/components/TerminalView';
import { formatRelativeTime, getProviderIcon, getSessionDisplayName } from '@/lib/utils';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useHydrated } from '@/hooks/useHydrated';
import { MCPManagerModal, useMCPManager } from '@/components/mcp/MCPManagerModal';
import { SessionAnalytics } from '@/components/analytics/SessionAnalytics';
import { SendToSessionDialog } from '@/components/SendToSessionDialog';
import { LinkedSessionsPanel } from '@/components/LinkedSessionsPanel';
import { ActivityTimeline } from '@/components/ActivityTimeline';
import { useUIStore } from '@/stores/ui';
import { useTerminateSession } from '@/hooks/useTerminateSession';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useSessionIdle } from '@/hooks/useSessionIdle';
import { cn } from '@/lib/utils';
import type { Host, ServerToUIMessage, Session, SessionGroup } from '@agent-command/schema';

export default function SessionDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const sessionId = params.id as string;

  // Check for view=terminal URL parameter
  const initialView = searchParams.get('view') === 'terminal' ? 'terminal' : 'console';

  // Inline editing state
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [originalTitle, setOriginalTitle] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // MCP Manager
  const mcpManager = useMCPManager();

  // Send to Session Dialog
  const [sendToDialogOpen, setSendToDialogOpen] = useState(false);
  const [sendToTargetId, setSendToTargetId] = useState<string | undefined>(undefined);

  // Console/Terminal view toggle - initialized from URL param
  const [viewMode, setViewMode] = useState<'console' | 'terminal'>(initialView);
  const { addRecentSession } = useUIStore();
  const recentKeyRef = useRef<string | null>(null);
  const isMobile = useIsMobile();
  const hydrated = useHydrated();
  const { setSessionIdle, isSessionIdlePending } = useSessionIdle();
  const { terminateSession, isTerminating } = useTerminateSession();

  const handleSendToFromLinks = (targetSessionId: string) => {
    setSendToTargetId(targetSessionId);
    setSendToDialogOpen(true);
  };

  const handleCloseSendToDialog = () => {
    setSendToDialogOpen(false);
    setSendToTargetId(undefined);
  };

  const handleTerminate = async () => {
    if (!data?.session) return;
    if (isTerminating) return;
    const confirmTerminate = window.confirm(
      `Terminate "${getSessionDisplayName(data.session)}"? This will archive the session.`
    );
    if (!confirmTerminate) return;
    try {
      await terminateSession(data.session);
    } catch (error) {
      console.error('Failed to terminate session:', error);
    }
  };

  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => getSession(sessionId),
    refetchInterval: false,
  });
  const refetchTimerRef = useRef<number | null>(null);

  const scheduleRefetch = useCallback(() => {
    if (refetchTimerRef.current) return;
    refetchTimerRef.current = window.setTimeout(() => {
      refetch();
      refetchTimerRef.current = null;
    }, 1000);
  }, [refetch]);

  const { data: groupsData } = useQuery({
    queryKey: ['groups'],
    queryFn: getGroups,
  });
  const flatGroups = useMemo<SessionGroup[]>(
    () => groupsData?.flat ?? [],
    [groupsData]
  );

  const { data: hostsData } = useQuery({
    queryKey: ['hosts'],
    queryFn: getHosts,
  });
  const hostById = useMemo(() => {
    const map = new Map<string, Host>();
    for (const host of hostsData?.hosts || []) {
      map.set(host.id, host);
    }
    return map;
  }, [hostsData]);

  // Sync view mode when URL parameter changes
  useEffect(() => {
    const urlView = searchParams.get('view');
    setViewMode(urlView === 'terminal' ? 'terminal' : 'console');
  }, [searchParams]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    if (!data?.session) return;
    const session = data.session;
    const key = `${session.id}|${session.title ?? ''}|${session.cwd ?? ''}|${session.provider ?? ''}`;
    if (recentKeyRef.current === key) return;
    recentKeyRef.current = key;
    addRecentSession({
      id: session.id,
      title: session.title ?? null,
      cwd: session.cwd ?? null,
      status: session.status,
      provider: session.provider,
    });
  }, [data?.session, addRecentSession]);

  const startEditing = () => {
    const session = data?.session;
    const displayTitle = session?.title || session?.git_branch || 'Untitled Session';
    const initial = session?.title || displayTitle;
    setEditValue(initial);
    setOriginalTitle(initial);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditValue('');
    setOriginalTitle('');
  };

  const saveTitle = async () => {
    const next = editValue.trim();
    const original = originalTitle.trim();
    if (!next || next === original) {
      cancelEditing();
      return;
    }

    setIsSaving(true);
    try {
      await updateSession(sessionId, { title: next });
      await refetch();
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to update session title:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAssignGroup = async (groupId: string | null) => {
    try {
      await assignSessionGroup(sessionId, groupId);
      await refetch();
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
    } catch (error) {
      console.error('Failed to assign session to group:', error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveTitle();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditing();
    }
  };

  // Global keyboard shortcut for MCP Manager
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in an input
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Don't trigger if modifiers are pressed
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }

      // 'M' to open MCP Manager
      if (e.key === 'M' && e.shiftKey) {
        e.preventDefault();
        if (data?.session) {
          mcpManager.open(sessionId, data.session.repo_root || undefined);
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [data?.session, sessionId, mcpManager]);

  useWebSocket(
    [
      { type: 'events', filter: { session_id: sessionId } },
      { type: 'sessions', filter: { session_id: sessionId } },
    ],
    (message: ServerToUIMessage) => {
      if (message.type === 'sessions.changed') {
        const payload = message.payload as { sessions: Session[] };
        const updated = payload.sessions.find((s) => s.id === sessionId);
        if (updated) {
          queryClient.setQueryData(['session', sessionId], (current: any) => {
            if (!current) return current;
            return { ...current, session: { ...current.session, ...updated } };
          });
        }
      }
      if (message.type === 'events.appended') {
        scheduleRefetch();
      }
    }
  );

  useEffect(() => {
    return () => {
      if (refetchTimerRef.current) {
        window.clearTimeout(refetchTimerRef.current);
        refetchTimerRef.current = null;
      }
    };
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="container mx-auto px-4 py-6 text-center">
        <p className="text-destructive mb-4">Failed to load session</p>
        <Button onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  const { session, snapshot, events } = data;
  const tmuxMeta = session.metadata?.tmux as { session_name?: string; window_name?: string } | undefined;
  const windowName = tmuxMeta?.window_name?.trim();
  const tmuxLabel = session.tmux_target || (tmuxMeta?.session_name && windowName ? `${tmuxMeta.session_name}:${windowName}` : '');
  const statusDetail = session.metadata?.status_detail
    || session.metadata?.approval?.summary
    || session.metadata?.approval?.reason
    || (session.status === 'WAITING_FOR_APPROVAL'
      ? 'Approval requested'
      : session.status === 'WAITING_FOR_INPUT'
        ? 'Input required'
        : '');
  const host = hostById.get(session.host_id);
  const isManualIdle = !!session.idled_at;
  const idlePending = isSessionIdlePending(sessionId);

  const handleIdleToggle = async () => {
    if (idlePending) return;
    try {
      await setSessionIdle(sessionId, !isManualIdle);
    } catch (error) {
      console.error('Failed to update idle state:', error);
    }
  };

  return (
    <div className={cn('container mx-auto px-4 py-6', isMobile && 'px-2 py-3')}>
      {/* Header */}
      <div className={cn(
        'flex items-start justify-between mb-6',
        isMobile && 'flex-col gap-3 mb-4'
      )}>
        <div className="flex items-center gap-3 w-full">
          {/* Back button on mobile */}
          {isMobile && (
            <Link href="/sessions">
              <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0">
                <ChevronLeft className="h-5 w-5" />
              </Button>
            </Link>
          )}

          <div className={cn(
            'rounded-full bg-muted flex items-center justify-center font-mono font-bold shrink-0',
            isMobile ? 'w-10 h-10 text-lg' : 'w-12 h-12 text-xl'
          )}>
            {getProviderIcon(session.provider)}
          </div>

          <div className="flex-1 min-w-0">
            {isEditing ? (
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isSaving}
                  className={cn(
                    'font-bold px-2 py-1 bg-background border rounded focus:outline-none focus:ring-2 focus:ring-primary flex-1 min-w-0',
                    isMobile ? 'text-lg' : 'text-2xl'
                  )}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={saveTitle}
                  disabled={isSaving}
                  className={cn(isMobile && 'h-10 w-10')}
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={cancelEditing}
                  disabled={isSaving}
                  className={cn(isMobile && 'h-10 w-10')}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 group">
                <h1 className={cn(
                  'font-bold truncate',
                  isMobile ? 'text-lg' : 'text-2xl'
                )}>
                  {getSessionDisplayName(session)}
                </h1>
                {!isMobile && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={startEditing}
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                )}
              </div>
            )}
            <div className={cn(
              'flex items-center gap-2 text-muted-foreground',
              isMobile ? 'text-xs' : 'text-sm'
            )}>
              <span className="truncate max-w-[200px]">{session.cwd}</span>
              {session.git_branch && (
                <>
                  <span>•</span>
                  <span className="truncate max-w-[100px]">{session.git_branch}</span>
                </>
              )}
            </div>
            {tmuxLabel && !isMobile && (
              <div className="text-xs text-muted-foreground font-mono mt-1">
                {tmuxLabel}
              </div>
            )}
          </div>

          {/* Status badge on desktop */}
          {!isMobile && (
            <StatusBadge
              status={session.status}
              host={host}
              className="text-xs h-8 px-3 py-0 leading-none shrink-0 self-start"
            />
          )}
        </div>

        {/* Action buttons */}
        <div className={cn(
          'flex items-center gap-2',
          isMobile && 'w-full justify-between'
        )}>
          {isMobile && (
            <StatusBadge status={session.status} host={host} className="text-xs h-10 px-3 py-0 leading-none" />
          )}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleIdleToggle}
              disabled={idlePending}
              className={cn('gap-1', isMobile && 'h-10 px-3')}
              title={isManualIdle ? 'Wake session' : 'Mark idle'}
            >
              {isManualIdle ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              {!isMobile && (isManualIdle ? 'Wake' : 'Idle')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSendToDialogOpen(true)}
              className={cn('gap-1', isMobile && 'h-10 px-3')}
            >
              <Send className="h-4 w-4" />
              {!isMobile && 'Send to...'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => mcpManager.open(sessionId, session.repo_root || undefined)}
              className={cn('gap-1', isMobile && 'h-10 px-3')}
            >
              <Plug className="h-4 w-4" />
              {!isMobile && 'MCP'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleTerminate}
              disabled={isTerminating}
              className={cn('gap-1 text-destructive hover:text-destructive', isMobile && 'h-10 px-3')}
              title="Terminate session"
            >
              <Power className="h-4 w-4" />
              {!isMobile && 'Terminate'}
            </Button>
            {isMobile && (
              <Button
                variant="ghost"
                size="icon"
                onClick={startEditing}
                className="h-10 w-10"
              >
                <Pencil className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className={cn('space-y-6', isMobile && 'space-y-4')}>
        {/* Console/Terminal - full width */}
        <Card className={cn(
          'flex flex-col',
          isMobile ? 'h-[66vh] min-h-[360px]' : 'h-[66vh]'
        )}>
          <CardHeader className="py-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                {viewMode === 'console' ? 'Console' : 'Terminal'}
              </CardTitle>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={viewMode === 'console' ? 'default' : 'ghost'}
                  onClick={() => setViewMode('console')}
                  className="h-7 px-2"
                >
                  Stream
                </Button>
                <Button
                  size="sm"
                  variant={viewMode === 'terminal' ? 'default' : 'ghost'}
                  onClick={() => setViewMode('terminal')}
                  disabled={!session.tmux_pane_id}
                  className="h-7 px-2"
                  title={!session.tmux_pane_id ? 'No tmux pane available' : 'Interactive terminal'}
                >
                  Terminal
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0 flex-1 min-h-0">
            {viewMode === 'console' ? (
              <ConsoleView
                sessionId={session.id}
                snapshot={snapshot?.capture_text || null}
                paneId={session.tmux_pane_id || undefined}
                status={session.status}
                provider={session.provider}
              />
            ) : (
              <TerminalView
                sessionId={session.id}
                paneId={session.tmux_pane_id || undefined}
              />
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="space-y-6">
            {/* Session Info */}
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-base">Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Provider</span>
                  <span className="capitalize">{session.provider.replace(/_/g, ' ')}</span>
                </div>
                <div className="flex justify-between items-center gap-2">
                  <span className="text-muted-foreground">Group</span>
                  <select
                    value={session.group_id || ''}
                    onChange={(e) => handleAssignGroup(e.target.value || null)}
                    className="px-2 py-1 text-xs bg-background border rounded-md max-w-[180px]"
                  >
                    <option value="">Ungrouped</option>
                    {flatGroups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                </div>
                {windowName && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Window</span>
                    <span className="truncate max-w-[180px]">{windowName}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Kind</span>
                  <span>{session.kind}</span>
                </div>
                {session.tmux_target && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">tmux</span>
                    <span className="font-mono text-xs">{session.tmux_target}</span>
                  </div>
                )}
                {session.git_remote && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Remote</span>
                    <span className="truncate max-w-[180px] text-xs">
                      {session.git_remote.replace(/.*[:/]([^/]+\/[^/]+?)(?:\.git)?$/, '$1')}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last Activity</span>
                  <span suppressHydrationWarning>
                    {hydrated
                      ? formatRelativeTime(session.last_activity_at || session.updated_at)
                      : '—'}
                  </span>
                </div>
                {statusDetail && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Waiting</span>
                    <span className="truncate max-w-[180px]">{statusDetail}</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Linked Sessions */}
            <LinkedSessionsPanel
              sessionId={session.id}
              sourceGroupId={session.group_id || null}
              onSendTo={handleSendToFromLinks}
            />
          </div>

          <div className="space-y-6">
            {/* Analytics */}
            <Card>
              <CardContent className="py-4">
                <SessionAnalytics sessionId={session.id} />
              </CardContent>
            </Card>

            {/* Activity Timeline - Real-time tool events */}
            <ActivityTimeline sessionId={session.id} maxItems={15} />

            {/* Recent Events */}
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-base">Recent Events</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-[300px] overflow-auto">
                  {events.length === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground">No events yet</p>
                  ) : (
                    <ul className="divide-y">
                      {events.slice(0, 10).map((event) => (
                        <li key={event.id} className="px-4 py-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{event.type}</span>
                            <span className="text-xs text-muted-foreground">
                              <span suppressHydrationWarning>
                                {hydrated ? formatRelativeTime(event.ts) : '—'}
                              </span>
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* MCP Manager Modal */}
      {mcpManager.sessionId && (
        <MCPManagerModal
          isOpen={mcpManager.isOpen}
          onClose={mcpManager.close}
          sessionId={mcpManager.sessionId}
          repoRoot={mcpManager.repoRoot}
        />
      )}

      {/* Send to Session Dialog */}
      <SendToSessionDialog
        isOpen={sendToDialogOpen}
        onClose={handleCloseSendToDialog}
        sourceSession={session}
        initialTargetSessionId={sendToTargetId}
      />
    </div>
  );
}
