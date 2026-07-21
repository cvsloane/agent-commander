export function isPerformanceTelemetryEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if ((window as Window & { __sessionsPerf?: boolean }).__sessionsPerf === true) return true;
  return new URLSearchParams(window.location.search).get('perf') === '1';
}
