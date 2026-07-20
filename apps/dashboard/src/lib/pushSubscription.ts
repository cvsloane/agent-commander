import {
  createPushSubscription,
  deletePushSubscription,
  getPushSubscriptions,
  getPushVapidPublicKey,
  type PushVapidConfiguration,
  type PushSubscriptionPayload,
} from '@/lib/api';

export interface PushSubscriptionLike {
  endpoint: string;
  toJSON: () => PushSubscriptionJSON;
  unsubscribe: () => Promise<boolean>;
}

export interface PushRuntime {
  isSupported: () => boolean;
  getPermission: () => NotificationPermission;
  requestPermission: () => Promise<NotificationPermission>;
  getSubscription: () => Promise<PushSubscriptionLike | null>;
  subscribe: (applicationServerKey: Uint8Array<ArrayBuffer>) => Promise<PushSubscriptionLike>;
}

export interface PushSubscriptionAPI {
  getConfiguration: () => Promise<PushVapidConfiguration>;
  list: () => Promise<Array<{ endpoint: string }>>;
  save: (subscription: PushSubscriptionPayload) => Promise<unknown>;
  remove: (endpoint: string) => Promise<unknown>;
}

export interface PushOwnershipStore {
  get: () => string | null;
  set: (ownerId: string) => void;
  clear: () => void;
}

interface PushSubscriptionControllerOptions {
  runtime: PushRuntime;
  api: PushSubscriptionAPI;
  deviceLabel: () => string;
  ownerId?: string | null;
  ownership?: PushOwnershipStore;
}

export interface PushSubscriptionCheck {
  supported: boolean;
  permission: NotificationPermission;
  subscribed: boolean;
}

export class PushBackendUnavailableError extends Error {
  constructor(message = 'Push notifications are not configured on this server.') {
    super(message);
    this.name = 'PushBackendUnavailableError';
  }
}

function payloadFromSubscription(
  subscription: PushSubscriptionLike,
  deviceLabel: string
): PushSubscriptionPayload {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) {
    throw new Error('The browser returned an incomplete push subscription.');
  }
  return {
    endpoint: json.endpoint,
    p256dh,
    auth,
    device_label: deviceLabel,
  };
}

export function applicationServerKeyFromBase64(value: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const decoded = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(decoded.length));
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}

export function createPushSubscriptionController({
  runtime,
  api,
  deviceLabel,
  ownerId,
  ownership,
}: PushSubscriptionControllerOptions) {
  return {
    async check(): Promise<PushSubscriptionCheck> {
      if (!runtime.isSupported()) {
        return { supported: false, permission: 'default', subscribed: false };
      }
      const subscription = await runtime.getSubscription();
      if (!subscription) {
        ownership?.clear();
        return {
          supported: true,
          permission: runtime.getPermission(),
          subscribed: false,
        };
      }

      const knownOwner = ownership?.get();
      if (ownerId && knownOwner && knownOwner !== ownerId) {
        await subscription.unsubscribe().catch(() => false);
        ownership?.clear();
        return {
          supported: true,
          permission: runtime.getPermission(),
          subscribed: false,
        };
      }

      let registered: Array<{ endpoint: string }>;
      try {
        registered = await api.list();
      } catch (error) {
        // A legacy subscription without an ownership marker cannot safely be
        // displayed to a newly authenticated account if reconciliation fails.
        if (!knownOwner) {
          await subscription.unsubscribe().catch(() => false);
          ownership?.clear();
        }
        throw error;
      }

      const belongsToCurrentUser = registered.some(
        (candidate) => candidate.endpoint === subscription.endpoint
      );
      if (!belongsToCurrentUser) {
        await subscription.unsubscribe().catch(() => false);
        ownership?.clear();
      } else if (ownerId) {
        ownership?.set(ownerId);
      }
      return {
        supported: true,
        permission: runtime.getPermission(),
        subscribed: belongsToCurrentUser,
      };
    },

    async subscribe(): Promise<PushSubscriptionLike> {
      if (!runtime.isSupported()) throw new Error('Push notifications are not supported on this device.');

      let permission = runtime.getPermission();
      if (permission === 'default') permission = await runtime.requestPermission();
      if (permission !== 'granted') throw new DOMException('Notification permission was not granted.', 'NotAllowedError');

      let subscription = await runtime.getSubscription();
      const knownOwner = ownership?.get();
      if (subscription && ownerId && knownOwner && knownOwner !== ownerId) {
        await subscription.unsubscribe().catch(() => false);
        ownership?.clear();
        subscription = null;
      }
      if (!subscription) {
        const configuration = await api.getConfiguration();
        if (!configuration.enabled || !configuration.public_key) {
          throw new PushBackendUnavailableError();
        }
        subscription = await runtime.subscribe(
          applicationServerKeyFromBase64(configuration.public_key)
        );
      }

      try {
        await api.save(payloadFromSubscription(subscription, deviceLabel()));
        if (ownerId) ownership?.set(ownerId);
      } catch (error) {
        // A local-only subscription is indistinguishable from success after a
        // reload, so fail closed for every unsuccessful server registration.
        await subscription.unsubscribe().catch(() => false);
        ownership?.clear();
        throw error;
      }
      return subscription;
    },

    async unsubscribe(): Promise<void> {
      if (!runtime.isSupported()) return;
      const subscription = await runtime.getSubscription();
      if (!subscription) {
        ownership?.clear();
        return;
      }

      let backendError: unknown;
      try {
        await api.remove(subscription.endpoint);
      } catch (error) {
        backendError = error;
      }
      await subscription.unsubscribe();
      ownership?.clear();
      if (backendError) throw backendError;
    },
  };
}

function defaultDeviceLabel(): string {
  const standalone = window.matchMedia('(display-mode: standalone)').matches ? ' · Installed' : '';
  const platform = /iPhone|iPad|iPod/i.test(navigator.userAgent)
    ? 'iOS'
    : /Android/i.test(navigator.userAgent)
      ? 'Android'
      : 'Browser';
  return `${platform}${standalone}`;
}

const browserRuntime: PushRuntime = {
  isSupported: () =>
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window,
  getPermission: () => (typeof Notification === 'undefined' ? 'default' : Notification.permission),
  requestPermission: () => Notification.requestPermission(),
  getSubscription: async () => {
    const registration = await navigator.serviceWorker.getRegistration('/');
    return (await registration?.pushManager.getSubscription()) ?? null;
  },
  subscribe: async (applicationServerKey) => {
    const registration = await navigator.serviceWorker.ready;
    return registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
  },
};

const controlPlaneAPI: PushSubscriptionAPI = {
  getConfiguration: getPushVapidPublicKey,
  list: async () => (await getPushSubscriptions()).subscriptions,
  save: createPushSubscription,
  remove: deletePushSubscription,
};

const PUSH_OWNER_KEY = 'agent-command:push-subscription-owner-v1';

const browserOwnership: PushOwnershipStore = {
  get: () => {
    try {
      return window.localStorage.getItem(PUSH_OWNER_KEY);
    } catch {
      return null;
    }
  },
  set: (ownerId) => {
    try {
      window.localStorage.setItem(PUSH_OWNER_KEY, ownerId);
    } catch {
      // The server list remains authoritative when storage is restricted.
    }
  },
  clear: () => {
    try {
      window.localStorage.removeItem(PUSH_OWNER_KEY);
    } catch {
      // Nothing else to clear when storage is restricted.
    }
  },
};

export function createBrowserPushSubscriptionController(ownerId?: string | null) {
  return createPushSubscriptionController({
    runtime: browserRuntime,
    api: controlPlaneAPI,
    deviceLabel: defaultDeviceLabel,
    ownerId,
    ownership: browserOwnership,
  });
}
