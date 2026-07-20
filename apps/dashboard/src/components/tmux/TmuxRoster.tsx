'use client';

import { Search } from 'lucide-react';
import type { Host, SessionWithSnapshot } from '@agent-command/schema';
import type { FleetRosterGroup } from '@/lib/fleetRoster';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn, formatRelativeTime, isHostOnline } from '@/lib/utils';
import { TmuxClusterRow } from './TmuxClusterRow';
import { TmuxOrchestratorRow } from './TmuxOrchestratorRow';
import {
  FLEET_ROSTER_FILTERS,
  type FleetRosterFilter,
} from '@/hooks/useTmuxRosterData';

const FILTER_LABELS: Record<FleetRosterFilter, string> = {
  all: 'All',
  waiting: 'Waiting',
  errors: 'Errors',
  active: 'Active',
  dirty: 'Dirty',
  untracked: 'Untracked',
  this_host: 'This host',
  recent: 'Recent',
};

interface TmuxRosterProps {
  selectedHost?: Host;
  hosts: Host[];
  allHostsSelected?: boolean;
  partialHostFailureCount?: number;
  query: string;
  onQueryChange: (query: string) => void;
  activeFilter: FleetRosterFilter;
  onFilterChange: (filter: FleetRosterFilter) => void;
  groups: FleetRosterGroup[];
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
  hosts,
  allHostsSelected = false,
  partialHostFailureCount = 0,
  query,
  onQueryChange,
  activeFilter,
  onFilterChange,
  groups,
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
          {allHostsSelected
            ? 'Every online tmux machine · waiting work first'
            : selectedHost
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
          {FLEET_ROSTER_FILTERS.map((filter) => (
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
            {groups.length} sessions · {filteredSessions.length} panes
          </span>
          {selectedHost && !allHostsSelected && (
            <span suppressHydrationWarning>
              {hydrated && selectedHost.last_seen_at
                ? `Last seen ${formatRelativeTime(selectedHost.last_seen_at)}`
                : 'Waiting for host heartbeat'}
            </span>
          )}
        </div>

        {partialHostFailureCount > 0 && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-200" role="status">
            {partialHostFailureCount} online machine{partialHostFailureCount === 1 ? '' : 's'} could not be reached. Showing the rosters that loaded.
          </div>
        )}

        {sessionsLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : sessionsError ? (
          <div className="text-sm text-destructive">
            Failed to load tmux sessions for this host.
          </div>
        ) : groups.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No tmux panes matched this host and filter.
          </div>
        ) : (
          <div className="space-y-2">
            {groups.map((group) => group.kind === 'orchestrator' ? (
              <TmuxOrchestratorRow
                key={group.key}
                group={group}
                hosts={hosts}
                expanded={expandedClusterKey === group.key}
                active={group.key === selectedClusterKey}
                hydrated={hydrated}
                selectedSessionId={selectedSessionId}
                onExpandedChange={(expanded) => onExpandedClusterKeyChange(expanded ? group.key : null)}
                onSelectSession={onSelectSession}
                onOpenActions={onOpenActions}
              />
            ) : (
              <TmuxClusterRow
                key={group.key}
                cluster={group.cluster}
                hostLabel={allHostsSelected
                  ? hosts.find((host) => host.id === group.cluster.hostId)?.name
                  : undefined}
                hostOnline={isHostOnline(
                  hosts.find((host) => host.id === group.cluster.hostId)?.last_seen_at ?? null
                )}
                expanded={expandedClusterKey === group.key}
                active={group.key === selectedClusterKey}
                hydrated={hydrated}
                selectedWindowKey={selectedWindowKey}
                selectedSessionId={selectedSessionId}
                onExpandedChange={(expanded) => onExpandedClusterKeyChange(expanded ? group.key : null)}
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
