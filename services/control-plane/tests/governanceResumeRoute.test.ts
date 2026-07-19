import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/auth/types.js';

const userId = '11111111-1111-4111-8111-111111111111';
const approvalId = '22222222-2222-4222-8222-222222222222';
const agentId = '33333333-3333-4333-8333-333333333333';
const runId = '44444444-4444-4444-8444-444444444444';
const wakeupId = '55555555-5555-4555-8555-555555555555';

describe('governance resume route', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('publishes the approval_resume wakeup created by an approved decision', async () => {
    const approval = {
      id: approvalId,
      user_id: userId,
      automation_agent_id: agentId,
      automation_run_id: runId,
      type: 'budget_override',
      status: 'approved',
      request_payload: {},
      decision_payload: { budget_grace: true },
    };
    const wakeup = {
      id: wakeupId,
      automation_agent_id: agentId,
      source: 'approval_resume',
      status: 'queued',
      context_json: {
        objective: 'Continue work',
        preflight_override: { budget_grace: true },
      },
    };
    const decide = vi.fn(async () => ({
      approval,
      wakeup,
      run: null,
      work_item: null,
    }));
    vi.doMock('../src/db/automationMemory.js', () => ({
      decideGovernanceApprovalWithOutcome: decide,
      listGovernanceApprovals: vi.fn(),
    }));
    const publishGovernanceApprovalUpdated = vi.fn();
    const publishAutomationWakeupUpdated = vi.fn();
    vi.doMock('../src/services/pubsub.js', () => ({
      pubsub: {
        publishGovernanceApprovalUpdated,
        publishAutomationWakeupUpdated,
        publishAutomationRunUpdated: vi.fn(),
        publishWorkItemUpdated: vi.fn(),
      },
    }));
    vi.doMock('../src/metrics.js', () => ({
      recordGovernanceApproval: vi.fn(),
      recordAutomationWakeup: vi.fn(),
    }));

    const { registerGovernanceApprovalRoutes } = await import('../src/routes/governanceApprovals.js');
    const app = Fastify({ logger: false });
    app.addHook('onRequest', async (request) => {
      request.user = {
        id: userId,
        sub: 'operator@example.test',
        role: 'operator',
        auth_type: 'jwt',
      } satisfies AuthUser;
    });
    registerGovernanceApprovalRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/governance-approvals/${approvalId}/decide`,
      payload: {
        decision: 'approved',
        decision_payload: { budget_grace: true },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(decide).toHaveBeenCalledWith(
      userId,
      approvalId,
      userId,
      expect.objectContaining({ decision: 'approved' })
    );
    expect(publishGovernanceApprovalUpdated).toHaveBeenCalledWith(approval);
    expect(publishAutomationWakeupUpdated).toHaveBeenCalledWith(wakeup);
    expect(response.json()).toMatchObject({ resume_wakeup: { id: wakeupId } });
    await app.close();
  });
});
