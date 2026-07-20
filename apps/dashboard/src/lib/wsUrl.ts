import { getRuntimeConfig, type RuntimeConfig } from '@/lib/runtimeConfig';

type WebSocketEndpoint =
  | { type: 'events' }
  | { type: 'terminal'; sessionId: string; ticket: string }
  | { type: 'voice'; ticket: string };

interface WebSocketUrlEnvironment {
  NEXT_PUBLIC_CONTROL_PLANE_URL?: string;
  NEXT_PUBLIC_CONTROL_PLANE_BASE_URL?: string;
  NEXT_PUBLIC_CONTROL_PLANE_WS_URL?: string;
}

interface BrowserLocation {
  protocol: string;
  host: string;
}

interface WebSocketUrlSources {
  runtime?: RuntimeConfig;
  env?: WebSocketUrlEnvironment;
  location?: BrowserLocation | null;
}

function currentLocation(): BrowserLocation | null {
  if (typeof window === 'undefined') return null;
  return window.location;
}

function toWebSocketProtocol(url: URL): void {
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.protocol === 'http:') url.protocol = 'ws:';
}

function terminalPathFromEventPath(eventPath: string, sessionId: string): string {
  const eventSuffix = '/v1/ui/stream';
  const prefix = eventPath.endsWith(eventSuffix)
    ? eventPath.slice(0, -eventSuffix.length)
    : '';
  return `${prefix}/v1/ui/terminal/${sessionId}`;
}

function voicePathFromEventPath(eventPath: string): string {
  const eventSuffix = '/v1/ui/stream';
  const prefix = eventPath.endsWith(eventSuffix)
    ? eventPath.slice(0, -eventSuffix.length)
    : '';
  return `${prefix}/v1/voice/transcribe`;
}

function urlHost(value: string): string | null {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

function isInternalHostname(hostname: string): boolean {
  return hostname === 'control-plane' ||
    (!hostname.includes('.') && hostname !== 'localhost' && hostname !== '127.0.0.1');
}

export function resolveControlPlaneWebSocketUrl(
  endpoint: WebSocketEndpoint,
  sources: WebSocketUrlSources = {}
): string {
  const runtime = sources.runtime ?? getRuntimeConfig();
  const env = sources.env ?? process.env;
  const location = sources.location === undefined ? currentLocation() : sources.location;
  const protocol = location?.protocol === 'https:' ? 'wss:' : 'ws:';
  const base = runtime.controlPlaneUrl ||
    env.NEXT_PUBLIC_CONTROL_PLANE_URL ||
    env.NEXT_PUBLIC_CONTROL_PLANE_BASE_URL ||
    '';
  const configuredWs = runtime.controlPlaneWsUrl || env.NEXT_PUBLIC_CONTROL_PLANE_WS_URL || '';
  const baseHost = base ? urlHost(base.replace(/\/+$/, '')) : null;
  const configuredHost = configuredWs ? urlHost(configuredWs) : null;
  const usableConfiguredWs = configuredHost && (!baseHost || baseHost === configuredHost)
    ? configuredWs
    : '';
  let url: URL;
  let source: 'configured' | 'base' | 'fallback' = 'fallback';

  try {
    if (usableConfiguredWs) {
      url = new URL(usableConfiguredWs);
      source = 'configured';
    } else if (base) {
      url = new URL(base.replace(/\/+$/, ''));
      source = 'base';
    } else {
      url = new URL(`${protocol}//${location?.host ?? 'localhost:8080'}`);
    }
  } catch {
    url = new URL(`${protocol}//${location?.host ?? 'localhost:8080'}`);
    source = 'fallback';
  }
  if (location && isInternalHostname(url.hostname)) {
    const browserOrigin = new URL(`${protocol}//${location.host}`);
    url.hostname = browserOrigin.hostname;
    url.port = browserOrigin.port;
    url.protocol = protocol;
  }
  toWebSocketProtocol(url);

  if (source === 'base') {
    const basePath = url.pathname.replace(/\/+$/, '');
    const apiRoot = basePath && basePath !== '/'
      ? (basePath.endsWith('/v1') ? basePath : `${basePath}/v1`)
      : '/v1';
    url.pathname = `${apiRoot}/ui/stream`;
    url.search = '';
    url.hash = '';
  }

  if (endpoint.type === 'terminal') {
    url.pathname = terminalPathFromEventPath(url.pathname, endpoint.sessionId);
    url.search = '';
    url.searchParams.set('ticket', endpoint.ticket);
  } else if (endpoint.type === 'voice') {
    url.pathname = voicePathFromEventPath(url.pathname);
    url.search = '';
    url.searchParams.set('ticket', endpoint.ticket);
  } else if (source === 'fallback') {
    url.pathname = '/v1/ui/stream';
  }

  return url.toString();
}
