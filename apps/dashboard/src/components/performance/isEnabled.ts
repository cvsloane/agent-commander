let cachedSearch: string | null = null;
let cachedQueryFlag = false;

export function isPerformanceTelemetryEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if ((window as Window & { __sessionsPerf?: boolean }).__sessionsPerf === true) return true;
  // This runs on every terminal output frame: avoid a URLSearchParams
  // allocation per frame by re-parsing only when the query string changes.
  const search = window.location.search;
  if (search !== cachedSearch) {
    cachedSearch = search;
    cachedQueryFlag = new URLSearchParams(search).get('perf') === '1';
  }
  return cachedQueryFlag;
}
