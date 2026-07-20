'use client';

import type { TmuxWindowView } from '@/lib/tmuxRoster';
import { Badge } from '@/components/ui/badge';
import { cn, formatRelativeTime, getStatusIndicator } from '@/lib/utils';
import { TmuxPaneRow } from './TmuxPaneRow';

interface TmuxWindowRowProps {
  window: TmuxWindowView;
  selectedWindowKey: string | null;
  selectedSessionId: string;
  hydrated: boolean;
  onSelectSession: (sessionId: string) => void;
  onOpenActions?: (sessionId: string) => void;
}

export function TmuxWindowRow({
  window,
  selectedWindowKey,
  selectedSessionId,
  hydrated,
  onSelectSession,
  onOpenActions,
}: TmuxWindowRowProps) {
  const windowSelected = window.key === selectedWindowKey;
  const paneCount = window.panes.length;
  const windowLabel = `${window.windowIndex}${window.windowName !== `window ${window.windowIndex}` ? ` · ${window.windowName}` : ''}`;
  const status = getStatusIndicator(window.selectedPane.session.status);

  return (
    <div className="rounded-lg border bg-background">
      <button
        type="button"
        onClick={() => onSelectSession(window.selectedPane.session.id)}
        className={cn(
          'min-h-12 w-full rounded-lg px-3 py-2 text-left transition-colors',
          windowSelected ? 'bg-accent/70' : 'hover:bg-accent/40'
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-medium">{windowLabel}</span>
              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{paneCount} pane{paneCount === 1 ? '' : 's'}</Badge>
              {window.hasUnmanaged && (
                <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                  Untracked pane
                </Badge>
              )}
            </div>
            <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <span className="truncate">{window.repoOrCwd}</span>
              <span>•</span>
              <span className="truncate">{window.providerSummary || 'Unknown provider'}</span>
              {window.branch && (
                <>
                  <span>•</span>
                  <span className="truncate">{window.branch}</span>
                </>
              )}
              <span>•</span>
              <span suppressHydrationWarning>
                {hydrated ? formatRelativeTime(window.lastActivityAt) : '—'}
              </span>
            </div>
          </div>
          <span className={cn('text-xs font-mono', status.textColor)}>
            {status.symbol}
          </span>
        </div>
      </button>

      <div className="space-y-1 px-2 pb-2">
        {window.panes.map((pane) => (
          <TmuxPaneRow
            key={pane.session.id}
            pane={pane}
            selectedSessionId={selectedSessionId}
            hydrated={hydrated}
            onSelectSession={onSelectSession}
            onOpenActions={onOpenActions}
          />
        ))}
      </div>
    </div>
  );
}
