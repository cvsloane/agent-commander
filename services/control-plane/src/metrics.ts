import client from 'prom-client';

export const registry = new client.Registry();
registry.setDefaultLabels({ app: 'agent-command-control-plane' });

client.collectDefaultMetrics({ register: registry });

export type ClawdbotDecision = 'allowed' | 'blocked';
export type ClawdbotReason =
  | 'allowed'
  | 'provider_disabled'
  | 'actionable_only'
  | 'event_disabled'
  | 'rate_limit'
  | 'approval_dedup'
  | 'dedupe_key'
  | 'session_cooldown';

export const clawdbotNotificationDecisionsTotal = new client.Counter({
  name: 'agent_command_clawdbot_notification_decisions_total',
  help: 'Count of Clawdbot notification decisions (allowed/blocked) and reasons.',
  labelNames: ['decision', 'reason', 'event_type', 'provider'] as const,
  registers: [registry],
});

export function recordClawdbotNotificationDecision(params: {
  decision: ClawdbotDecision;
  reason: ClawdbotReason;
  eventType: string;
  provider: string | null;
}): void {
  clawdbotNotificationDecisionsTotal.inc({
    decision: params.decision,
    reason: params.reason,
    event_type: params.eventType,
    provider: params.provider ?? 'none',
  });
}

