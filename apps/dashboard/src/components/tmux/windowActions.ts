import type { CommandRequest } from '@agent-command/schema';
import { sendCommand } from '@/lib/api';

export type TmuxWindowAction =
  | { type: 'select'; windowIndex: number }
  | { type: 'rename'; windowIndex: number; name: string }
  | { type: 'close'; windowIndex: number }
  | { type: 'new'; cwd?: string };

interface RunTmuxWindowActionOptions {
  sessionId: string;
  windowCount: number;
  windowSource: 'topology' | 'roster';
  action: TmuxWindowAction;
  dispatch?: typeof sendCommand;
  confirm?: (message: string) => boolean;
  optimistic?: () => void;
  rollback?: (error: unknown) => void;
  onDispatched?: (cmdId: string) => void;
}

function commandForAction(action: TmuxWindowAction): CommandRequest {
  switch (action.type) {
    case 'select':
      return { type: 'select_window', payload: { window_index: action.windowIndex } };
    case 'rename':
      return {
        type: 'rename_window',
        payload: { window_index: action.windowIndex, name: action.name },
      };
    case 'close':
      return { type: 'kill_window', payload: { window_index: action.windowIndex } };
    case 'new':
      return {
        type: 'new_window',
        payload: action.cwd ? { cwd: action.cwd } : {},
      };
  }
}

export async function runTmuxWindowAction({
  sessionId,
  windowCount,
  windowSource,
  action,
  dispatch = sendCommand,
  confirm = (message) => window.confirm(message),
  optimistic,
  rollback,
  onDispatched,
}: RunTmuxWindowActionOptions): Promise<'dispatched' | 'cancelled'> {
  if (action.type === 'close') {
    const confirmation =
      windowSource === 'topology'
        ? windowCount === 1
          ? 'This ends the whole tmux session'
          : 'Close this window?'
        : 'Close this window?';
    if (confirmation && !confirm(confirmation)) return 'cancelled';
  }
  optimistic?.();
  let response: { cmd_id: string };
  try {
    response = await dispatch(sessionId, commandForAction(action));
  } catch (error) {
    rollback?.(error);
    throw error;
  }
  onDispatched?.(response.cmd_id);
  return 'dispatched';
}
