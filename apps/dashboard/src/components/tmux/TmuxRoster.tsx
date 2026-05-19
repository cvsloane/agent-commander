'use client';

import { Search } from 'lucide-react';
import type { Host, SessionWithSnapshot } from '@agent-command/schema';
import { TMUX_ROSTER_FILTERS, type TmuxRosterFilter, type TmuxSessionCluster } from '@/lib/tmuxRoster';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn, formatRelativeTime } from '@/lib/utils';
import { TmuxClusterRow } from './TmuxClusterRow';

const FILTER_LABELS: Record<TmuxRosterFilter, string> = {
  all: 'All',
  waiting: 'Waiting',
  errors: 'Errors',
  active: 'Active',
  dirty: 'Dirty',
  untracked: 'Untracked',
};

interface TmuxRosterProps {
  selectedHost?: Host;
  query: string;
  onQueryChange: (query: string) => void;
  activeFilter: TmuxRosterFilter;
  onFilterChange: (filter: TmuxRosterFilter) => void;
  clusters: TmuxSessionCluster[];
  filteredSessions: SessionWithSnapshot[];
  sessionsLoading: boolean;
  sessionsError: unknown;
  hydrated: boolean;
  expandedClusterKey: string | null;
  onExpandedClusterKeyChange: (clusterKey: string | null) => void;
  selectedClusterKey: string | null;
  selectedWindowKey: string | null;
  selectedSessionId: string;
  onSelectSession: (sessionId: string) => void;
  onOpenActions?: (sessionId: string) => void;
  className?: string;
}

export function TmuxRoster({
  selectedHost,
  query,
  onQueryChange,
  activeFilter,
  onFilterChange,
  clusters,
  filteredSessions,
  sessionsLoading,
  sessionsError,
  hydrated,
  expandedClusterKey,
  onExpandedClusterKeyChange,
  selectedClusterKey,
  selectedWindowKey,
  selectedSessionId,
  onSelectSession,
  onOpenActions,
  className,
}: TmuxRosterProps) {
  return (
    <Card className={cn('min-h-0', className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Live tmux Sessions</CardTitle>
        <CardDescription>
          {selectedHost
            ? `${selectedHost.name}${selectedHost.tailscale_name ? ` · ${selectedHost.tailscale_name}` : ''}`
            : 'Select a host'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Filter by tmux session, cwd, branch, repo, provider..."
            className="pl-9"
          />
        </div>

        <div className="flex gap-1 overflow-x-auto pb-1" role="toolbar" aria-label="tmux roster filters">
          {TMUX_ROSTER_FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => onFilterChange(filter)}
              className={cn(
                'h-8 shrink-0 rounded-md border px-3 text-xs font-medium transition-colors',
                activeFilter === filter
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              {FILTER_LABELS[filter]}
            </button>
          ))}
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

        {sessionsLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : sessionsError ? (
          <div className="text-sm text-destructive">
            Failed to load tmux sessions for this host.
          </div>
        ) : clusters.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No tmux panes matched this host and filter.
          </div>
        ) : (
          <div className="space-y-2">
            {clusters.map((cluster) => (
              <TmuxClusterRow
                key={cluster.key}
                cluster={cluster}
                expanded={expandedClusterKey === cluster.key}
                active={cluster.key === selectedClusterKey}
                hydrated={hydrated}
                selectedWindowKey={selectedWindowKey}
                selectedSessionId={selectedSessionId}
                onExpandedChange={(expanded) => onExpandedClusterKeyChange(expanded ? cluster.key : null)}
                onSelectSession={onSelectSession}
                onOpenActions={onOpenActions}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
