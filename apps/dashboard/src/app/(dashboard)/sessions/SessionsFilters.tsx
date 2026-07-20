'use client';

import type { Host } from '@agent-command/schema';
import { Button } from '@/components/ui/button';

const selectClassName =
  'h-11 w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-[200px]';

export function SessionsFilters({
  query,
  status,
  provider,
  hostId,
  hosts,
  onQueryChange,
  onApply,
  onFilterChange,
}: {
  query: string;
  status: string;
  provider: string;
  hostId: string;
  hosts: Host[];
  onQueryChange: (value: string) => void;
  onApply: () => void;
  onFilterChange: (key: 'status' | 'provider' | 'host_id', value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3 sm:flex-row sm:flex-wrap sm:items-end">
      <input
        type="search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => event.key === 'Enter' && onApply()}
        placeholder="Filter title, cwd, repo, branch…"
        aria-label="Filter sessions"
        className="h-11 w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-[240px]"
      />
      <select
        value={status}
        onChange={(event) => onFilterChange('status', event.target.value)}
        aria-label="Filter by status"
        className={selectClassName}
      >
        <option value="">All Statuses</option>
        {[
          'STARTING',
          'RUNNING',
          'IDLE',
          'WAITING_FOR_INPUT',
          'WAITING_FOR_APPROVAL',
          'ERROR',
          'DONE',
        ].map((value) => (
          <option key={value} value={value}>
            {value.replace(/_/g, ' ')}
          </option>
        ))}
      </select>
      <select
        value={provider}
        onChange={(event) => onFilterChange('provider', event.target.value)}
        aria-label="Filter by provider"
        className={selectClassName}
      >
        <option value="">All Providers</option>
        {[
          ['claude_code', 'Claude Code'],
          ['codex', 'Codex'],
          ['gemini_cli', 'Gemini CLI'],
          ['opencode', 'OpenCode'],
          ['cursor', 'Cursor'],
          ['aider', 'Aider'],
          ['continue', 'Continue'],
          ['shell', 'Shell'],
          ['unknown', 'Unknown'],
        ].map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <select
        value={hostId}
        onChange={(event) => onFilterChange('host_id', event.target.value)}
        aria-label="Filter by host"
        className={selectClassName}
      >
        <option value="">All Hosts</option>
        {hosts.map((host) => (
          <option key={host.id} value={host.id}>
            {host.name}
          </option>
        ))}
      </select>
      <Button size="mobile" onClick={onApply} className="w-full sm:w-auto">
        Apply
      </Button>
    </div>
  );
}
