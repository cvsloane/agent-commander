'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Rows3, Search, SearchX } from 'lucide-react';
import type { Host, SessionWithSnapshot } from '@agent-command/schema';
import type { FleetRosterGroup } from '@/lib/fleetRoster';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, formatRelativeTime, isHostOnline } from '@/lib/utils';
import { TmuxClusterRow } from './TmuxClusterRow';
import { TmuxOrchestratorRow } from './TmuxOrchestratorRow';
import { firstRosterTriageTarget } from './rosterTriage';
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

function TmuxRosterSkeleton() {
  return (
    <div className="min-h-72 space-y-2" role="status" aria-label="Loading tmux sessions">
      <span className="sr-only">Loading tmux sessions</span>
      {[0, 1, 2].map((row) => (
        <div key={row} className="rounded-lg border p-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-5/6" />
            </div>
            <Skeleton className="h-6 w-14 shrink-0" />
          </div>
        </div>
      ))}
    </div>
  );
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
  const treeRef = useRef<HTMLDivElement>(null);
  const [pendingRevealSessionId, setPendingRevealSessionId] = useState<string | null>(null);
  const lastWaitingTargetRef = useRef<string | null>(null);
  const revealSession = useCallback((groupKey: string, sessionId: string) => {
    onExpandedClusterKeyChange(groupKey);
    setPendingRevealSessionId(sessionId);
  }, [onExpandedClusterKeyChange]);

  useEffect(() => {
    if (!pendingRevealSessionId) return;
    const pane = treeRef.current?.querySelector<HTMLButtonElement>(
      `[data-tmux-pane-session="${pendingRevealSessionId}"]`
    );
    if (!pane) return;
    pane.focus({ preventScroll: true });
    pane.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setPendingRevealSessionId(null);
  }, [expandedClusterKey, pendingRevealSessionId]);

  useEffect(() => {
    if (activeFilter !== 'waiting') {
      lastWaitingTargetRef.current = null;
      return;
    }
    const target = firstRosterTriageTarget(groups);
    if (!target) return;
    const targetKey = `${target.groupKey}:${target.sessionId}`;
    if (lastWaitingTargetRef.current === targetKey) return;
    lastWaitingTargetRef.current = targetKey;
    revealSession(target.groupKey, target.sessionId);
  }, [activeFilter, groups, revealSession]);

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
                'h-8 shrink-0 rounded-md border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
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

        <div className="min-h-72" aria-busy={sessionsLoading}>
          {sessionsLoading ? (
            <TmuxRosterSkeleton />
          ) : sessionsError ? (
            <div className="text-sm text-destructive" role="alert">
              Failed to load tmux sessions for this host.
            </div>
          ) : groups.length === 0 ? (
            <EmptyState
              icon={query || activeFilter !== 'all' ? SearchX : Rows3}
              title={query || activeFilter !== 'all' ? 'No matching sessions' : 'No live tmux sessions'}
              description={query || activeFilter !== 'all'
                ? 'Try a different search or roster filter.'
                : 'Live sessions will appear here when a tmux pane is available.'}
              className="min-h-72"
            />
          ) : (
            <div ref={treeRef} className="space-y-2" role="tree" aria-label="tmux session roster">
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
                onRevealSession={(sessionId) => revealSession(group.key, sessionId)}
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
                onRevealSession={(sessionId) => revealSession(group.key, sessionId)}
              />
            ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
