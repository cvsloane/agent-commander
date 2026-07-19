import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/auth/types.js';

const userId = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
const hostId = '44444444-4444-4444-8444-444444444444';
const agentId = '55555555-5555-4555-8555-555555555555';

async function buildServer(user: AuthUser): Promise<{
  app: FastifyInstance;
  reportAutomationRunById: ReturnType<typeof vi.fn>;
  sendInputToSession: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();
  const reportAutomationRunById = vi.fn(async () => ({
    run: {
      id: runId,
      automation_agent_id: agentId,
      wakeup_id: '66666666-6666-4666-8666-666666666666',
      session_id: sessionId,
      status: 'succeeded',
      objective: 'Test',
      result_summary: 'All green',
      memory_snapshot_json: {},
      pending_followups_json: [],
      usage_json: {},
      worker_report_json: {},
      log_ref_json: {},
    },
    ingested: { memory: null, trajectory: null },
    work_item: null,
    replayed: false,
  }));
  class MockReportError extends Error {
    constructor(message: string, readonly statusCode: 403 | 404 | 409) {
      super(message);
    }
  }
  vi.doMock('../src/services/automation.js', () => ({
    AutomationRunReportError: MockReportError,
    reportAutomationRunById,
    getAutomationAgentPreflight: vi.fn(),
    getAutomationAgentView: vi.fn(),
    getAutomationRunEvents: vi.fn(),
    listAutomationAgentViews: vi.fn(),
  }));
  vi.doMock('../src/db/automationMemory.js', () => ({
    getAutomationAgentBySlug: vi.fn(async () => ({
      id: agentId,
      user_id: userId,
      slug: 'hermes-worker',
    })),
    getActiveAutomationRuntimeForAgent: vi.fn(async () => ({
      active_session_id: sessionId,
      active_host_id: hostId,
      runtime_status: 'attached',
    })),
  }));
  vi.doMock('../src/db/index.js', () => ({
    getSessionById: vi.fn(async () => ({
      id: sessionId,
      host_id: hostId,
      status: 'IDLE',
    })),
    createAuditLog: vi.fn(async () => undefined),
  }));
  const sendInputToSession = vi.fn(async () => 'message-command');
  vi.doMock('../src/services/sessionSpawn.js', () => ({ sendInputToSession }));
  vi.doMock('../src/services/pubsub.js', () => ({ pubsub: {} }));

  const { registerAutomationRoutes } = await import('../src/routes/automation.js');
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (request) => {
    request.user = user;
  });
  registerAutomationRoutes(app);
  return { app, reportAutomationRunById, sendInputToSession };
}

describe('automation agent-facing APIs', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts a structured completion only through session/service auth', async () => {
    const { app, reportAutomationRunById } = await buildServer({
      id: userId,
      sub: `session:${sessionId}`,
      role: 'viewer',
      auth_type: 'session',
      session_id: sessionId,
    });
    const response = await app.inject({
      method: 'POST',
      url: `/v1/automation-runs/${runId}/report`,
      payload: { outcome: 'succeeded', summary: 'All green' },
    });

    expect(response.statusCode).toBe(200);
    expect(reportAutomationRunById).toHaveBeenCalledWith(expect.objectContaining({
      user_id: userId,
      run_id: runId,
      session_id: sessionId,
      allow_unscoped: false,
      report: expect.objectContaining({
        outcome: 'succeeded',
        summary: 'All green',
      }),
    }));
    await app.close();
  });

  it('lets Hermes service auth nudge an attached automation runtime', async () => {
    const { app, sendInputToSession } = await buildServer({
      id: '77777777-7777-4777-8777-777777777777',
      sub: 'service:hermes',
      role: 'operator',
      auth_type: 'service',
      service_name: 'hermes',
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/automation-agents/hermes-worker/message',
      payload: { message: 'Please re-check the queue' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      automation_agent_id: agentId,
      session_id: sessionId,
      cmd_id: 'message-command',
    });
    expect(sendInputToSession).toHaveBeenCalledWith({
      host_id: hostId,
      session_id: sessionId,
      text: 'Please re-check the queue',
      enter: true,
    });
    await app.close();
  });
});
