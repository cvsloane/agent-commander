import { describe, expect, it, vi } from 'vitest';
import { createClawdbotNotifier } from '../src/services/clawdbot.js';

const userId = '11111111-1111-4111-8111-111111111111';

describe('OpenClaw durable delivery', () => {
  it('retries with backoff, logs delivery, and shares PostgreSQL throttle decisions across instances', async () => {
    const notifications = {
      reserve: vi
        .fn()
        .mockResolvedValueOnce({ allowed: true })
        .mockResolvedValueOnce({ allowed: false, reason: 'dedupe_key' }),
      recordSuccess: vi.fn(async () => undefined),
      recordFailure: vi.fn(async () => undefined),
      recordLog: vi.fn(async () => undefined),
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 202 });
    const sleep = vi.fn(async () => undefined);
    const getSettings = vi.fn(async () => ({
      data: {
        alertSettings: {
          clawdbot: {
            enabled: true,
            baseUrl: 'https://openclaw.example.test',
            token: 'secret',
            events: { approvals: true },
            providers: { codex: true },
            throttle: { maxPerHour: 30, batchDelayMs: 60_000, sessionCooldownMs: 30_000 },
          },
        },
      },
    }));
    const dependencies = {
      notifications,
      fetch: fetchMock as never,
      getSettings,
      sleep,
    };
    const firstProcess = createClawdbotNotifier(dependencies);
    await firstProcess.queueNotification(userId, 'approvals', 'codex', 'Approval required', {
      approvalId: 'approval-1',
      isActionable: true,
      url: '/orchestrator',
    });
    await firstProcess.flushPending();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
    expect(notifications.recordSuccess).toHaveBeenCalledOnce();
    expect(notifications.recordFailure).not.toHaveBeenCalled();
    expect(notifications.recordLog).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'sent',
        attemptCount: 2,
        responseStatus: 202,
      })
    );

    const restartedProcess = createClawdbotNotifier(dependencies);
    await restartedProcess.queueNotification(userId, 'approvals', 'codex', 'Approval required', {
      approvalId: 'approval-1',
      isActionable: true,
      url: '/orchestrator',
    });
    await restartedProcess.flushPending();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(notifications.reserve).toHaveBeenCalledTimes(2);
    expect(notifications.recordLog).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'throttled',
        error: 'dedupe_key',
      })
    );
  });
});
