'use client';

import { Bot, ChevronDown, ChevronRight, Network } from 'lucide-react';
import type { Host } from '@agent-command/schema';
import type { OrchestratorFleetGroup } from '@/lib/fleetRoster';
import { Badge } from '@/components/ui/badge';
import { cn, formatRelativeTime, getStatusIndicator, isHostOnline } from '@/lib/utils';
import { TmuxPaneRow } from './TmuxPaneRow';
import { SessionHealthBadges } from '@/components/session/SessionHealthBadges';

interface TmuxOrchestratorRowProps {
  group: OrchestratorFleetGroup;
  hosts: Host[];
  expanded: boolean;
  active: boolean;
  hydrated: boolean;
  selectedSessionId: string;
  onExpandedChange: (expanded: boolean) => void;
  onSelectSession: (sessionId: string) => void;
  onOpenActions?: (sessionId: string) => void;
}

export function TmuxOrchestratorRow({
  group,
  hosts,
  expanded,
  active,
  hydrated,
  selectedSessionId,
  onExpandedChange,
  onSelectSession,
  onOpenActions,
}: TmuxOrchestratorRowProps) {
  const hostNames = group.hostIds
    .map((hostId) => hosts.find((host) => host.id === hostId)?.name || hostId.slice(0, 8))
    .join(', ');
  const statuses = [group.orchestrator, ...group.workers].map((pane) => pane.session.status);
  const waitingCount = statuses.filter((status) => status.startsWith('WAITING')).length;
  const status = getStatusIndicator(group.orchestrator.session.status);

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
            <Network className="h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-400" />
            <span className="truncate font-medium">{group.title}</span>
            <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px]">Orchestrator</Badge>
            <SessionHealthBadges
              session={group.orchestrator.session}
              hostOnline={isHostOnline(
                hosts.find((host) => host.id === group.orchestrator.session.host_id)?.last_seen_at ?? null
              )}
              compact
            />
          </div>
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span className="shrink-0 whitespace-nowrap">{group.workers.length} worker{group.workers.length === 1 ? '' : 's'}</span>
            {waitingCount > 0 && <span className="shrink-0 whitespace-nowrap">• {waitingCount} waiting</span>}
            <span className="shrink-0">•</span>
            <span className="truncate">{hostNames}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={cn('text-xs font-mono', status.textColor)}>{status.symbol}</span>
          <span className="hidden text-[11px] text-muted-foreground sm:inline" suppressHydrationWarning>
            {hydrated ? formatRelativeTime(group.lastActivityAt) : '—'}
          </span>
          {expanded
            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
            : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
      </summary>

      {expanded && (
        <div className="space-y-2 border-t px-2 pb-2 pt-2">
          <div className="flex items-center gap-2 px-3 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Bot className="h-3.5 w-3.5" /> Lead terminal
          </div>
          <TmuxPaneRow
            pane={group.orchestrator}
            selectedSessionId={selectedSessionId}
            hydrated={hydrated}
            onSelectSession={onSelectSession}
            onOpenActions={onOpenActions}
            hostOnline={isHostOnline(
              hosts.find((host) => host.id === group.orchestrator.session.host_id)?.last_seen_at ?? null
            )}
          />
          <div className="px-3 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Workers
          </div>
          {group.workers.map((worker) => (
            <TmuxPaneRow
              key={worker.session.id}
              pane={worker}
              selectedSessionId={selectedSessionId}
              hydrated={hydrated}
              onSelectSession={onSelectSession}
              onOpenActions={onOpenActions}
              hostOnline={isHostOnline(
                hosts.find((host) => host.id === worker.session.host_id)?.last_seen_at ?? null
              )}
            />
          ))}
        </div>
      )}
    </details>
  );
}
