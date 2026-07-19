import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  release: vi.fn(),
  connect: vi.fn(),
}));

vi.mock('../src/db/index.js', () => ({
  pool: {
    query: vi.fn(),
    connect: database.connect,
  },
}));

import { decideApprovalAndEnqueue } from '../src/db/commandOutbox.js';

const approvalId = '11111111-1111-4111-8111-111111111111';
const hostId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
const userId = '44444444-4444-4444-8444-444444444444';
const cmdId = '55555555-5555-4555-8555-555555555555';

function input() {
  return {
    approval_id: approvalId,
    decision: 'allow' as const,
    decided_payload: { mode: 'default' },
    decided_by_user_id: userId,
    command: {
      cmd_id: cmdId,
      host_id: hostId,
      session_id: sessionId,
      type: 'approvals.decision',
      payload: { type: 'approvals.decision' },
      class: 'durable' as const,
      expires_at: '2026-07-19T17:00:00.000Z',
    },
  };
}

describe('approval decision outbox transaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.connect.mockResolvedValue({
      query: database.clientQuery,
      release: database.release,
    });
  });

  it('rolls back the approval update when command insertion fails', async () => {
    database.clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: approvalId, session_id: sessionId }] })
      .mockRejectedValueOnce(new Error('command insert failed'))
      .mockResolvedValueOnce({ rows: [] });

    await expect(decideApprovalAndEnqueue(input())).rejects.toThrow('command insert failed');

    expect(database.clientQuery.mock.calls.map(([sql]) => String(sql).trim())).toEqual([
      'BEGIN',
      expect.stringContaining('UPDATE approvals SET'),
      expect.stringContaining('INSERT INTO commands'),
      'ROLLBACK',
    ]);
    expect(database.release).toHaveBeenCalledOnce();
  });
});
