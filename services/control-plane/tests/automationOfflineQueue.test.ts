import type { AutomationRun, Host } from '@agent-command/schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClaimedAutomationWakeup } from '../src/db/automationMemory.js';

const mocks = vi.hoisted(() => ({
  getHostById: vi.fn(),
  getHosts: vi.fn(),
  getAutomationRuntimeState: vi.fn(),
  getActiveAutomationRunForScope: vi.fn(),
  buildObjectiveFromWake: vi.fn(),
  createAutomationRun: vi.fn(),
  updateAutomationRun: vi.fn(),
  appendAutomationRunEvent: vi.fn(),
  describeRepo: vi.fn(),
  computeAutomationBudgetUsage: vi.fn(),
  countActiveAutomationRunsByHost: vi.fn(),
  requeueAutomationWakeup: vi.fn(),
  markAutomationWakeupStatus: vi.fn(),
  createGovernanceApproval: vi.fn(),
}));

vi.mock('../src/config.js', () => ({ config: {} }));
vi.mock('../src/metrics.js', () => ({
  recordAutomationRun: vi.fn(),
  recordAutomationWakeup: vi.fn(),
  recordGovernanceApproval: vi.fn(),
}));
vi.mock('../src/db/index.js', () => ({
  getHostById: mocks.getHostById,
  getHosts: mocks.getHosts,
}));
vi.mock('../src/db/automationMemory.js', () => ({
  getAutomationRuntimeState: mocks.getAutomationRuntimeState,
  getActiveAutomationRunForScope: mocks.getActiveAutomationRunForScope,
  buildObjectiveFromWake: mocks.buildObjectiveFromWake,
  createAutomationRun: mocks.createAutomationRun,
  updateAutomationRun: mocks.updateAutomationRun,
  appendAutomationRunEvent: mocks.appendAutomationRunEvent,
  describeRepo: mocks.describeRepo,
  computeAutomationBudgetUsage: mocks.computeAutomationBudgetUsage,
  countActiveAutomationRunsByHost: mocks.countActiveAutomationRunsByHost,
  requeueAutomationWakeup: mocks.requeueAutomationWakeup,
  markAutomationWakeupStatus: mocks.markAutomationWakeupStatus,
  createGovernanceApproval: mocks.createGovernanceApproval,
}));
vi.mock('../src/services/sessionSpawn.js', () => ({ spawnSessionOnHost: vi.fn() }));
vi.mock('../src/services/sessionMemory.js', () => ({
  prepareSessionMemoryForSpawn: vi.fn(),
  bootstrapSessionMemory: vi.fn(),
}));

import { processAutomationWakeup } from '../src/services/automation.js';

const now = new Date('2026-07-19T20:00:00.000Z');
const hostId = '11111111-1111-4111-8111-111111111111';
const agentId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const wakeupId = '44444444-4444-4444-8444-444444444444';
const runId = '55555555-5555-4555-8555-555555555555';

const offlineHost: Host = {
  id: hostId,
  name: 'homelinux',
  tailscale_name: 'homelinux',
  tailscale_ip: null,
  capabilities: { spawn: true, providers: { codex: true } },
  agent_version: 'test',
  last_seen_at: now.toISOString(),
  last_acked_seq: 0,
  created_at: now.toISOString(),
  updated_at: now.toISOString(),
};

function wakeup(overrides: Partial<ClaimedAutomationWakeup> = {}): ClaimedAutomationWakeup {
  return {
    id: wakeupId,
    automation_agent_id: agentId,
    repo_id: null,
    source: 'schedule',
    status: 'running',
    idempotency_key: null,
    context_json: {},
    requested_at: now.toISOString(),
    claimed_at: now.toISOString(),
    finished_at: null,
    agent_name: 'Nightly worker',
    agent_provider: 'codex',
    agent_role: 'orchestrator',
    agent_status: 'active',
    agent_user_id: userId,
    agent_default_cwd: '/home/cvsloane/dev/agent-command',
    agent_fixed_host_id: hostId,
    wake_policy_json: {
      host_offline_ttl_minutes: 15,
      host_offline_backoff_seconds: 5,
    },
    memory_policy_json: {},
    budget_policy_json: {},
    worker_pool_json: {},
    max_parallel_runs: 1,
    active_run_count: 0,
    ...overrides,
  };
}

function run(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: runId,
    automation_agent_id: agentId,
    wakeup_id: wakeupId,
    repo_id: null,
    session_id: null,
    status: 'starting',
    objective: 'Run the nightly automation',
    memory_snapshot_json: {},
    pending_followups_json: [],
    result_summary: null,
    usage_json: {},
    worker_report_json: {},
    log_ref_json: {},
    started_at: now.toISOString(),
    ended_at: null,
    ...overrides,
  };
}

describe('offline automation wakeups', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    mocks.getHostById.mockResolvedValue(offlineHost);
    mocks.getHosts.mockResolvedValue([offlineHost]);
    mocks.getAutomationRuntimeState.mockResolvedValue(null);
    mocks.getActiveAutomationRunForScope.mockResolvedValue(null);
    mocks.buildObjectiveFromWake.mockResolvedValue({
      objective: 'Run the nightly automation',
      workItem: null,
      repo: null,
    });
    mocks.createAutomationRun.mockResolvedValue(run());
    mocks.updateAutomationRun.mockImplementation(async (_id: string, updates: Partial<AutomationRun>) => (
      run(updates)
    ));
    mocks.appendAutomationRunEvent.mockImplementation(async (input) => ({
      id: 1,
      seq: 1,
      level: input.level ?? 'info',
      payload: input.payload ?? {},
      created_at: now.toISOString(),
      ...input,
    }));
    mocks.describeRepo.mockResolvedValue(null);
    mocks.computeAutomationBudgetUsage.mockResolvedValue({ daily_cents: 0, monthly_cents: 0 });
    mocks.countActiveAutomationRunsByHost.mockResolvedValue({ [hostId]: 0 });
    mocks.requeueAutomationWakeup.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      ...wakeup(),
      status: 'queued',
      claimed_at: null,
      context_json: patch,
    }));
    mocks.markAutomationWakeupStatus.mockImplementation(async (
      _id: string,
      status: ClaimedAutomationWakeup['status'],
      patch: Record<string, unknown>
    ) => ({ ...wakeup(), status, context_json: patch }));
    mocks.createGovernanceApproval.mockResolvedValue({
      id: '66666666-6666-4666-8666-666666666666',
      user_id: userId,
      automation_agent_id: agentId,
      automation_run_id: runId,
      type: 'host_selection',
      status: 'pending',
      request_payload: {},
      decision_payload: null,
      requested_at: now.toISOString(),
      decided_at: null,
      decided_by_user_id: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('requeues an offline-host wakeup with backoff before its TTL', async () => {
    await processAutomationWakeup({ error: vi.fn(), warn: vi.fn(), info: vi.fn() } as never, wakeup());

    expect(mocks.requeueAutomationWakeup).toHaveBeenCalledWith(wakeupId, expect.objectContaining({
      reason: 'queued_until_host_online',
      queued_until_host_online: true,
      waiting_for_host_id: hostId,
      host_wait_attempt: 1,
      host_wait_started_at_ms: now.getTime(),
      automation_deferred_until_ms: now.getTime() + 5_000,
    }));
    expect(mocks.markAutomationWakeupStatus).not.toHaveBeenCalled();
    expect(mocks.createGovernanceApproval).not.toHaveBeenCalled();
    expect(mocks.appendAutomationRunEvent).toHaveBeenCalledWith(expect.objectContaining({
      automation_run_id: runId,
      event_type: 'host.offline_wait',
      level: 'warn',
    }));
    expect(mocks.updateAutomationRun).toHaveBeenCalledWith(runId, expect.objectContaining({
      status: 'cancelled',
    }));
  });

  it.each([
    { requireApproval: false, expectedApprovals: 0 },
    { requireApproval: true, expectedApprovals: 1 },
  ])(
    'blocks after the offline TTL and creates $expectedApprovals host approval(s)',
    async ({ requireApproval, expectedApprovals }) => {
      const expired = wakeup({
        context_json: {
          host_wait_started_at_ms: now.getTime() - 15 * 60_000,
          host_wait_attempt: 4,
        },
        wake_policy_json: {
          host_offline_ttl_minutes: 15,
          host_offline_backoff_seconds: 5,
          require_host_selection_approval: requireApproval,
        },
      });

      await processAutomationWakeup(
        { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as never,
        expired
      );

      expect(mocks.requeueAutomationWakeup).not.toHaveBeenCalled();
      expect(mocks.markAutomationWakeupStatus).toHaveBeenCalledWith(
        wakeupId,
        'blocked',
        expect.objectContaining({ reason: 'fixed_host_offline' })
      );
      expect(mocks.createGovernanceApproval).toHaveBeenCalledTimes(expectedApprovals);
      if (requireApproval) {
        expect(mocks.createGovernanceApproval).toHaveBeenCalledWith(expect.objectContaining({
          type: 'host_selection',
        }));
      }
    }
  );
});
