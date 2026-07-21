import type { UICommandResultMessage } from '@agent-command/schema';

type CommandResultPayload = UICommandResultMessage['payload'];

interface PendingTmuxCommand {
  cmdId: string;
  sessionId: string;
  failureTitle: string;
  rollback?: (error: Error) => void;
}

export interface TmuxCommandReconciliation {
  cmdId: string;
  sessionId: string;
  ok: boolean;
  failureTitle: string;
  message?: string;
}

const pendingCommands = new Map<string, PendingTmuxCommand>();
const earlyResults = new Map<string, CommandResultPayload>();
const MAX_EARLY_RESULTS = 50;

function reconcile(
  pending: PendingTmuxCommand,
  result: CommandResultPayload
): TmuxCommandReconciliation {
  if (result.ok) {
    return {
      cmdId: pending.cmdId,
      sessionId: pending.sessionId,
      ok: true,
      failureTitle: pending.failureTitle,
    };
  }
  const error = new Error(result.error?.message || 'The tmux command failed.');
  pending.rollback?.(error);
  return {
    cmdId: pending.cmdId,
    sessionId: pending.sessionId,
    ok: false,
    failureTitle: pending.failureTitle,
    message: error.message,
  };
}

export function registerPendingTmuxCommand(
  pending: PendingTmuxCommand
): TmuxCommandReconciliation | undefined {
  const earlyResult = earlyResults.get(pending.cmdId);
  if (earlyResult) {
    earlyResults.delete(pending.cmdId);
    return reconcile(pending, earlyResult);
  }
  pendingCommands.set(pending.cmdId, pending);
  return undefined;
}

export function reconcileTmuxCommandResult(
  result: CommandResultPayload
): TmuxCommandReconciliation | undefined {
  const pending = pendingCommands.get(result.cmd_id);
  if (!pending) {
    earlyResults.delete(result.cmd_id);
    earlyResults.set(result.cmd_id, result);
    while (earlyResults.size > MAX_EARLY_RESULTS) {
      const oldest = earlyResults.keys().next().value as string | undefined;
      if (!oldest) break;
      earlyResults.delete(oldest);
    }
    return undefined;
  }
  pendingCommands.delete(result.cmd_id);
  return reconcile(pending, result);
}

export function resetTmuxCommandReconciliation() {
  pendingCommands.clear();
  earlyResults.clear();
}
