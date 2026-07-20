import { describe, expect, it, vi } from 'vitest';
import { createWebPushService } from '../src/services/webPush.js';

const userId = '11111111-1111-4111-8111-111111111111';
const firstId = '22222222-2222-4222-8222-222222222222';
const secondId = '33333333-3333-4333-8333-333333333333';

function subscription(id: string, suffix: string) {
  return {
    id,
    user_id: userId,
    endpoint: `https://push.example.test/${suffix}`,
    p256dh: `p256dh-${suffix}`,
    auth: `auth-${suffix}`,
    device_label: null,
    created_at: '2026-07-19T16:00:00.000Z',
    last_seen_at: '2026-07-19T16:00:00.000Z',
    failure_count: 0,
  };
}

function harness(sendNotification: ReturnType<typeof vi.fn>, allowed = true) {
  const subscriptions = {
    list: vi.fn(async () => [subscription(firstId, 'first'), subscription(secondId, 'second')]),
    removeById: vi.fn(async () => undefined),
    recordSuccess: vi.fn(async () => undefined),
    recordFailure: vi.fn(async () => 1),
  };
  const notifications = {
    reserve: vi.fn(async () => ({ allowed, reason: allowed ? undefined : 'dedupe_key' })),
    recordSuccess: vi.fn(async () => undefined),
    recordFailure: vi.fn(async () => undefined),
    recordLog: vi.fn(async () => undefined),
  };
  const sleep = vi.fn(async () => undefined);
  const sender = { setVapidDetails: vi.fn(), sendNotification };
  const service = createWebPushService({
    sender,
    subscriptions,
    notifications,
    sleep,
    publicKey: 'public',
    privateKey: 'private',
    subject: 'mailto:admin@example.test',
  });
  return { service, subscriptions, notifications, sender, sleep };
}

const notification = {
  userId,
  eventType: 'approval.requested',
  dedupeKey: 'approval:abc',
  title: 'Approval required',
  body: 'Codex needs permission to continue.',
  url: 'https://agent-command.example.test/tmux?host_id=h&session_id=s&mode=terminal',
  tag: 'approval:abc',
};

describe('web push delivery', () => {
  it('sends deep-linked payloads and prunes expired subscriptions', async () => {
    const sendNotification = vi
      .fn()
      .mockResolvedValueOnce({ statusCode: 201 })
      .mockRejectedValueOnce({ statusCode: 410, message: 'Gone' });
    const { service, subscriptions, notifications } = harness(sendNotification);

    const result = await service.send(notification);

    expect(result).toEqual({ sent: 1, failed: 0, pruned: 1, throttled: false });
    const payload = JSON.parse(sendNotification.mock.calls[0][1]);
    expect(payload).toMatchObject({
      title: notification.title,
      body: notification.body,
      url: notification.url,
      data: { url: notification.url },
    });
    expect(subscriptions.recordSuccess).toHaveBeenCalledWith(firstId);
    expect(subscriptions.removeById).toHaveBeenCalledWith(secondId);
    expect(subscriptions.recordFailure).not.toHaveBeenCalled();
    expect(notifications.recordLog).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'pruned',
        responseStatus: 410,
      })
    );
  });

  it('retries transient delivery with backoff and resets failures only after success', async () => {
    const sendNotification = vi
      .fn()
      .mockRejectedValueOnce({ statusCode: 503, message: 'Unavailable' })
      .mockResolvedValue({ statusCode: 201 });
    const { service, subscriptions, sleep } = harness(sendNotification);
    subscriptions.list.mockResolvedValueOnce([subscription(firstId, 'first')]);

    const result = await service.send(notification);

    expect(result.sent).toBe(1);
    expect(sendNotification).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
    expect(subscriptions.recordSuccess).toHaveBeenCalledOnce();
    expect(subscriptions.recordFailure).not.toHaveBeenCalled();
  });

  it('increments a subscription failure once after retry exhaustion', async () => {
    const sendNotification = vi.fn().mockRejectedValue({ statusCode: 503, message: 'Unavailable' });
    const { service, subscriptions, notifications, sleep } = harness(sendNotification);
    subscriptions.list.mockResolvedValueOnce([subscription(firstId, 'first')]);

    const result = await service.send(notification);

    expect(result.failed).toBe(1);
    expect(sendNotification).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([250, 1000]);
    expect(subscriptions.recordFailure).toHaveBeenCalledOnce();
    expect(subscriptions.recordSuccess).not.toHaveBeenCalled();
    expect(notifications.recordFailure).toHaveBeenCalledOnce();
  });

  it('does not contact the vendor when PostgreSQL throttle state blocks delivery', async () => {
    const sendNotification = vi.fn();
    const { service, notifications } = harness(sendNotification, false);

    const result = await service.send(notification);

    expect(result).toEqual({ sent: 0, failed: 0, pruned: 0, throttled: true });
    expect(sendNotification).not.toHaveBeenCalled();
    expect(notifications.recordLog).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'throttled',
      })
    );
  });
});
