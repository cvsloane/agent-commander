import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CommandRouter,
  HOST_COMMAND_SESSION_ID,
  type CommandOutbox,
} from '../src/services/commandRouter.js';
import type { CommandRecord, EnqueueCommand } from '../src/db/commandOutbox.js';

const hostId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const cmdId = '33333333-3333-4333-8333-333333333333';

function record(input: Partial<CommandRecord> = {}): CommandRecord {
  return {
    cmd_id: cmdId,
    host_id: hostId,
    session_id: sessionId,
    type: 'commands.dispatch',
    payload: {},
    class: 'volatile',
    status: 'queued',
    created_at: '2026-07-19T16:00:00.000Z',
    sent_at: null,
    completed_at: null,
    expires_at: '2026-07-20T16:00:00.000Z',
    result: null,
    error: null,
    idempotency_key: null,
    ...input,
  };
}

function buildRouter(sendResult = true) {
  const records: CommandRecord[] = [];
  const outbox: CommandOutbox = {
    enqueue: vi.fn(async (input: EnqueueCommand) => {
      const created = record({
        cmd_id: input.cmd_id,
        host_id: input.host_id,
        session_id: input.session_id ?? null,
        type: input.type,
        payload: input.payload,
        class: input.class,
        expires_at: input.expires_at,
        idempotency_key: input.idempotency_key ?? null,
      });
      records.push(created);
      return { record: created, created: true };
    }),
    getByIdempotencyKey: vi.fn(async () => null),
    markSent: vi.fn(async (id) => record({ cmd_id: id, status: 'sent' })),
    markCompleted: vi.fn(async (id, result) => record({ cmd_id: id, status: 'completed', result: result ?? null })),
    markFailed: vi.fn(async (id, error) => record({ cmd_id: id, status: 'failed', error })),
    listDeliverable: vi.fn(async () => records),
    expireStale: vi.fn(async () => []),
  };
  const transport = { send: vi.fn(() => sendResult) };
  return { router: new CommandRouter(outbox, transport, () => Date.parse('2026-07-19T16:00:00.000Z')), outbox, transport, records };
}

describe('CommandRouter', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists and dispatches validated volatile command messages', async () => {
    const { router, outbox, transport } = buildRouter();

    await expect(router.dispatch(hostId, sessionId, cmdId, {
      type: 'send_input',
      payload: { text: 'hello', enter: true },
    })).resolves.toBe(true);

    expect(outbox.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      cmd_id: cmdId,
      class: 'volatile',
    }));
    expect(transport.send).toHaveBeenCalledWith(hostId, expect.objectContaining({
      v: 1,
      type: 'commands.dispatch',
      payload: expect.objectContaining({
        cmd_id: cmdId,
        session_id: sessionId,
        command: {
          type: 'send_input',
          payload: { text: 'hello', enter: true },
        },
      }),
    }));
    expect(outbox.markSent).toHaveBeenCalledWith(cmdId);
  });

  it('fails fast for offline volatile commands but keeps durable commands queued', async () => {
    const { router, outbox } = buildRouter(false);

    await expect(router.dispatch(hostId, sessionId, cmdId, {
      type: 'send_input',
      payload: { text: 'hello' },
    })).resolves.toBe(false);
    expect(outbox.markFailed).toHaveBeenCalledWith(cmdId, expect.objectContaining({
      code: 'agent_not_connected',
    }));

    const durableId = '44444444-4444-4444-8444-444444444444';
    await expect(router.dispatch(hostId, sessionId, durableId, {
      type: 'spawn_session',
      payload: { provider: 'codex', working_directory: '/tmp' },
    })).resolves.toBe(true);
    expect(outbox.enqueue).toHaveBeenLastCalledWith(expect.objectContaining({
      cmd_id: durableId,
      class: 'durable',
    }));
    expect(outbox.markFailed).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['spawn_session', { provider: 'codex', working_directory: '/tmp' }],
    ['spawn_job', { provider: 'codex', cwd: '/tmp', prompt: 'work' }],
    ['kill_session', {}],
    ['adopt_pane', { tmux_pane_id: '%1' }],
    ['fork', {}],
  ])('classifies %s as durable', async (type, payload) => {
    const { router, outbox } = buildRouter(false);

    await expect(router.dispatch(hostId, sessionId, cmdId, {
      type,
      payload,
    })).resolves.toBe(true);
    expect(outbox.enqueue).toHaveBeenCalledWith(expect.objectContaining({ class: 'durable' }));
    expect(outbox.markFailed).not.toHaveBeenCalled();
  });

  it('correlates results and persists command completion', async () => {
    const { router, outbox } = buildRouter();
    const resultPromise = router.dispatchAndWait(hostId, sessionId, cmdId, {
      type: 'capture_pane',
      payload: { last_n_lines: 50 },
    });
    await vi.waitFor(() => expect(outbox.markSent).toHaveBeenCalled());

    await expect(router.handleResult(cmdId, {
      ok: true,
      result: { content: 'captured text' },
    })).resolves.toBe(true);
    await expect(resultPromise).resolves.toEqual({
      ok: true,
      result: { content: 'captured text' },
    });
    expect(outbox.markCompleted).toHaveBeenCalledWith(cmdId, { content: 'captured text' });
  });

  it('uses the shared pending-response seam for host and legacy MCP messages', async () => {
    const { router, outbox } = buildRouter();
    const hostCommandId = '55555555-5555-4555-8555-555555555555';
    const hostResult = router.dispatchHostAndWait(hostId, hostCommandId, {
      type: 'list_directory',
      payload: { path: '/home/cvsloane/dev', show_hidden: false },
    });
    await vi.waitFor(() => expect(outbox.markSent).toHaveBeenCalled());
    await router.handleResult(hostCommandId, { ok: true, result: { entries: [] } });
    await expect(hostResult).resolves.toEqual({ ok: true, result: { entries: [] } });
    expect(outbox.enqueue).toHaveBeenCalledWith(expect.objectContaining({ session_id: null }));

    const mcpId = '66666666-6666-4666-8666-666666666666';
    const mcpResult = router.dispatchMessageAndWait<{ servers: unknown[] }>(hostId, mcpId, {
      v: 1,
      type: 'mcp.list_servers',
      ts: '2026-07-19T16:00:00.000Z',
      cmd_id: mcpId,
      payload: { cmd_id: mcpId, host_id: hostId },
    });
    await vi.waitFor(() => expect(outbox.markSent).toHaveBeenCalledTimes(2));
    await router.handleResponse(mcpId, { servers: [] });
    await expect(mcpResult).resolves.toEqual({ servers: [] });
  });

  it('redelivers queued and sent records in order after hello', async () => {
    const { router, outbox, transport, records } = buildRouter();
    records.push(
      record({ cmd_id: '77777777-7777-4777-8777-777777777777', payload: { type: 'first' }, class: 'durable' }),
      record({ cmd_id: '88888888-8888-4888-8888-888888888888', payload: { type: 'second' }, class: 'durable', status: 'sent' })
    );

    await expect(router.deliverPending(hostId)).resolves.toEqual({ delivered: 2, expired: 0 });
    expect(transport.send.mock.calls.map(([, message]) => message)).toEqual([
      { type: 'first' },
      { type: 'second' },
    ]);
    expect(outbox.markSent).toHaveBeenCalledTimes(2);
  });

  it('rejects pending commands on timeout', async () => {
    vi.useFakeTimers();
    const { router } = buildRouter();
    const resultPromise = router.dispatchAndWait(hostId, sessionId, cmdId, {
      type: 'capture_pane',
      payload: {},
    }, 100);
    const rejection = expect(resultPromise).rejects.toThrow('Command timed out');

    await vi.advanceTimersByTimeAsync(101);
    await rejection;
    await expect(router.handleResult(cmdId, { ok: true })).resolves.toBe(false);
  });
});
