'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, RefreshCw, Workflow } from 'lucide-react';
import type {
  AutomationAgent,
  AutomationRun,
  AutomationWakeup,
  GovernanceApproval,
  Host,
  Repo,
  ServerToUIMessage,
  WorkItem,
} from '@agent-command/schema';
import { AutomationActionSheets } from '@/components/automation/AutomationActionSheets';
import { AutomationOverview } from '@/components/automation/AutomationOverview';
import { AutomationTabs } from '@/components/automation/AutomationTabs';
import {
  AUTOMATION_TABS,
  type AutomationSheetKind,
  type AutomationTab,
} from '@/components/automation/automationUi';
import { Button } from '@/components/ui/button';
import { useWebSocket } from '@/hooks/useWebSocket';
import {
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

const EMPTY_AGENTS: AutomationAgent[] = [];
const EMPTY_RUNS: AutomationRun[] = [];
const EMPTY_WAKEUPS: AutomationWakeup[] = [];
const EMPTY_APPROVALS: GovernanceApproval[] = [];
const EMPTY_WORK_ITEMS: WorkItem[] = [];
const EMPTY_REPOS: Repo[] = [];
const EMPTY_HOSTS: Host[] = [];

export default function AutomationPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [openSheet, setOpenSheet] = useState<AutomationSheetKind>(null);
  const [nudgeAgent, setNudgeAgent] = useState<AutomationAgent | null>(null);

  const selectedRunId = searchParams.get('run');
  const tabParam = searchParams.get('tab');
  const tab: AutomationTab = AUTOMATION_TABS.includes(tabParam as AutomationTab)
    ? tabParam as AutomationTab
    : selectedRunId ? 'runs' : 'agents';

  const updateParams = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const query = params.toString();
    router.replace(`/automation${query ? `?${query}` : ''}`, { scroll: false });
  }, [router, searchParams]);

  const agentsQuery = useQuery({
    queryKey: ['automation', 'agents'],
    queryFn: getAutomationAgents,
    refetchInterval: 15_000,
  });
  const runsQuery = useQuery({
    queryKey: ['automation', 'runs'],
    queryFn: () => getAutomationRuns({ limit: 100 }),
    refetchInterval: 15_000,
  });
  const runEventsQuery = useQuery({
    queryKey: ['automation', 'run-events', selectedRunId],
    queryFn: () => getAutomationRunEvents(selectedRunId!),
    enabled: Boolean(selectedRunId),
    refetchInterval: selectedRunId ? 15_000 : false,
  });
  const wakeupsQuery = useQuery({
    queryKey: ['automation', 'wakeups'],
    queryFn: () => getAutomationWakeups({ limit: 50 }),
    refetchInterval: 15_000,
  });
  const approvalsQuery = useQuery({
    queryKey: ['automation', 'governance-approvals'],
    queryFn: () => getGovernanceApprovals({ status: 'pending' }),
    refetchInterval: 15_000,
  });
  const workItemsQuery = useQuery({
    queryKey: ['automation', 'work-items'],
    queryFn: () => getWorkItems({ limit: 100 }),
    refetchInterval: 15_000,
  });
  const reposQuery = useQuery({
    queryKey: ['repos', 'automation'],
    queryFn: () => getRepos({ limit: 100 }),
  });
  const hostsQuery = useQuery({ queryKey: ['hosts', 'automation'], queryFn: getHosts });

  const agents = agentsQuery.data?.agents ?? EMPTY_AGENTS;
  const runs = runsQuery.data?.runs ?? EMPTY_RUNS;
  const wakeups = wakeupsQuery.data?.wakeups ?? EMPTY_WAKEUPS;
  const approvals = approvalsQuery.data?.approvals ?? EMPTY_APPROVALS;
  const workItems = workItemsQuery.data?.work_items ?? EMPTY_WORK_ITEMS;
  const repos = reposQuery.data?.repos ?? EMPTY_REPOS;
  const hosts = hostsQuery.data?.hosts ?? EMPTY_HOSTS;
  const runEvents = runEventsQuery.data?.events ?? [];

  const invalidate = useCallback((key: string) => {
    void queryClient.invalidateQueries({ queryKey: ['automation', key] });
  }, [queryClient]);

  const handleAutomationMessage = useCallback((message: ServerToUIMessage) => {
    if (message.type === 'automation.run.updated') invalidate('runs');
    else if (message.type === 'automation.run.event') invalidate('run-events');
    else if (message.type === 'automation.runtime_state.updated') invalidate('agents');
    else if (message.type === 'automation.wakeup.updated') invalidate('wakeups');
    else if (message.type === 'governance_approval.updated') invalidate('governance-approvals');
    else if (message.type === 'work_item.updated') invalidate('work-items');
  }, [invalidate]);

  useWebSocket([
    { type: 'automation_runs' },
    ...(selectedRunId
      ? [{ type: 'automation_run_events' as const, filter: { automation_run_id: selectedRunId } }]
      : []),
    { type: 'automation_wakeups' },
    { type: 'governance_approvals' },
    { type: 'work_items' },
  ], handleAutomationMessage);

  const wakeMutation = useMutation({
    mutationFn: (agent: AutomationAgent) => wakeAutomationAgent(agent.id, { source: 'manual' }),
    onSuccess: () => { invalidate('wakeups'); invalidate('runs'); },
  });
  const toggleMutation = useMutation({
    mutationFn: (agent: AutomationAgent) => updateAutomationAgent(agent.id, {
      status: agent.status === 'active' ? 'paused' : 'active',
    }),
    onSuccess: () => invalidate('agents'),
  });
  const approvalMutation = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approved' | 'denied' }) =>
      decideGovernanceApproval(id, { decision }),
    onSuccess: () => invalidate('governance-approvals'),
  });
  const workMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: WorkItem['status'] }) =>
      updateWorkItem(id, { status }),
    onSuccess: () => invalidate('work-items'),
  });

  const refetchAll = useCallback(async () => {
    await Promise.all([
      agentsQuery.refetch(), runsQuery.refetch(), wakeupsQuery.refetch(), approvalsQuery.refetch(),
      workItemsQuery.refetch(), reposQuery.refetch(), hostsQuery.refetch(),
      ...(selectedRunId ? [runEventsQuery.refetch()] : []),
    ]);
  }, [agentsQuery, approvalsQuery, hostsQuery, reposQuery, runEventsQuery, runsQuery, selectedRunId, wakeupsQuery, workItemsQuery]);

  const metrics = useMemo(() => [
    { label: 'Active agents', value: agents.filter((agent) => agent.status === 'active').length },
    { label: 'Active runs', value: runs.filter((run) => ['starting', 'running'].includes(run.status)).length },
    { label: 'Wake queue', value: wakeups.filter((wakeup) => ['queued', 'running', 'blocked'].includes(wakeup.status)).length },
    { label: 'Open work', value: workItems.filter((item) => ['queued', 'in_progress', 'blocked'].includes(item.status)).length },
  ], [agents, runs, wakeups, workItems]);
  const partialErrorSources: string[] = [];
  if (runsQuery.error) partialErrorSources.push('runs');
  if (wakeupsQuery.error) partialErrorSources.push('wakeups');
  if (approvalsQuery.error) partialErrorSources.push('approvals');
  if (workItemsQuery.error) partialErrorSources.push('work items');
  if (reposQuery.error) partialErrorSources.push('repos');
  if (hostsQuery.error) partialErrorSources.push('hosts');
  if (selectedRunId && runEventsQuery.error) partialErrorSources.push('selected run timeline');
  const actionErrors = [wakeMutation.error, toggleMutation.error, approvalMutation.error, workMutation.error]
    .filter((error): error is Error => error instanceof Error);
  const busy = wakeMutation.isPending || toggleMutation.isPending || approvalMutation.isPending || workMutation.isPending;

  if (agentsQuery.isLoading && agents.length === 0) {
    return <div className="mx-auto flex w-full max-w-7xl items-center justify-center px-3 py-16 text-sm text-muted-foreground sm:px-4" role="status">Loading automation agents…</div>;
  }
  if (agentsQuery.error) {
    return (
      <div className="mx-auto w-full max-w-7xl px-3 py-12 text-center sm:px-4">
        <p className="font-medium text-destructive">Failed to load automation data</p>
        <p className="mt-1 text-sm text-muted-foreground">{agentsQuery.error.message}</p>
        <Button size="mobile" className="mt-4" onClick={() => void refetchAll()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 px-3 py-4 sm:px-4 sm:py-6">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Workflow className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold sm:text-2xl">Automation</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Manage agents, wakeups, approvals, runs, and durable work.</p>
        </div>
        <Button variant="outline" size="mobile-icon" onClick={() => void refetchAll()} aria-label="Refresh automation">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </header>

      {partialErrorSources.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Unavailable sources: {partialErrorSources.join(', ')}. Available data is shown below.</span>
        </div>
      )}
      {actionErrors.length > 0 && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          {actionErrors[0]?.message || 'The automation action failed. Try again.'}
        </div>
      )}

      <AutomationOverview
        metrics={metrics}
        onCreateAgent={() => setOpenSheet('agent')}
        onWakeAgent={() => setOpenSheet('wake')}
        onCreateWork={() => setOpenSheet('work')}
      />

      <AutomationTabs
        tab={tab}
        onTabChange={(nextTab) => updateParams({ tab: nextTab === 'agents' ? null : nextTab, run: nextTab === 'runs' ? selectedRunId : null })}
        agents={agents}
        runs={runs}
        wakeups={wakeups}
        approvals={approvals}
        workItems={workItems}
        repos={repos}
        hosts={hosts}
        selectedRunId={selectedRunId}
        runEvents={runEvents}
        runEventsLoading={runEventsQuery.isLoading}
        runEventsError={runEventsQuery.error}
        hostsUnavailable={Boolean(hostsQuery.error)}
        busy={busy}
        onSelectRun={(runId) => updateParams({ tab: 'runs', run: runId })}
        onWake={(agent) => wakeMutation.mutate(agent)}
        onToggleAgent={(agent) => toggleMutation.mutate(agent)}
        onNudge={(agent) => { setNudgeAgent(agent); setOpenSheet('nudge'); }}
        onDecideApproval={(id, decision) => approvalMutation.mutate({ id, decision })}
        onUpdateWorkItem={(id, status) => workMutation.mutate({ id, status })}
      />

      <AutomationActionSheets
        open={openSheet}
        agents={agents}
        repos={repos}
        hosts={hosts}
        reposLoading={reposQuery.isLoading}
        hostsLoading={hostsQuery.isLoading}
        reposError={reposQuery.error}
        hostsError={hostsQuery.error}
        nudgeAgent={nudgeAgent}
        onClose={() => { setOpenSheet(null); setNudgeAgent(null); }}
      />
    </div>
  );
}
