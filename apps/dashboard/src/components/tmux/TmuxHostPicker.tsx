'use client';

import type { Host } from '@agent-command/schema';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn, isHostOnline } from '@/lib/utils';

interface TmuxHostPickerProps {
  hosts: Host[];
  selectedHostId: string;
  onSelectHost: (hostId: string) => void;
}

export function TmuxHostPicker({ hosts, selectedHostId, onSelectHost }: TmuxHostPickerProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Hosts</CardTitle>
        <CardDescription>Select a machine, then drill into its live tmux windows.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {hosts.map((host) => {
          const online = isHostOnline(host.last_seen_at ?? null);
          const active = host.id === selectedHostId;
          return (
            <button
              key={host.id}
              type="button"
              onClick={() => onSelectHost(host.id)}
              className={cn(
                'inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'bg-background hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <span
                className={cn(
                  'h-2 w-2 rounded-full',
                  online ? 'bg-green-500' : active ? 'bg-primary-foreground/70' : 'bg-gray-400'
                )}
              />
              <span className="font-medium">{host.name}</span>
              {host.tailscale_name && (
                <span className={cn('text-xs', active ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                  {host.tailscale_name}
                </span>
              )}
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}
