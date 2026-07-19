import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const memoryId = '33333333-3333-4333-8333-333333333333';
const trajectoryId = '44444444-4444-4444-8444-444444444444';

describe('session memory ingestion idempotency', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('recovers rows won by a concurrent ingestion without checking out a lock client', async () => {
    const memory = {
      id: memoryId,
      user_id: userId,
      session_id: sessionId,
      scope_type: 'global',
      tier: 'episodic',
      summary: 'Worker completed',
      content: 'Worker completed',
      metadata: {},
      confidence: 0.7,
    };
    const trajectory = {
      id: trajectoryId,
      user_id: userId,
      session_id: sessionId,
      outcome: 'succeeded',
      summary: 'Worker completed',
      steps_json: {},
    };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('WHERE session_id = $1 LIMIT 1')) return { rows: [] };
      if (sql.includes('WHERE session_id = $1') && sql.includes("tier = 'episodic'")) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO memory_entries')) return { rows: [] };
      if (sql.includes('memory_entries WHERE ingestion_key')) return { rows: [memory] };
      if (sql.includes('INSERT INTO memory_trajectories')) return { rows: [] };
      if (sql.includes('memory_trajectories WHERE ingestion_key')) return { rows: [trajectory] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const connect = vi.fn(() => {
      throw new Error('ingestion must not reserve a pool client');
    });
    vi.doMock('../src/db/index.js', () => ({
      pool: { query, connect },
      getEvents: vi.fn(async () => []),
      getLatestSnapshot: vi.fn(async () => null),
      getRepoById: vi.fn(),
      getSessionById: vi.fn(async () => ({
        id: sessionId,
        user_id: userId,
        repo_id: null,
        provider: 'codex',
        status: 'DONE',
        title: 'Worker completed',
      })),
      getSessionUsageLatest: vi.fn(async () => []),
      getToolStats: vi.fn(async () => []),
    }));
    vi.doMock('../src/config.js', () => ({ config: {} }));

    const { ingestSessionToMemory } = await import('../src/db/automationMemory.js');
    const result = await ingestSessionToMemory({ session_id: sessionId });

    expect(result).toEqual({ memory, trajectory });
    expect(connect).not.toHaveBeenCalled();
    expect(query.mock.calls.filter(([sql]) => String(sql).includes('ingestion_key'))).toHaveLength(4);
  });
});
