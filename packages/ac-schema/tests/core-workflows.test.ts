import { describe, expect, it } from 'vitest';
import {
  AlertProviderFiltersSchema,
  ApprovalDecideRequestSchema,
  AutomationAgentSchema,
  AutomationRunSchema,
  CaptureTranscriptPayloadSchema,
  CommandPayloadSchema,
  CreateWorkItemSchema,
  MemorySearchQuerySchema,
  ScrollbackRequestSchema,
  ScrollbackResultSchema,
  ServerToUIMessageSchema,
  TmuxPaneIdentitySchema,
  UpsertAutomationAgentSchema,
  UpsertMemoryEntrySchema,
  WorkItemsQuerySchema,
  UISubscribeMessageSchema,
  UsageThresholdsSchema,
} from '../src/index.js';

const uuid = '11111111-1111-4111-8111-111111111111';

describe('Zod 4 compatibility', () => {
  it('preserves partial provider records accepted before the migration', () => {
    expect(AlertProviderFiltersSchema.parse({ codex: false })).toEqual({ codex: false });
    expect(UsageThresholdsSchema.parse({ codex: [50, 80] })).toEqual({ codex: [50, 80] });
  });
});

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

describe('UI stream subscription readiness', () => {
  it('correlates an optional subscription request with a server acknowledgement', () => {
    const subscribed = UISubscribeMessageSchema.parse({
      v: 1,
      type: 'ui.subscribe',
      ts: '2026-07-23T12:00:00.000Z',
      payload: {
        subscription_id: uuid,
        topics: [{ type: 'commands.result' }],
      },
    });
    expect(subscribed.payload.subscription_id).toBe(uuid);

    const acknowledgement = ServerToUIMessageSchema.parse({
      v: 1,
      type: 'ui.subscribed',
      ts: '2026-07-23T12:00:00.001Z',
      payload: { subscription_id: uuid },
    });
    expect(acknowledgement.type).toBe('ui.subscribed');
    expect(acknowledgement.payload.subscription_id).toBe(uuid);
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
  it('requires an anchored scrollback cursor to be wholly absent or wholly present', () => {
    expect(ScrollbackRequestSchema.parse({ mode: 'full' })).toEqual({
      mode: 'full',
      strip_ansi: true,
    });
    expect(
      ScrollbackRequestSchema.parse({
        mode: 'full',
        page_size: 500,
        snapshot_id: uuid,
        before_line: 7_500,
      }),
    ).toEqual({
      mode: 'full',
      page_size: 500,
      snapshot_id: uuid,
      before_line: 7_500,
      strip_ansi: true,
    });

    expect(
      ScrollbackRequestSchema.safeParse({ mode: 'full', snapshot_id: uuid }).success,
    ).toBe(false);
    expect(
      ScrollbackRequestSchema.safeParse({ mode: 'full', before_line: 7_500 }).success,
    ).toBe(false);
    expect(
      ScrollbackRequestSchema.safeParse({ mode: 'full', page_size: 5_001 }).success,
    ).toBe(false);

    const command = CommandPayloadSchema.parse({
      type: 'capture_pane',
      payload: {
        mode: 'full',
        page_size: 500,
        snapshot_id: uuid,
        before_line: 7_500,
      },
    });
    expect(command.payload).toMatchObject({
      page_size: 500,
      snapshot_id: uuid,
      before_line: 7_500,
    });
  });

  it('types bounded immutable scrollback page metadata', () => {
    const page = ScrollbackResultSchema.parse({
      content: 'older\nnewer',
      line_count: 2,
      capture_mode: 'snapshot',
      snapshot_id: uuid,
      range_start: 7_498,
      range_end: 7_500,
      total_lines: 8_000,
      source_total_lines: 8_000,
      snapshot_truncated: false,
      has_older: true,
      next_before: 7_498,
    });

    expect(page).toMatchObject({
      snapshot_id: uuid,
      range_start: 7_498,
      range_end: 7_500,
      next_before: 7_498,
    });
    expect(
      ScrollbackResultSchema.safeParse({
        ...page,
        line_count: 5_001,
      }).success,
    ).toBe(false);
  });

  it('defaults and bounds transcript capture pages', () => {
    expect(CaptureTranscriptPayloadSchema.parse({})).toEqual({ page_size: 200 });
    expect(CaptureTranscriptPayloadSchema.parse({ page_size: 500, before_entry: 42 })).toEqual({
      page_size: 500,
      before_entry: 42,
    });
    expect(CaptureTranscriptPayloadSchema.safeParse({ page_size: 501 }).success).toBe(false);
    expect(CaptureTranscriptPayloadSchema.safeParse({ before_entry: -1 }).success).toBe(false);
    expect(
      CommandPayloadSchema.safeParse({
        type: 'capture_transcript',
        payload: { page_size: 250 },
      }).success
    ).toBe(true);
  });

  it('enforces tmux window and pane command optionality', () => {
    expect(CommandPayloadSchema.safeParse({ type: 'new_window', payload: {} }).success).toBe(true);
    expect(
      CommandPayloadSchema.safeParse({
        type: 'split_pane',
        payload: { direction: 'horizontal' },
      }).success
    ).toBe(true);
    expect(CommandPayloadSchema.safeParse({ type: 'split_pane', payload: {} }).success).toBe(false);
    expect(
      CommandPayloadSchema.safeParse({
        type: 'resize_pane',
        payload: { pane_id: '%14', height: 30 },
      }).success
    ).toBe(true);
    expect(
      CommandPayloadSchema.safeParse({
        type: 'resize_pane',
        payload: { pane_id: '%14' },
      }).success
    ).toBe(false);
  });

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
