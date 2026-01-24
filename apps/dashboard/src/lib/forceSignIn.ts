export function forceSignIn(reason?: string) {
  if (typeof window === 'undefined') return;
  if (window.location.pathname.startsWith('/signin')) return;
  const url = new URL('/signin', window.location.origin);
  if (reason) {
    url.searchParams.set('error', reason);
  }
  window.location.href = url.toString();
}
