type UpdateKind = 'session.set' | 'session.update' | 'usage.update' | 'usage.batch';

interface PerfCounters {
  sessionListRenders: number;
  sessionCardRenders: number;
  sessionSetCalls: number;
  sessionSetItems: number;
  sessionUpdateCalls: number;
  sessionUpdateItems: number;
  sessionUpdateDeleted: number;
  usageUpdateCalls: number;
  usageUpdateItems: number;
  usageBatchCalls: number;
  usageBatchItems: number;
}

const counters: PerfCounters = {
  sessionListRenders: 0,
  sessionCardRenders: 0,
  sessionSetCalls: 0,
  sessionSetItems: 0,
  sessionUpdateCalls: 0,
  sessionUpdateItems: 0,
  sessionUpdateDeleted: 0,
  usageUpdateCalls: 0,
  usageUpdateItems: 0,
  usageBatchCalls: 0,
  usageBatchItems: 0,
};

const callsites = new Map<string, number>();
let logTimer: number | null = null;
const CALLSITE_SAMPLE_RATE = 0.2;

function isEnabled(): boolean {
  return typeof window !== 'undefined' && (window as unknown as { __sessionsPerf?: boolean }).__sessionsPerf === true;
}

export function setSessionsPerfEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  (window as unknown as { __sessionsPerf?: boolean }).__sessionsPerf = enabled;
}

function recordCallsite(kind: UpdateKind) {
  if (!isEnabled()) return;
  if (Math.random() > CALLSITE_SAMPLE_RATE) return;
  const stack = new Error().stack;
  if (!stack) return;
  const lines = stack.split('\n').map((line) => line.trim()).filter(Boolean);
  const candidate = lines.find((line) =>
    line.includes('/_next/static/') ||
    line.includes('/apps/dashboard/') ||
    line.includes('/src/')
  ) || lines[1];
  const key = `${kind} @ ${(candidate || 'unknown').replace(/^at\s+/, '')}`;
  callsites.set(key, (callsites.get(key) || 0) + 1);
}

function resetCounters() {
  counters.sessionListRenders = 0;
  counters.sessionCardRenders = 0;
  counters.sessionSetCalls = 0;
  counters.sessionSetItems = 0;
  counters.sessionUpdateCalls = 0;
  counters.sessionUpdateItems = 0;
  counters.sessionUpdateDeleted = 0;
  counters.usageUpdateCalls = 0;
  counters.usageUpdateItems = 0;
  counters.usageBatchCalls = 0;
  counters.usageBatchItems = 0;
  callsites.clear();
}

export function startSessionsPerfLogging(intervalMs: number = 2000): void {
  if (!isEnabled()) return;
  if (logTimer) return;
  logTimer = window.setInterval(() => {
    if (!isEnabled()) {
      stopSessionsPerfLogging();
      return;
    }
    const hasActivity =
      counters.sessionListRenders +
        counters.sessionCardRenders +
        counters.sessionSetCalls +
        counters.sessionUpdateCalls +
        counters.usageUpdateCalls +
        counters.usageBatchCalls >
      0;
    if (!hasActivity && callsites.size === 0) return;

    console.log('[perf] sessions.renders', {
      sessionList: counters.sessionListRenders,
      sessionCard: counters.sessionCardRenders,
    });
    console.log('[perf] sessions.store', {
      setCalls: counters.sessionSetCalls,
      setItems: counters.sessionSetItems,
      updateCalls: counters.sessionUpdateCalls,
      updateItems: counters.sessionUpdateItems,
      deleted: counters.sessionUpdateDeleted,
    });
    console.log('[perf] sessions.usage', {
      updateCalls: counters.usageUpdateCalls,
      updateItems: counters.usageUpdateItems,
      batchCalls: counters.usageBatchCalls,
      batchItems: counters.usageBatchItems,
    });

    if (callsites.size > 0) {
      const top = Array.from(callsites.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([key, count]) => ({ count, key }));
      console.log('[perf] sessions.callers (sampled)', top);
    }

    resetCounters();
  }, intervalMs);
}

export function stopSessionsPerfLogging(): void {
  if (logTimer) {
    window.clearInterval(logTimer);
    logTimer = null;
  }
  resetCounters();
}

export function markSessionListRender(): void {
  if (!isEnabled()) return;
  counters.sessionListRenders += 1;
}

export function markSessionCardRender(): void {
  if (!isEnabled()) return;
  counters.sessionCardRenders += 1;
}

export function recordSessionSet(items: number): void {
  if (!isEnabled()) return;
  counters.sessionSetCalls += 1;
  counters.sessionSetItems += items;
  recordCallsite('session.set');
}

export function recordSessionUpdate(items: number, deleted: number): void {
  if (!isEnabled()) return;
  counters.sessionUpdateCalls += 1;
  counters.sessionUpdateItems += items;
  counters.sessionUpdateDeleted += deleted;
  recordCallsite('session.update');
}

export function recordUsageUpdate(items: number): void {
  if (!isEnabled()) return;
  counters.usageUpdateCalls += 1;
  counters.usageUpdateItems += items;
  recordCallsite('usage.update');
}

export function recordUsageBatch(items: number): void {
  if (!isEnabled()) return;
  counters.usageBatchCalls += 1;
  counters.usageBatchItems += items;
  recordCallsite('usage.batch');
}
