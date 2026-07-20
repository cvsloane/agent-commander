'use client';

import { cn } from '@/lib/utils';
import { useConnectionStore, type EventConnectionStatus } from '@/stores/connection';

const STATUS_LABELS: Record<EventConnectionStatus, string> = {
  connecting: 'Connecting',
  connected: 'Connected',
  reconnecting: 'Reconnecting',
  offline: 'Offline',
  disconnected: 'Disconnected',
};

export function HeaderConnectionStatus() {
  const status = useConnectionStore((state) => state.eventStatus);
  const label = STATUS_LABELS[status];

  return (
    <div
      className="flex min-h-11 items-center gap-1.5 rounded-md px-1.5 text-[11px] font-medium text-muted-foreground sm:px-2 sm:text-xs"
      role="status"
      aria-label={`Event connection: ${label}`}
      title={`Event connection: ${label}`}
    >
      <span
        className={cn(
          'h-2 w-2 shrink-0 rounded-full',
          status === 'connected' && 'bg-emerald-500',
          (status === 'connecting' || status === 'reconnecting') && 'bg-amber-500 motion-safe:animate-pulse',
          (status === 'offline' || status === 'disconnected') && 'bg-red-500'
        )}
        aria-hidden="true"
      />
      <span className="hidden min-[360px]:inline">{label}</span>
    </div>
  );
}
