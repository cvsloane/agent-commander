import { describe, expect, it } from 'vitest';
import {
  AgentTaskSchema,
  LaunchRequestSchema,
  ServerToUIMessageSchema,
  SessionEdgeSchema,
  SessionRoleSchema,
  SessionSchema,
  SpawnSessionPayloadSchema,
  UISubscribeMessageSchema,
  WorkItemSchema,
} from '../src/index.js';

const parentSessionId = '11111111-1111-4111-8111-111111111111';
const childSessionId = '22222222-2222-4222-8222-222222222222';
const taskId = '33333333-3333-4333-8333-333333333333';
const now = '2026-07-19T16:00:00.000Z';

describe('orchestration contracts', () => {
  it('validates session graph roles, edges, and in-process agent tasks', () => {
    expect(SessionRoleSchema.parse('orchestrator')).toBe('orchestrator');
    expect(SessionEdgeSchema.parse({
      parent_session_id: parentSessionId,
      child_session_id: childSessionId,
      edge_type: 'spawned',
      created_at: now,
    })).toMatchObject({ child_session_id: childSessionId, edge_type: 'spawned' });
    expect(AgentTaskSchema.parse({
      id: taskId,
      session_id: parentSessionId,
      tool_use_id: 'toolu_01',
      description: 'Inspect the session graph',
      status: 'running',
      started_at: now,
      ended_at: null,
      metadata: { subagent_type: 'Explore' },
    })).toMatchObject({ tool_use_id: 'toolu_01', status: 'running' });
  });

  it('carries orchestration linkage through session, spawn, launch, work-item, and UI contracts', () => {
    const session = SessionSchema.parse({
      id: childSessionId,
      host_id: taskId,
      kind: 'tmux_pane',
      provider: 'codex',
      status: 'STARTING',
      role: 'worker',
      metadata: { parent_session_id: parentSessionId },
      created_at: now,
      updated_at: now,
    });
    expect(session.role).toBe('worker');

    expect(SpawnSessionPayloadSchema.parse({
      provider: 'codex',
      working_directory: '/tmp/repo',
      parent_session_id: parentSessionId,
      role: 'worker',
    })).toMatchObject({ parent_session_id: parentSessionId, role: 'worker' });
    expect(LaunchRequestSchema.parse({
      host_id: taskId,
      provider: 'codex',
      working_directory: '/tmp/repo',
      parent_session_id: parentSessionId,
      role: 'worker',
    })).toMatchObject({ parent_session_id: parentSessionId, role: 'worker' });

    expect(WorkItemSchema.parse({
      id: taskId,
      user_id: parentSessionId,
      session_id: childSessionId,
      title: 'Review contracts',
      objective: 'Verify the new orchestration contracts',
      status: 'in_progress',
      priority: 1,
    }).session_id).toBe(childSessionId);

    expect(UISubscribeMessageSchema.parse({
      v: 1,
      type: 'ui.subscribe',
      ts: now,
      payload: {
        topics: [{ type: 'session_edges' }, { type: 'agent_tasks' }],
      },
    }).payload.topics).toHaveLength(2);

    expect(ServerToUIMessageSchema.parse({
      v: 1,
      type: 'session_edges.changed',
      ts: now,
      payload: {
        session_id: parentSessionId,
        edges: [{
          parent_session_id: parentSessionId,
          child_session_id: childSessionId,
          edge_type: 'spawned',
          created_at: now,
        }],
      },
    }).type).toBe('session_edges.changed');
    expect(ServerToUIMessageSchema.parse({
      v: 1,
      type: 'agent_tasks.changed',
      ts: now,
      payload: {
        session_id: parentSessionId,
        agent_tasks: [{
          id: taskId,
          session_id: parentSessionId,
          tool_use_id: 'toolu_01',
          description: 'Review contracts',
          status: 'completed',
          started_at: now,
          ended_at: now,
          metadata: {},
        }],
      },
    }).type).toBe('agent_tasks.changed');
  });
});
