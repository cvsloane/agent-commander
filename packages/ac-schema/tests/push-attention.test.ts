import { describe, expect, it } from 'vitest';
import {
  PushSubscriptionRequestSchema,
  ServerToUIMessageSchema,
  SessionSchema,
  UISubscribeMessageSchema,
} from '../src/index.js';

const now = '2026-07-19T16:00:00.000Z';
const sessionId = '11111111-1111-4111-8111-111111111111';
const hostId = '22222222-2222-4222-8222-222222222222';

describe('push, attention, and UI resume contracts', () => {
  it('accepts browser push subscriptions and rejects missing encryption keys', () => {
    const parsed = PushSubscriptionRequestSchema.parse({
      endpoint: 'https://push.example.test/subscriptions/123',
      keys: {
        p256dh: 'browser-public-key',
        auth: 'browser-auth-secret',
      },
      device_label: 'Chris phone',
    });

    expect(parsed.device_label).toBe('Chris phone');
    expect(
      PushSubscriptionRequestSchema.safeParse({
        endpoint: 'https://push.example.test/subscriptions/123',
        keys: { p256dh: 'browser-public-key' },
      }).success
    ).toBe(false);
  });

  it('keeps legacy subscriptions valid while accepting a resume cursor', () => {
    const legacy = UISubscribeMessageSchema.parse({
      v: 1,
      type: 'ui.subscribe',
      ts: now,
      payload: { topics: [{ type: 'events' }] },
    });
    const resumable = UISubscribeMessageSchema.parse({
      v: 1,
      type: 'ui.subscribe',
      ts: now,
      payload: {
        since: 41,
        topics: [{ type: 'events' }, { type: 'attention' }],
      },
    });

    expect(legacy.payload.since).toBeUndefined();
    expect(resumable.payload.since).toBe(41);

    const perTopic = UISubscribeMessageSchema.parse({
      v: 1,
      type: 'ui.subscribe',
      ts: now,
      payload: {
        since: { events: 41, attention: 41, automation_run_events: 7 },
        topics: [{ type: 'events' }, { type: 'automation_run_events' }],
      },
    });
    expect(perTopic.payload.since).toEqual({
      events: 41,
      attention: 41,
      automation_run_events: 7,
    });
  });

  it('carries persisted attention and additive sequence cursors to the UI', () => {
    const session = SessionSchema.parse({
      id: sessionId,
      host_id: hostId,
      kind: 'tmux_pane',
      provider: 'codex',
      status: 'WAITING_FOR_INPUT',
      attention_reason: 'yes_no',
      metadata: {},
      created_at: now,
      updated_at: now,
    });
    const message = ServerToUIMessageSchema.parse({
      v: 1,
      type: 'attention.changed',
      ts: now,
      seq: 42,
      payload: {
        session_id: sessionId,
        attention_reason: 'yes_no',
        question: 'Continue? (y/n)',
        confidence: 0.85,
        capture_hash: 'capture-42',
      },
    });

    expect(session.attention_reason).toBe('yes_no');
    expect(message.seq).toBe(42);
    expect(message.type).toBe('attention.changed');
  });
});
