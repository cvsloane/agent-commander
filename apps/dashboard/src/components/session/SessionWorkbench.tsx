'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Maximize2, Minimize2 } from 'lucide-react';
import { getGroups } from '@/lib/api';
import { ActivityTimeline } from '@/components/ActivityTimeline';
import { ConsoleView } from '@/components/ConsoleView';
import { LinkedSessionsPanel } from '@/components/LinkedSessionsPanel';
import { SessionAnalytics } from '@/components/analytics/SessionAnalytics';
import { TerminalView } from '@/components/TerminalView';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useHydrated } from '@/hooks/useHydrated';
import { useIsMobile } from '@/hooks/useIsMobile';
import { cn, formatRelativeTime } from '@/lib/utils';
import type { Event, Session, SessionGroup } from '@agent-command/schema';

type WorkbenchViewMode = 'console' | 'terminal';

interface SessionWorkbenchProps {
  session: Session;
  snapshot: { created_at: string; capture_text: string } | null;
  events: Event[];
  onAssignGroup?: (groupId: string | null) => Promise<void> | void;
  onSendToLinkedSession?: (targetSessionId: string) => void;
  initialView?: WorkbenchViewMode;
  viewMode?: WorkbenchViewMode;
  onViewModeChange?: (mode: WorkbenchViewMode) => void;
  className?: string;
}

export function SessionWorkbench({
  session,
  snapshot,
  events,
  onAssignGroup,
  onSendToLinkedSession,
  initialView = 'console',
  viewMode,
  onViewModeChange,
  className,
}: SessionWorkbenchProps) {
  const [internalViewMode, setInternalViewMode] = useState<WorkbenchViewMode>(initialView);
  const [maximized, setMaximized] = useState(false);
  const hydrated = useHydrated();
  const isMobile = useIsMobile();
  const activeViewMode = viewMode ?? internalViewMode;
  const setActiveViewMode = onViewModeChange ?? setInternalViewMode;

  const { data: groupsData } = useQuery({
    queryKey: ['groups'],
    queryFn: getGroups,
  });

  const flatGroups = useMemo<SessionGroup[]>(
    () => groupsData?.flat ?? [],
    [groupsData]
  );

  useEffect(() => {
    if (viewMode !== undefined) return;
    setInternalViewMode(initialView);
  }, [initialView, viewMode]);

  useEffect(() => {
    if (!maximized) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      setMaximized(false);
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [maximized]);

  useEffect(() => {
    if (!maximized || typeof document === 'undefined') return;

    const body = document.body;
    const html = document.documentElement;
    const prevBodyOverflow = body.style.overflow;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyPaddingRight = body.style.paddingRight;
    const scrollBarWidth = window.innerWidth - html.clientWidth;

    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
    if (scrollBarWidth > 0) {
      body.style.paddingRight = `${scrollBarWidth}px`;
    }

    return () => {
      body.style.overflow = prevBodyOverflow;
      html.style.overflow = prevHtmlOverflow;
      body.style.paddingRight = prevBodyPaddingRight;
    };
  }, [maximized]);

  const tmuxMeta = session.metadata?.tmux as {
    session_name?: string;
    window_name?: string;
  } | undefined;
  const windowName = tmuxMeta?.window_name?.trim();
  const statusDetail = session.metadata?.status_detail
    || session.metadata?.approval?.summary
    || session.metadata?.approval?.reason
    || (session.status === 'WAITING_FOR_APPROVAL'
      ? 'Approval requested'
      : session.status === 'WAITING_FOR_INPUT'
        ? 'Input required'
        : '');

  return (
    <div className={cn('space-y-6', isMobile && 'space-y-4', className)}>
      <Card
        className={cn(
          'flex flex-col',
          maximized
            ? 'fixed inset-0 z-[60] rounded-none border-0 h-screen'
            : isMobile ? 'h-[66vh] min-h-[360px]' : 'h-[66vh]'
        )}
      >
        <CardHeader className="py-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              {activeViewMode === 'console' ? 'Console' : 'Terminal'}
            </CardTitle>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={activeViewMode === 'console' ? 'default' : 'ghost'}
                onClick={() => setActiveViewMode('console')}
                className="h-7 px-2"
              >
                Stream
              </Button>
              <Button
                size="sm"
                variant={activeViewMode === 'terminal' ? 'default' : 'ghost'}
                onClick={() => setActiveViewMode('terminal')}
                disabled={!session.tmux_pane_id}
                className="h-7 px-2"
                title={!session.tmux_pane_id ? 'No tmux pane available' : 'Interactive terminal'}
              >
                Terminal
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setMaximized((current) => !current)}
                className="h-7 px-2"
                title={maximized ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
              >
                {maximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0 flex-1 min-h-0">
          {activeViewMode === 'console' ? (
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
                  onChange={(event) => void onAssignGroup?.(event.target.value || null)}
                  disabled={!onAssignGroup}
                  className="px-2 py-1 text-xs bg-background border rounded-md max-w-[180px] disabled:opacity-60"
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

          <LinkedSessionsPanel
            sessionId={session.id}
            sourceGroupId={session.group_id || null}
            onSendTo={onSendToLinkedSession}
          />
        </div>

        <div className="space-y-6">
          <Card>
            <CardContent className="py-4">
              <SessionAnalytics sessionId={session.id} />
            </CardContent>
          </Card>

          <ActivityTimeline sessionId={session.id} maxItems={15} />

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
  );
}
