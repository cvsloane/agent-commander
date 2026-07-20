import { describe, expect, it, vi } from 'vitest';
import { runTmuxWindowAction } from './windowActions';

describe('tmux window actions', () => {
  it('dispatches window selection through the attached session', async () => {
    const dispatch = vi.fn().mockResolvedValue({ cmd_id: 'command-1' });

    const result = await runTmuxWindowAction({
      sessionId: '22222222-2222-4222-8222-222222222222',
      windowCount: 2,
      action: { type: 'select', windowIndex: 3 },
      dispatch,
    });

    expect(result).toBe('dispatched');
    expect(dispatch).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', {
      type: 'select_window',
      payload: { window_index: 3 },
    });
  });

  it.each([
    [
      { type: 'rename' as const, windowIndex: 3, name: 'review' },
      { type: 'rename_window', payload: { window_index: 3, name: 'review' } },
    ],
    [
      { type: 'close' as const, windowIndex: 3 },
      { type: 'kill_window', payload: { window_index: 3 } },
    ],
    [
      { type: 'new' as const, cwd: '/work/agent-command' },
      { type: 'new_window', payload: { cwd: '/work/agent-command' } },
    ],
  ])('dispatches %s with the command schema payload', async (action, command) => {
    const dispatch = vi.fn().mockResolvedValue({ cmd_id: 'command-1' });

    await runTmuxWindowAction({
      sessionId: '22222222-2222-4222-8222-222222222222',
      windowCount: 2,
      action,
      dispatch,
    });

    expect(dispatch).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', command);
  });

  it('requires the hard session-ending confirmation before closing the last window', async () => {
    const dispatch = vi.fn().mockResolvedValue({ cmd_id: 'command-1' });
    const confirm = vi.fn().mockReturnValue(false);

    const cancelled = await runTmuxWindowAction({
      sessionId: '22222222-2222-4222-8222-222222222222',
      windowCount: 1,
      action: { type: 'close', windowIndex: 0 },
      dispatch,
      confirm,
    });

    expect(cancelled).toBe('cancelled');
    expect(confirm).toHaveBeenCalledWith('This ends the whole tmux session');
    expect(dispatch).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    const dispatched = await runTmuxWindowAction({
      sessionId: '22222222-2222-4222-8222-222222222222',
      windowCount: 1,
      action: { type: 'close', windowIndex: 0 },
      dispatch,
      confirm,
    });

    expect(dispatched).toBe('dispatched');
    expect(dispatch).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', {
      type: 'kill_window',
      payload: { window_index: 0 },
    });
  });

  it('rolls an optimistic window change back when command dispatch fails', async () => {
    const error = new Error('Agent not connected');
    const optimistic = vi.fn();
    const rollback = vi.fn();

    await expect(
      runTmuxWindowAction({
        sessionId: '22222222-2222-4222-8222-222222222222',
        windowCount: 2,
        action: { type: 'rename', windowIndex: 1, name: 'review' },
        dispatch: vi.fn().mockRejectedValue(error),
        optimistic,
        rollback,
      })
    ).rejects.toThrow('Agent not connected');

    expect(optimistic).toHaveBeenCalledOnce();
    expect(rollback).toHaveBeenCalledWith(error);
  });
});
