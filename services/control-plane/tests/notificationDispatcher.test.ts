import { describe, expect, it, vi } from 'vitest';
import type { Approval, Session } from '@agent-command/schema';
import { createNotificationDispatcher } from '../src/services/notificationDispatcher.js';

const userId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const hostId = '33333333-3333-4333-8333-333333333333';
const now = '2026-07-19T16:00:00.000Z';

const session: Session = {
  id: sessionId,
  host_id: hostId,
  user_id: userId,
  kind: 'tmux_pane',
  provider: 'codex',
  status: 'WAITING_FOR_INPUT',
  title: 'Wave 3 refactor',
  metadata: {},
  created_at: now,
  updated_at: now,
  fork_depth: 0,
};

function harness() {
  const webPush = {
    send: vi.fn(async () => ({ sent: 1, failed: 0, pruned: 0, throttled: false })),
  };
  const openClaw = { queueNotification: vi.fn(async () => undefined) };
  const recipients = {
    list: vi.fn(async () => [userId]),
    userForAutomationAgent: vi.fn(async () => userId),
  };
  const dispatcher = createNotificationDispatcher({
    webPush,
    openClaw,
    recipients,
    baseUrl: 'https://agent-command.example.test',
  });
  return { dispatcher, webPush, openClaw, recipients };
}

describe('notification dispatcher', () => {
  it('sends approval requests with a terminal deep link', async () => {
    const approval: Approval = {
      id: '44444444-4444-4444-8444-444444444444',
      session_id: sessionId,
      provider: 'codex',
      ts_requested: now,
      requested_payload: { tool: 'Bash', reason: 'Run the gate' },
    };
    const { dispatcher, webPush, openClaw } = harness();

    await dispatcher.notifyApproval(approval, session, true);

    const expectedUrl = `https://agent-command.example.test/tmux?host_id=${hostId}&session_id=${sessionId}&mode=terminal&attach=1`;
    expect(webPush.send).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        eventType: 'approval.requested',
        dedupeKey: `approval:${approval.id}`,
        url: expectedUrl,
      })
    );
    expect(openClaw.queueNotification).toHaveBeenCalledWith(
      userId,
      'approvals',
      'codex',
      expect.stringContaining(expectedUrl),
      expect.objectContaining({ approvalId: approval.id, url: expectedUrl })
    );
  });

  it('sends snapshot/status attention and run failures to the orchestrator surfaces', async () => {
    const { dispatcher, webPush, recipients } = harness();
    await dispatcher.notifyAttention(session, {
      attention_reason: 'yes_no',
      question: 'Continue? (y/n)',
      capture_hash: 'capture-42',
    });
    await dispatcher.notifyRun({
      id: '55555555-5555-4555-8555-555555555555',
      automation_agent_id: '66666666-6666-4666-8666-666666666666',
      wakeup_id: '77777777-7777-4777-8777-777777777777',
      status: 'failed',
      objective: 'Finish Wave 3',
      memory_snapshot_json: {},
      usage_json: {},
      started_at: now,
    });

    expect(webPush.send).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'waiting_input',
        url: expect.stringContaining('/tmux?'),
      })
    );
    expect(recipients.userForAutomationAgent).toHaveBeenCalled();
    expect(webPush.send).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'run.failed',
        url: expect.stringContaining('/orchestrator?item=run%3A'),
      })
    );
  });

  it('dedupes host-offline dispatch by a host-specific key', async () => {
    const { dispatcher, webPush } = harness();
    await dispatcher.notifyHostOffline(hostId, 'homelinux');

    expect(webPush.send).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'host.offline',
        dedupeKey: `host:${hostId}:offline`,
        url: `https://agent-command.example.test/tmux?host_id=${hostId}`,
      })
    );
  });
});
