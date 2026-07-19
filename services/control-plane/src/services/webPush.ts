import webpush from 'web-push';
import { config } from '../config.js';
import { pushSubscriptions, type PushSubscriptionRecord } from '../db/pushSubscriptions.js';
import { notificationRepository } from '../db/notifications.js';

const RETRY_DELAYS_MS = [250, 1000] as const;

interface PushSender {
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload?: string,
    options?: Record<string, unknown>
  ): Promise<{ statusCode?: number }>;
}

interface SubscriptionStore {
  list(userId: string): Promise<PushSubscriptionRecord[]>;
  removeById(id: string): Promise<void>;
  recordSuccess(id: string): Promise<void>;
  recordFailure(id: string): Promise<number>;
}

interface NotificationStore {
  reserve(input: {
    userId: string;
    channel: 'web_push';
    dedupeKey: string;
    sessionId?: string;
    actionable?: boolean;
    dedupeWindowMs?: number;
    payload?: Record<string, unknown>;
  }): Promise<{ allowed: boolean; reason?: string }>;
  recordSuccess(input: {
    userId: string;
    channel: 'web_push';
    dedupeKey: string;
    sessionId?: string;
    actionable?: boolean;
  }): Promise<void>;
  recordFailure(input: { userId: string; channel: 'web_push'; dedupeKey: string }): Promise<void>;
  recordLog(input: {
    userId: string;
    channel: 'web_push';
    eventType: string;
    dedupeKey: string;
    target?: string;
    status: 'sent' | 'failed' | 'pruned' | 'throttled';
    attemptCount?: number;
    responseStatus?: number;
    error?: string;
    payload?: Record<string, unknown>;
  }): Promise<void>;
}

export interface WebPushNotification {
  userId: string;
  eventType: string;
  dedupeKey: string;
  title: string;
  body: string;
  url: string;
  tag?: string;
  sessionId?: string;
  actionable?: boolean;
  data?: Record<string, unknown>;
  dedupeWindowMs?: number;
}

export interface WebPushDeliverySummary {
  sent: number;
  failed: number;
  pruned: number;
  throttled: boolean;
}

function statusCodeOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === 'number' ? statusCode : undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : typeof (error as { message?: unknown })?.message === 'string'
      ? String((error as { message: string }).message)
      : String(error);
}

function isTransient(statusCode: number | undefined): boolean {
  return statusCode === undefined || statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

export function createWebPushService(options: {
  sender: PushSender;
  subscriptions: SubscriptionStore;
  notifications: NotificationStore;
  sleep?: (milliseconds: number) => Promise<void>;
  publicKey?: string;
  privateKey?: string;
  subject?: string;
}) {
  const enabled = Boolean(options.publicKey && options.privateKey && options.subject);
  if (enabled) {
    options.sender.setVapidDetails(options.subject!, options.publicKey!, options.privateKey!);
  }
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, milliseconds);
        timer.unref?.();
      }));

  async function deliver(
    subscription: PushSubscriptionRecord,
    payload: string
  ): Promise<{
    status: 'sent' | 'failed' | 'pruned';
    attempts: number;
    responseStatus?: number;
    error?: string;
  }> {
    let attempts = 0;
    for (;;) {
      attempts += 1;
      try {
        const response = await options.sender.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          payload,
          { TTL: 300, urgency: 'high' }
        );
        return { status: 'sent', attempts, responseStatus: response.statusCode };
      } catch (error) {
        const responseStatus = statusCodeOf(error);
        if (responseStatus === 404 || responseStatus === 410) {
          return {
            status: 'pruned',
            attempts,
            responseStatus,
            error: messageOf(error),
          };
        }
        const delay = RETRY_DELAYS_MS[attempts - 1];
        if (!delay || !isTransient(responseStatus)) {
          return {
            status: 'failed',
            attempts,
            responseStatus,
            error: messageOf(error),
          };
        }
        await sleep(delay);
      }
    }
  }

  return {
    publicKey: enabled ? options.publicKey! : null,
    async send(notification: WebPushNotification): Promise<WebPushDeliverySummary> {
      const summary: WebPushDeliverySummary = {
        sent: 0,
        failed: 0,
        pruned: 0,
        throttled: false,
      };
      if (!enabled) return summary;

      const subscriptions = await options.subscriptions.list(notification.userId);
      if (subscriptions.length === 0) return summary;

      const payloadObject = {
        title: notification.title,
        body: notification.body,
        tag: notification.tag ?? notification.dedupeKey,
        url: notification.url,
        data: { ...notification.data, url: notification.url },
      };
      const reservation = await options.notifications.reserve({
        userId: notification.userId,
        channel: 'web_push',
        dedupeKey: notification.dedupeKey,
        sessionId: notification.sessionId,
        actionable: notification.actionable,
        dedupeWindowMs: notification.dedupeWindowMs,
        payload: payloadObject,
      });
      if (!reservation.allowed) {
        summary.throttled = true;
        await options.notifications.recordLog({
          userId: notification.userId,
          channel: 'web_push',
          eventType: notification.eventType,
          dedupeKey: notification.dedupeKey,
          status: 'throttled',
          error: reservation.reason,
          payload: payloadObject,
        });
        return summary;
      }

      const payload = JSON.stringify(payloadObject);
      for (const subscription of subscriptions) {
        const delivery = await deliver(subscription, payload);
        summary[delivery.status] += 1;
        if (delivery.status === 'sent') {
          await options.subscriptions.recordSuccess(subscription.id);
        } else if (delivery.status === 'pruned') {
          await options.subscriptions.removeById(subscription.id);
        } else {
          await options.subscriptions.recordFailure(subscription.id);
        }
        await options.notifications.recordLog({
          userId: notification.userId,
          channel: 'web_push',
          eventType: notification.eventType,
          dedupeKey: notification.dedupeKey,
          target: subscription.id,
          status: delivery.status,
          attemptCount: delivery.attempts,
          responseStatus: delivery.responseStatus,
          error: delivery.error,
          payload: payloadObject,
        });
      }

      if (summary.sent > 0) {
        await options.notifications.recordSuccess({
          userId: notification.userId,
          channel: 'web_push',
          dedupeKey: notification.dedupeKey,
          sessionId: notification.sessionId,
          actionable: notification.actionable,
        });
      } else {
        await options.notifications.recordFailure({
          userId: notification.userId,
          channel: 'web_push',
          dedupeKey: notification.dedupeKey,
        });
      }
      return summary;
    },
  };
}

export const webPushService = createWebPushService({
  sender: webpush,
  subscriptions: pushSubscriptions,
  notifications: notificationRepository,
  publicKey: config.VAPID_PUBLIC_KEY,
  privateKey: config.VAPID_PRIVATE_KEY,
  subject: config.VAPID_SUBJECT,
});
