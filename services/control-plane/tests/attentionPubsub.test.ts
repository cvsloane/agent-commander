import { afterEach, describe, expect, it, vi } from 'vitest';
import { pubsub } from '../src/services/pubsub.js';

const sessionId = '11111111-1111-4111-8111-111111111111';

describe('attention session subscriptions', () => {
  afterEach(() => {
    pubsub.removeUIClient('attention-filter-test');
  });

  it('includes a running session when persisted detection marks it as needing attention', () => {
    const send = vi.fn();
    pubsub.addUIClient('attention-filter-test', { send } as never);
    pubsub.setUISubscriptions('attention-filter-test', [
      {
        type: 'sessions',
        filter: { needs_attention: true },
      },
    ]);

    pubsub.publishSessionsChanged([
      {
        id: sessionId,
        host_id: '22222222-2222-4222-8222-222222222222',
        kind: 'tmux_pane',
        provider: 'codex',
        status: 'RUNNING',
        attention_reason: 'yes_no',
        metadata: {},
        created_at: '2026-07-19T16:00:00.000Z',
        updated_at: '2026-07-19T16:00:00.000Z',
        fork_depth: 0,
      },
    ]);

    expect(send).toHaveBeenCalledOnce();
    expect(JSON.parse(send.mock.calls[0][0])).toMatchObject({
      type: 'sessions.changed',
      payload: { sessions: [{ id: sessionId, attention_reason: 'yes_no' }] },
    });
  });
});
