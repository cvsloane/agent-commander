'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Columns2,
  History,
  Rows2,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { CommandRequest, Session } from '@agent-command/schema';
import { Button } from '@/components/ui/button';
import { ScrollbackPager } from '@/components/terminal/ScrollbackPager';
import { useTmuxHostTopology } from '@/hooks/useTmuxTopology';
import { useTerminateSession } from '@/hooks/useTerminateSession';
import { getHosts, sendCommand } from '@/lib/api';
import { cn, getSessionDisplayName } from '@/lib/utils';
import { useNotifications } from '@/stores/notifications';
import { buildSplitPaneCommand, hostSupportsPercentSplits } from './paneActions';

interface TmuxPaneControlsProps {
  session: Session;
  variant?: 'desktop' | 'sheet';
  className?: string;
}

function tmuxIdentity(session: Session) {
  const tmux = session.metadata?.tmux;
  const indexes = session.tmux_target?.match(/:(\d+)(?:\.(\d+))?$/);
  return {
    sessionName:
      session.tmux_session_name ||
      tmux?.session_name ||
      session.tmux_target?.split(':')[0] ||
      'tmux',
    windowIndex: session.tmux_window_index ?? tmux?.window_index ?? Number(indexes?.[1] ?? 0),
  };
}

export function TmuxPaneControls({
  session,
  variant = 'desktop',
  className,
}: TmuxPaneControlsProps) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const notifications = useNotifications();
  const topology = useTmuxHostTopology(session.host_id);
  const identity = useMemo(() => tmuxIdentity(session), [session]);
  const { data: hostsData } = useQuery({
    queryKey: ['hosts'],
    queryFn: getHosts,
    staleTime: 30_000,
  });
  const host = hostsData?.hosts.find((candidate) => candidate.id === session.host_id);
  const supportsPercent = hostSupportsPercentSplits(host);
  const topologySession = topology?.sessions.find(
    (candidate) => candidate.sessionName === identity.sessionName
  );
  const currentWindow = topologySession?.windows.find(
    (candidate) => candidate.windowIndex === identity.windowIndex
  );
  const panes = currentWindow?.panes ?? [];
  const currentPaneIndex = panes.findIndex((pane) => pane.paneId === session.tmux_pane_id);
  const previousPane = currentPaneIndex > 0 ? panes[currentPaneIndex - 1] : undefined;
  const nextPane =
    currentPaneIndex >= 0 && currentPaneIndex < panes.length - 1
      ? panes[currentPaneIndex + 1]
      : undefined;
  const zoomed = currentWindow?.zoomed ?? false;
  const { terminateSession, isTerminating } = useTerminateSession();
  const labelClassName = variant === 'desktop' ? 'hidden 2xl:inline' : undefined;

  const dispatch = async (label: string, command: CommandRequest) => {
    if (pendingAction) return;
    setPendingAction(label);
    try {
      await sendCommand(session.id, command);
    } catch (error) {
      notifications.error(
        `Could not ${label}`,
        error instanceof Error ? error.message : 'The tmux command failed.',
        { sessionId: session.id }
      );
    } finally {
      setPendingAction(null);
    }
  };

  const selectPane = (paneId: string | undefined, label: string) => {
    if (!paneId) return;
    void dispatch(label, { type: 'select_pane', payload: { pane_id: paneId } });
  };

  const killPane = async () => {
    if (isTerminating) return;
    if (
      !window.confirm(
        `Kill pane "${getSessionDisplayName(session)}"? This terminates and archives its tracked session.`
      )
    )
      return;
    try {
      await terminateSession(session);
    } catch {
      // useTerminateSession owns the user-facing error toast.
    }
  };

  return (
    <>
      <div
        className={cn(
          variant === 'desktop'
            ? 'hidden min-h-10 items-center gap-1 border-b bg-muted/20 px-2 py-1 lg:flex'
            : 'grid grid-cols-2 gap-2',
          className
        )}
        role="toolbar"
        aria-label="tmux pane controls"
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn('gap-1.5', variant === 'sheet' && 'justify-start border')}
          onClick={() => setHistoryOpen(true)}
          aria-label={variant === 'desktop' ? 'View terminal history' : undefined}
          title={variant === 'desktop' ? 'View terminal history' : undefined}
        >
          <History className="h-4 w-4" aria-hidden="true" />
          <span className={labelClassName}>View history</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn('gap-1.5', variant === 'sheet' && 'justify-start border')}
          disabled={Boolean(pendingAction)}
          title={supportsPercent ? 'Split side-by-side at 50%' : 'Split side-by-side'}
          aria-label={variant === 'desktop' ? 'Split pane horizontally' : undefined}
          onClick={() =>
            void dispatch(
              'split pane horizontally',
              buildSplitPaneCommand(host, 'horizontal', session.cwd || undefined)
            )
          }
        >
          <Columns2 className="h-4 w-4" aria-hidden="true" />
          <span className={labelClassName}>Split horizontal</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn('gap-1.5', variant === 'sheet' && 'justify-start border')}
          disabled={Boolean(pendingAction)}
          title={supportsPercent ? 'Split top-and-bottom at 50%' : 'Split top-and-bottom'}
          aria-label={variant === 'desktop' ? 'Split pane vertically' : undefined}
          onClick={() =>
            void dispatch(
              'split pane vertically',
              buildSplitPaneCommand(host, 'vertical', session.cwd || undefined)
            )
          }
        >
          <Rows2 className="h-4 w-4" aria-hidden="true" />
          <span className={labelClassName}>Split vertical</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn('gap-1.5', variant === 'sheet' && 'justify-start border')}
          disabled={!session.tmux_pane_id || Boolean(pendingAction)}
          aria-label={variant === 'desktop' ? (zoomed ? 'Unzoom pane' : 'Zoom pane') : undefined}
          title={variant === 'desktop' ? (zoomed ? 'Unzoom pane' : 'Zoom pane') : undefined}
          onClick={() =>
            session.tmux_pane_id &&
            void dispatch(zoomed ? 'unzoom pane' : 'zoom pane', {
              type: 'zoom_pane',
              payload: { pane_id: session.tmux_pane_id },
            })
          }
        >
          {zoomed ? (
            <ZoomOut className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ZoomIn className="h-4 w-4" aria-hidden="true" />
          )}
          <span className={labelClassName}>{zoomed ? 'Unzoom' : 'Zoom'}</span>
        </Button>

        {variant === 'sheet' && (
          <div className="col-span-2 grid grid-cols-4 gap-2" aria-label="Select adjacent pane">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!previousPane || Boolean(pendingAction)}
              onClick={() => selectPane(previousPane?.paneId, 'select pane left')}
              aria-label="Select pane left"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!previousPane || Boolean(pendingAction)}
              onClick={() => selectPane(previousPane?.paneId, 'select pane up')}
              aria-label="Select pane up"
            >
              <ArrowUp className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!nextPane || Boolean(pendingAction)}
              onClick={() => selectPane(nextPane?.paneId, 'select pane down')}
              aria-label="Select pane down"
            >
              <ArrowDown className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!nextPane || Boolean(pendingAction)}
              onClick={() => selectPane(nextPane?.paneId, 'select pane right')}
              aria-label="Select pane right"
            >
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        )}

        {variant === 'desktop' && (
          <>
            <div className="flex-1" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5 text-destructive hover:text-destructive"
              disabled={isTerminating}
              onClick={() => void killPane()}
              aria-label="Kill pane"
              title="Kill pane"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              <span className={labelClassName}>Kill pane</span>
            </Button>
          </>
        )}
      </div>
      <ScrollbackPager
        sessionId={session.id}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
      />
    </>
  );
}
