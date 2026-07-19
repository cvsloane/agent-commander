import { describe, expect, it } from 'vitest';
import {
  ApprovalDecideRequestSchema,
  AutomationAgentSchema,
  AutomationRunSchema,
  CreateWorkItemSchema,
  MemorySearchQuerySchema,
  ServerToUIMessageSchema,
  TmuxPaneIdentitySchema,
  UpsertAutomationAgentSchema,
  UpsertMemoryEntrySchema,
  WorkItemsQuerySchema,
  UISubscribeMessageSchema,
} from '../src/index.js';

const uuid = '11111111-1111-4111-8111-111111111111';

describe('approval schemas', () => {
  it('defaults dashboard approval decisions to both hook and command behavior', () => {
    const parsed = ApprovalDecideRequestSchema.parse({ decision: 'allow' });

    expect(parsed).toEqual({ decision: 'allow', mode: 'both' });
  });

  it('accepts structured updated input for approval edits', () => {
    const parsed = ApprovalDecideRequestSchema.parse({
      decision: 'allow',
      mode: 'hook',
      payload: {
        updatedInput: { command: 'pnpm test:ci' },
      },
    });

    expect(parsed.payload?.updatedInput).toEqual({ command: 'pnpm test:ci' });
  });
});

describe('host presence schemas', () => {
  it('accepts additive hosts subscriptions and presence change messages', () => {
    expect(
      UISubscribeMessageSchema.safeParse({
        v: 1,
        type: 'ui.subscribe',
        ts: '2026-07-19T16:00:00.000Z',
        payload: { topics: [{ type: 'hosts' }] },
      }).success
    ).toBe(true);

    const parsed = ServerToUIMessageSchema.parse({
      v: 1,
      type: 'hosts.changed',
      ts: '2026-07-19T16:00:00.000Z',
      payload: {
        hosts: [
          {
            host_id: uuid,
            online: true,
            last_heartbeat_at: '2026-07-19T16:00:00.000Z',
          },
        ],
      },
    });

    expect(parsed.type).toBe('hosts.changed');
  });
});

describe('memory schemas', () => {
  it('bounds memory search limits for operator queries', () => {
    const parsed = MemorySearchQuerySchema.parse({ q: 'approval policy', limit: '25' });

    expect(parsed.limit).toBe(25);
    expect(MemorySearchQuerySchema.safeParse({ q: 'approval policy', limit: 101 }).success).toBe(
      false
    );
  });

  it('requires durable memory content and confidence in range', () => {
    expect(
      UpsertMemoryEntrySchema.safeParse({
        scope_type: 'repo',
        tier: 'procedural',
        summary: 'Run pnpm test:ci before release',
        content: 'The repo has Vitest coverage for schema and control-plane auth.',
        confidence: 0.9,
      }).success
    ).toBe(true);

    expect(
      UpsertMemoryEntrySchema.safeParse({
        scope_type: 'repo',
        tier: 'procedural',
        summary: '',
        content: 'Missing summary should fail.',
      }).success
    ).toBe(false);
  });
});

describe('tmux schemas', () => {
  it('validates pane identity shared across agent, control plane, and dashboard', () => {
    const parsed = TmuxPaneIdentitySchema.parse({
      pane_id: '%2',
      target: 'agents:0.1',
      session_name: 'agents',
      window_name: 'agent-command',
      window_index: 0,
      pane_index: 1,
    });

    expect(parsed).toMatchObject({
      pane_id: '%2',
      target: 'agents:0.1',
      session_name: 'agents',
      window_name: 'agent-command',
      window_index: 0,
      pane_index: 1,
    });

    expect(
      TmuxPaneIdentitySchema.safeParse({
        pane_id: '',
        target: 'agents:0.1',
        session_name: 'agents',
        window_name: 'agent-command',
        window_index: -1,
        pane_index: 1,
      }).success
    ).toBe(false);
  });
});

describe('automation and work item schemas', () => {
  it('keeps automation agent slugs operator-safe', () => {
    expect(
      UpsertAutomationAgentSchema.safeParse({
        role: 'worker',
        name: 'Release Builder',
        slug: 'release-builder',
        provider: 'claude_code',
      }).success
    ).toBe(true);

    expect(
      UpsertAutomationAgentSchema.safeParse({
        role: 'worker',
        name: 'Release Builder',
        slug: 'Release Builder',
        provider: 'claude_code',
      }).success
    ).toBe(false);
  });

  it('parses automation run records with default JSON containers', () => {
    const parsed = AutomationRunSchema.parse({
      id: uuid,
      automation_agent_id: uuid,
      wakeup_id: uuid,
      status: 'running',
      objective: 'Add CI ratchets',
    });

    expect(parsed.memory_snapshot_json).toEqual({});
    expect(parsed.pending_followups_json).toEqual([]);
    expect(parsed.usage_json).toEqual({});
  });

  it('defaults and bounds work item queries', () => {
    const parsed = WorkItemsQuerySchema.parse({ limit: '20', status: 'queued' });

    expect(parsed).toMatchObject({ limit: 20, status: 'queued' });
    expect(WorkItemsQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });

  it('requires actionable work item title and objective', () => {
    expect(
      CreateWorkItemSchema.safeParse({
        title: 'Add auth tests',
        objective: 'Cover service token and JWT verification.',
        priority: 2,
      }).success
    ).toBe(true);

    expect(
      CreateWorkItemSchema.safeParse({
        title: '',
        objective: 'No title should fail.',
      }).success
    ).toBe(false);
  });

  it('validates persisted automation agents used by the dashboard and API', () => {
    const parsed = AutomationAgentSchema.parse({
      id: uuid,
      user_id: uuid,
      role: 'orchestrator',
      name: 'Daily Operator',
      slug: 'daily-operator',
      status: 'active',
      provider: 'codex',
      max_parallel_runs: 2,
    });

    expect(parsed.wake_policy_json).toEqual({});
    expect(parsed.worker_pool_json).toEqual({});
  });
});
