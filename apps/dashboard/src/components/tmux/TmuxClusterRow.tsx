'use client';

import type { MouseEvent } from 'react';

import { ChevronDown, ChevronRight, Monitor } from 'lucide-react';
import type { TmuxSessionCluster } from '@/lib/tmuxRoster';
import { Badge } from '@/components/ui/badge';
import { cn, formatRelativeTime } from '@/lib/utils';
import { TmuxWindowRow } from './TmuxWindowRow';
import { summarizeRosterTriage } from './rosterTriage';

interface TmuxClusterRowProps {
  cluster: TmuxSessionCluster;
  hostLabel?: string;
  hostOnline?: boolean;
  expanded: boolean;
  active: boolean;
  hydrated: boolean;
  selectedWindowKey: string | null;
  selectedSessionId: string;
  onExpandedChange: (expanded: boolean) => void;
  onSelectSession: (sessionId: string) => void;
  onOpenActions?: (sessionId: string) => void;
  onRevealSession?: (sessionId: string) => void;
}

export function TmuxClusterRow({
  cluster,
  hostLabel,
  hostOnline,
  expanded,
  active,
  hydrated,
  selectedWindowKey,
  selectedSessionId,
  onExpandedChange,
  onSelectSession,
  onOpenActions,
  onRevealSession,
}: TmuxClusterRowProps) {
  const triage = summarizeRosterTriage(
    cluster.windows.flatMap((window) => window.panes.map((pane) => pane.session))
  );
  const revealTriage = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (triage.firstSessionId) onRevealSession?.(triage.firstSessionId);
  };
  return (
    <details
      open={expanded}
      onToggle={(event) => onExpandedChange(event.currentTarget.open)}
      role="none"
      className={cn(
        'rounded-xl border bg-background transition-colors',
        active && 'border-primary bg-primary/5'
      )}
    >
      <summary
        role="treeitem"
        className={cn(
          'flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden',
          expanded ? 'bg-accent/40' : 'hover:bg-accent/30'
        )}
        aria-expanded={expanded}
        aria-selected={active}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Monitor className="h-4 w-4 text-primary" />
            <span className="truncate font-medium">{cluster.tmuxSessionName}</span>
            {cluster.hasUnmanaged && (
              <Badge variant="outline" className="text-[10px]">
                Untracked
              </Badge>
            )}
          </div>
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            {hostLabel && (
              <Badge variant="secondary" className="h-5 max-w-24 shrink-0 truncate px-1.5 text-[10px]">
                {hostLabel}
              </Badge>
            )}
            <span className="shrink-0 whitespace-nowrap">{cluster.windowCount} window{cluster.windowCount === 1 ? '' : 's'}</span>
            <span className="shrink-0">•</span>
            <span className="shrink-0 whitespace-nowrap">{cluster.paneCount} pane{cluster.paneCount === 1 ? '' : 's'}</span>
            <span className="shrink-0">•</span>
            <span className="truncate">{cluster.providerSummary || 'Unknown provider'}</span>
            {cluster.branch && (
              <>
                <span>•</span>
                <span className="truncate">{cluster.branch}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!expanded && triage.approvalCount > 0 && (
            <button
              type="button"
              className="h-7 rounded-full border border-amber-500/50 bg-amber-500/15 px-2 text-[10px] font-semibold text-amber-700 outline-none focus-visible:ring-2 focus-visible:ring-amber-400 dark:text-amber-300"
              onClick={revealTriage}
              aria-label={`Reveal ${triage.approvalCount} approval pane${triage.approvalCount === 1 ? '' : 's'}`}
            >
              {triage.approvalCount} approval
            </button>
          )}
          {!expanded && triage.waitingCount > 0 && (
            <button
              type="button"
              className="h-7 rounded-full border border-sky-500/50 bg-sky-500/15 px-2 text-[10px] font-semibold text-sky-700 outline-none focus-visible:ring-2 focus-visible:ring-sky-400 dark:text-sky-300"
              onClick={revealTriage}
              aria-label={`Reveal ${triage.waitingCount} waiting pane${triage.waitingCount === 1 ? '' : 's'}`}
            >
              {triage.waitingCount} waiting
            </button>
          )}
          <span className="hidden text-[11px] text-muted-foreground 2xl:inline" suppressHydrationWarning>
            {hydrated ? formatRelativeTime(cluster.lastActivityAt) : '—'}
          </span>
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </summary>

      {expanded && (
        <div className="space-y-3 border-t px-3 pb-3 pt-3" role="group">
          <div className="space-y-3">
            {cluster.windows.map((window) => (
              <TmuxWindowRow
                key={window.key}
                window={window}
                selectedWindowKey={selectedWindowKey}
                selectedSessionId={selectedSessionId}
                hydrated={hydrated}
                onSelectSession={onSelectSession}
                onOpenActions={onOpenActions}
                hostOnline={hostOnline}
              />
            ))}
          </div>
        </div>
      )}
    </details>
  );
}
