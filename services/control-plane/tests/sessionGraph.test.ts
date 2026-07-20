import { describe, expect, it, vi } from 'vitest';
import {
  SessionGraphRepository,
  type Queryer,
  type SessionGraphRollup,
} from '../src/db/sessionGraph.js';

const parentSessionId = '11111111-1111-4111-8111-111111111111';
const childSessionId = '22222222-2222-4222-8222-222222222222';
const createdAt = '2026-07-19T16:00:00.000Z';
const edge = {
  parent_session_id: parentSessionId,
  child_session_id: childSessionId,
  edge_type: 'spawned' as const,
  created_at: createdAt,
};

describe('SessionGraphRepository', () => {
  it('upserts, lists, and deletes typed session edges', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [edge] })
      .mockResolvedValueOnce({ rows: [edge] })
      .mockResolvedValueOnce({ rows: [edge], rowCount: 1 });
    const repository = new SessionGraphRepository({ query } as Queryer);

    await expect(repository.upsert({
      parent_session_id: parentSessionId,
      child_session_id: childSessionId,
      edge_type: 'spawned',
    })).resolves.toEqual({ edge, created: true });
    await expect(repository.list(parentSessionId)).resolves.toEqual([edge]);
    await expect(repository.delete({
      parent_session_id: parentSessionId,
      child_session_id: childSessionId,
      edge_type: 'spawned',
    })).resolves.toBe(true);

    expect(String(query.mock.calls[0]?.[0])).toContain('ON CONFLICT');
    expect(String(query.mock.calls[1]?.[0])).toContain('parent_session_id = $1 OR child_session_id = $1');
    expect(query.mock.calls[2]?.[1]).toEqual([parentSessionId, childSessionId, 'spawned']);
  });

  it('reads an existing edge without updating it or reporting a change', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [edge] });
    const repository = new SessionGraphRepository({ query } as Queryer);

    await expect(repository.upsert({
      parent_session_id: parentSessionId,
      child_session_id: childSessionId,
      edge_type: 'spawned',
    })).resolves.toEqual({ edge, created: false });

    expect(String(query.mock.calls[0]?.[0])).toContain('DO NOTHING');
    expect(String(query.mock.calls[0]?.[0])).not.toContain('DO UPDATE');
    expect(String(query.mock.calls[1]?.[0])).toContain('SELECT * FROM session_edges');
  });

  it('returns child-session and in-process task status rollups for a parent', async () => {
    const row = {
      child_session_total: '3',
      child_sessions_by_status: { RUNNING: 2, ERROR: 1 },
      agent_task_total: '4',
      agent_task_running: '1',
      agent_task_completed: '2',
      agent_task_failed: '1',
    };
    const query = vi.fn(async () => ({ rows: [row] }));
    const repository = new SessionGraphRepository({ query } as Queryer);

    const expected: SessionGraphRollup = {
      session_id: parentSessionId,
      child_sessions: {
        total: 3,
        by_status: { RUNNING: 2, ERROR: 1 },
      },
      agent_tasks: {
        total: 4,
        running: 1,
        completed: 2,
        failed: 1,
      },
    };
    await expect(repository.rollup(parentSessionId)).resolves.toEqual(expected);

    expect(String(query.mock.calls[0]?.[0])).toContain('COUNT(DISTINCT child.id)');
    expect(String(query.mock.calls[0]?.[0])).toContain('FROM agent_tasks');
    expect(query.mock.calls[0]?.[1]).toEqual([parentSessionId]);
  });

  it('sets session roles and backfills fork edges from existing lineage', async () => {
    const roleSession = { id: childSessionId, role: 'worker' };
    const forkEdge = { ...edge, edge_type: 'forked' as const };
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [roleSession] })
      .mockResolvedValueOnce({ rows: [forkEdge] });
    const repository = new SessionGraphRepository({ query } as Queryer);

    await expect(repository.setRole(childSessionId, 'worker')).resolves.toEqual(roleSession);
    await expect(repository.backfillForkEdges(parentSessionId)).resolves.toEqual([forkEdge]);

    expect(query.mock.calls[0]?.[1]).toEqual([childSessionId, 'worker']);
    expect(String(query.mock.calls[1]?.[0])).toContain('sessions.forked_from = $1');
  });
});
