'use client';

import type { TmuxPaneView } from '@/lib/tmuxRoster';
import { SessionHealthBadges } from '@/components/session/SessionHealthBadges';
import {
  cn,
  formatRelativeTime,
  getProviderIcon,
  getSessionDisplayName,
  getStatusIndicator,
} from '@/lib/utils';

interface TmuxPaneRowProps {
  pane: TmuxPaneView;
  selectedSessionId: string;
  hydrated: boolean;
  onSelectSession: (sessionId: string) => void;
  onOpenActions?: (sessionId: string) => void;
  hostOnline?: boolean;
}

export function TmuxPaneRow({ pane, selectedSessionId, hydrated, onSelectSession, onOpenActions, hostOnline }: TmuxPaneRowProps) {
  const paneActive = pane.session.id === selectedSessionId;
  const status = getStatusIndicator(pane.session.status);

  return (
    <button
      type="button"
      onClick={() => onSelectSession(pane.session.id)}
      onContextMenu={(event) => {
        if (!onOpenActions) return;
        event.preventDefault();
        onOpenActions(pane.session.id);
      }}
      className={cn(
        'flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-3 py-1.5 text-left transition-colors',
        paneActive ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
      )}
    >
      <div className="min-w-0">
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
          <SessionHealthBadges
            session={pane.session}
            hostOnline={hostOnline}
            selected={paneActive}
          />
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
}
