import { describe, expect, it, vi } from 'vitest';
import {
  CommandOutboxRepository,
  type CommandRecord,
  type Queryer,
} from '../src/db/commandOutbox.js';

const cmdId = '11111111-1111-4111-8111-111111111111';
const hostId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';

function record(overrides: Partial<CommandRecord> = {}): CommandRecord {
  return {
    cmd_id: cmdId,
    host_id: hostId,
    session_id: sessionId,
    type: 'commands.dispatch',
    payload: { type: 'commands.dispatch' },
    class: 'durable',
    status: 'queued',
    created_at: '2026-07-19T16:00:00.000Z',
    sent_at: null,
    completed_at: null,
    expires_at: '2026-07-20T16:00:00.000Z',
    result: null,
    error: null,
    idempotency_key: null,
    ...overrides,
  };
}

describe('CommandOutboxRepository', () => {
  it('enqueues a new durable command with its full wire payload', async () => {
    const query = vi.fn(async () => ({ rows: [record()] }));
    const repository = new CommandOutboxRepository({ query } as Queryer);

    const result = await repository.enqueue({
      cmd_id: cmdId,
      host_id: hostId,
      session_id: sessionId,
      type: 'commands.dispatch',
      payload: { v: 1, type: 'commands.dispatch' },
      class: 'durable',
      expires_at: '2026-07-20T16:00:00.000Z',
    });

    expect(result).toEqual({ record: record(), created: true });
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[1]).toContain(JSON.stringify({ v: 1, type: 'commands.dispatch' }));
  });

  it('returns the original row when an idempotency key already exists', async () => {
    const original = record({ idempotency_key: 'same-request' });
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [original] });
    const repository = new CommandOutboxRepository({ query } as Queryer);

    await expect(repository.enqueue({
      cmd_id: '44444444-4444-4444-8444-444444444444',
      host_id: hostId,
      type: 'commands.dispatch',
      payload: {},
      class: 'durable',
      expires_at: '2026-07-20T16:00:00.000Z',
      idempotency_key: 'same-request',
    })).resolves.toEqual({ record: original, created: false });

    expect(query.mock.calls[1]?.[1]).toEqual([hostId, 'same-request']);
  });

  it('lists queued and sent commands in stable delivery order and expires stale rows', async () => {
    const queued = record();
    const sent = record({
      cmd_id: '55555555-5555-4555-8555-555555555555',
      status: 'sent',
    });
    const expired = record({ status: 'expired' });
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [queued, sent] })
      .mockResolvedValueOnce({ rows: [expired] });
    const repository = new CommandOutboxRepository({ query } as Queryer);

    await expect(repository.listDeliverable(hostId)).resolves.toEqual([queued, sent]);
    await expect(repository.expireStale(hostId)).resolves.toEqual([expired]);
    expect(String(query.mock.calls[0]?.[0])).toContain('ORDER BY created_at ASC, cmd_id ASC');
  });

  it('records sent, completed, and failed transitions', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [record({ status: 'sent' })] })
      .mockResolvedValueOnce({ rows: [record({ status: 'completed' })] })
      .mockResolvedValueOnce({ rows: [record({ status: 'failed' })] });
    const repository = new CommandOutboxRepository({ query } as Queryer);

    await repository.markSent(cmdId);
    await repository.markCompleted(cmdId, { pane_id: '%1' });
    await repository.markFailed(cmdId, { code: 'agent_error' });

    expect(query.mock.calls[1]?.[1]).toEqual([cmdId, JSON.stringify({ pane_id: '%1' })]);
    expect(query.mock.calls[2]?.[1]).toEqual([cmdId, JSON.stringify({ code: 'agent_error' })]);
  });
});
