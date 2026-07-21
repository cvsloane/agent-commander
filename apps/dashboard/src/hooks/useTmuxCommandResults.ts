'use client';

import type { ServerToUIMessage } from '@agent-command/schema';
import { useNotificationStore } from '@/stores/notifications';
import { reconcileTmuxCommandResult } from '@/stores/tmuxCommands';
import { useWebSocket } from './useWebSocket';

export function useTmuxCommandResults() {
  const addNotification = useNotificationStore((state) => state.add);
  useWebSocket(
    [{ type: 'commands.result' }],
    (message: ServerToUIMessage) => {
      if (message.type !== 'commands.result') return;
      const reconciliation = reconcileTmuxCommandResult(message.payload);
      if (!reconciliation || reconciliation.ok) return;
      addNotification({
        type: 'error',
        title: reconciliation.failureTitle,
        message: reconciliation.message,
        sessionId: reconciliation.sessionId,
        duration: 8_000,
      });
    },
    true,
    'tmux-command-results'
  );
}
