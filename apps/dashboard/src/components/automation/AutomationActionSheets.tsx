'use client';

import { FormEvent, ReactNode, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, X } from 'lucide-react';
import type { AutomationAgent, Host, Repo } from '@agent-command/schema';
import {
  createAutomationAgent,
  createWorkItem,
  messageAutomationAgent,
  wakeAutomationAgent,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  centsFromDollars,
  positiveInt,
  providerOptions,
  repoLabel,
  selectClassName,
  type AutomationSheetKind,
} from './automationUi';
import { getProviderDisplayName } from '@/lib/utils';

interface SheetFrameProps {
  open: boolean;
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
}

function SheetFrame({ open, title, description, onClose, children }: SheetFrameProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l bg-background shadow-2xl focus:outline-none">
          <div className="flex items-start justify-between gap-4 border-b px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
            <div>
              <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">{description}</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button size="mobile-icon" variant="ghost" aria-label={`Close ${title}`}>
                <X className="h-5 w-5" />
              </Button>
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-6">
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface AutomationActionSheetsProps {
  open: AutomationSheetKind;
  agents: AutomationAgent[];
  repos: Repo[];
  hosts: Host[];
  reposLoading: boolean;
  hostsLoading: boolean;
  reposError: Error | null;
  hostsError: Error | null;
  nudgeAgent: AutomationAgent | null;
  onClose: () => void;
}

const initialAgentForm = {
  name: '', slug: '', role: 'orchestrator', provider: 'codex', defaultCwd: '', fixedHostId: '',
  intervalMinutes: '', scheduledObjective: '', schedulerMode: 'native', concurrencyPolicy: 'coalesce_if_active',
  catchUpPolicy: 'skip_missed', missedRunCap: '1', maxQueueDepth: '10', maxParallelRuns: '1',
  dailyBudgetUsd: '', monthlyBudgetUsd: '', warnPercent: '80',
};

export function AutomationActionSheets({
  open,
  agents,
  repos,
  hosts,
  reposLoading,
  hostsLoading,
  reposError,
  hostsError,
  nudgeAgent,
  onClose,
}: AutomationActionSheetsProps) {
  const queryClient = useQueryClient();
  const [agentForm, setAgentForm] = useState(initialAgentForm);
  const [wakeForm, setWakeForm] = useState({ agentId: '', repoId: '', objective: '', idempotencyKey: '' });
  const [workForm, setWorkForm] = useState({ repoId: '', title: '', objective: '', priority: '0', assignedAgentId: '', dedupeKey: '' });
  const [nudgeMessage, setNudgeMessage] = useState('');

  const createAgentMutation = useMutation({
    mutationFn: () => {
      const interval = positiveInt(agentForm.intervalMinutes, 0);
      const dailyLimit = centsFromDollars(agentForm.dailyBudgetUsd);
      const monthlyLimit = centsFromDollars(agentForm.monthlyBudgetUsd);
      return createAutomationAgent({
        name: agentForm.name.trim(),
        slug: agentForm.slug.trim() || undefined,
        role: agentForm.role as AutomationAgent['role'],
        provider: agentForm.provider as AutomationAgent['provider'],
        default_cwd: agentForm.defaultCwd.trim() || undefined,
        fixed_host_id: agentForm.fixedHostId || undefined,
        max_parallel_runs: positiveInt(agentForm.maxParallelRuns, 1),
        wake_policy_json: {
          ...(interval > 0 ? { interval_minutes: interval } : {}),
          ...(agentForm.scheduledObjective.trim() ? { objective: agentForm.scheduledObjective.trim() } : {}),
          scheduler_mode: agentForm.schedulerMode,
          concurrency_policy: agentForm.concurrencyPolicy,
          catch_up_policy: agentForm.catchUpPolicy,
          missed_run_cap: positiveInt(agentForm.missedRunCap, 1),
          max_queue_depth: positiveInt(agentForm.maxQueueDepth, 10),
        },
        budget_policy_json: {
          ...(dailyLimit ? { daily_limit_cents: dailyLimit } : {}),
          ...(monthlyLimit ? { monthly_limit_cents: monthlyLimit } : {}),
          warn_percent: positiveInt(agentForm.warnPercent, 80),
        },
      });
    },
    onSuccess: () => {
      setAgentForm(initialAgentForm);
      void queryClient.invalidateQueries({ queryKey: ['automation', 'agents'] });
      onClose();
    },
  });

  const wakeMutation = useMutation({
    mutationFn: () => wakeAutomationAgent(wakeForm.agentId, {
      source: 'manual',
      repo_id: wakeForm.repoId || undefined,
      idempotency_key: wakeForm.idempotencyKey.trim() || undefined,
      context_json: wakeForm.objective.trim() ? { objective: wakeForm.objective.trim() } : undefined,
    }),
    onSuccess: () => {
      setWakeForm({ agentId: '', repoId: '', objective: '', idempotencyKey: '' });
      void queryClient.invalidateQueries({ queryKey: ['automation', 'wakeups'] });
      void queryClient.invalidateQueries({ queryKey: ['automation', 'runs'] });
      onClose();
    },
  });

  const workMutation = useMutation({
    mutationFn: () => createWorkItem({
      repo_id: workForm.repoId || undefined,
      title: workForm.title.trim(),
      objective: workForm.objective.trim(),
      priority: Number.parseInt(workForm.priority, 10) || 0,
      assigned_automation_agent_id: workForm.assignedAgentId || undefined,
      dedupe_key: workForm.dedupeKey.trim() || undefined,
    }),
    onSuccess: () => {
      setWorkForm({ repoId: '', title: '', objective: '', priority: '0', assignedAgentId: '', dedupeKey: '' });
      void queryClient.invalidateQueries({ queryKey: ['automation', 'work-items'] });
      onClose();
    },
  });

  const nudgeMutation = useMutation({
    mutationFn: () => {
      if (!nudgeAgent) throw new Error('Choose an automation agent to nudge.');
      return messageAutomationAgent(nudgeAgent.slug, { message: nudgeMessage.trim(), enter: true });
    },
    onSuccess: () => {
      setNudgeMessage('');
      onClose();
    },
  });

  const closeNudgeSheet = () => {
    setNudgeMessage('');
    nudgeMutation.reset();
    onClose();
  };

  const mutationError = (mutation: { error: unknown }) => mutation.error instanceof Error
    ? mutation.error.message
    : 'The request failed. Try again.';

  return (
    <>
      <SheetFrame open={open === 'agent'} title="New automation agent" description="Configure runtime, scheduling, concurrency, and budget policy." onClose={onClose}>
        <form onSubmit={(event) => { event.preventDefault(); createAgentMutation.mutate(); }} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" id="agent-name"><Input id="agent-name" value={agentForm.name} onChange={(event) => setAgentForm((value) => ({ ...value, name: event.target.value }))} placeholder="Repo orchestrator" required /></Field>
            <Field label="Slug" id="agent-slug"><Input id="agent-slug" value={agentForm.slug} onChange={(event) => setAgentForm((value) => ({ ...value, slug: event.target.value }))} placeholder="repo-orchestrator" /></Field>
            <Field label="Role" id="agent-role"><select id="agent-role" className={selectClassName} value={agentForm.role} onChange={(event) => setAgentForm((value) => ({ ...value, role: event.target.value }))}><option value="orchestrator">Orchestrator</option><option value="worker">Worker</option></select></Field>
            <Field label="Provider" id="agent-provider"><select id="agent-provider" className={selectClassName} value={agentForm.provider} onChange={(event) => setAgentForm((value) => ({ ...value, provider: event.target.value }))}>{providerOptions.map((provider) => <option key={provider} value={provider}>{getProviderDisplayName(provider)}</option>)}</select></Field>
            <Field label="Pinned host" id="agent-host">
              <select id="agent-host" className={selectClassName} value={agentForm.fixedHostId} onChange={(event) => setAgentForm((value) => ({ ...value, fixedHostId: event.target.value }))} disabled={hostsLoading || Boolean(hostsError)}>
                <option value="">{hostsLoading ? 'Loading hosts…' : hostsError ? 'Hosts unavailable' : 'Auto-select'}</option>
                {hosts.map((host) => <option key={host.id} value={host.id}>{host.name}</option>)}
              </select>
              {hostsError && <p className="text-xs text-destructive" role="alert">Host choices could not be loaded.</p>}
            </Field>
            <Field label="Max parallel runs" id="agent-parallel"><Input id="agent-parallel" type="number" min="1" value={agentForm.maxParallelRuns} onChange={(event) => setAgentForm((value) => ({ ...value, maxParallelRuns: event.target.value }))} /></Field>
          </div>
          <Field label="Default working directory" id="agent-cwd"><Input id="agent-cwd" value={agentForm.defaultCwd} onChange={(event) => setAgentForm((value) => ({ ...value, defaultCwd: event.target.value }))} placeholder="/home/cvsloane/dev/agent-command" /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Interval (minutes)" id="agent-interval"><Input id="agent-interval" type="number" min="0" value={agentForm.intervalMinutes} onChange={(event) => setAgentForm((value) => ({ ...value, intervalMinutes: event.target.value }))} placeholder="60" /></Field>
            <Field label="Scheduler" id="agent-scheduler"><select id="agent-scheduler" className={selectClassName} value={agentForm.schedulerMode} onChange={(event) => setAgentForm((value) => ({ ...value, schedulerMode: event.target.value }))}><option value="native">Native</option><option value="external">External / Hermes</option><option value="hybrid">Hybrid</option></select></Field>
            <Field label="Concurrency" id="agent-concurrency"><select id="agent-concurrency" className={selectClassName} value={agentForm.concurrencyPolicy} onChange={(event) => setAgentForm((value) => ({ ...value, concurrencyPolicy: event.target.value }))}><option value="coalesce_if_active">Coalesce if active</option><option value="always_enqueue">Always enqueue</option><option value="skip_if_active">Skip if active</option></select></Field>
            <Field label="Catch-up" id="agent-catchup"><select id="agent-catchup" className={selectClassName} value={agentForm.catchUpPolicy} onChange={(event) => setAgentForm((value) => ({ ...value, catchUpPolicy: event.target.value }))}><option value="skip_missed">Skip missed intervals</option><option value="enqueue_missed_with_cap">Catch up with cap</option></select></Field>
            <Field label="Missed run cap" id="agent-missed-cap"><Input id="agent-missed-cap" type="number" min="1" value={agentForm.missedRunCap} onChange={(event) => setAgentForm((value) => ({ ...value, missedRunCap: event.target.value }))} /></Field>
            <Field label="Max queue depth" id="agent-queue-depth"><Input id="agent-queue-depth" type="number" min="1" value={agentForm.maxQueueDepth} onChange={(event) => setAgentForm((value) => ({ ...value, maxQueueDepth: event.target.value }))} /></Field>
            <Field label="Daily limit ($)" id="agent-daily"><Input id="agent-daily" type="number" min="0" step="0.01" value={agentForm.dailyBudgetUsd} onChange={(event) => setAgentForm((value) => ({ ...value, dailyBudgetUsd: event.target.value }))} /></Field>
            <Field label="Monthly limit ($)" id="agent-monthly"><Input id="agent-monthly" type="number" min="0" step="0.01" value={agentForm.monthlyBudgetUsd} onChange={(event) => setAgentForm((value) => ({ ...value, monthlyBudgetUsd: event.target.value }))} /></Field>
            <Field label="Warning threshold (%)" id="agent-warn"><Input id="agent-warn" type="number" min="1" max="99" value={agentForm.warnPercent} onChange={(event) => setAgentForm((value) => ({ ...value, warnPercent: event.target.value }))} /></Field>
          </div>
          <Field label="Scheduled objective" id="agent-objective"><Textarea id="agent-objective" value={agentForm.scheduledObjective} onChange={(event) => setAgentForm((value) => ({ ...value, scheduledObjective: event.target.value }))} className="min-h-24" /></Field>
          {createAgentMutation.error && <p className="text-sm text-destructive" role="alert">{mutationError(createAgentMutation)}</p>}
          <SubmitButton pending={createAgentMutation.isPending} label="Create agent" />
        </form>
      </SheetFrame>

      <SheetFrame open={open === 'wake'} title="Wake automation agent" description="Queue a manual wake with optional repo context and objective." onClose={onClose}>
        <form onSubmit={(event) => { event.preventDefault(); wakeMutation.mutate(); }} className="space-y-4">
          <Field label="Agent" id="wake-agent"><select id="wake-agent" className={selectClassName} value={wakeForm.agentId} onChange={(event) => setWakeForm((value) => ({ ...value, agentId: event.target.value }))} required><option value="">Select agent…</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></Field>
          <Field label="Repo" id="wake-repo">
            <select id="wake-repo" className={selectClassName} value={wakeForm.repoId} onChange={(event) => setWakeForm((value) => ({ ...value, repoId: event.target.value }))} disabled={reposLoading || Boolean(reposError)}>
              <option value="">{reposLoading ? 'Loading repos…' : reposError ? 'Repos unavailable' : 'Global / no repo'}</option>
              {repos.map((repo) => <option key={repo.id} value={repo.id}>{repoLabel(repo)}</option>)}
            </select>
            {reposError && <p className="text-xs text-destructive" role="alert">Repo choices could not be loaded.</p>}
          </Field>
          <Field label="Objective" id="wake-objective"><Textarea id="wake-objective" value={wakeForm.objective} onChange={(event) => setWakeForm((value) => ({ ...value, objective: event.target.value }))} className="min-h-28" placeholder="Optional override objective for this wake." /></Field>
          <Field label="Idempotency key" id="wake-key"><Input id="wake-key" value={wakeForm.idempotencyKey} onChange={(event) => setWakeForm((value) => ({ ...value, idempotencyKey: event.target.value }))} placeholder="deploy:nightly" /></Field>
          {wakeMutation.error && <p className="text-sm text-destructive" role="alert">{mutationError(wakeMutation)}</p>}
          <SubmitButton pending={wakeMutation.isPending} label="Queue wakeup" disabled={!wakeForm.agentId} />
        </form>
      </SheetFrame>

      <SheetFrame open={open === 'work'} title="New work item" description="Queue explicit worker work with scope, priority, and ownership." onClose={onClose}>
        <form onSubmit={(event) => { event.preventDefault(); workMutation.mutate(); }} className="space-y-4">
          <Field label="Repo" id="work-repo">
            <select id="work-repo" className={selectClassName} value={workForm.repoId} onChange={(event) => setWorkForm((value) => ({ ...value, repoId: event.target.value }))} disabled={reposLoading || Boolean(reposError)}>
              <option value="">{reposLoading ? 'Loading repos…' : reposError ? 'Repos unavailable' : 'Global / no repo'}</option>
              {repos.map((repo) => <option key={repo.id} value={repo.id}>{repoLabel(repo)}</option>)}
            </select>
            {reposError && <p className="text-xs text-destructive" role="alert">Repo choices could not be loaded.</p>}
          </Field>
          <Field label="Title" id="work-title"><Input id="work-title" value={workForm.title} onChange={(event) => setWorkForm((value) => ({ ...value, title: event.target.value }))} required /></Field>
          <Field label="Objective" id="work-objective"><Textarea id="work-objective" value={workForm.objective} onChange={(event) => setWorkForm((value) => ({ ...value, objective: event.target.value }))} className="min-h-32" required /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Priority" id="work-priority"><Input id="work-priority" type="number" value={workForm.priority} onChange={(event) => setWorkForm((value) => ({ ...value, priority: event.target.value }))} /></Field>
            <Field label="Assigned worker" id="work-assignee"><select id="work-assignee" className={selectClassName} value={workForm.assignedAgentId} onChange={(event) => setWorkForm((value) => ({ ...value, assignedAgentId: event.target.value }))}><option value="">Unassigned</option>{agents.filter((agent) => agent.role === 'worker').map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></Field>
          </div>
          <Field label="Dedupe key" id="work-key"><Input id="work-key" value={workForm.dedupeKey} onChange={(event) => setWorkForm((value) => ({ ...value, dedupeKey: event.target.value }))} /></Field>
          {workMutation.error && <p className="text-sm text-destructive" role="alert">{mutationError(workMutation)}</p>}
          <SubmitButton pending={workMutation.isPending} label="Create work item" disabled={!workForm.title.trim() || !workForm.objective.trim()} />
        </form>
      </SheetFrame>

      <SheetFrame open={open === 'nudge'} title={`Nudge ${nudgeAgent?.name || 'agent'}`} description="Send input to the standing runtime session without opening its terminal." onClose={closeNudgeSheet}>
        <form onSubmit={(event) => { event.preventDefault(); nudgeMutation.mutate(); }} className="space-y-4">
          <Field label="Message" id="nudge-message"><Textarea id="nudge-message" value={nudgeMessage} onChange={(event) => setNudgeMessage(event.target.value)} className="min-h-36" placeholder="Check the queued work and report what is blocked." required /></Field>
          {nudgeMutation.error && <p className="text-sm text-destructive" role="alert">{mutationError(nudgeMutation)}</p>}
          <SubmitButton pending={nudgeMutation.isPending} label="Send nudge" disabled={!nudgeMessage.trim() || !nudgeAgent} />
        </form>
      </SheetFrame>
    </>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label>{children}</div>;
}

function SubmitButton({ pending, label, disabled = false }: { pending: boolean; label: string; disabled?: boolean }) {
  return (
    <Button type="submit" size="mobile" className="w-full gap-2" disabled={pending || disabled}>
      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
      {pending ? 'Working…' : label}
    </Button>
  );
}
