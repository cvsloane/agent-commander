import { describe, expect, it, vi } from 'vitest';
import type { Session } from '@agent-command/schema';
import { analyzeAttentionSnapshot, createAttentionService } from '../src/services/attention.js';

const sessionId = '11111111-1111-4111-8111-111111111111';
const hostId = '22222222-2222-4222-8222-222222222222';
const now = '2026-07-19T16:00:00.000Z';

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: sessionId,
    host_id: hostId,
    user_id: '33333333-3333-4333-8333-333333333333',
    kind: 'tmux_pane',
    provider: 'codex',
    status: 'RUNNING',
    title: 'Codex refactor',
    metadata: {},
    created_at: now,
    updated_at: now,
    fork_depth: 0,
    ...overrides,
  };
}

describe('server-side attention detection', () => {
  it('ports multi-choice detection with the question above the options', () => {
    const result = analyzeAttentionSnapshot(
      ['Choose a deployment target:', '1. Production', '2. Cancel'].join('\n'),
      'multi-hash'
    );

    expect(result).toMatchObject({
      reason: 'multi_choice',
      question: 'Choose a deployment target:',
      confidence: 0.9,
      captureHash: 'multi-hash',
    });
  });

  it('prefers plan review over a generic yes/no prompt', () => {
    const result = analyzeAttentionSnapshot(
      ['Implementation plan', '- Add migration', '- Add service', 'Approve the plan? (y/n)'].join(
        '\n'
      )
    );

    expect(result?.reason).toBe('plan_review');
  });

  it('strips ANSI and detects yes/no, errors, and non-actionable output', () => {
    expect(analyzeAttentionSnapshot('\u001b[33mContinue? (y/n)\u001b[0m')?.reason).toBe('yes_no');
    expect(analyzeAttentionSnapshot('fatal: repository not found')?.reason).toBe('error');
    expect(analyzeAttentionSnapshot('Build completed successfully.')).toBeNull();
  });
});

describe('attention transitions', () => {
  it('persists, publishes, and notifies only a changed snapshot detection', async () => {
    const transitioned = {
      session: session({ attention_reason: 'yes_no' }),
      event: {
        id: 42,
        ts: now,
        type: 'attention.changed',
        payload: {
          attention_reason: 'yes_no',
          question: 'Continue? (y/n)',
          confidence: 0.85,
          capture_hash: 'capture-42',
        },
      },
    };
    const transition = vi.fn().mockResolvedValueOnce(transitioned).mockResolvedValueOnce(null);
    const publish = vi.fn();
    const notify = vi.fn(async () => undefined);
    const service = createAttentionService({ store: { transition }, publish, notify });

    const updated = await service.evaluateSnapshot(session(), 'Continue? (y/n)', 'capture-42');
    await service.evaluateSnapshot(
      session({ attention_reason: 'yes_no' }),
      'Continue? (y/n)',
      'capture-42'
    );

    expect(updated.attention_reason).toBe('yes_no');
    expect(transition).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({
        reason: 'yes_no',
        captureHash: 'capture-42',
      })
    );
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(sessionId, transitioned.event);
    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(transitioned.session, transitioned.event.payload);
  });

  it('uses status attention on inventory ingest and clears it after progress resumes', async () => {
    const transition = vi.fn(async () => null);
    const service = createAttentionService({
      store: { transition },
      publish: vi.fn(),
      notify: vi.fn(async () => undefined),
    });

    await service.evaluateStatus(session({ status: 'WAITING_FOR_INPUT' }));
    await service.evaluateStatus(session({ status: 'RUNNING', attention_reason: 'waiting_input' }));

    expect(transition.mock.calls[0][1]).toMatchObject({ reason: 'waiting_input' });
    expect(transition.mock.calls[1][1]).toMatchObject({ reason: null });
  });
});
