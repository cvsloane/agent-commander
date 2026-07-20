import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listStaleStartingAutomationRuns: vi.fn(),
  failStaleStartingAutomationRun: vi.fn(),
  listStaleRunningAutomationWakeups: vi.fn(),
  recoverRunningAutomationWakeup: vi.fn(),
  appendAutomationRunEvent: vi.fn(),
}));

vi.mock('../src/config.js', () => ({ config: {} }));
vi.mock('../src/metrics.js', () => ({
  recordAutomationRun: vi.fn(),
  recordAutomationWakeup: vi.fn(),
  recordGovernanceApproval: vi.fn(),
}));
vi.mock('../src/db/index.js', () => ({}));
vi.mock('../src/db/automationMemory.js', () => ({
  listStaleStartingAutomationRuns: mocks.listStaleStartingAutomationRuns,
  failStaleStartingAutomationRun: mocks.failStaleStartingAutomationRun,
  listStaleRunningAutomationWakeups: mocks.listStaleRunningAutomationWakeups,
  recoverRunningAutomationWakeup: mocks.recoverRunningAutomationWakeup,
  appendAutomationRunEvent: mocks.appendAutomationRunEvent,
}));
vi.mock('../src/services/sessionSpawn.js', () => ({ spawnSessionOnHost: vi.fn() }));
vi.mock('../src/services/sessionMemory.js', () => ({
  prepareSessionMemoryForSpawn: vi.fn(),
  bootstrapSessionMemory: vi.fn(),
}));

import { reapStaleAutomationState } from '../src/services/automation.js';

const now = new Date('2026-07-19T20:00:00.000Z');
const staleAt = new Date(now.getTime() - 5 * 60_000).toISOString();
const agentId = '11111111-1111-4111-8111-111111111111';
const wakeupId = '22222222-2222-4222-8222-222222222222';
const runId = '33333333-3333-4333-8333-333333333333';

function staleWakeup(retryCount: number) {
  return {
    id: wakeupId,
    automation_agent_id: agentId,
    repo_id: null,
    source: 'schedule',
    status: 'running',
    idempotency_key: null,
    context_json: { crash_reaper_retry_count: retryCount },
    requested_at: staleAt,
    claimed_at: staleAt,
    finished_at: null,
    automation_run_id: runId,
  };
}

function staleRun(requeueCount: number) {
  return {
    id: runId,
    automation_agent_id: agentId,
    wakeup_id: wakeupId,
    repo_id: null,
    session_id: null,
    status: 'starting',
    objective: 'Recover after a control-plane crash',
    memory_snapshot_json: {},
    pending_followups_json: [],
    result_summary: null,
    usage_json: {},
    worker_report_json: {},
    log_ref_json: {},
    started_at: staleAt,
    ended_at: null,
    wakeup_context_json: { starting_run_requeue_count: requeueCount },
  };
}

function recoveredWakeup(status: 'queued' | 'failed', context: Record<string, unknown>) {
  return {
    ...staleWakeup(Number(context.crash_reaper_retry_count ?? 0)),
    status,
    context_json: context,
    claimed_at: null,
  };
}

const logger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
};

describe('automation crash reapers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    mocks.listStaleStartingAutomationRuns.mockResolvedValue([]);
    mocks.listStaleRunningAutomationWakeups.mockResolvedValue([]);
    mocks.appendAutomationRunEvent.mockImplementation(async (input) => ({
      id: 1,
      seq: 1,
      level: input.level ?? 'info',
      payload: input.payload ?? {},
      created_at: now.toISOString(),
      ...input,
    }));
    logger.error.mockReset();
    logger.warn.mockReset();
    logger.info.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it.each([
    { retryCount: 0, expectedStatus: 'queued', nextRetryCount: 1 },
    { retryCount: 2, expectedStatus: 'queued', nextRetryCount: 3 },
    { retryCount: 3, expectedStatus: 'failed', nextRetryCount: 3 },
  ] as const)(
    'recovers a stale running wakeup at retry $retryCount as $expectedStatus',
    async ({ retryCount, expectedStatus, nextRetryCount }) => {
      mocks.listStaleRunningAutomationWakeups.mockResolvedValue([staleWakeup(retryCount)]);
      mocks.recoverRunningAutomationWakeup.mockImplementation(async (input) => (
        recoveredWakeup(input.status, input.contextPatch)
      ));

      await reapStaleAutomationState(logger as never, now.getTime());

      expect(mocks.recoverRunningAutomationWakeup).toHaveBeenCalledWith(expect.objectContaining({
        id: wakeupId,
        status: expectedStatus,
        contextPatch: expect.objectContaining({
          crash_reaper_retry_count: nextRetryCount,
        }),
      }));
      expect(mocks.appendAutomationRunEvent).toHaveBeenCalledWith(expect.objectContaining({
        automation_run_id: runId,
        event_type: expectedStatus === 'queued'
          ? 'wakeup.requeued_after_stall'
          : 'wakeup.failed_after_stall',
      }));
    }
  );

  it.each([
    { requeueCount: 0, expectedWakeStatus: 'queued', nextRequeueCount: 1 },
    { requeueCount: 1, expectedWakeStatus: 'failed', nextRequeueCount: 1 },
  ] as const)(
    'fails a session-less starting run and recovers its wakeup as $expectedWakeStatus',
    async ({ requeueCount, expectedWakeStatus, nextRequeueCount }) => {
      const stale = staleRun(requeueCount);
      mocks.listStaleStartingAutomationRuns.mockResolvedValue([stale]);
      mocks.failStaleStartingAutomationRun.mockResolvedValue({
        ...stale,
        status: 'failed',
        result_summary: 'Session was not assigned before the start timeout.',
        ended_at: now.toISOString(),
      });
      mocks.recoverRunningAutomationWakeup.mockImplementation(async (input) => (
        recoveredWakeup(input.status, input.contextPatch)
      ));

      await reapStaleAutomationState(logger as never, now.getTime());

      expect(mocks.failStaleStartingAutomationRun).toHaveBeenCalledWith(expect.objectContaining({
        id: runId,
      }));
      expect(mocks.recoverRunningAutomationWakeup).toHaveBeenCalledWith(expect.objectContaining({
        id: wakeupId,
        status: expectedWakeStatus,
        contextPatch: expect.objectContaining({
          starting_run_requeue_count: nextRequeueCount,
        }),
      }));
      expect(mocks.appendAutomationRunEvent).toHaveBeenCalledWith(expect.objectContaining({
        automation_run_id: runId,
        event_type: 'run.start_timeout',
        level: 'error',
      }));
    }
  );

  it('does not reap wakeups that this service is still processing', async () => {
    mocks.listStaleStartingAutomationRuns.mockResolvedValue([staleRun(0)]);
    mocks.listStaleRunningAutomationWakeups.mockResolvedValue([staleWakeup(0)]);

    await reapStaleAutomationState(logger as never, now.getTime(), {
      isWakeupProcessing: (id) => id === wakeupId,
    });

    expect(mocks.failStaleStartingAutomationRun).not.toHaveBeenCalled();
    expect(mocks.recoverRunningAutomationWakeup).not.toHaveBeenCalled();
    expect(mocks.appendAutomationRunEvent).not.toHaveBeenCalled();
  });
});
