'use client';

import type { ReactNode } from 'react';
import type { Host, SessionWithSnapshot } from '@agent-command/schema';
import type { TmuxRosterFilter, TmuxSessionCluster } from '@/lib/tmuxRoster';
import { TmuxHostPicker } from './TmuxHostPicker';
import { TmuxRoster } from './TmuxRoster';

interface TmuxDesktopShellProps {
  hosts: Host[];
  selectedHostId: string;
  selectedHost?: Host;
  onSelectHost: (hostId: string) => void;
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
  workbench: ReactNode;
}

export function TmuxDesktopShell({
  hosts,
  selectedHostId,
  selectedHost,
  onSelectHost,
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
  workbench,
}: TmuxDesktopShellProps) {
  return (
    <div className="hidden space-y-6 lg:block">
      <TmuxHostPicker
        hosts={hosts}
        selectedHostId={selectedHostId}
        onSelectHost={onSelectHost}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)] lg:items-start">
        <div className="lg:sticky lg:top-6 lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto">
          <TmuxRoster
            selectedHost={selectedHost}
            query={query}
            onQueryChange={onQueryChange}
            activeFilter={activeFilter}
            onFilterChange={onFilterChange}
            clusters={clusters}
            filteredSessions={filteredSessions}
            sessionsLoading={sessionsLoading}
            sessionsError={sessionsError}
            hydrated={hydrated}
            expandedClusterKey={expandedClusterKey}
            onExpandedClusterKeyChange={onExpandedClusterKeyChange}
            selectedClusterKey={selectedClusterKey}
            selectedWindowKey={selectedWindowKey}
            selectedSessionId={selectedSessionId}
            onSelectSession={onSelectSession}
          />
        </div>

        <div className="min-w-0 space-y-4">
          {workbench}
        </div>
      </div>
    </div>
  );
}
