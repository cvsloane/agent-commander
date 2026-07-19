import type { Host } from '@agent-command/schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  countActiveAutomationRunsByHost: vi.fn(),
  computeAutomationBudgetUsage: vi.fn(),
  describeRepo: vi.fn(),
  getHostById: vi.fn(),
  getHosts: vi.fn(),
}));

vi.mock('../src/config.js', () => ({ config: {} }));
vi.mock('../src/db/index.js', () => ({
  getHostById: mocks.getHostById,
  getHosts: mocks.getHosts,
  pool: { query: vi.fn(), connect: vi.fn() },
}));
vi.mock('../src/db/automationMemory.js', () => ({
  countActiveAutomationRunsByHost: mocks.countActiveAutomationRunsByHost,
  computeAutomationBudgetUsage: mocks.computeAutomationBudgetUsage,
  describeRepo: mocks.describeRepo,
}));

import {
  evaluateAutomationPreflight,
  getPreflightOverride,
  isAutomationCompletionFallbackReady,
  selectExecutionHost,
} from '../src/services/automation.js';
import { pubsub } from '../src/services/pubsub.js';

function host(id: string, name: string): Host {
  return {
    id,
    name,
    tailscale_name: name,
    tailscale_ip: null,
    capabilities: {
      spawn: true,
      providers: { codex: true },
    },
    agent_version: 'test',
    last_seen_at: new Date().toISOString(),
    last_acked_seq: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function connect(hosts: Host[]): void {
  for (const item of hosts) {
    pubsub.addAgentConnection(item.id, { send: vi.fn() } as never);
  }
}

describe('automation host selection', () => {
  const fixed = host('44444444-4444-4444-8444-444444444444', 'fixed');
  const affinity = host('55555555-5555-4555-8555-555555555555', 'affinity');
  const alpha = host('66666666-6666-4666-8666-666666666666', 'alpha');
  const beta = host('77777777-7777-4777-8777-777777777777', 'beta');
  const allHosts = [beta, affinity, fixed, alpha];

  beforeEach(() => {
    mocks.countActiveAutomationRunsByHost.mockResolvedValue({});
    mocks.computeAutomationBudgetUsage.mockResolvedValue({ daily_cents: 0, monthly_cents: 0 });
    mocks.describeRepo.mockResolvedValue(null);
    mocks.getHosts.mockResolvedValue(allHosts);
    mocks.getHostById.mockImplementation(async (id: string) => (
      allHosts.find((item) => item.id === id) ?? null
    ));
    connect(allHosts);
  });

  afterEach(() => {
    for (const item of allHosts) {
      pubsub.removeAgentConnection(item.id);
    }
    vi.clearAllMocks();
  });

  it.each([
    {
      name: 'fixed host before repo affinity and load',
      fixedHostId: fixed.id,
      repoHostId: affinity.id,
      activeRuns: { [fixed.id]: 9, [affinity.id]: 0, [alpha.id]: 0, [beta.id]: 0 },
      expectedHostId: fixed.id,
    },
    {
      name: 'repo affinity before load',
      fixedHostId: null,
      repoHostId: affinity.id,
      activeRuns: { [affinity.id]: 9, [alpha.id]: 0, [beta.id]: 0 },
      expectedHostId: affinity.id,
    },
    {
      name: 'fewest active runs without an affinity',
      fixedHostId: null,
      repoHostId: null,
      activeRuns: { [alpha.id]: 2, [beta.id]: 1, [affinity.id]: 3, [fixed.id]: 4 },
      expectedHostId: beta.id,
    },
    {
      name: 'stable host name when load is tied',
      fixedHostId: null,
      repoHostId: null,
      activeRuns: { [alpha.id]: 1, [beta.id]: 1, [affinity.id]: 1, [fixed.id]: 1 },
      expectedHostId: affinity.id,
    },
  ])('selects by $name', async ({ fixedHostId, repoHostId, activeRuns, expectedHostId }) => {
    mocks.countActiveAutomationRunsByHost.mockResolvedValue(activeRuns);

    const selection = await selectExecutionHost({
      fixedHostId,
      repoLastHostId: repoHostId,
      provider: 'codex',
    });

    expect(selection.host?.id).toBe(expectedHostId);
    expect(selection.issues).toEqual([]);
    expect(selection.issues).not.toContainEqual(expect.objectContaining({
      code: 'ambiguous_host_selection',
    }));
  });

  it('starts the completion grace period at the first terminal observation', () => {
    const observedAt = '2026-07-19T18:00:00.000Z';

    expect(isAutomationCompletionFallbackReady(
      'IDLE',
      observedAt,
      Date.parse('2026-07-19T18:00:14.999Z')
    )).toBe(false);
    expect(isAutomationCompletionFallbackReady(
      'IDLE',
      observedAt,
      Date.parse('2026-07-19T18:00:15.000Z')
    )).toBe(true);
    expect(isAutomationCompletionFallbackReady(
      'RUNNING',
      observedAt,
      Date.parse('2026-07-19T18:01:00.000Z')
    )).toBe(false);
  });

  it('honors approved budget grace and a decision-payload host pin', async () => {
    mocks.computeAutomationBudgetUsage.mockResolvedValue({
      daily_cents: 150,
      monthly_cents: 150,
    });
    const preflightOverride = getPreflightOverride({
      preflight_override: {
        budget_grace: true,
        host_id: beta.id,
      },
    });

    const result = await evaluateAutomationPreflight({
      automationAgentId: '88888888-8888-4888-8888-888888888888',
      provider: 'codex',
      budgetPolicyJson: { daily_limit_cents: 100 },
      fixedHostId: fixed.id,
      defaultCwd: '/workspace/repo',
      preflightOverride,
    });

    expect(result.host?.id).toBe(beta.id);
    expect(result.preflight.status).toBe('warn');
    expect(result.preflight.issues).toContainEqual(expect.objectContaining({
      code: 'budget_override_applied',
      level: 'warn',
    }));
    expect(result.preflight.issues).not.toContainEqual(expect.objectContaining({
      code: 'budget_exceeded',
    }));
  });
});
