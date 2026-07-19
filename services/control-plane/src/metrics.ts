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

export const automationWakeupsTotal = new client.Counter({
  name: 'agent_command_automation_wakeups_total',
  help: 'Count of automation wakeup state transitions.',
  labelNames: ['status', 'source'] as const,
  registers: [registry],
});

export function recordAutomationWakeup(status: string, source: string): void {
  automationWakeupsTotal.inc({ status, source });
}

export const automationRunsTotal = new client.Counter({
  name: 'agent_command_automation_runs_total',
  help: 'Count of automation run lifecycle transitions.',
  labelNames: ['status', 'provider'] as const,
  registers: [registry],
});

export function recordAutomationRun(status: string, provider: string): void {
  automationRunsTotal.inc({ status, provider });
}

export const governanceApprovalsTotal = new client.Counter({
  name: 'agent_command_governance_approvals_total',
  help: 'Count of governance approval creations and decisions.',
  labelNames: ['status', 'type'] as const,
  registers: [registry],
});

export function recordGovernanceApproval(status: string, type: string): void {
  governanceApprovalsTotal.inc({ status, type });
}

export const memorySearchesTotal = new client.Counter({
  name: 'agent_command_memory_searches_total',
  help: 'Count of memory search queries and result shapes.',
  labelNames: ['scope', 'hit'] as const,
  registers: [registry],
});

export function recordMemorySearch(scope: string, hit: boolean): void {
  memorySearchesTotal.inc({ scope, hit: hit ? 'true' : 'false' });
}
