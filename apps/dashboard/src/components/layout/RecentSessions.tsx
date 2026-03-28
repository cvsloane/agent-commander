'use client';
import { Clock, ExternalLink, Rows3 } from 'lucide-react';
import { useUIStore, type RecentSession } from '@/stores/ui';
import { cn } from '@/lib/utils';

function getRecentSessionLabel(session: RecentSession) {
  return session.title || session.tmuxSessionName || session.cwd?.split('/').filter(Boolean).pop() || 'Untitled';
}

function getRecentSessionHref(session: RecentSession) {
  if (session.kind === 'tmux_pane') {
    const params = new URLSearchParams();
    if (session.hostId) params.set('host_id', session.hostId);
    params.set('session_id', session.id);
    return `/tmux?${params.toString()}`;
  }

  return `/sessions/${session.id}`;
}

function getStatusDotClass(status: string) {
  return cn(
    'w-2 h-2 rounded-full flex-shrink-0',
    status === 'RUNNING' && 'bg-green-500',
    status === 'IDLE' && 'bg-blue-500',
    status === 'WAITING_FOR_INPUT' && 'bg-yellow-500',
    status === 'WAITING_FOR_APPROVAL' && 'bg-orange-500',
    status === 'ERROR' && 'bg-red-500',
    status === 'DONE' && 'bg-gray-400',
    status === 'STARTING' && 'bg-purple-500'
  );
}

function SessionList({
  title,
  icon,
  sessions,
}: {
  title: string;
  icon: React.ReactNode;
  sessions: RecentSession[];
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2 text-muted-foreground">
        {icon}
        <span className="text-xs font-medium uppercase">{title}</span>
      </div>
      <div className="space-y-1">
        {sessions.map((session) => (
          <a
            key={session.id}
            href={getRecentSessionHref(session)}
            className={cn(
              'flex items-center gap-2 px-2 py-1.5 rounded-md text-sm',
              'text-muted-foreground hover:bg-accent hover:text-foreground',
              'transition-colors group'
            )}
          >
            <span className={getStatusDotClass(session.status)} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">
                {getRecentSessionLabel(session)}
              </div>
              {session.kind === 'tmux_pane' && (
                <div className="truncate text-[11px] text-muted-foreground/80">
                  {session.tmuxTarget || session.cwd || 'tmux'}
                </div>
              )}
            </div>
            <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-50 transition-opacity" />
          </a>
        ))}
      </div>
    </div>
  );
}

export function RecentSessions() {
  const { recentSessions } = useUIStore();
  const recentTmuxSessions = recentSessions.filter((session) => session.kind === 'tmux_pane');
  const recentStandardSessions = recentSessions.filter((session) => session.kind !== 'tmux_pane');

  if (recentSessions.length === 0) {
    return (
      <div className="p-3">
        <div className="flex items-center gap-2 mb-2 text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          <span className="text-xs font-medium uppercase">Recent</span>
        </div>
        <p className="text-xs text-muted-foreground">No recent sessions</p>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">
      {recentTmuxSessions.length > 0 && (
        <SessionList
          title="tmux"
          icon={<Rows3 className="h-3.5 w-3.5" />}
          sessions={recentTmuxSessions}
        />
      )}

      {recentStandardSessions.length > 0 && (
        <SessionList
          title="Recent"
          icon={<Clock className="h-3.5 w-3.5" />}
          sessions={recentStandardSessions}
        />
      )}
    </div>
  );
}
