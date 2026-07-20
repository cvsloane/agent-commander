'use client';

import { BellRing, BellOff, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { usePushSubscription } from '@/hooks/usePushSubscription';

interface PushNotificationsCardProps {
  className?: string;
  compact?: boolean;
}

export function PushNotificationsCard({ className, compact = false }: PushNotificationsCardProps) {
  const { state, subscribe, unsubscribe, refresh } = usePushSubscription();
  const busy = ['checking', 'subscribing', 'unsubscribing'].includes(state.status);

  const statusText = (() => {
    switch (state.status) {
      case 'checking':
        return 'Checking this device…';
      case 'unsupported':
        return 'This browser does not support Web Push.';
      case 'permission-required':
        return 'Ready to enable on this device.';
      case 'permission-denied':
        return 'Blocked in browser settings. Allow notifications there, then retry.';
      case 'unsubscribed':
        return 'Push is off on this device.';
      case 'subscribing':
        return 'Enabling push notifications…';
      case 'subscribed':
        return 'Enabled on this device.';
      case 'unsubscribing':
        return 'Disabling push notifications…';
      case 'unavailable':
      case 'error':
        return state.error;
    }
  })();

  return (
    <div className={cn('rounded-lg border p-4', compact ? 'space-y-3' : 'space-y-4', className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            {state.status === 'subscribed' ? (
              <BellRing className="h-4 w-4 text-cyan-500" />
            ) : (
              <BellOff className="h-4 w-4" />
            )}
            Web Push
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground" aria-live="polite">
            {statusText}
          </p>
        </div>
        <span
          className={cn(
            'mt-1 h-2.5 w-2.5 shrink-0 rounded-full',
            state.status === 'subscribed'
              ? 'bg-cyan-500'
              : state.status === 'error' || state.status === 'permission-denied'
                ? 'bg-red-500'
                : 'bg-muted-foreground/40'
          )}
          aria-hidden="true"
        />
      </div>

      {!compact && (
        <p className="text-xs text-muted-foreground">
          Receive approval, waiting-input, blocked-run, and failure alerts even when Agent Commander is closed.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {state.status === 'subscribed' ? (
          <Button variant="outline" size="sm" onClick={() => void unsubscribe()} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Disable on this device
          </Button>
        ) : state.status === 'unsupported' ? null : (
          <Button
            size="sm"
            onClick={() => void subscribe()}
            disabled={busy || state.status === 'permission-denied' || state.status === 'unavailable'}
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Enable push
          </Button>
        )}
        {['error', 'permission-denied', 'unavailable'].includes(state.status) && (
          <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={busy}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry check
          </Button>
        )}
      </div>
    </div>
  );
}
