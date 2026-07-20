import { forceSignIn } from '@/lib/forceSignIn';
import { resolveControlPlaneWebSocketUrl } from '@/lib/wsUrl';

let cachedToken: { token: string; exp: number } | null = null;
const TOKEN_FETCH_TIMEOUT_MS = 5000;

export async function getControlPlaneToken(): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - now > 30) {
    return cachedToken.token;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TOKEN_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch('/api/control-plane-token', { signal: controller.signal });
    if (res.status === 401) {
      forceSignIn('SessionExpired');
      return null;
    }
    if (!res.ok) return null;
    const data = (await res.json()) as { token: string; exp: number };
    cachedToken = data;
    return data.token;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getWebSocketTicket(): Promise<string | null> {
  const token = await getControlPlaneToken();
  if (!token) return null;

  const ticketUrl = new URL(resolveControlPlaneWebSocketUrl({ type: 'events' }));
  ticketUrl.protocol = ticketUrl.protocol === 'wss:' ? 'https:' : 'http:';
  ticketUrl.pathname = ticketUrl.pathname.replace(/\/v1\/ui\/stream$/, '/v1/auth/ws-ticket');
  ticketUrl.search = '';
  ticketUrl.hash = '';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TOKEN_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(ticketUrl.toString(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (res.status === 401) {
      clearControlPlaneTokenCache();
      forceSignIn('SessionExpired');
      return null;
    }
    if (!res.ok) return null;
    const data = (await res.json()) as { ticket?: string };
    return data.ticket || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function clearControlPlaneTokenCache() {
  cachedToken = null;
}
