import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commandRouter } from '../src/services/commandRouter.js';
import { pubsub } from '../src/services/pubsub.js';

const hostId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const cmdId = '01HZXCOMMANDROUTERTEST000000000';

describe('commandRouter', () => {
  beforeEach(() => {
    pubsub.removeAgentConnection(hostId);
    vi.useRealTimers();
  });

  afterEach(() => {
    pubsub.removeAgentConnection(hostId);
    vi.useRealTimers();
  });

  it('dispatches validated command messages to the target host agent', () => {
    const send = vi.fn();
    pubsub.addAgentConnection(hostId, { send } as never);

    const sent = commandRouter.dispatch(hostId, sessionId, cmdId, {
      type: 'send_input',
      payload: { text: 'hello', enter: true },
    });

    expect(sent).toBe(true);
    expect(send).toHaveBeenCalledOnce();
    const message = JSON.parse(String(send.mock.calls[0]?.[0]));
    expect(message).toMatchObject({
      v: 1,
      type: 'commands.dispatch',
      payload: {
        cmd_id: cmdId,
        session_id: sessionId,
        command: {
          type: 'send_input',
          payload: { text: 'hello', enter: true },
        },
      },
    });
  });

  it('correlates async command results by command id', async () => {
    const send = vi.fn();
    pubsub.addAgentConnection(hostId, { send } as never);

    const resultPromise = commandRouter.dispatchAndWait(hostId, sessionId, cmdId, {
      type: 'capture_pane',
      payload: { last_n_lines: 50 },
    });

    expect(send).toHaveBeenCalledOnce();
    expect(commandRouter.handleResult(cmdId, {
      ok: true,
      result: { content: 'captured text' },
    })).toBe(true);

    await expect(resultPromise).resolves.toEqual({
      ok: true,
      result: { content: 'captured text' },
    });
  });

  it('rejects pending commands on timeout', async () => {
    vi.useFakeTimers();
    const send = vi.fn();
    pubsub.addAgentConnection(hostId, { send } as never);

    const resultPromise = commandRouter.dispatchAndWait(hostId, sessionId, cmdId, {
      type: 'capture_pane',
      payload: {},
    }, 100);
    const rejection = expect(resultPromise).rejects.toThrow('Command timed out');

    await vi.advanceTimersByTimeAsync(101);
    await rejection;
    expect(commandRouter.handleResult(cmdId, { ok: true })).toBe(false);
  });
});
