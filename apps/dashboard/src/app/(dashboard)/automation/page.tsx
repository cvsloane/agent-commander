'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BadgeProps,
} from '@/components/ui/badge';
import type {
  AutomationAgent,
  AutomationRun,
  AutomationRunEvent,
  AutomationWakeup,
  GovernanceApproval,
  Host,
  Repo,
  ServerToUIMessage,
  WorkItem,
} from '@agent-command/schema';
import {
  AlertTriangle,
  Bot,
  FolderGit2,
  Pause,
  Play,
  RefreshCw,
  ShieldAlert,
  Workflow,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useWebSocket } from '@/hooks/useWebSocket';
import {
  createAutomationAgent,
  createWorkItem,
  decideGovernanceApproval,
  getAutomationAgents,
  getAutomationRunEvents,
  getAutomationRuns,
  getAutomationWakeups,
  getGovernanceApprovals,
  getHosts,
  getRepos,
  getWorkItems,
  updateAutomationAgent,
  updateWorkItem,
  wakeAutomationAgent,
} from '@/lib/api';
import { formatRelativeTime, getProviderDisplayName } from '@/lib/utils';

const providerOptions = [
  'claude_code',
  'codex',
  'gemini_cli',
  'opencode',
  'cursor',
  'aider',
  'continue',
  'shell',
] as const;

const EMPTY_REPOS: Repo[] = [];
const EMPTY_AGENTS: AutomationAgent[] = [];
const EMPTY_RUNS: AutomationRun[] = [];
const EMPTY_WAKEUPS: AutomationWakeup[] = [];
const EMPTY_APPROVALS: GovernanceApproval[] = [];
const EMPTY_WORK_ITEMS: WorkItem[] = [];
const EMPTY_HOSTS: Host[] = [];

const selectClassName =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

function getBadgeVariant(status: string): BadgeProps['variant'] {
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

function centsFromDollars(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.round(parsed * 100);
}

function parsePositiveInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function repoLabel(repo: Repo): string {
  return repo.display_name || repo.last_repo_root || repo.canonical_key;
}

function describeBudget(policy: Record<string, unknown> | null | undefined): string {
  if (!policy) return 'No budget limits';
  const daily = typeof policy.daily_limit_cents === 'number'
    ? policy.daily_limit_cents / 100
    : null;
  const monthly = typeof policy.monthly_limit_cents === 'number'
    ? policy.monthly_limit_cents / 100
    : null;
  const warnPercent = typeof policy.warn_percent === 'number'
    ? `${policy.warn_percent}% warn`
    : null;
  if (!daily && !monthly) return warnPercent || 'No budget limits';
  return [
    daily ? `$${daily.toFixed(2)}/day` : null,
    monthly ? `$${monthly.toFixed(2)}/month` : null,
    warnPercent,
  ]
    .filter(Boolean)
    .join(' · ');
}

function describeSchedule(policy: Record<string, unknown> | null | undefined): string {
  if (!policy) return 'Manual only';
  const intervalMinutes = typeof policy.interval_minutes === 'number'
    ? policy.interval_minutes
    : typeof policy.interval_minutes === 'string'
      ? Number(policy.interval_minutes)
      : 0;
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
    return 'Manual only';
  }
  return `Every ${intervalMinutes}m`;
}

function describeApproval(approval: GovernanceApproval): string {
  const reason = approval.request_payload?.reason;
  if (typeof reason === 'string' && reason.trim()) {
    return reason.trim();
  }
  return JSON.stringify(approval.request_payload);
}

function describeWorkItemStatus(item: WorkItem): string {
  if (item.checkout_run_id) {
    return `${item.status} · checked out`;
  }
  return item.status;
}

function describeWakeContext(wakeup: AutomationWakeup): string {
  const objective = wakeup.context_json?.objective;
  if (typeof objective === 'string' && objective.trim()) {
    return objective.trim();
  }
  return 'Uses agent schedule or queue objective';
}

function describeRunSummary(run: AutomationRun): string {
  return run.result_summary?.trim() || run.objective;
}

function describeConcurrency(policy: Record<string, unknown> | null | undefined): string {
  const value = typeof policy?.concurrency_policy === 'string'
    ? policy.concurrency_policy
    : 'coalesce_if_active';
  switch (value) {
    case 'always_enqueue':
      return 'Queue behind active runs';
    case 'skip_if_active':
      return 'Skip when already active';
    default:
      return 'Coalesce into active run';
  }
}

function describeRuntime(agent: AutomationAgent): string {
  const runtime = agent.runtime_state;
  if (!runtime) return 'No runtime bound';
  if (runtime.active_session_id) {
    return `${runtime.runtime_status} · session attached`;
  }
  return runtime.runtime_status;
}

function eventBadgeVariant(level: AutomationRunEvent['level']): BadgeProps['variant'] {
  if (level === 'error') return 'destructive';
  if (level === 'warn') return 'waiting';
  return 'outline';
}

export const dynamic = 'force-dynamic';

export default function AutomationPage() {
  const queryClient = useQueryClient();
  const [agentForm, setAgentForm] = useState({
    name: '',
    role: 'orchestrator',
    provider: 'codex',
    defaultCwd: '',
    fixedHostId: '',
    intervalMinutes: '',
    scheduledObjective: '',
    concurrencyPolicy: 'coalesce_if_active',
    maxParallelRuns: '1',
    dailyBudgetUsd: '',
    monthlyBudgetUsd: '',
    warnPercent: '80',
  });
  const [wakeForm, setWakeForm] = useState({
    agentId: '',
    repoId: '',
    objective: '',
    idempotencyKey: '',
  });
  const [workForm, setWorkForm] = useState({
    repoId: '',
    title: '',
    objective: '',
    priority: '0',
    assignedAutomationAgentId: '',
    dedupeKey: '',
  });
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const { data: agentsData, isLoading: agentsLoading, error: agentsError, refetch: refetchAgents } = useQuery({
    queryKey: ['automation', 'agents'],
    queryFn: getAutomationAgents,
    refetchInterval: 15000,
  });
  const { data: runsData, refetch: refetchRuns } = useQuery({
    queryKey: ['automation', 'runs'],
    queryFn: () => getAutomationRuns({ limit: 30 }),
    refetchInterval: 15000,
  });
  const { data: runEventsData, refetch: refetchRunEvents } = useQuery({
    queryKey: ['automation', 'run-events', selectedRunId],
    queryFn: () => getAutomationRunEvents(selectedRunId!),
    enabled: Boolean(selectedRunId),
    refetchInterval: selectedRunId ? 15000 : false,
  });
  const { data: wakeupsData, refetch: refetchWakeups } = useQuery({
    queryKey: ['automation', 'wakeups'],
    queryFn: () => getAutomationWakeups({ limit: 30 }),
    refetchInterval: 15000,
  });
  const { data: approvalsData, refetch: refetchApprovals } = useQuery({
    queryKey: ['automation', 'governance-approvals'],
    queryFn: () => getGovernanceApprovals({ status: 'pending' }),
    refetchInterval: 15000,
  });
  const { data: workItemsData, refetch: refetchWorkItems } = useQuery({
    queryKey: ['automation', 'work-items'],
    queryFn: () => getWorkItems({ limit: 50 }),
    refetchInterval: 15000,
  });
  const { data: reposData } = useQuery({
    queryKey: ['repos', 'automation'],
    queryFn: () => getRepos({ limit: 100 }),
  });
  const { data: hostsData } = useQuery({
    queryKey: ['hosts', 'automation'],
    queryFn: getHosts,
  });

  const agents = agentsData?.agents ?? EMPTY_AGENTS;
  const runs = runsData?.runs ?? EMPTY_RUNS;
  const wakeups = wakeupsData?.wakeups ?? EMPTY_WAKEUPS;
  const approvals = approvalsData?.approvals ?? EMPTY_APPROVALS;
  const workItems = workItemsData?.work_items ?? EMPTY_WORK_ITEMS;
  const repos = reposData?.repos ?? EMPTY_REPOS;
  const hosts = hostsData?.hosts ?? EMPTY_HOSTS;
  const runEvents = runEventsData?.events ?? [];

  const repoMap = useMemo(() => new Map(repos.map((repo) => [repo.id, repo])), [repos]);
  const hostMap = useMemo(() => new Map(hosts.map((host) => [host.id, host])), [hosts]);
  const agentMap = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);

  const refetchAll = useCallback(() => {
    void refetchAgents();
    void refetchRuns();
    void refetchRunEvents();
    void refetchWakeups();
    void refetchApprovals();
    void refetchWorkItems();
  }, [refetchAgents, refetchRuns, refetchRunEvents, refetchWakeups, refetchApprovals, refetchWorkItems]);

  const handleAutomationMessage = useCallback(
    (message: ServerToUIMessage) => {
      if (message.type === 'automation.run.updated') {
        void queryClient.invalidateQueries({ queryKey: ['automation', 'runs'] });
        return;
      }
      if (message.type === 'automation.run.event') {
        void queryClient.invalidateQueries({ queryKey: ['automation', 'run-events'] });
        return;
      }
      if (message.type === 'automation.runtime_state.updated') {
        void queryClient.invalidateQueries({ queryKey: ['automation', 'agents'] });
        return;
      }
      if (message.type === 'automation.wakeup.updated') {
        void queryClient.invalidateQueries({ queryKey: ['automation', 'wakeups'] });
        return;
      }
      if (message.type === 'governance_approval.updated') {
        void queryClient.invalidateQueries({ queryKey: ['automation', 'governance-approvals'] });
        return;
      }
      if (message.type === 'work_item.updated') {
        void queryClient.invalidateQueries({ queryKey: ['automation', 'work-items'] });
      }
    },
    [queryClient]
  );

  useWebSocket(
    [
      { type: 'automation_runs' },
      ...(selectedRunId ? [{ type: 'automation_run_events' as const, filter: { automation_run_id: selectedRunId } }] : []),
      { type: 'automation_wakeups' },
      { type: 'governance_approvals', filter: { status: 'pending' } },
      { type: 'work_items' },
    ],
    handleAutomationMessage
  );

  const createAgentMutation = useMutation({
    mutationFn: async () => {
      const wakePolicyJson: Record<string, unknown> = {};
      const intervalMinutes = parsePositiveInt(agentForm.intervalMinutes, 0);
      if (intervalMinutes > 0) {
        wakePolicyJson.interval_minutes = intervalMinutes;
      }
      if (agentForm.scheduledObjective.trim()) {
        wakePolicyJson.objective = agentForm.scheduledObjective.trim();
      }
      wakePolicyJson.concurrency_policy = agentForm.concurrencyPolicy;

      const budgetPolicyJson: Record<string, unknown> = {};
      const dailyBudget = centsFromDollars(agentForm.dailyBudgetUsd);
      const monthlyBudget = centsFromDollars(agentForm.monthlyBudgetUsd);
      if (dailyBudget) {
        budgetPolicyJson.daily_limit_cents = dailyBudget;
      }
      if (monthlyBudget) {
        budgetPolicyJson.monthly_limit_cents = monthlyBudget;
      }
      budgetPolicyJson.warn_percent = parsePositiveInt(agentForm.warnPercent, 80);

      return createAutomationAgent({
        name: agentForm.name.trim(),
        role: agentForm.role as 'orchestrator' | 'worker',
        provider: agentForm.provider as AutomationAgent['provider'],
        default_cwd: agentForm.defaultCwd.trim() || undefined,
        fixed_host_id: agentForm.fixedHostId || undefined,
        max_parallel_runs: parsePositiveInt(agentForm.maxParallelRuns, 1),
        wake_policy_json: Object.keys(wakePolicyJson).length > 0 ? wakePolicyJson : undefined,
        budget_policy_json: Object.keys(budgetPolicyJson).length > 0 ? budgetPolicyJson : undefined,
      });
    },
    onSuccess: () => {
      setAgentForm({
        name: '',
        role: 'orchestrator',
        provider: 'codex',
        defaultCwd: '',
        fixedHostId: '',
        intervalMinutes: '',
        scheduledObjective: '',
        concurrencyPolicy: 'coalesce_if_active',
        maxParallelRuns: '1',
        dailyBudgetUsd: '',
        monthlyBudgetUsd: '',
        warnPercent: '80',
      });
      void queryClient.invalidateQueries({ queryKey: ['automation', 'agents'] });
    },
  });

  const wakeAgentMutation = useMutation({
    mutationFn: async (input: { agentId: string; repoId?: string; objective?: string; idempotencyKey?: string }) =>
      wakeAutomationAgent(input.agentId, {
        source: 'manual',
        repo_id: input.repoId || undefined,
        idempotency_key: input.idempotencyKey || undefined,
        context_json: input.objective?.trim() ? { objective: input.objective.trim() } : undefined,
      }),
    onSuccess: () => {
      setWakeForm({ agentId: '', repoId: '', objective: '', idempotencyKey: '' });
      void queryClient.invalidateQueries({ queryKey: ['automation', 'wakeups'] });
      void queryClient.invalidateQueries({ queryKey: ['automation', 'runs'] });
    },
  });

  const toggleAgentMutation = useMutation({
    mutationFn: async (agent: AutomationAgent) =>
      updateAutomationAgent(agent.id, {
        status: agent.status === 'active' ? 'paused' : 'active',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['automation', 'agents'] });
    },
  });

  const decideApprovalMutation = useMutation({
    mutationFn: async (input: { approvalId: string; decision: 'approved' | 'denied' }) =>
      decideGovernanceApproval(input.approvalId, { decision: input.decision }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['automation', 'governance-approvals'] });
    },
  });

  const createWorkItemMutation = useMutation({
    mutationFn: async () =>
      createWorkItem({
        repo_id: workForm.repoId || undefined,
        title: workForm.title.trim(),
        objective: workForm.objective.trim(),
        priority: Number.parseInt(workForm.priority, 10) || 0,
        assigned_automation_agent_id: workForm.assignedAutomationAgentId || undefined,
        dedupe_key: workForm.dedupeKey.trim() || undefined,
      }),
    onSuccess: () => {
      setWorkForm({
        repoId: '',
        title: '',
        objective: '',
        priority: '0',
        assignedAutomationAgentId: '',
        dedupeKey: '',
      });
      void queryClient.invalidateQueries({ queryKey: ['automation', 'work-items'] });
    },
  });

  const updateWorkItemMutation = useMutation({
    mutationFn: async (input: { workItemId: string; status: WorkItem['status'] }) =>
      updateWorkItem(input.workItemId, { status: input.status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['automation', 'work-items'] });
    },
  });

  const activeRunsCount = runs.filter((run) => ['starting', 'running'].includes(run.status)).length;
  const queuedWakeupsCount = wakeups.filter((wakeup) => ['queued', 'running', 'blocked'].includes(wakeup.status)).length;
  const activeAgentsCount = agents.filter((agent) => agent.status === 'active').length;
  const queuedWorkCount = workItems.filter((item) => ['queued', 'in_progress', 'blocked'].includes(item.status)).length;

  if (agentsLoading && agents.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (agentsError) {
    const message = agentsError instanceof Error ? agentsError.message : 'Unknown error';
    return (
      <div className="container mx-auto px-4 py-6 text-center">
        <p className="text-destructive mb-2">Failed to load automation data</p>
        <p className="text-xs text-muted-foreground mb-4">{message}</p>
        <Button onClick={refetchAll}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Workflow className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">Automation</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Orchestrator agents, wake queue, governance approvals, and worker work items.
          </p>
        </div>
        <Button variant="outline" onClick={refetchAll} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Active Agents</p>
            <p className="text-2xl font-bold">{activeAgentsCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Active Runs</p>
            <p className="text-2xl font-bold">{activeRunsCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Wake Queue</p>
            <p className="text-2xl font-bold">{queuedWakeupsCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Open Work</p>
            <p className="text-2xl font-bold">{queuedWorkCount}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Create Automation Agent</CardTitle>
            <CardDescription>Keep the form narrow: runtime, schedule, and budget only.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="agent-name">Name</Label>
                <Input
                  id="agent-name"
                  value={agentForm.name}
                  onChange={(event) => setAgentForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Repo orchestrator"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="agent-role">Role</Label>
                <select
                  id="agent-role"
                  className={selectClassName}
                  value={agentForm.role}
                  onChange={(event) => setAgentForm((current) => ({ ...current, role: event.target.value }))}
                >
                  <option value="orchestrator">Orchestrator</option>
                  <option value="worker">Worker</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="agent-provider">Provider</Label>
                <select
                  id="agent-provider"
                  className={selectClassName}
                  value={agentForm.provider}
                  onChange={(event) => setAgentForm((current) => ({ ...current, provider: event.target.value }))}
                >
                  {providerOptions.map((provider) => (
                    <option key={provider} value={provider}>
                      {getProviderDisplayName(provider)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="agent-host">Pinned Host</Label>
                <select
                  id="agent-host"
                  className={selectClassName}
                  value={agentForm.fixedHostId}
                  onChange={(event) => setAgentForm((current) => ({ ...current, fixedHostId: event.target.value }))}
                >
                  <option value="">Auto-select</option>
                  {hosts.map((host) => (
                    <option key={host.id} value={host.id}>
                      {host.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="agent-cwd">Default Working Directory</Label>
                <Input
                  id="agent-cwd"
                  value={agentForm.defaultCwd}
                  onChange={(event) => setAgentForm((current) => ({ ...current, defaultCwd: event.target.value }))}
                  placeholder="/home/cvsloane/dev/agent-command"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="agent-interval">Schedule Interval (minutes)</Label>
                <Input
                  id="agent-interval"
                  type="number"
                  min="0"
                  value={agentForm.intervalMinutes}
                  onChange={(event) => setAgentForm((current) => ({ ...current, intervalMinutes: event.target.value }))}
                  placeholder="60"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="agent-parallelism">Max Parallel Runs</Label>
                <Input
                  id="agent-parallelism"
                  type="number"
                  min="1"
                  value={agentForm.maxParallelRuns}
                  onChange={(event) => setAgentForm((current) => ({ ...current, maxParallelRuns: event.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="agent-concurrency-policy">Concurrency Policy</Label>
                <select
                  id="agent-concurrency-policy"
                  className={selectClassName}
                  value={agentForm.concurrencyPolicy}
                  onChange={(event) => setAgentForm((current) => ({ ...current, concurrencyPolicy: event.target.value }))}
                >
                  <option value="coalesce_if_active">Coalesce if active</option>
                  <option value="always_enqueue">Always enqueue</option>
                  <option value="skip_if_active">Skip if active</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="agent-daily-budget">Daily Limit ($)</Label>
                <Input
                  id="agent-daily-budget"
                  type="number"
                  min="0"
                  step="0.01"
                  value={agentForm.dailyBudgetUsd}
                  onChange={(event) => setAgentForm((current) => ({ ...current, dailyBudgetUsd: event.target.value }))}
                  placeholder="10.00"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="agent-monthly-budget">Monthly Limit ($)</Label>
                <Input
                  id="agent-monthly-budget"
                  type="number"
                  min="0"
                  step="0.01"
                  value={agentForm.monthlyBudgetUsd}
                  onChange={(event) => setAgentForm((current) => ({ ...current, monthlyBudgetUsd: event.target.value }))}
                  placeholder="200.00"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="agent-warn-percent">Budget Warn %</Label>
                <Input
                  id="agent-warn-percent"
                  type="number"
                  min="1"
                  max="99"
                  value={agentForm.warnPercent}
                  onChange={(event) => setAgentForm((current) => ({ ...current, warnPercent: event.target.value }))}
                  placeholder="80"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="agent-objective">Scheduled Objective</Label>
              <Textarea
                id="agent-objective"
                value={agentForm.scheduledObjective}
                onChange={(event) => setAgentForm((current) => ({ ...current, scheduledObjective: event.target.value }))}
                placeholder="Review the repo, pick the highest leverage work item, and move it forward."
                className="min-h-[92px]"
              />
            </div>
            {createAgentMutation.error && (
              <p className="text-sm text-destructive">
                {createAgentMutation.error instanceof Error ? createAgentMutation.error.message : 'Failed to create automation agent'}
              </p>
            )}
            <Button
              onClick={() => createAgentMutation.mutate()}
              disabled={createAgentMutation.isPending || !agentForm.name.trim()}
              className="w-full"
            >
              {createAgentMutation.isPending ? 'Creating...' : 'Create Agent'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Wake Agent</CardTitle>
            <CardDescription>Manual kickoff for an agent, optionally pinned to a repo and objective.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="wake-agent-id">Agent</Label>
              <select
                id="wake-agent-id"
                className={selectClassName}
                value={wakeForm.agentId}
                onChange={(event) => setWakeForm((current) => ({ ...current, agentId: event.target.value }))}
              >
                <option value="">Select agent...</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="wake-repo-id">Repo</Label>
              <select
                id="wake-repo-id"
                className={selectClassName}
                value={wakeForm.repoId}
                onChange={(event) => setWakeForm((current) => ({ ...current, repoId: event.target.value }))}
              >
                <option value="">Global / no repo</option>
                {repos.map((repo) => (
                  <option key={repo.id} value={repo.id}>
                    {repoLabel(repo)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="wake-objective">Objective</Label>
              <Textarea
                id="wake-objective"
                value={wakeForm.objective}
                onChange={(event) => setWakeForm((current) => ({ ...current, objective: event.target.value }))}
                placeholder="Optional override objective for this wake."
                className="min-h-[92px]"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="wake-idempotency">Idempotency Key</Label>
              <Input
                id="wake-idempotency"
                value={wakeForm.idempotencyKey}
                onChange={(event) => setWakeForm((current) => ({ ...current, idempotencyKey: event.target.value }))}
                placeholder="deploy:nightly"
              />
            </div>
            {wakeAgentMutation.error && (
              <p className="text-sm text-destructive">
                {wakeAgentMutation.error instanceof Error ? wakeAgentMutation.error.message : 'Failed to queue wakeup'}
              </p>
            )}
            <Button
              onClick={() =>
                wakeAgentMutation.mutate({
                  agentId: wakeForm.agentId,
                  repoId: wakeForm.repoId || undefined,
                  objective: wakeForm.objective || undefined,
                  idempotencyKey: wakeForm.idempotencyKey || undefined,
                })
              }
              disabled={wakeAgentMutation.isPending || !wakeForm.agentId}
              className="w-full"
            >
              {wakeAgentMutation.isPending ? 'Queueing...' : 'Queue Wakeup'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Create Work Item</CardTitle>
            <CardDescription>Queue explicit worker work instead of relying only on free-form wakes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="work-repo-id">Repo</Label>
              <select
                id="work-repo-id"
                className={selectClassName}
                value={workForm.repoId}
                onChange={(event) => setWorkForm((current) => ({ ...current, repoId: event.target.value }))}
              >
                <option value="">Global / no repo</option>
                {repos.map((repo) => (
                  <option key={repo.id} value={repo.id}>
                    {repoLabel(repo)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="work-title">Title</Label>
              <Input
                id="work-title"
                value={workForm.title}
                onChange={(event) => setWorkForm((current) => ({ ...current, title: event.target.value }))}
                placeholder="Fix flaky automation session bootstrap"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="work-objective">Objective</Label>
              <Textarea
                id="work-objective"
                value={workForm.objective}
                onChange={(event) => setWorkForm((current) => ({ ...current, objective: event.target.value }))}
                placeholder="Investigate the failing spawn path and ship a fix with verification."
                className="min-h-[92px]"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="work-priority">Priority</Label>
                <Input
                  id="work-priority"
                  type="number"
                  value={workForm.priority}
                  onChange={(event) => setWorkForm((current) => ({ ...current, priority: event.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="work-assignee">Assigned Agent</Label>
                <select
                  id="work-assignee"
                  className={selectClassName}
                  value={workForm.assignedAutomationAgentId}
                  onChange={(event) => setWorkForm((current) => ({ ...current, assignedAutomationAgentId: event.target.value }))}
                >
                  <option value="">Unassigned</option>
                  {agents
                    .filter((agent) => agent.role === 'worker')
                    .map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="work-dedupe">Dedupe Key</Label>
              <Input
                id="work-dedupe"
                value={workForm.dedupeKey}
                onChange={(event) => setWorkForm((current) => ({ ...current, dedupeKey: event.target.value }))}
                placeholder="bootstrap-fix"
              />
            </div>
            {createWorkItemMutation.error && (
              <p className="text-sm text-destructive">
                {createWorkItemMutation.error instanceof Error ? createWorkItemMutation.error.message : 'Failed to create work item'}
              </p>
            )}
            <Button
              onClick={() => createWorkItemMutation.mutate()}
              disabled={createWorkItemMutation.isPending || !workForm.title.trim() || !workForm.objective.trim()}
              className="w-full"
            >
              {createWorkItemMutation.isPending ? 'Creating...' : 'Create Work Item'}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="agents" className="space-y-4">
        <TabsList>
          <TabsTrigger value="agents">Agents</TabsTrigger>
          <TabsTrigger value="wakeups">Wake Queue</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="approvals">Approvals</TabsTrigger>
          <TabsTrigger value="work-items">Work Items</TabsTrigger>
        </TabsList>

        <TabsContent value="agents" className="space-y-4">
          {agents.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                No automation agents configured yet.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {agents.map((agent) => {
                const fixedHost = agent.fixed_host_id ? hostMap.get(agent.fixed_host_id) : null;
                return (
                  <Card key={agent.id}>
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Bot className="h-4 w-4 text-primary" />
                            <CardTitle className="text-lg">{agent.name}</CardTitle>
                          </div>
                          <CardDescription>
                            {agent.role} · {getProviderDisplayName(agent.provider)}
                          </CardDescription>
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {agent.preflight && (
                            <Badge variant={getBadgeVariant(agent.preflight.status)}>
                              preflight {agent.preflight.status}
                            </Badge>
                          )}
                          <Badge variant={getBadgeVariant(agent.status)}>{agent.status}</Badge>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div>
                          <p className="text-muted-foreground">Schedule</p>
                          <p>{describeSchedule(agent.wake_policy_json as Record<string, unknown>)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Concurrency</p>
                          <p>{describeConcurrency(agent.wake_policy_json as Record<string, unknown>)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Budget</p>
                          <p>{describeBudget(agent.budget_policy_json as Record<string, unknown>)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Runtime</p>
                          <p>{describeRuntime(agent)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Working Dir</p>
                          <p className="truncate">{agent.default_cwd || 'Auto from repo'}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Pinned Host</p>
                          <p>{fixedHost?.name || 'Auto-select'}</p>
                        </div>
                      </div>
                      {agent.runtime_state?.active_session_id && (
                        <div className="text-sm">
                          <Link
                            href={`/sessions/${agent.runtime_state.active_session_id}`}
                            className="text-primary hover:underline"
                          >
                            Open active runtime session
                          </Link>
                        </div>
                      )}
                      {agent.preflight && agent.preflight.issues.length > 0 && (
                        <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-2">
                          {agent.preflight.issues.map((issue) => (
                            <div key={`${agent.id}-${issue.code}-${issue.message}`} className="flex items-start gap-2">
                              <AlertTriangle className={`mt-0.5 h-3.5 w-3.5 ${issue.level === 'error' ? 'text-destructive' : 'text-orange-500'}`} />
                              <p className="text-xs text-muted-foreground">{issue.message}</p>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          onClick={() => wakeAgentMutation.mutate({ agentId: agent.id })}
                          disabled={wakeAgentMutation.isPending}
                          className="gap-1"
                        >
                          <Play className="h-3.5 w-3.5" />
                          Wake Now
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => toggleAgentMutation.mutate(agent)}
                          disabled={toggleAgentMutation.isPending}
                          className="gap-1"
                        >
                          {agent.status === 'active' ? (
                            <>
                              <Pause className="h-3.5 w-3.5" />
                              Pause
                            </>
                          ) : (
                            <>
                              <Play className="h-3.5 w-3.5" />
                              Resume
                            </>
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="wakeups" className="space-y-4">
          {wakeups.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                No wakeups queued yet.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {wakeups.map((wakeup) => {
                const repo = wakeup.repo_id ? repoMap.get(wakeup.repo_id) : null;
                const agent = agentMap.get(wakeup.automation_agent_id);
                return (
                  <Card key={wakeup.id}>
                    <CardContent className="p-4 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge variant={getBadgeVariant(wakeup.status)}>{wakeup.status}</Badge>
                          <span className="font-medium">{agent?.name || wakeup.automation_agent_id}</span>
                          <span className="text-sm text-muted-foreground">via {wakeup.source}</span>
                        </div>
                        <span className="text-sm text-muted-foreground">
                          {wakeup.requested_at ? formatRelativeTime(wakeup.requested_at) : 'just now'}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <FolderGit2 className="h-3.5 w-3.5" />
                          {repo ? repoLabel(repo) : 'Global scope'}
                        </span>
                        {wakeup.idempotency_key && <span>dedupe: {wakeup.idempotency_key}</span>}
                        {wakeup.coalesced_into_run_id && <span>coalesced into run</span>}
                      </div>
                      <p className="text-sm">{describeWakeContext(wakeup)}</p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="runs" className="space-y-4">
          {runs.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                No automation runs yet.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {runs.map((run) => {
                const repo = run.repo_id ? repoMap.get(run.repo_id) : null;
                const agent = agentMap.get(run.automation_agent_id);
                return (
                  <Card key={run.id}>
                    <CardContent className="p-4 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge variant={getBadgeVariant(run.status)}>{run.status}</Badge>
                          <span className="font-medium">{agent?.name || run.automation_agent_id}</span>
                        </div>
                        <span className="text-sm text-muted-foreground">
                          {run.started_at ? formatRelativeTime(run.started_at) : 'just now'}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        <span>{repo ? repoLabel(repo) : 'Global scope'}</span>
                        {run.session_id && (
                          <Link href={`/sessions/${run.session_id}`} className="text-primary hover:underline">
                            Session
                          </Link>
                        )}
                        {Array.isArray(run.pending_followups_json) && run.pending_followups_json.length > 0 && (
                          <span>{run.pending_followups_json.length} pending follow-up{run.pending_followups_json.length === 1 ? '' : 's'}</span>
                        )}
                        {typeof run.usage_json?.estimated_cost_cents === 'number' && (
                          <span>${(run.usage_json.estimated_cost_cents / 100).toFixed(2)} cost</span>
                        )}
                      </div>
                      <p className="text-sm">{describeRunSummary(run)}</p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant={selectedRunId === run.id ? 'default' : 'outline'}
                          onClick={() => setSelectedRunId((current) => current === run.id ? null : run.id)}
                        >
                          {selectedRunId === run.id ? 'Hide Timeline' : 'Show Timeline'}
                        </Button>
                      </div>
                      {selectedRunId === run.id && (
                        <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-2">
                          {runEvents.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No run events yet.</p>
                          ) : (
                            runEvents.map((event) => (
                              <div key={`${event.automation_run_id}-${event.seq}`} className="space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge variant={eventBadgeVariant(event.level)}>{event.level}</Badge>
                                  <span className="text-xs font-medium">{event.event_type}</span>
                                  <span className="text-xs text-muted-foreground">
                                    {event.created_at ? formatRelativeTime(event.created_at) : 'just now'}
                                  </span>
                                </div>
                                <p className="text-xs text-muted-foreground">{event.message}</p>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="approvals" className="space-y-4">
          {approvals.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                No pending governance approvals.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {approvals.map((approval) => {
                const agent = agentMap.get(approval.automation_agent_id);
                return (
                  <Card key={approval.id}>
                    <CardContent className="p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <ShieldAlert className="h-4 w-4 text-orange-500" />
                          <span className="font-medium">{agent?.name || approval.automation_agent_id}</span>
                          <Badge variant={getBadgeVariant(approval.status)}>{approval.type}</Badge>
                        </div>
                        <span className="text-sm text-muted-foreground">
                          {approval.requested_at ? formatRelativeTime(approval.requested_at) : 'just now'}
                        </span>
                      </div>
                      <p className="text-sm">{describeApproval(approval)}</p>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() =>
                            decideApprovalMutation.mutate({ approvalId: approval.id, decision: 'approved' })
                          }
                          disabled={decideApprovalMutation.isPending}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            decideApprovalMutation.mutate({ approvalId: approval.id, decision: 'denied' })
                          }
                          disabled={decideApprovalMutation.isPending}
                        >
                          Deny
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="work-items" className="space-y-4">
          {workItems.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                No work items queued.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {workItems.map((item) => {
                const repo = item.repo_id ? repoMap.get(item.repo_id) : null;
                const agent = item.assigned_automation_agent_id
                  ? agentMap.get(item.assigned_automation_agent_id)
                  : null;
                return (
                  <Card key={item.id}>
                    <CardContent className="p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge variant={getBadgeVariant(item.status)}>{item.status}</Badge>
                          <span className="font-medium">{item.title}</span>
                        </div>
                        <span className="text-sm text-muted-foreground">
                          priority {item.priority}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        <span>{repo ? repoLabel(repo) : 'Global scope'}</span>
                        <span>{agent ? `Assigned to ${agent.name}` : 'Unassigned'}</span>
                        <span>{describeWorkItemStatus(item)}</span>
                        <span>{item.updated_at ? formatRelativeTime(item.updated_at) : 'just now'}</span>
                      </div>
                      <p className="text-sm">{item.objective}</p>
                      <div className="flex flex-wrap gap-2">
                        {item.status !== 'queued' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateWorkItemMutation.mutate({ workItemId: item.id, status: 'queued' })}
                            disabled={updateWorkItemMutation.isPending}
                          >
                            Requeue
                          </Button>
                        )}
                        {item.status !== 'blocked' && item.status !== 'done' && item.status !== 'cancelled' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateWorkItemMutation.mutate({ workItemId: item.id, status: 'blocked' })}
                            disabled={updateWorkItemMutation.isPending}
                          >
                            Block
                          </Button>
                        )}
                        {item.status !== 'done' && (
                          <Button
                            size="sm"
                            onClick={() => updateWorkItemMutation.mutate({ workItemId: item.id, status: 'done' })}
                            disabled={updateWorkItemMutation.isPending}
                          >
                            Done
                          </Button>
                        )}
                        {item.status !== 'cancelled' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateWorkItemMutation.mutate({ workItemId: item.id, status: 'cancelled' })}
                            disabled={updateWorkItemMutation.isPending}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
