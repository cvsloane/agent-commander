import { describe, expect, it } from 'vitest';
import {
  EventTypeSchema,
  EventPayloadSchemaRegistry,
  SessionSchema,
  SessionUpsertSchema,
  parseServerToUIMessage,
  validateEventPayload,
} from '../src/index.js';

const sessionId = '11111111-1111-4111-8111-111111111111';

describe('event payload registry', () => {
  it('validates every emitted event family through its registered schema', () => {
    expect(validateEventPayload('claude.hook', {
      hook_name: 'PreToolUse',
      hook_data: {},
    }).status).toBe('valid');
    expect(validateEventPayload('codex.event', {
      type: 'turn.completed',
      usage: { input_tokens: 12 },
    }).status).toBe('valid');
    expect(validateEventPayload('workshop.subagent_start', {
      sessionId,
      provider: 'codex',
      cwd: '/repo',
      timestamp: 1_752_940_800_000,
      tool_use_id: 'toolu_1',
    }).status).toBe('valid');
    expect(validateEventPayload('approval.requested', {
      approval_id: '22222222-2222-4222-8222-222222222222',
      provider: 'claude_code',
      reason: 'Run command?',
      details: {},
    }).status).toBe('valid');
    expect(validateEventPayload('orchestrator.report', {
      outcome: 'succeeded',
      summary: 'Gate passed',
    }).status).toBe('valid');
  });

  it('distinguishes invalid known payloads from forward-compatible unknown types', () => {
    expect(Object.keys(EventPayloadSchemaRegistry).sort()).toEqual(
      [...EventTypeSchema.options].sort()
    );
    expect(validateEventPayload('approval.requested', {})).toMatchObject({
      status: 'invalid',
      eventType: 'approval.requested',
    });
    expect(validateEventPayload('provider.future_event', {})).toEqual({
      status: 'unknown',
      eventType: 'provider.future_event',
    });
    expect(EventTypeSchema.safeParse('session.created').success).toBe(false);
  });
});

describe('runtime wire validation', () => {
  it('reads legacy service sessions but rejects new service upserts', () => {
    const now = new Date().toISOString();
    expect(SessionSchema.safeParse({
      id: sessionId,
      host_id: '22222222-2222-4222-8222-222222222222',
      kind: 'service',
      provider: 'unknown',
      status: 'IDLE',
      created_at: now,
      updated_at: now,
      fork_depth: 0,
    }).success).toBe(true);
    expect(SessionUpsertSchema.safeParse({
      id: sessionId,
      kind: 'service',
      provider: 'unknown',
      status: 'IDLE',
    }).success).toBe(false);
  });

  it('preserves the full typed tmux identity from an agent upsert', () => {
    const parsed = SessionUpsertSchema.parse({
      id: sessionId,
      kind: 'tmux_pane',
      provider: 'codex',
      status: 'RUNNING',
      metadata: {
        tmux: {
          pane_id: '%7',
          target: 'agents:3.2',
          session_name: 'agents',
          window_name: 'data-contracts',
          window_index: 3,
          pane_index: 2,
        },
      },
    });

    expect(parsed.metadata?.tmux).toMatchObject({
      pane_id: '%7',
      target: 'agents:3.2',
      session_name: 'agents',
      window_index: 3,
      pane_index: 2,
    });
  });

  it('accepts valid known UI messages, rejects malformed known messages, and ignores future types', () => {
    const known = {
      v: 1,
      type: 'attention.changed',
      ts: '2026-07-19T18:00:00.000Z',
      payload: { session_id: sessionId, attention_reason: null },
    };
    expect(parseServerToUIMessage(known)).toEqual(known);
    expect(() => parseServerToUIMessage({ ...known, payload: {} })).toThrow();
    expect(parseServerToUIMessage({
      v: 1,
      type: 'attention.future',
      ts: known.ts,
      payload: { additive: true },
    })).toBeNull();
  });
});
