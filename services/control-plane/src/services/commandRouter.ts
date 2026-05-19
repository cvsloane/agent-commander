import { CommandsDispatchMessageSchema } from '@agent-command/schema';
import { pubsub } from './pubsub.js';

export type CommandResult = {
  ok: boolean;
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
};

export type RoutedCommand = {
  type: string;
  payload: unknown;
};

type PendingCommand = {
  resolve: (value: CommandResult) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

class CommandRouter {
  private pendingCommandResults = new Map<string, PendingCommand>();

  dispatch(hostId: string, sessionId: string, cmdId: string, command: RoutedCommand): boolean {
    const dispatchMessage = CommandsDispatchMessageSchema.parse({
      v: 1,
      type: 'commands.dispatch',
      ts: new Date().toISOString(),
      payload: {
        cmd_id: cmdId,
        session_id: sessionId,
        command,
      },
    });

    return pubsub.sendToAgent(hostId, dispatchMessage);
  }

  async dispatchAndWait(
    hostId: string,
    sessionId: string,
    cmdId: string,
    command: RoutedCommand,
    timeoutMs = 30000
  ): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommandResults.delete(cmdId);
        reject(new Error('Command timed out'));
      }, timeoutMs);

      this.pendingCommandResults.set(cmdId, { resolve, reject, timeout });

      const sent = this.dispatch(hostId, sessionId, cmdId, command);
      if (!sent) {
        clearTimeout(timeout);
        this.pendingCommandResults.delete(cmdId);
        reject(new Error('Agent not connected'));
      }
    });
  }

  handleResult(cmdId: string, result: CommandResult): boolean {
    const pending = this.pendingCommandResults.get(cmdId);
    if (!pending) return false;

    clearTimeout(pending.timeout);
    this.pendingCommandResults.delete(cmdId);
    pending.resolve(result);
    return true;
  }
}

export const commandRouter = new CommandRouter();

export function handleCommandResultForPending(cmdId: string, result: CommandResult): boolean {
  return commandRouter.handleResult(cmdId, result);
}
