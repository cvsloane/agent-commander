'use client';

import { Badge, getStatusBadgeVariant } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn, getStatusIndicator } from '@/lib/utils';
import type { Host } from '@agent-command/schema';
import { useHydrated } from '@/hooks/useHydrated';

interface StatusBadgeProps {
  status: string;
  host?: Host | null;
  showTooltip?: boolean;
  className?: string;
}

// Check if host is considered offline
function isHostOffline(host: Host | null | undefined): boolean {
  if (!host) return false;

  const lastSeen = host.last_seen_at ? new Date(host.last_seen_at) : null;
  if (!lastSeen) return true;

  const now = new Date();
  const diffSeconds = (now.getTime() - lastSeen.getTime()) / 1000;

  // Host is offline if last seen more than 60 seconds ago
  return diffSeconds > 60;
}

export function StatusBadge({ status, host, showTooltip = true, className }: StatusBadgeProps) {
  const hydrated = useHydrated();
  const offline = hydrated ? isHostOffline(host) : false;

  // If host is offline, override the status
  const effectiveStatus = offline ? 'OFFLINE' : status;

  // Get variant and indicator based on effective status
  const variant = offline ? 'outline' : getStatusBadgeVariant(status);
  const indicator = offline
    ? { symbol: '!', label: 'Offline' }
    : getStatusIndicator(status);

  const badge = (
    <Badge
      variant={variant}
      className={cn(
        offline && 'border-gray-400 text-gray-500 bg-gray-100 dark:bg-gray-800 dark:text-gray-400',
        className
      )}
      suppressHydrationWarning
    >
      <span className="mr-1 font-mono">{indicator.symbol}</span>
      {indicator.label}
    </Badge>
  );

  if (!showTooltip || !offline) {
    return badge;
  }

  const lastSeen = host?.last_seen_at
    ? hydrated
      ? new Date(host.last_seen_at).toLocaleString()
      : '—'
    : 'Unknown';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {badge}
      </TooltipTrigger>
      <TooltipContent>
        <p>Host disconnected</p>
        <p className="text-xs text-muted-foreground" suppressHydrationWarning>
          Last seen: {lastSeen}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

export { isHostOffline };
