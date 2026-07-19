import type { ServerToUIMessage } from '@agent-command/schema';
import { forceSignIn } from '@/lib/forceSignIn';
import {
  initialReconnectState,
  transitionReconnect,
  type ReconnectEvent,
  type ReconnectState,
} from '@/lib/reconnect';
import { resolveControlPlaneWebSocketUrl } from '@/lib/wsUrl';
import { useConnectionStore } from '@/stores/connection';

type MessageHandler = (message: ServerToUIMessage) => void;

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries
    .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`)
    .join(',')}}`;
}

class WebSocketClient {
  private ws: WebSocket | null = null;
  private handlers: Set<MessageHandler> = new Set();
  private subscriptions: Array<{ type: string; filter?: Record<string, unknown> }> = [];
  private subscriptionMap: Map<string, Array<{ type: string; filter?: Record<string, unknown> }>> =
    new Map();
  private authToken: string | null = null;
  private tokenProvider: (() => Promise<string | null>) | null = null;
  private reconnectState: ReconnectState = initialReconnectState;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private connectPromise: Promise<void> | null = null;
  private stopped = false;

  constructor() {
    if (typeof window !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
      window.addEventListener('pageshow', this.handlePageShow);
      if (!navigator.onLine) {
        useConnectionStore.getState().setEventStatus('offline');
      }
    }
  }

  setToken(token: string | null): void {
    this.authToken = token;
  }

  setTokenProvider(provider: (() => Promise<string | null>) | null): void {
    this.tokenProvider = provider;
  }

  connect(): Promise<void> {
    this.stopped = false;
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return Promise.resolve();
    }
    if (this.connectPromise) return this.connectPromise;

    const pending = this.openSocket();
    this.connectPromise = pending;
    void pending.finally(() => {
      if (this.connectPromise === pending) {
        this.connectPromise = null;
      }
    });
    return pending;
  }

  private async openSocket(): Promise<void> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      useConnectionStore.getState().setEventStatus('offline');
      return;
    }

    useConnectionStore.getState().setEventStatus(
      this.reconnectState.attempt > 0 ? 'reconnecting' : 'connecting'
    );

    if (this.tokenProvider) {
      try {
        const token = await this.tokenProvider();
        this.authToken = token || null;
        if (!token) {
          console.warn('No auth token available for WebSocket connection');
          this.scheduleReconnect();
          return;
        }
      } catch (error) {
        console.warn('Failed to refresh WebSocket token', error);
      }
    }

    const wsUrl = new URL(resolveControlPlaneWebSocketUrl({ type: 'events' }));
    if (this.authToken) {
      wsUrl.searchParams.set('token', this.authToken);
    }

    const socket = new WebSocket(wsUrl.toString());
    this.ws = socket;

    socket.onopen = () => {
      if (this.ws !== socket) return;
      console.log('WebSocket connected');
      this.applyReconnectEvent({ type: 'opened' });
      useConnectionStore.getState().setEventStatus('connected');
      this.startKeepalive();

      // Re-subscribe and establish a schema-valid application keepalive.
      this.sendSubscriptions();
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as ServerToUIMessage;
        this.handlers.forEach((handler) => handler(message));
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    socket.onclose = (event) => {
      if (this.ws !== socket) return;
      this.ws = null;
      this.stopKeepalive();
      const detail = `code ${event.code}${event.reason ? `: ${event.reason}` : ''}`;
      console.log('WebSocket disconnected', detail);
      if (this.stopped) return;
      if (event.code === 4001 || event.code === 4002 || event.code === 4003) {
        useConnectionStore.getState().setEventStatus('disconnected');
        forceSignIn('InvalidToken');
        return;
      }
      this.scheduleReconnect();
    };

    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  private scheduleReconnect(): void {
    useConnectionStore.getState().setEventStatus(
      typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'reconnecting'
    );
    this.applyReconnectEvent({ type: 'closed' });
  }

  private applyReconnectEvent(event: ReconnectEvent): void {
    const transition = transitionReconnect(this.reconnectState, event);
    this.reconnectState = transition.state;

    if (transition.effect.type === 'cancel') {
      this.clearReconnectTimer();
      return;
    }
    if (transition.effect.type === 'reconnect') {
      this.clearReconnectTimer();
      void this.connect();
      return;
    }

    this.clearReconnectTimer();
    console.log(
      `Reconnecting in ${transition.effect.delayMs}ms (attempt ${this.reconnectState.attempt})`
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.applyReconnectEvent({ type: 'timer' });
    }, transition.effect.delayMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => this.sendSubscriptions(), 25_000);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  private retryImmediately(event: Extract<ReconnectEvent, { type: 'visibility' | 'online' | 'pageshow' }>): void {
    if (this.stopped) return;
    if (this.ws?.readyState === WebSocket.OPEN) {
      useConnectionStore.getState().setEventStatus('connected');
      this.sendSubscriptions();
      return;
    }
    if (this.ws?.readyState === WebSocket.CONNECTING || this.connectPromise) {
      useConnectionStore.getState().setEventStatus('reconnecting');
      return;
    }
    this.applyReconnectEvent(event);
  }

  private handleVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      this.retryImmediately({ type: 'visibility' });
    }
  };

  private handleOnline = (): void => {
    this.retryImmediately({ type: 'online' });
  };

  private handleOffline = (): void => {
    if (!this.stopped) {
      useConnectionStore.getState().setEventStatus('offline');
    }
  };

  private handlePageShow = (): void => {
    this.retryImmediately({ type: 'pageshow' });
  };

  registerSubscription(topics: Array<{ type: string; filter?: Record<string, unknown> }>): string {
    const id = crypto.randomUUID();
    this.subscriptionMap.set(id, topics);
    this.updateSubscriptions();
    return id;
  }

  unregisterSubscription(id: string): void {
    if (this.subscriptionMap.has(id)) {
      this.subscriptionMap.delete(id);
      this.updateSubscriptions();
    }
  }

  private updateSubscriptions(): void {
    const merged = new Map<string, { type: string; filter?: Record<string, unknown> }>();
    for (const topics of Array.from(this.subscriptionMap.values())) {
      for (const topic of topics) {
        const key = `${topic.type}:${stableStringify(topic.filter || {})}`;
        merged.set(key, topic);
      }
    }
    this.subscriptions = Array.from(merged.values());
    this.sendSubscriptions();
  }

  private sendSubscriptions(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const message = {
        v: 1,
        type: 'ui.subscribe',
        ts: new Date().toISOString(),
        payload: { topics: this.subscriptions },
      };
      this.ws.send(JSON.stringify(message));
    }
  }

  addHandler(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  disconnect(): void {
    this.stopped = true;
    this.clearReconnectTimer();
    this.stopKeepalive();
    this.reconnectState = initialReconnectState;
    const socket = this.ws;
    this.ws = null;
    socket?.close();
    useConnectionStore.getState().setEventStatus('disconnected');
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// Singleton instance
let wsClient: WebSocketClient | null = null;

export function getWebSocketClient(): WebSocketClient {
  if (!wsClient) {
    wsClient = new WebSocketClient();
  }
  return wsClient;
}
