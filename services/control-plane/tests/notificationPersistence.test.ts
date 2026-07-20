import { describe, expect, it, vi } from 'vitest';
import { createNotificationRepository } from '../src/db/notifications.js';

const userId = '11111111-1111-4111-8111-111111111111';

describe('notification throttle persistence', () => {
  it('blocks a fresh service instance from a recent PostgreSQL dedupe row', async () => {
    const statements: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        statements.push(sql);
        if (sql.includes('FROM notifications_log')) return { rows: [{ count: '0' }] };
        if (sql.includes('FROM notification_delivery_state')) {
          return {
            rows: [
              {
                dedupe_key: 'approval:abc',
                last_sent_at: new Date().toISOString(),
                reserved_until: null,
              },
            ],
          };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const database = {
      connect: vi.fn(async () => client),
      query: vi.fn(async () => ({ rows: [] })),
    };
    const restartedRepository = createNotificationRepository(database as never);

    const result = await restartedRepository.reserve({
      userId,
      channel: 'web_push',
      dedupeKey: 'approval:abc',
    });

    expect(result).toEqual({ allowed: false, reason: 'dedupe_key' });
    expect(statements.some((sql) => sql.includes('INSERT INTO notification_delivery_state'))).toBe(
      false
    );
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('records successful delivery in durable throttle state', async () => {
    const database = {
      connect: vi.fn(),
      query: vi.fn(async () => ({ rows: [] })),
    };
    const repository = createNotificationRepository(database as never);

    await repository.recordSuccess({
      userId,
      channel: 'openclaw',
      dedupeKey: 'run:abc:failed',
    });

    expect(database.query).toHaveBeenCalledWith(expect.stringContaining('last_sent_at = NOW()'), [
      userId,
      'openclaw',
      ['run:abc:failed'],
    ]);
  });
});
