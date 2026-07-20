'use client';

import Link from 'next/link';
import { FolderGit2, ShieldAlert } from 'lucide-react';
import type {
  AutomationAgent,
  AutomationRun,
  AutomationRunEvent,
  AutomationWakeup,
  GovernanceApproval,
  Host,
  Repo,
  WorkItem,
} from '@agent-command/schema';
import { AutomationAgentCard } from './AutomationAgentCard';
import {
  describeApproval,
  describeRunSummary,
  describeWakeContext,
  describeWorkItemStatus,
  eventBadgeVariant,
  getAutomationBadgeVariant,
  repoLabel,
  type AutomationTab,
} from './automationUi';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatRelativeTime } from '@/lib/utils';

interface AutomationTabsProps {
  tab: AutomationTab;
  onTabChange: (tab: AutomationTab) => void;
  agents: AutomationAgent[];
  runs: AutomationRun[];
  wakeups: AutomationWakeup[];
  approvals: GovernanceApproval[];
  workItems: WorkItem[];
  repos: Repo[];
  hosts: Host[];
  selectedRunId: string | null;
  runEvents: AutomationRunEvent[];
  runEventsLoading: boolean;
  runEventsError: Error | null;
  hostsUnavailable: boolean;
  busy: boolean;
  onSelectRun: (runId: string | null) => void;
  onWake: (agent: AutomationAgent) => void;
  onToggleAgent: (agent: AutomationAgent) => void;
  onNudge: (agent: AutomationAgent) => void;
  onDecideApproval: (approvalId: string, decision: 'approved' | 'denied') => void;
  onUpdateWorkItem: (workItemId: string, status: WorkItem['status']) => void;
}

function EmptyPanel({ children }: { children: string }) {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function RunTimeline({
  events,
  loading,
  error,
}: {
  events: AutomationRunEvent[];
  loading: boolean;
  error: Error | null;
}) {
  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          Run timeline unavailable: {error.message}
        </p>
      ) : loading ? (
        <p className="text-xs text-muted-foreground">Loading run events…</p>
      ) : events.length === 0 ? (
        <p className="text-xs text-muted-foreground">No run events yet.</p>
      ) : events.map((event) => (
        <div key={`${event.automation_run_id}-${event.seq}`} className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={eventBadgeVariant(event.level)}>{event.level}</Badge>
            <span className="text-xs font-medium">{event.event_type}</span>
            <span className="text-xs text-muted-foreground" suppressHydrationWarning>
              {event.created_at ? formatRelativeTime(event.created_at) : 'just now'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{event.message}</p>
        </div>
      ))}
    </div>
  );
}

export function AutomationTabs({
  tab,
  onTabChange,
  agents,
  runs,
  wakeups,
  approvals,
  workItems,
  repos,
  hosts,
  selectedRunId,
  runEvents,
  runEventsLoading,
  runEventsError,
  hostsUnavailable,
  busy,
  onSelectRun,
  onWake,
  onToggleAgent,
  onNudge,
  onDecideApproval,
  onUpdateWorkItem,
}: AutomationTabsProps) {
  const repoMap = new Map(repos.map((repo) => [repo.id, repo]));
  const hostMap = new Map(hosts.map((host) => [host.id, host]));
  const agentMap = new Map(agents.map((agent) => [agent.id, agent]));
  const selectedRunMissing = Boolean(
    selectedRunId && !runs.some((run) => run.id === selectedRunId)
  );

  return (
    <Tabs value={tab} onValueChange={(value) => onTabChange(value as AutomationTab)} className="space-y-4">
      <div className="-mx-3 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
        <TabsList className="h-11 min-w-max justify-start">
          <TabsTrigger value="agents" className="h-9">Agents</TabsTrigger>
          <TabsTrigger value="wakeups" className="h-9">Wake queue</TabsTrigger>
          <TabsTrigger value="runs" className="h-9">Runs</TabsTrigger>
          <TabsTrigger value="approvals" className="h-9">Approvals</TabsTrigger>
          <TabsTrigger value="work-items" className="h-9">Work items</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="agents" className="space-y-4">
        {agents.length === 0 ? <EmptyPanel>No automation agents configured yet.</EmptyPanel> : (
          <div className="grid gap-4 xl:grid-cols-2">
            {agents.map((agent) => (
              <AutomationAgentCard
                key={agent.id}
                agent={agent}
                host={agent.fixed_host_id ? hostMap.get(agent.fixed_host_id) : undefined}
                hostsUnavailable={hostsUnavailable}
                runs={runs}
                busy={busy}
                onWake={onWake}
                onToggle={onToggleAgent}
                onNudge={onNudge}
              />
            ))}
          </div>
        )}
      </TabsContent>

      <TabsContent value="wakeups" className="space-y-3">
        {wakeups.length === 0 ? <EmptyPanel>No wakeups queued yet.</EmptyPanel> : wakeups.map((wakeup) => {
          const repo = wakeup.repo_id ? repoMap.get(wakeup.repo_id) : null;
          const agent = agentMap.get(wakeup.automation_agent_id);
          return (
            <Card key={wakeup.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={getAutomationBadgeVariant(wakeup.status)}>{wakeup.status}</Badge>
                    <span className="font-medium">{agent?.name || wakeup.automation_agent_id}</span>
                    <span className="text-sm text-muted-foreground">via {wakeup.source}</span>
                  </div>
                  <span className="text-xs text-muted-foreground" suppressHydrationWarning>
                    {wakeup.requested_at ? formatRelativeTime(wakeup.requested_at) : 'just now'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><FolderGit2 className="h-3.5 w-3.5" />{repo ? repoLabel(repo) : 'Global scope'}</span>
                  {wakeup.idempotency_key && <span>dedupe: {wakeup.idempotency_key}</span>}
                </div>
                <p className="text-sm">{describeWakeContext(wakeup)}</p>
              </CardContent>
            </Card>
          );
        })}
      </TabsContent>

      <TabsContent value="runs" className="space-y-3">
        {selectedRunMissing && (
          <Card>
            <CardContent className="space-y-3 p-4">
              <div>
                <p className="font-medium">Linked run timeline</p>
                <p className="mt-1 break-all text-xs text-muted-foreground">{selectedRunId}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  This run is outside the recent run list, but its event timeline remains available.
                </p>
              </div>
              <RunTimeline events={runEvents} loading={runEventsLoading} error={runEventsError} />
              <Button size="mobile-sm" variant="outline" onClick={() => onSelectRun(null)}>
                Close timeline
              </Button>
            </CardContent>
          </Card>
        )}
        {runs.length === 0 ? <EmptyPanel>No automation runs yet.</EmptyPanel> : runs.map((run) => {
          const repo = run.repo_id ? repoMap.get(run.repo_id) : null;
          const agent = agentMap.get(run.automation_agent_id);
          return (
            <Card key={run.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={getAutomationBadgeVariant(run.status)}>{run.status}</Badge>
                    <span className="font-medium">{agent?.name || run.automation_agent_id}</span>
                  </div>
                  <span className="text-xs text-muted-foreground" suppressHydrationWarning>
                    {run.started_at ? formatRelativeTime(run.started_at) : 'just now'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{repo ? repoLabel(repo) : 'Global scope'}</span>
                  {run.session_id && (
                    <Link href={`/sessions/${run.session_id}`} className="text-primary hover:underline">Session</Link>
                  )}
                  {typeof run.usage_json?.estimated_cost_cents === 'number' && (
                    <span>${(run.usage_json.estimated_cost_cents / 100).toFixed(2)} cost</span>
                  )}
                </div>
                <p className="text-sm leading-relaxed">{describeRunSummary(run)}</p>
                <Button
                  size="mobile-sm"
                  variant={selectedRunId === run.id ? 'default' : 'outline'}
                  onClick={() => onSelectRun(selectedRunId === run.id ? null : run.id)}
                >
                  {selectedRunId === run.id ? 'Hide timeline' : 'Show timeline'}
                </Button>
                {selectedRunId === run.id && (
                  <RunTimeline events={runEvents} loading={runEventsLoading} error={runEventsError} />
                )}
              </CardContent>
            </Card>
          );
        })}
      </TabsContent>

      <TabsContent value="approvals" className="space-y-3">
        {approvals.length === 0 ? <EmptyPanel>No pending governance approvals.</EmptyPanel> : approvals.map((approval) => {
          const agent = agentMap.get(approval.automation_agent_id);
          return (
            <Card key={approval.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-amber-500" />
                    <span className="font-medium">{agent?.name || approval.automation_agent_id}</span>
                    <Badge variant={getAutomationBadgeVariant(approval.status)}>{approval.type}</Badge>
                  </div>
                  <span className="text-xs text-muted-foreground" suppressHydrationWarning>
                    {approval.requested_at ? formatRelativeTime(approval.requested_at) : 'just now'}
                  </span>
                </div>
                <p className="text-sm">{describeApproval(approval)}</p>
                <div className="grid grid-cols-2 gap-2 sm:flex">
                  <Button size="mobile-sm" onClick={() => onDecideApproval(approval.id, 'approved')} disabled={busy}>Approve</Button>
                  <Button size="mobile-sm" variant="outline" onClick={() => onDecideApproval(approval.id, 'denied')} disabled={busy}>Deny</Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </TabsContent>

      <TabsContent value="work-items" className="space-y-3">
        {workItems.length === 0 ? <EmptyPanel>No work items queued.</EmptyPanel> : workItems.map((item) => {
          const repo = item.repo_id ? repoMap.get(item.repo_id) : null;
          const agent = item.assigned_automation_agent_id ? agentMap.get(item.assigned_automation_agent_id) : null;
          return (
            <Card key={item.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={getAutomationBadgeVariant(item.status)}>{item.status}</Badge>
                    <span className="font-medium">{item.title}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">priority {item.priority}</span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{repo ? repoLabel(repo) : 'Global scope'}</span>
                  <span>{agent ? `Assigned to ${agent.name}` : 'Unassigned'}</span>
                  <span>{describeWorkItemStatus(item)}</span>
                </div>
                <p className="text-sm">{item.objective}</p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {item.status !== 'queued' && (
                    <Button size="mobile-sm" variant="outline" onClick={() => onUpdateWorkItem(item.id, 'queued')} disabled={busy}>Requeue</Button>
                  )}
                  {!['blocked', 'done', 'cancelled'].includes(item.status) && (
                    <Button size="mobile-sm" variant="outline" onClick={() => onUpdateWorkItem(item.id, 'blocked')} disabled={busy}>Block</Button>
                  )}
                  {item.status !== 'done' && (
                    <Button size="mobile-sm" onClick={() => onUpdateWorkItem(item.id, 'done')} disabled={busy}>Done</Button>
                  )}
                  {item.status !== 'cancelled' && (
                    <Button size="mobile-sm" variant="outline" onClick={() => onUpdateWorkItem(item.id, 'cancelled')} disabled={busy}>Cancel</Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </TabsContent>
    </Tabs>
  );
}
