import { z } from 'zod';

export const PushSubscriptionKeysSchema = z.object({
  p256dh: z.string().min(1),
  auth: z.string().min(1),
});
export type PushSubscriptionKeys = z.infer<typeof PushSubscriptionKeysSchema>;

const NestedPushSubscriptionRequestSchema = z.object({
  endpoint: z.string().url(),
  keys: PushSubscriptionKeysSchema,
  device_label: z.string().trim().min(1).max(120).optional(),
});

const FlatPushSubscriptionRequestSchema = z.object({
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
  device_label: z.string().trim().min(1).max(120).optional(),
});

export const PushSubscriptionRequestSchema = z
  .union([NestedPushSubscriptionRequestSchema, FlatPushSubscriptionRequestSchema])
  .transform((subscription) =>
    'keys' in subscription
      ? subscription
      : {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          device_label: subscription.device_label,
        }
  );
export type PushSubscriptionRequest = z.infer<typeof PushSubscriptionRequestSchema>;

export const PushUnsubscribeRequestSchema = z.object({
  endpoint: z.string().url(),
});
export type PushUnsubscribeRequest = z.infer<typeof PushUnsubscribeRequestSchema>;

export const PushSubscriptionSchema = z.object({
  id: z.string().uuid(),
  endpoint: z.string().url(),
  device_label: z.string().nullable().optional(),
  created_at: z.string().datetime({ offset: true }),
  last_seen_at: z.string().datetime({ offset: true }),
});
export type PushSubscription = z.infer<typeof PushSubscriptionSchema>;

export const AttentionReasonSchema = z.enum([
  'multi_choice',
  'yes_no',
  'text_input',
  'plan_review',
  'error',
  'needs_attention',
  'waiting_input',
  'waiting_approval',
]);
export type AttentionReason = z.infer<typeof AttentionReasonSchema>;
