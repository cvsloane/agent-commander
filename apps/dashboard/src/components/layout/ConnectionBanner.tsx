'use client';

import { RefreshCw, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useConnectionStore } from '@/stores/connection';

export function ConnectionBanner() {
  const status = useConnectionStore((state) => state.eventStatus);
  if (status !== 'reconnecting' && status !== 'offline') return null;

  const offline = status === 'offline';
  const Icon = offline ? WifiOff : RefreshCw;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-50 flex justify-center px-3"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div
        className={cn(
          'flex h-8 max-w-full items-center gap-2 rounded-full border px-3 text-xs font-medium shadow-sm backdrop-blur-sm',
          offline
            ? 'border-red-300 bg-red-50/95 text-red-800 dark:border-red-900 dark:bg-red-950/95 dark:text-red-200'
            : 'border-amber-300 bg-amber-50/95 text-amber-900 dark:border-amber-900 dark:bg-amber-950/95 dark:text-amber-100'
        )}
      >
        <Icon
          className={cn('h-3.5 w-3.5 shrink-0', !offline && 'motion-safe:animate-spin')}
          aria-hidden="true"
        />
        <span>{offline ? 'offline' : 'reconnecting…'}</span>
      </div>
    </div>
  );
}
