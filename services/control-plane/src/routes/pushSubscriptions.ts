import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { PushSubscriptionRequestSchema, PushUnsubscribeRequestSchema } from '@agent-command/schema';
import { pushSubscriptions } from '../db/pushSubscriptions.js';
import { webPushService } from '../services/webPush.js';

function publicSubscription(subscription: Awaited<ReturnType<typeof pushSubscriptions.upsert>>) {
  return {
    id: subscription.id,
    endpoint: subscription.endpoint,
    device_label: subscription.device_label,
    created_at: subscription.created_at,
    last_seen_at: subscription.last_seen_at,
  };
}

export function registerPushSubscriptionRoutes(app: FastifyInstance): void {
  app.get('/v1/push/vapid-public-key', async () => ({
    enabled: Boolean(webPushService.publicKey),
    public_key: webPushService.publicKey,
  }));

  const listSubscriptions = async (request: FastifyRequest) => {
    const subscriptions = await pushSubscriptions.list(request.user!.id);
    return {
      subscriptions: subscriptions.map(publicSubscription),
    };
  };
  app.get('/v1/push-subscriptions', listSubscriptions);
  app.get('/v1/push/subscriptions', listSubscriptions);

  const createSubscription = async (
    request: FastifyRequest<{ Body: unknown }>,
    reply: FastifyReply
  ) => {
    const parsed = PushSubscriptionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid push subscription', details: parsed.error });
    }

    try {
      const subscription = await pushSubscriptions.upsert(request.user!.id, {
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        device_label: parsed.data.device_label,
      });
      return reply.status(201).send({
        success: true,
        subscription: publicSubscription(subscription),
      });
    } catch (error) {
      if ((error as Error).message.includes('another user')) {
        return reply.status(409).send({ error: 'Push endpoint is already registered' });
      }
      throw error;
    }
  };
  app.post('/v1/push-subscriptions', createSubscription);
  app.post('/v1/push/subscriptions', createSubscription);

  const deleteSubscription = async (
    request: FastifyRequest<{ Body: unknown }>,
    reply: FastifyReply
  ) => {
    const parsed = PushUnsubscribeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid push subscription', details: parsed.error });
    }
    await pushSubscriptions.remove(request.user!.id, parsed.data.endpoint);
    return reply.send({ success: true });
  };
  app.delete('/v1/push-subscriptions', deleteSubscription);
  app.delete('/v1/push/subscriptions', deleteSubscription);
}
