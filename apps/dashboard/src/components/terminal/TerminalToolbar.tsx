'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ConnectionStatus } from './types';

const statusColors: Record<ConnectionStatus, string> = {
  disconnected: 'bg-gray-500',
  connecting: 'bg-yellow-500 animate-pulse',
  reconnecting: 'bg-amber-500 animate-pulse',
  connected: 'bg-green-500',
  error: 'bg-red-500',
};

const statusLabels: Record<ConnectionStatus, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting...',
  reconnecting: 'Reconnecting...',
  connected: 'Connected',
  error: 'Error',
};

interface TerminalToolbarProps {
  status: ConnectionStatus;
  readOnly: boolean;
  errorMessage: string | null;
  lagMessage: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onTakeControl: () => void;
  onFocus: () => void;
}

export function TerminalToolbar({
  status,
  readOnly,
  errorMessage,
  lagMessage,
  onConnect,
  onDisconnect,
  onTakeControl,
  onFocus,
}: TerminalToolbarProps) {
  const connectionPending = status === 'connecting' || status === 'reconnecting';

  return (
    <div className="flex min-h-12 min-w-0 items-center gap-2 border-b bg-muted/30 p-2">
      {status === 'connected' ? (
        <Button size="sm" variant="outline" onClick={onDisconnect}>
          Detach
        </Button>
      ) : (
        <Button
          size="sm"
          onClick={onConnect}
          disabled={connectionPending}
        >
          {connectionPending ? statusLabels[status] : 'Attach Terminal'}
        </Button>
      )}

      <div className="flex shrink-0 items-center gap-2 text-xs" aria-live="polite">
        <span className={cn('h-2 w-2 rounded-full', statusColors[status])} aria-hidden="true" />
        {statusLabels[status]}
      </div>

      {status === 'connected' && readOnly && (
        <div className="flex items-center gap-2 text-xs text-amber-600">
          <span className="h-2 w-2 rounded-full bg-amber-500" />
          Read-only
        </div>
      )}

      {errorMessage && (
        <span className="ml-2 min-w-0 truncate text-xs text-destructive" title={errorMessage}>
          {errorMessage}
        </span>
      )}

      {!errorMessage && lagMessage && (
        <span className="ml-2 min-w-0 truncate text-xs text-amber-600" title={lagMessage}>
          {lagMessage}
        </span>
      )}

      <div className="flex-1" />

      {status === 'connected' && readOnly && (
        <Button
          size="sm"
          variant="default"
          onClick={onTakeControl}
        >
          Take Control
        </Button>
      )}

      {status === 'connected' && (
        <Button
          size="sm"
          variant="ghost"
          onClick={onFocus}
        >
          Focus
        </Button>
      )}
    </div>
  );
}
