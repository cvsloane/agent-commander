import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  claimNextAutomationWakeup: vi.fn(),
}));

vi.mock('../src/config.js', () => ({ config: {} }));
vi.mock('../src/metrics.js', () => ({
  recordAutomationRun: vi.fn(),
  recordAutomationWakeup: vi.fn(),
  recordGovernanceApproval: vi.fn(),
}));
vi.mock('../src/db/index.js', () => ({}));
vi.mock('../src/db/automationMemory.js', () => ({
  claimNextAutomationWakeup: mocks.claimNextAutomationWakeup,
}));
vi.mock('../src/services/sessionSpawn.js', () => ({ spawnSessionOnHost: vi.fn() }));
vi.mock('../src/services/sessionMemory.js', () => ({
  prepareSessionMemoryForSpawn: vi.fn(),
  bootstrapSessionMemory: vi.fn(),
}));

import { createAutomationWakeupTaskPool } from '../src/services/automation.js';

function claimedWakeup(index: number) {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    automation_agent_id: '11111111-1111-4111-8111-111111111111',
    repo_id: null,
    source: 'schedule',
    status: 'running',
    idempotency_key: null,
    context_json: {},
    requested_at: new Date().toISOString(),
    claimed_at: new Date().toISOString(),
    finished_at: null,
    agent_name: `Worker ${index}`,
    agent_provider: 'codex',
    agent_role: 'worker',
    agent_status: 'active',
    agent_user_id: '22222222-2222-4222-8222-222222222222',
    agent_default_cwd: '/home/cvsloane/dev/agent-command',
    agent_fixed_host_id: null,
    wake_policy_json: {},
    memory_policy_json: {},
    budget_policy_json: {},
    worker_pool_json: {},
    max_parallel_runs: 1,
    active_run_count: 0,
  };
}

describe('automation wakeup task pool', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('processes slow wakeups off-tick without exceeding the concurrency cap', async () => {
    const wakeups = [1, 2, 3, 4].map(claimedWakeup);
    for (const wakeup of wakeups) {
      mocks.claimNextAutomationWakeup.mockResolvedValueOnce(wakeup);
    }
    mocks.claimNextAutomationWakeup.mockResolvedValue(null);

    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    const processor = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
    });
    const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
    const pool = createAutomationWakeupTaskPool(logger as never, {
      concurrency: 3,
      processor,
    });

    await pool.fill();
    await vi.waitFor(() => expect(processor).toHaveBeenCalledTimes(3));

    expect(pool.activeCount).toBe(3);
    expect(maxActive).toBe(3);
    expect(mocks.claimNextAutomationWakeup).toHaveBeenCalledTimes(3);

    releases.shift()?.();
    await vi.waitFor(() => expect(pool.activeCount).toBe(2));
    await pool.fill();
    await vi.waitFor(() => expect(processor).toHaveBeenCalledTimes(4));

    expect(pool.activeCount).toBe(3);
    expect(maxActive).toBe(3);

    for (const release of releases) release();
    await pool.drain();
    expect(pool.activeCount).toBe(0);
  });
});
