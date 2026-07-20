'use client';

import type { SessionWithSnapshot } from '@agent-command/schema';
import { cn, getSessionDisplayName } from '@/lib/utils';
import { useUIStore } from '@/stores/ui';
import { getRecentTmuxPanes } from './quickSwitch';

interface TmuxQuickSwitchStripProps {
  sessions: SessionWithSnapshot[];
  selectedSessionId: string;
  onSelectSession: (sessionId: string) => void;
}

function statusColor(status: string): string {
  switch (status) {
    case 'RUNNING':
    case 'STARTING':
      return 'bg-emerald-500';
    case 'WAITING_FOR_INPUT':
    case 'WAITING_FOR_APPROVAL':
      return 'bg-amber-500';
    case 'ERROR':
      return 'bg-red-500';
    case 'IDLE':
      return 'bg-muted-foreground';
    default:
      return 'bg-muted-foreground';
  }
}

export function TmuxQuickSwitchStrip({
  sessions,
  selectedSessionId,
  onSelectSession,
}: TmuxQuickSwitchStripProps) {
  const recentSessions = useUIStore((state) => state.recentSessions);
  const panes = getRecentTmuxPanes(recentSessions, sessions, selectedSessionId);
  if (panes.length === 0) return null;

  return (
    <div className="-mx-4 overflow-x-auto px-4 touch-pan-x" aria-label="Recent tmux panes">
      <div className="flex min-w-max gap-2 py-0.5">
        {panes.map((session) => {
          const selected = session.id === selectedSessionId;
          return (
            <button
              key={session.id}
              type="button"
              onClick={() => onSelectSession(session.id)}
              aria-current={selected ? 'true' : undefined}
              className={cn(
                'inline-flex h-9 max-w-52 items-center gap-2 rounded-full border px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary',
                selected
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'bg-background hover:bg-muted'
              )}
            >
              <span
                className={cn(
                  'h-2 w-2 shrink-0 rounded-full ring-2',
                  selected ? 'ring-primary-foreground/30' : 'ring-background',
                  statusColor(session.status)
                )}
                aria-hidden="true"
              />
              <span className="truncate">{getSessionDisplayName(session)}</span>
              <span className="sr-only">{session.status.replaceAll('_', ' ').toLowerCase()}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
