import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/auth/types.js';

const orchestratorId = '11111111-1111-4111-8111-111111111111';
const childId = '22222222-2222-4222-8222-222222222222';
const hostId = '33333333-3333-4333-8333-333333333333';
const userId = '44444444-4444-4444-8444-444444444444';
const automationAgentId = '55555555-5555-4555-8555-555555555555';
const runId = '66666666-6666-4666-8666-666666666666';
const wakeupId = '77777777-7777-4777-8777-777777777777';
const taskId = '88888888-8888-4888-8888-888888888888';
const now = '2026-07-20T18:00:00.000Z';

const orchestrator = {
  id: orchestratorId,
  host_id: hostId,
  user_id: userId,
  repo_id: null,
  kind: 'tmux_pane',
  provider: 'codex',
  status: 'RUNNING',
  role: 'orchestrator',
  title: 'Frontend lead',
  cwd: '/workspace/repo',
  repo_root: '/workspace/repo',
  git_remote: null,
  git_branch: 'main',
  tmux_pane_id: '%1',
  tmux_target: 'frontend:0.0',
  metadata: {},
  created_at: now,
  updated_at: now,
  last_activity_at: now,
  idled_at: null,
  group_id: null,
  forked_from: null,
  fork_depth: 0,
  archived_at: null,
};
const child = {
  ...orchestrator,
  id: childId,
  role: 'worker',
  title: 'Contracts worker',
  tmux_pane_id: '%2',
  tmux_target: 'frontend:0.1',
};
const edge = {
  parent_session_id: orchestratorId,
  child_session_id: childId,
  edge_type: 'spawned',
  created_at: now,
};
const rollup = {
  session_id: orchestratorId,
  child_sessions: { total: 1, by_status: { RUNNING: 1 } },
  agent_tasks: { total: 1, running: 1, completed: 0, failed: 0 },
};
const agentTask = {
  id: taskId,
  session_id: childId,
  tool_use_id: 'tool-1',
  description: 'Implement contracts',
  status: 'running',
  started_at: now,
  ended_at: null,
  metadata: {},
};
const automationAgent = {
  id: automationAgentId,
  user_id: userId,
  role: 'orchestrator',
  name: 'Frontend command center',
  slug: 'frontend-command-center',
  status: 'active',
  reports_to_automation_agent_id: null,
  provider: 'codex',
  default_cwd: '/workspace/repo',
  fixed_host_id: hostId,
  wake_policy_json: {},
  memory_policy_json: {},
  budget_policy_json: { daily_limit_cents: 500 },
  worker_pool_json: {},
  max_parallel_runs: 4,
  runtime_state: {
    id: '99999999-9999-4999-8999-999999999999',
    automation_agent_id: automationAgentId,
    active_session_id: orchestratorId,
    last_session_id: childId,
    runtime_status: 'attached',
    state_json: {},
    usage_rollup_json: { total_tokens: 1234 },
    created_at: now,
    updated_at: now,
  },
  preflight: { status: 'ok', issues: [] },
  created_at: now,
  updated_at: now,
};
const latestRun = {
  id: runId,
  automation_agent_id: automationAgentId,
  wakeup_id: wakeupId,
  repo_id: null,
  session_id: childId,
  status: 'succeeded',
  objective: 'Ship the control-plane contracts',
  memory_snapshot_json: {},
  pending_followups_json: [],
  result_summary: 'Fallback result',
  usage_json: { estimated_cost_cents: 250, total_tokens: 1234 },
  worker_report_json: { summary: 'Shipped the fleet aggregate' },
  log_ref_json: {},
  started_at: now,
  ended_at: now,
};

async function buildServer(): Promise<{
  app: FastifyInstance;
  listFleetWorkItemCounts: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();
  vi.doMock('../src/db/index.js', () => ({
    getSessions: vi.fn(async () => [orchestrator, child]),
    getLatestSnapshots: vi.fn(async () => [{
      id: 1,
      session_id: orchestratorId,
      created_at: now,
      capture_text: 'coordinating',
      capture_hash: 'snapshot-hash',
    }]),
    getSessionsByIds: vi.fn(async () => [child]),
    getSessionById: vi.fn(async () => null),
    createAuditLog: vi.fn(async () => undefined),
  }));
  vi.doMock('../src/db/sessionGraph.js', () => ({
    sessionGraph: {
      list: vi.fn(async () => [edge]),
      rollup: vi.fn(async () => rollup),
    },
  }));
  vi.doMock('../src/db/agentTasks.js', () => ({
    agentTasks: { list: vi.fn(async () => [agentTask]) },
  }));
  const listFleetWorkItemCounts = vi.fn(async () => [
    {
      session_id: childId,
      assigned_automation_agent_id: null,
      status: 'in_progress',
      count: 1,
    },
    {
      session_id: null,
      assigned_automation_agent_id: automationAgentId,
      status: 'queued',
      count: 2,
    },
  ]);
  vi.doMock('../src/db/automationMemory.js', () => ({
    listAutomationRuns: vi.fn(async () => [latestRun]),
    computeAutomationBudgetUsage: vi.fn(async () => ({
      daily_cents: 250,
      monthly_cents: 900,
    })),
    listFleetWorkItemCounts,
  }));
  vi.doMock('../src/services/automation.js', () => ({
    listAutomationAgentViews: vi.fn(async () => [automationAgent]),
  }));
  vi.doMock('../src/services/sessionMemory.js', () => ({
    prepareSessionMemoryForSpawn: vi.fn(),
  }));
  vi.doMock('../src/services/sessionSpawn.js', () => ({
    spawnSessionOnHost: vi.fn(),
    queueInputToSession: vi.fn(),
  }));
  vi.doMock('../src/auth/verify.js', () => ({ mintSessionToken: vi.fn() }));
  vi.doMock('../src/services/pubsub.js', () => ({
    pubsub: {
      publishSessionsChanged: vi.fn(),
      publishWorkItemUpdated: vi.fn(),
    },
  }));

  const { registerOrchestratorRoutes } = await import('../src/routes/orchestrator.js');
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (request) => {
    request.user = {
      id: userId,
      sub: userId,
      email: 'operator@example.com',
      role: 'operator',
      auth_type: 'jwt',
    } satisfies AuthUser;
  });
  registerOrchestratorRoutes(app);
  return { app, listFleetWorkItemCounts };
}

describe('GET /v1/orchestrator/fleet', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns each orchestrator card bundle with work, report, budget, and usage data', async () => {
    const { app, listFleetWorkItemCounts } = await buildServer();

    const response = await app.inject({ method: 'GET', url: '/v1/orchestrator/fleet' });

    expect(response.statusCode, response.body).toBe(200);
    expect(listFleetWorkItemCounts).toHaveBeenCalledWith(userId);
    expect(response.json()).toEqual({
      orchestrators: [{
        session: {
          ...orchestrator,
          latest_snapshot: {
            created_at: now,
            capture_text: 'coordinating',
            capture_hash: 'snapshot-hash',
          },
        },
        children: [{ ...child, latest_snapshot: null }],
        edges: [edge],
        agent_tasks: [agentTask],
        rollup,
        work_item_counts: {
          total: 3,
          by_status: {
            queued: 2,
            in_progress: 1,
            blocked: 0,
            done: 0,
            cancelled: 0,
          },
        },
        automation_agent: automationAgent,
        latest_run: latestRun,
        latest_report: {
          run_id: runId,
          status: 'succeeded',
          summary: 'Shipped the fleet aggregate',
          reported_at: now,
        },
        budget_policy: { daily_limit_cents: 500 },
        budget_usage: { daily_cents: 250, monthly_cents: 900 },
        usage_rollup: { total_tokens: 1234 },
      }],
    });
    await app.close();
  });
});
