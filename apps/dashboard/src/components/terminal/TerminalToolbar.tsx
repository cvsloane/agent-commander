'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ConnectionStatus } from './types';

const statusColors: Record<ConnectionStatus, string> = {
  disconnected: 'bg-gray-500',
  connecting: 'bg-yellow-500 animate-pulse',
  connected: 'bg-green-500',
  error: 'bg-red-500',
};

const statusLabels: Record<ConnectionStatus, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting...',
  connected: 'Connected',
  error: 'Error',
};

interface TerminalToolbarProps {
  status: ConnectionStatus;
  readOnly: boolean;
  errorMessage: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onTakeControl: () => void;
  onFocus: () => void;
}

export function TerminalToolbar({
  status,
  readOnly,
  errorMessage,
  onConnect,
  onDisconnect,
  onTakeControl,
  onFocus,
}: TerminalToolbarProps) {
  return (
    <div className="flex items-center gap-2 border-b bg-muted/30 p-2">
      {status === 'connected' ? (
        <Button size="sm" variant="outline" onClick={onDisconnect}>
          Detach
        </Button>
      ) : (
        <Button
          size="sm"
          onClick={onConnect}
          disabled={status === 'connecting'}
        >
          {status === 'connecting' ? 'Connecting...' : 'Attach Terminal'}
        </Button>
      )}

      <div className="flex items-center gap-2 text-xs">
        <span className={cn('h-2 w-2 rounded-full', statusColors[status])} />
        {statusLabels[status]}
      </div>

      {status === 'connected' && readOnly && (
        <div className="flex items-center gap-2 text-xs text-amber-600">
          <span className="h-2 w-2 rounded-full bg-amber-500" />
          Read-only
        </div>
      )}

      {errorMessage && (
        <span className="ml-2 text-xs text-destructive">{errorMessage}</span>
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
