import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  reconcileTmuxCommandResult,
  registerPendingTmuxCommand,
  resetTmuxCommandReconciliation,
} from './tmuxCommands';

const hostId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';

describe('tmux command result reconciliation', () => {
  beforeEach(resetTmuxCommandReconciliation);

  it('keeps successful optimistic state and rolls failures back with the agent error', () => {
    const rollback = vi.fn();
    registerPendingTmuxCommand({
      cmdId: 'cmd-success',
      sessionId,
      failureTitle: 'tmux command failed',
      rollback,
    });
    expect(reconcileTmuxCommandResult({
      cmd_id: 'cmd-success',
      session_id: sessionId,
      host_id: hostId,
      ok: true,
    })).toMatchObject({ ok: true, cmdId: 'cmd-success' });
    expect(rollback).not.toHaveBeenCalled();

    registerPendingTmuxCommand({
      cmdId: 'cmd-failure',
      sessionId,
      failureTitle: 'tmux command failed',
      rollback,
    });
    expect(reconcileTmuxCommandResult({
      cmd_id: 'cmd-failure',
      session_id: sessionId,
      host_id: hostId,
      ok: false,
      error: { code: 'TMUX_COMMAND_FAILED', message: "can't find window: 2" },
    })).toMatchObject({
      ok: false,
      cmdId: 'cmd-failure',
      message: "can't find window: 2",
    });
    expect(rollback).toHaveBeenCalledOnce();
    expect(rollback.mock.calls[0]?.[0]).toMatchObject({ message: "can't find window: 2" });
  });

  it('reconciles a result that beats the REST dispatch response', () => {
    reconcileTmuxCommandResult({
      cmd_id: 'cmd-fast',
      session_id: sessionId,
      host_id: hostId,
      ok: false,
      error: { code: 'TMUX_COMMAND_FAILED', message: 'fast failure' },
    });
    const rollback = vi.fn();

    expect(registerPendingTmuxCommand({
      cmdId: 'cmd-fast',
      sessionId,
      failureTitle: 'tmux command failed',
      rollback,
    })).toMatchObject({ ok: false, message: 'fast failure' });
    expect(rollback).toHaveBeenCalledOnce();
  });
});
