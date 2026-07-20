import { beforeEach, describe, expect, it, vi } from 'vitest';

const userId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const hostId = '33333333-3333-4333-8333-333333333333';
const now = '2026-07-19T16:00:00.000Z';

describe('notification event sources', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('wires approvals, failed runs, governance creation, and host offline into the dispatcher', async () => {
    const notifyApproval = vi.fn(async () => undefined);
    const notifyRun = vi.fn(async () => undefined);
    const notifyGovernance = vi.fn(async () => undefined);
    const notifyHostOffline = vi.fn(async () => undefined);
    vi.doMock('../src/services/notificationDispatcher.js', () => ({
      notificationDispatcher: {
        notifyApproval,
        notifyRun,
        notifyGovernance,
        notifyHostOffline,
      },
    }));
    vi.doMock('../src/services/clawdbot.js', () => ({
      clawdbotNotifier: { clearSessionState: vi.fn() },
    }));

    const { pubsub } = await import('../src/services/pubsub.js');
    const session = {
      id: sessionId,
      host_id: hostId,
      user_id: userId,
      kind: 'tmux_pane' as const,
      provider: 'codex' as const,
      status: 'WAITING_FOR_APPROVAL' as const,
      metadata: {},
      created_at: now,
      updated_at: now,
      fork_depth: 0,
    };
    pubsub.publishApprovalCreated(
      {
        id: '44444444-4444-4444-8444-444444444444',
        session_id: sessionId,
        provider: 'codex',
        ts_requested: now,
        requested_payload: { tool: 'Bash' },
      },
      session
    );
    pubsub.publishAutomationRunUpdated({
      id: '55555555-5555-4555-8555-555555555555',
      automation_agent_id: '66666666-6666-4666-8666-666666666666',
      wakeup_id: '77777777-7777-4777-8777-777777777777',
      status: 'failed',
      objective: 'Wave 3',
      memory_snapshot_json: {},
      usage_json: {},
      started_at: now,
    });
    pubsub.publishGovernanceApprovalUpdated({
      id: '88888888-8888-4888-8888-888888888888',
      user_id: userId,
      automation_agent_id: '66666666-6666-4666-8666-666666666666',
      type: 'plan_review',
      status: 'pending',
      request_payload: {},
      requested_at: now,
    });
    const socket = { send: vi.fn(), terminate: vi.fn() };
    pubsub.addAgentConnection(hostId, socket as never);
    pubsub.removeAgentConnection(hostId, socket as never);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(notifyApproval).toHaveBeenCalledOnce();
    expect(notifyRun).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
    expect(notifyGovernance).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
    expect(notifyHostOffline).toHaveBeenCalledWith(hostId);
  });
});
