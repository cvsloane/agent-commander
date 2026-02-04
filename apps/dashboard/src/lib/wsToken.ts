import { forceSignIn } from '@/lib/forceSignIn';

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

export function clearControlPlaneTokenCache() {
  cachedToken = null;
}
