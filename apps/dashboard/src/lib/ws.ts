import type { ServerToUIMessage } from '@agent-command/schema';
import { getRuntimeConfig } from '@/lib/runtimeConfig';
import { forceSignIn } from '@/lib/forceSignIn';

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
  private url: string;
  private handlers: Set<MessageHandler> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private subscriptions: Array<{ type: string; filter?: Record<string, unknown> }> = [];
  private subscriptionMap: Map<string, Array<{ type: string; filter?: Record<string, unknown> }>> =
    new Map();
  private authToken: string | null = null;
  private tokenProvider: (() => Promise<string | null>) | null = null;

  constructor(url: string) {
    this.url = url;
  }

  setToken(token: string | null): void {
    this.authToken = token;
  }

  setTokenProvider(provider: (() => Promise<string | null>) | null): void {
    this.tokenProvider = provider;
  }

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    if (this.tokenProvider) {
      try {
        const token = await this.tokenProvider();
        this.authToken = token || null;
        if (!token) {
          console.warn('No auth token available for WebSocket connection');
          return;
        }
      } catch (error) {
        console.warn('Failed to refresh WebSocket token', error);
      }
    }

    const wsUrl = new URL(this.url);
    if (this.authToken) {
      wsUrl.searchParams.set('token', this.authToken);
    }

    this.ws = new WebSocket(wsUrl.toString());

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;

      // Re-subscribe to topics
      if (this.subscriptions.length > 0) {
        this.sendSubscriptions();
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as ServerToUIMessage;
        this.handlers.forEach((handler) => handler(message));
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    this.ws.onclose = (event) => {
      const detail = `code ${event.code}${event.reason ? `: ${event.reason}` : ''}`;
      console.log('WebSocket disconnected', detail);
      if (event.code === 4001 || event.code === 4002 || event.code === 4003) {
        forceSignIn('InvalidToken');
        return;
      }
      this.attemptReconnect();
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      void this.connect();
    }, delay);
  }

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
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// Singleton instance
let wsClient: WebSocketClient | null = null;

function getHost(value: string): string | null {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

function resolveWsUrl(): string {
  const runtime = typeof window !== 'undefined' ? getRuntimeConfig() : {};
  const base =
    runtime.controlPlaneUrl ||
    process.env.NEXT_PUBLIC_CONTROL_PLANE_URL ||
    process.env.NEXT_PUBLIC_CONTROL_PLANE_BASE_URL ||
    '';
  const configuredWs =
    runtime.controlPlaneWsUrl ||
    process.env.NEXT_PUBLIC_CONTROL_PLANE_WS_URL ||
    '';
  const baseHost = base ? getHost(base.replace(/\/+$/, '')) : null;
  const wsHost = configuredWs ? getHost(configuredWs) : null;
  const configured =
    baseHost && wsHost && baseHost !== wsHost
      ? ''
      : configuredWs;
  if (configured) {
    try {
      const url = new URL(configured);
      const host = url.hostname;
      if (
        typeof window !== 'undefined' &&
        (host === 'control-plane' || (!host.includes('.') && host !== 'localhost' && host !== '127.0.0.1'))
      ) {
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        return `${protocol}://${window.location.host}/v1/ui/stream`;
      }
    } catch {
      // ignore invalid URL
    }
    return configured;
  }

  if (base) {
    try {
      const trimmed = base.replace(/\/+$/, '');
      const url = new URL(trimmed);
      const host = url.hostname;
      if (
        typeof window !== 'undefined' &&
        (host === 'control-plane' || (!host.includes('.') && host !== 'localhost' && host !== '127.0.0.1'))
      ) {
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        return `${protocol}://${window.location.host}/v1/ui/stream`;
      }
      const basePath = url.pathname.replace(/\/+$/, '');
      const wsPath =
        basePath && basePath !== '/'
          ? (basePath.endsWith('/v1') ? `${basePath}/ui/stream` : `${basePath}/v1/ui/stream`)
          : '/v1/ui/stream';
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.pathname = wsPath;
      url.search = '';
      url.hash = '';
      return url.toString();
    } catch {
      // ignore invalid URL
    }
  }

  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${protocol}://${window.location.host}/v1/ui/stream`;
  }

  return 'ws://localhost:8080/v1/ui/stream';
}

export function getWebSocketClient(): WebSocketClient {
  if (!wsClient) {
    wsClient = new WebSocketClient(resolveWsUrl());
  }
  return wsClient;
}
