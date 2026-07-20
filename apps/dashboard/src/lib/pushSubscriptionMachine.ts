export type PushSubscriptionStatus =
  | 'checking'
  | 'unsupported'
  | 'permission-required'
  | 'permission-denied'
  | 'unsubscribed'
  | 'subscribing'
  | 'subscribed'
  | 'unsubscribing'
  | 'unavailable'
  | 'error';

export interface PushSubscriptionState {
  status: PushSubscriptionStatus;
  error: string | null;
}

export type PushSubscriptionEvent =
  | { type: 'CHECK_STARTED' }
  | {
      type: 'CHECK_RESOLVED';
      supported: boolean;
      permission: NotificationPermission;
      subscribed: boolean;
    }
  | { type: 'SUBSCRIBE_STARTED' }
  | { type: 'SUBSCRIBE_SUCCEEDED' }
  | { type: 'UNSUBSCRIBE_STARTED' }
  | { type: 'UNSUBSCRIBE_SUCCEEDED' }
  | { type: 'FAILED'; message: string }
  | { type: 'BACKEND_UNAVAILABLE' };

export const INITIAL_PUSH_SUBSCRIPTION_STATE: PushSubscriptionState = {
  status: 'checking',
  error: null,
};

export function reducePushSubscription(
  state: PushSubscriptionState,
  event: PushSubscriptionEvent
): PushSubscriptionState {
  switch (event.type) {
    case 'CHECK_STARTED':
      return { status: 'checking', error: null };
    case 'CHECK_RESOLVED':
      if (!event.supported) return { status: 'unsupported', error: null };
      if (event.permission === 'denied') return { status: 'permission-denied', error: null };
      if (event.subscribed) return { status: 'subscribed', error: null };
      if (event.permission === 'default') return { status: 'permission-required', error: null };
      return { status: 'unsubscribed', error: null };
    case 'SUBSCRIBE_STARTED':
      return { status: 'subscribing', error: null };
    case 'SUBSCRIBE_SUCCEEDED':
      return { status: 'subscribed', error: null };
    case 'UNSUBSCRIBE_STARTED':
      return { status: 'unsubscribing', error: null };
    case 'UNSUBSCRIBE_SUCCEEDED':
      return { status: 'unsubscribed', error: null };
    case 'FAILED':
      return { status: 'error', error: event.message };
    case 'BACKEND_UNAVAILABLE':
      return {
        status: 'unavailable',
        error: 'Push notifications are not available on this server yet.',
      };
    default:
      return state;
  }
}
