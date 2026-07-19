import { describe, expect, it, vi } from 'vitest';
import { createUIStreamResumeService } from '../src/services/uiStreamResume.js';

const userId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const runId = '33333333-3333-4333-8333-333333333333';
const now = '2026-07-19T16:00:00.000Z';

describe('UI stream resume', () => {
  it('replays missed event, attention, and run-event messages after the cursor', async () => {
    const query = vi.fn(async (sql: string, values: unknown[]) => {
      if (sql.includes("e.type = 'attention.changed'")) {
        return {
          rows: [
            {
              id: 44,
              session_id: sessionId,
              ts: now,
              type: 'attention.changed',
              payload: { attention_reason: 'yes_no', question: 'Continue?' },
            },
          ],
        };
      }
      if (sql.includes('FROM automation_run_events')) {
        return {
          rows: [
            {
              id: 10,
              automation_run_id: runId,
              seq: 8,
              event_type: 'run.failed',
              level: 'error',
              message: 'Run failed.',
              payload: {},
              created_at: now,
            },
          ],
        };
      }
      return {
        rows: [
          {
            id: 43,
            session_id: sessionId,
            ts: now,
            type: 'turn.completed',
            payload: { ok: true },
          },
        ],
      };
    });
    const service = createUIStreamResumeService({ query } as never);

    const messages = await service.replay(
      userId,
      [
        { type: 'events', filter: { session_id: sessionId } },
        { type: 'attention', filter: { session_id: sessionId } },
        { type: 'automation_run_events', filter: { automation_run_id: runId } },
      ],
      42
    );

    expect(messages.map((message) => [message.type, message.seq])).toEqual([
      ['events.appended', 43],
      ['attention.changed', 44],
      ['automation.run.event', 8],
    ]);
    expect(query.mock.calls.every(([, values]) => values.includes(userId))).toBe(true);
    expect(query.mock.calls.every(([, values]) => values.includes(42))).toBe(true);

    query.mockClear();
    await service.replay(
      userId,
      [{ type: 'events' }, { type: 'attention' }, { type: 'automation_run_events' }],
      { events: 42, attention: 43, automation_run_events: 7 }
    );
    expect(query.mock.calls.map(([, values]) => values[1])).toEqual([42, 43, 7]);
  });

  it('builds an initial session, latest-snapshot, and current-attention state', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('DISTINCT ON')) {
        return {
          rows: [
            {
              id: 12,
              session_id: sessionId,
              capture_text: 'Continue? (y/n)',
              capture_hash: 'snapshot-hash',
              created_at: now,
            },
          ],
        };
      }
      return {
        rows: [
          {
            id: sessionId,
            host_id: '44444444-4444-4444-8444-444444444444',
            user_id: userId,
            kind: 'tmux_pane',
            provider: 'codex',
            status: 'WAITING_FOR_INPUT',
            attention_reason: 'yes_no',
            metadata: {},
            created_at: now,
            updated_at: now,
            fork_depth: 0,
          },
        ],
      };
    });
    const service = createUIStreamResumeService({ query } as never);

    const messages = await service.initialSnapshot(userId, [
      { type: 'sessions' },
      { type: 'snapshots' },
      { type: 'attention' },
    ]);

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'sessions.changed' }),
        expect.objectContaining({ type: 'snapshots.updated' }),
        expect.objectContaining({
          type: 'attention.changed',
          payload: expect.objectContaining({ attention_reason: 'yes_no' }),
        }),
      ])
    );
  });
});
