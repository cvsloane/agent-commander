export interface RuntimeConfig {
  controlPlaneUrl?: string;
  controlPlaneWsUrl?: string;
}

declare global {
  interface Window {
    __AC_RUNTIME__?: RuntimeConfig;
  }
}

export function getRuntimeConfig(): RuntimeConfig {
  if (typeof window === 'undefined') {
    return {};
  }
  const runtime = window.__AC_RUNTIME__;
  if (runtime && typeof runtime === 'object') {
    return runtime;
  }
  return {};
}
