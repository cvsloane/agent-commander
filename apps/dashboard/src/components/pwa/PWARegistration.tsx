'use client';

import { useEffect } from 'react';

export function PWARegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      return;
    }

    let cancelled = false;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then((registration) => {
      if (!cancelled) void registration.update();
    }).catch((error) => {
      console.warn('Service worker registration failed', error);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
