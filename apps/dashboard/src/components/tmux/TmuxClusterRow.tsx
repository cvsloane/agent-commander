'use client';

import { ChevronDown, ChevronRight, Monitor } from 'lucide-react';
import type { TmuxSessionCluster } from '@/lib/tmuxRoster';
import { Badge } from '@/components/ui/badge';
import { cn, formatRelativeTime } from '@/lib/utils';
import { TmuxWindowRow } from './TmuxWindowRow';

interface TmuxClusterRowProps {
  cluster: TmuxSessionCluster;
  hostLabel?: string;
  expanded: boolean;
  active: boolean;
  hydrated: boolean;
  selectedWindowKey: string | null;
  selectedSessionId: string;
  onExpandedChange: (expanded: boolean) => void;
  onSelectSession: (sessionId: string) => void;
  onOpenActions?: (sessionId: string) => void;
}

export function TmuxClusterRow({
  cluster,
  hostLabel,
  expanded,
  active,
  hydrated,
  selectedWindowKey,
  selectedSessionId,
  onExpandedChange,
  onSelectSession,
  onOpenActions,
}: TmuxClusterRowProps) {
  return (
    <details
      open={expanded}
      onToggle={(event) => onExpandedChange(event.currentTarget.open)}
      className={cn(
        'rounded-xl border bg-background transition-colors',
        active && 'border-primary bg-primary/5'
      )}
    >
      <summary
        className={cn(
          'flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors marker:hidden [&::-webkit-details-marker]:hidden',
          expanded ? 'bg-accent/40' : 'hover:bg-accent/30'
        )}
        aria-expanded={expanded}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Monitor className="h-4 w-4 text-primary" />
            <span className="truncate font-medium">{cluster.tmuxSessionName}</span>
            {hostLabel && (
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{hostLabel}</Badge>
            )}
            {cluster.hasUnmanaged && (
              <Badge variant="outline" className="text-[10px]">
                Untracked
              </Badge>
            )}
          </div>
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
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
      </summary>

      {expanded && (
        <div className="space-y-3 border-t px-3 pb-3 pt-3">
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
              />
            ))}
          </div>
        </div>
      )}
    </details>
  );
}
