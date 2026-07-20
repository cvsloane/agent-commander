import type {
  AutomationAgent,
  AutomationRun,
  AutomationRunEvent,
  AutomationWakeup,
  GovernanceApproval,
  Repo,
  WorkItem,
} from '@agent-command/schema';
import type { BadgeProps } from '@/components/ui/badge';

export const AUTOMATION_TABS = ['agents', 'wakeups', 'runs', 'approvals', 'work-items'] as const;
export type AutomationTab = (typeof AUTOMATION_TABS)[number];
export type AutomationSheetKind = 'agent' | 'wake' | 'work' | 'nudge' | null;

export const providerOptions = [
  'claude_code',
  'codex',
  'gemini_cli',
  'opencode',
  'cursor',
  'aider',
  'continue',
  'shell',
] as const;

export const selectClassName =
  'flex h-11 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function getAutomationBadgeVariant(status: string): BadgeProps['variant'] {
  switch (status) {
    case 'active':
    case 'running':
    case 'succeeded':
    case 'approved':
    case 'done':
    case 'completed':
      return 'running';
    case 'paused':
    case 'cancelled':
    case 'coalesced':
      return 'secondary';
    case 'queued':
    case 'starting':
    case 'in_progress':
      return 'default';
    case 'blocked':
    case 'pending':
    case 'skipped':
      return 'waiting';
    case 'failed':
    case 'denied':
      return 'destructive';
    default:
      return 'outline';
  }
}

export function centsFromDollars(value: string): number | undefined {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : undefined;
}

export function positiveInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function repoLabel(repo: Repo): string {
  return repo.display_name || repo.last_repo_root || repo.canonical_key;
}

export function describeSchedule(policy: Record<string, unknown> | null | undefined): string {
  const interval = Number(policy?.interval_minutes || 0);
  return Number.isFinite(interval) && interval > 0 ? `Every ${interval}m` : 'Manual only';
}

export function describeConcurrency(policy: Record<string, unknown> | null | undefined): string {
  switch (policy?.concurrency_policy) {
    case 'always_enqueue': return 'Queue behind active runs';
    case 'skip_if_active': return 'Skip when already active';
    default: return 'Coalesce into active run';
  }
}

export function describeScheduler(policy: Record<string, unknown> | null | undefined): string {
  switch (policy?.scheduler_mode) {
    case 'external': return 'Hermes / external';
    case 'hybrid': return 'Hybrid';
    default: return 'Native';
  }
}

export function describeRuntime(agent: AutomationAgent): string {
  const runtime = agent.runtime_state;
  if (!runtime) return 'No runtime bound';
  return runtime.active_session_id
    ? `${runtime.runtime_status} · session attached`
    : runtime.runtime_status;
}

export function describeWakeContext(wakeup: AutomationWakeup): string {
  const objective = wakeup.context_json?.objective;
  return typeof objective === 'string' && objective.trim()
    ? objective.trim()
    : 'Uses agent schedule or queue objective';
}

export function describeApproval(approval: GovernanceApproval): string {
  const reason = approval.request_payload?.reason;
  return typeof reason === 'string' && reason.trim()
    ? reason.trim()
    : JSON.stringify(approval.request_payload);
}

export function describeRunSummary(run: AutomationRun): string {
  const report = run.worker_report_json?.summary;
  if (typeof report === 'string' && report.trim()) return report.trim();
  return run.result_summary?.trim() || run.objective;
}

export function describeWorkItemStatus(item: WorkItem): string {
  return item.checkout_run_id ? `${item.status} · checked out` : item.status;
}

export function eventBadgeVariant(level: AutomationRunEvent['level']): BadgeProps['variant'] {
  if (level === 'error') return 'destructive';
  if (level === 'warn') return 'waiting';
  return 'outline';
}

export interface BudgetProgress {
  label: string;
  usedCents: number;
  limitCents: number | null;
  percent: number;
  complete: boolean;
}

export function automationBudgetProgress(
  agent: AutomationAgent,
  runs: AutomationRun[],
  now: Date = new Date()
): BudgetProgress {
  const policy = agent.budget_policy_json as Record<string, unknown>;
  const dailyLimit = typeof policy.daily_limit_cents === 'number' ? policy.daily_limit_cents : null;
  const monthlyLimit = typeof policy.monthly_limit_cents === 'number' ? policy.monthly_limit_cents : null;
  const agentRuns = runs.filter((run) => run.automation_agent_id === agent.id);
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const dailyUsed = agentRuns.reduce((total, run) => {
    if (!run.started_at || new Date(run.started_at).getTime() < dayStart) return total;
    return total + (typeof run.usage_json?.estimated_cost_cents === 'number'
      ? run.usage_json.estimated_cost_cents
      : 0);
  }, 0);
  const monthlyUsed = agentRuns.reduce((total, run) => {
    if (!run.started_at) return total;
    if (new Date(run.started_at).getTime() < monthStart) return total;
    return total + (typeof run.usage_json?.estimated_cost_cents === 'number'
      ? run.usage_json.estimated_cost_cents
      : 0);
  }, 0);
  const limitCents = dailyLimit || monthlyLimit;
  const usedCents = dailyLimit ? dailyUsed : monthlyUsed;
  return {
    label: dailyLimit ? 'Daily budget' : monthlyLimit ? 'Monthly budget' : 'Budget',
    usedCents,
    limitCents,
    percent: limitCents ? Math.min(100, Math.round((usedCents / limitCents) * 100)) : 0,
    complete: runs.length < 100,
  };
}
