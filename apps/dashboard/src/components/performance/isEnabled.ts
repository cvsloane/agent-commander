let cachedQueryFlag: boolean | null = null;

export function isPerformanceTelemetryEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if ((window as Window & { __sessionsPerf?: boolean }).__sessionsPerf === true) return true;
  // The URL flag cannot change without a navigation, and this runs on every
  // terminal output frame — parse the query string once, not per frame.
  if (cachedQueryFlag === null) {
    cachedQueryFlag = new URLSearchParams(window.location.search).get('perf') === '1';
  }
  return cachedQueryFlag;
}
