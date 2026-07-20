import { describe, expect, it, vi } from 'vitest';
import {
  AgentTasksRepository,
  agentTaskUpdateFromEvent,
  type Queryer,
} from '../src/db/agentTasks.js';

const sessionId = '11111111-1111-4111-8111-111111111111';
const taskId = '22222222-2222-4222-8222-222222222222';
const startedAt = '2026-07-19T16:00:00.000Z';
const endedAt = '2026-07-19T16:02:00.000Z';
const task = {
  id: taskId,
  session_id: sessionId,
  tool_use_id: 'toolu_01',
  description: 'Inspect the graph module',
  status: 'running' as const,
  started_at: startedAt,
  ended_at: null,
  metadata: { provider: 'claude_code' },
};

describe('AgentTasksRepository', () => {
  it('upserts, lists, and deletes an in-process agent task without regressing terminal status', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [task] })
      .mockResolvedValueOnce({ rows: [task] })
      .mockResolvedValueOnce({ rows: [task], rowCount: 1 });
    const repository = new AgentTasksRepository({ query } as Queryer);

    await expect(repository.upsert({
      session_id: sessionId,
      tool_use_id: 'toolu_01',
      description: task.description,
      status: 'running',
      started_at: startedAt,
      metadata: task.metadata,
    })).resolves.toEqual(task);
    await expect(repository.list(sessionId)).resolves.toEqual([task]);
    await expect(repository.delete(sessionId, 'toolu_01')).resolves.toBe(true);

    const upsertSql = String(query.mock.calls[0]?.[0]);
    expect(upsertSql).toContain('ON CONFLICT (session_id, tool_use_id)');
    expect(upsertSql).toContain("EXCLUDED.status = 'running'");
    expect(query.mock.calls[2]?.[1]).toEqual([sessionId, 'toolu_01']);
  });

  it('loads fleet tasks in bounded pages', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [task] })
      .mockResolvedValueOnce({ rows: [] });
    const repository = new AgentTasksRepository({ query } as Queryer);

    await expect(repository.listMany([sessionId], 1)).resolves.toEqual([task]);

    expect(query.mock.calls[0]?.[1]).toEqual([[sessionId], 1, 0]);
    expect(query.mock.calls[1]?.[1]).toEqual([[sessionId], 1, 1]);
    expect(String(query.mock.calls[0]?.[0])).toContain('session_id = ANY($1::uuid[])');
  });
});

describe('agentTaskUpdateFromEvent', () => {
  it('maps subagent lifecycle hooks using agentd fidelity fields', () => {
    expect(agentTaskUpdateFromEvent(sessionId, 'workshop.subagent_start', {
      tool_use_id: 'toolu_01',
      description: 'Inspect the graph module',
      timestamp: Date.parse(startedAt),
      provider: 'claude_code',
    })).toMatchObject({
      session_id: sessionId,
      tool_use_id: 'toolu_01',
      description: 'Inspect the graph module',
      status: 'running',
      started_at: startedAt,
      ended_at: null,
    });

    expect(agentTaskUpdateFromEvent(sessionId, 'workshop.subagent_stop', {
      toolUseId: 'toolu_01',
      description: 'Inspect the graph module',
      timestamp: endedAt,
      success: false,
    })).toMatchObject({
      tool_use_id: 'toolu_01',
      status: 'failed',
      ended_at: endedAt,
    });
  });

  it('maps the actual workshop Task pre/post tool payload emitted by agentd', () => {
    expect(agentTaskUpdateFromEvent(sessionId, 'workshop.pre_tool_use', {
      tool: 'Task',
      toolUseId: 'toolu_02',
      toolInput: {
        description: 'Trace the spawn flow',
        subagent_type: 'Explore',
      },
      timestamp: Date.parse(startedAt),
    })).toMatchObject({
      tool_use_id: 'toolu_02',
      description: 'Trace the spawn flow',
      status: 'running',
    });

    expect(agentTaskUpdateFromEvent(sessionId, 'workshop.post_tool_use', {
      tool: 'Task',
      toolUseId: 'toolu_02',
      toolInput: { description: 'Trace the spawn flow' },
      timestamp: Date.parse(endedAt),
      success: true,
    })).toMatchObject({
      tool_use_id: 'toolu_02',
      status: 'completed',
      ended_at: endedAt,
    });
  });

  it('ignores unrelated events and Task hooks without a stable tool-use id', () => {
    expect(agentTaskUpdateFromEvent(sessionId, 'workshop.notification', {
      message: 'hello',
    })).toBeNull();
    expect(agentTaskUpdateFromEvent(sessionId, 'workshop.pre_tool_use', {
      tool: 'Task',
      toolInput: { description: 'No id' },
    })).toBeNull();
  });
});
