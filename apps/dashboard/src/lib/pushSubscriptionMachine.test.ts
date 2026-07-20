import { describe, expect, it } from 'vitest';
import {
  INITIAL_PUSH_SUBSCRIPTION_STATE,
  reducePushSubscription,
} from './pushSubscriptionMachine';
import { createPushSubscriptionController } from './pushSubscription';
import { APIError } from './api';

describe('push subscription state machine', () => {
  it('moves a supported first-run device from permission prompt to subscribed', () => {
    let state = reducePushSubscription(INITIAL_PUSH_SUBSCRIPTION_STATE, {
      type: 'CHECK_RESOLVED',
      supported: true,
      permission: 'default',
      subscribed: false,
    });
    expect(state.status).toBe('permission-required');

    state = reducePushSubscription(state, { type: 'SUBSCRIBE_STARTED' });
    expect(state.status).toBe('subscribing');

    state = reducePushSubscription(state, { type: 'SUBSCRIBE_SUCCEEDED' });
    expect(state).toEqual({ status: 'subscribed', error: null });
  });

  it('marks the feature unavailable when the control-plane routes have not landed', () => {
    const state = reducePushSubscription(
      { status: 'subscribing', error: null },
      { type: 'BACKEND_UNAVAILABLE' }
    );

    expect(state).toEqual({
      status: 'unavailable',
      error: 'Push notifications are not available on this server yet.',
    });
  });

  it('keeps unsubscribe and retry failures explicit', () => {
    let state = reducePushSubscription(
      { status: 'subscribed', error: null },
      { type: 'UNSUBSCRIBE_STARTED' }
    );
    expect(state.status).toBe('unsubscribing');

    state = reducePushSubscription(state, {
      type: 'FAILED',
      message: 'Could not reach the control plane.',
    });
    expect(state).toEqual({
      status: 'error',
      error: 'Could not reach the control plane.',
    });

    state = reducePushSubscription(state, {
      type: 'CHECK_RESOLVED',
      supported: true,
      permission: 'granted',
      subscribed: false,
    });
    expect(state).toEqual({ status: 'unsubscribed', error: null });
  });

  it('rolls back the browser subscription when the backend returns 404', async () => {
    const calls: string[] = [];
    const localSubscription = {
      endpoint: 'https://push.example/subscription',
      toJSON: () => ({
        endpoint: 'https://push.example/subscription',
        keys: { p256dh: 'public-key', auth: 'auth-secret' },
      }),
      unsubscribe: async () => {
        calls.push('unsubscribe-local');
        return true;
      },
    };
    const controller = createPushSubscriptionController({
      runtime: {
        isSupported: () => true,
        getPermission: () => 'default',
        requestPermission: async () => {
          calls.push('request-permission');
          return 'granted';
        },
        getSubscription: async () => null,
        subscribe: async () => {
          calls.push('subscribe-local');
          return localSubscription;
        },
      },
      api: {
        getConfiguration: async () => {
          calls.push('get-vapid');
          return { enabled: true, public_key: 'AQ' };
        },
        list: async () => [],
        save: async () => {
          calls.push('save-server');
          throw new APIError('Not found', 404);
        },
        remove: async () => undefined,
      },
      deviceLabel: () => 'Test phone',
    });

    await expect(controller.subscribe()).rejects.toMatchObject({ status: 404 });
    expect(calls).toEqual([
      'request-permission',
      'get-vapid',
      'subscribe-local',
      'save-server',
      'unsubscribe-local',
    ]);
  });

  it('rolls back a local subscription after any failed server save', async () => {
    let localUnsubscribed = false;
    const controller = createPushSubscriptionController({
      runtime: {
        isSupported: () => true,
        getPermission: () => 'granted',
        requestPermission: async () => 'granted',
        getSubscription: async () => null,
        subscribe: async () => ({
          endpoint: 'https://push.example/new',
          toJSON: () => ({
            endpoint: 'https://push.example/new',
            keys: { p256dh: 'public-key', auth: 'auth-secret' },
          }),
          unsubscribe: async () => {
            localUnsubscribed = true;
            return true;
          },
        }),
      },
      api: {
        getConfiguration: async () => ({ enabled: true, public_key: 'AQ' }),
        list: async () => [],
        save: async () => {
          throw new APIError('Server unavailable', 503);
        },
        remove: async () => undefined,
      },
      deviceLabel: () => 'Test phone',
    });

    await expect(controller.subscribe()).rejects.toMatchObject({ status: 503 });
    expect(localUnsubscribed).toBe(true);
  });

  it('fails closed when an origin subscription belongs to another account', async () => {
    let localUnsubscribed = false;
    let owner: string | null = 'user-a';
    const controller = createPushSubscriptionController({
      ownerId: 'user-b',
      ownership: {
        get: () => owner,
        set: (value) => { owner = value; },
        clear: () => { owner = null; },
      },
      runtime: {
        isSupported: () => true,
        getPermission: () => 'granted',
        requestPermission: async () => 'granted',
        getSubscription: async () => ({
          endpoint: 'https://push.example/user-a',
          toJSON: () => ({ endpoint: 'https://push.example/user-a' }),
          unsubscribe: async () => {
            localUnsubscribed = true;
            return true;
          },
        }),
        subscribe: async () => { throw new Error('not expected'); },
      },
      api: {
        getConfiguration: async () => ({ enabled: true, public_key: 'AQ' }),
        list: async () => { throw new Error('not expected'); },
        save: async () => undefined,
        remove: async () => undefined,
      },
      deviceLabel: () => 'Test phone',
    });

    await expect(controller.check()).resolves.toMatchObject({ subscribed: false });
    expect(localUnsubscribed).toBe(true);
    expect(owner).toBeNull();
  });

  it('does not subscribe when VAPID is disabled', async () => {
    let browserSubscribed = false;
    const controller = createPushSubscriptionController({
      runtime: {
        isSupported: () => true,
        getPermission: () => 'granted',
        requestPermission: async () => 'granted',
        getSubscription: async () => null,
        subscribe: async () => {
          browserSubscribed = true;
          throw new Error('not expected');
        },
      },
      api: {
        getConfiguration: async () => ({ enabled: false, public_key: null }),
        list: async () => [],
        save: async () => undefined,
        remove: async () => undefined,
      },
      deviceLabel: () => 'Test phone',
    });

    await expect(controller.subscribe()).rejects.toMatchObject({
      name: 'PushBackendUnavailableError',
    });
    expect(browserSubscribed).toBe(false);
  });
});
