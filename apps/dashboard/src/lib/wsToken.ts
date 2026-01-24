import { forceSignIn } from '@/lib/forceSignIn';

let cachedToken: { token: string; exp: number } | null = null;

export async function getControlPlaneToken(): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - now > 30) {
    return cachedToken.token;
  }

  try {
    const res = await fetch('/api/control-plane-token');
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
  }
}

export function clearControlPlaneTokenCache() {
  cachedToken = null;
}
