import { describe, expect, it } from 'vitest';
import {
  ApprovalDecideRequestSchema,
  AutomationAgentSchema,
  AutomationRunSchema,
  CreateWorkItemSchema,
  MemorySearchQuerySchema,
  UpsertAutomationAgentSchema,
  UpsertMemoryEntrySchema,
  WorkItemsQuerySchema,
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

describe('memory schemas', () => {
  it('bounds memory search limits for operator queries', () => {
    const parsed = MemorySearchQuerySchema.parse({ q: 'approval policy', limit: '25' });

    expect(parsed.limit).toBe(25);
    expect(MemorySearchQuerySchema.safeParse({ q: 'approval policy', limit: 101 }).success).toBe(false);
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
