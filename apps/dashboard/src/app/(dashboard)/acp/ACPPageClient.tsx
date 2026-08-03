'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  GitBranch,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import type {
  ACPAction,
  ACPRecordDetail,
  ACPRecordSummary,
  ACPStatusResult,
} from '@agent-command/schema';
import { getACPWorkspace, runACPAction } from '@/lib/api';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

const INITIAL_ROWS = 50;
type ACPTab = 'overview' | 'work' | 'capacity' | 'fleet';
type ActionSheet = 'task' | 'program' | null;
type BadgeVariant = NonNullable<BadgeProps['variant']>;

type Policy = ACPStatusResult['routing']['builder'];
type Resolution = NonNullable<ACPStatusResult['routing']['latest_builder_resolution']>;
type ActionNotice = { kind: 'success' | 'error'; message: string } | null;

function formatTime(value?: string): string {
  if (!value || value === 'unknown') return 'Unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function valueOrUnavailable(value: string | number | undefined | null): string {
  if (value === undefined || value === null || String(value).trim() === '') return 'Unavailable';
  return String(value);
}

function stateLabel(state: ACPRecordSummary['state']): string {
  return state === 'active' ? 'Active' : state === 'attention' ? 'Needs human' : 'History';
}

function stateVariant(state: ACPRecordSummary['state']): BadgeVariant {
  return state === 'active' ? 'running' : state === 'attention' ? 'waiting' : 'secondary';
}

function alignmentVariant(value: ACPStatusResult['fleet']['release_alignment']): BadgeVariant {
  return value === 'aligned' ? 'running' : value === 'different' ? 'waiting' : 'secondary';
}

function isAwaitingInput(status: string): boolean {
  return /awaiting[-_ ]input/i.test(status);
}

function isReviewGate(status: string): boolean {
  return /judgment|needs[-_ ]review|blocked/i.test(status);
}

function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <h2 className="text-base font-semibold">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

function StatusBadge({ state }: { state: ACPRecordSummary['state'] }) {
  return <Badge variant={stateVariant(state)}>{stateLabel(state)}</Badge>;
}

function PolicySummary({
  label,
  policy,
  resolution,
}: {
  label: string;
  policy: Policy;
  resolution: Resolution | null;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Configured {label}</p>
          <p className="mt-1 break-words font-medium">{valueOrUnavailable(policy.lead_model)}</p>
        </div>
        <Badge variant={policy.selectable ? 'running' : 'waiting'}>
          {policy.selectable ? 'Selectable now' : 'Held'}
        </Badge>
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Provider</dt>
        <dd className="break-words">{valueOrUnavailable(policy.provider)}</dd>
        <dt className="text-muted-foreground">Effort</dt>
        <dd>{valueOrUnavailable(policy.effort)}</dd>
        <dt className="text-muted-foreground">Candidates</dt>
        <dd className="break-words">{policy.candidates.length ? policy.candidates.join(' → ') : 'Unavailable'}</dd>
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">{policy.selectable_reason}</p>
      <div className="mt-3 border-t pt-3 text-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Latest recorded resolution</p>
        {resolution ? (
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">Route</dt>
            <dd className="break-words">{valueOrUnavailable(resolution.model)}</dd>
            <dt className="text-muted-foreground">Machine</dt>
            <dd>{valueOrUnavailable(resolution.machine)}</dd>
            <dt className="text-muted-foreground">Provider</dt>
            <dd>{valueOrUnavailable(resolution.provider)}</dd>
            <dt className="text-muted-foreground">Reserve</dt>
            <dd>{valueOrUnavailable(resolution.reserve)}</dd>
            <dt className="text-muted-foreground">Freshness</dt>
            <dd>{valueOrUnavailable(resolution.freshness)}</dd>
            <dt className="text-muted-foreground">Reason</dt>
            <dd className="break-words">{valueOrUnavailable(resolution.selection_reason)}</dd>
            <dt className="text-muted-foreground">Recorded</dt>
            <dd>{formatTime(resolution.recorded_at)}</dd>
          </dl>
        ) : (
          <p className="mt-1 text-muted-foreground">No resolution is recorded.</p>
        )}
      </div>
    </div>
  );
}

function ChevronIcon() {
  return <span aria-hidden="true" className="mt-1 text-muted-foreground">›</span>;
}

function RecordRow({
  record,
  selected,
  onSelect,
}: {
  record: ACPRecordSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full border-b px-3 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selected ? 'bg-muted/50' : ''}`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{valueOrUnavailable(record.objective)}</span>
            <StatusBadge state={record.state} />
            <Badge variant="outline">{record.kind}</Badge>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>Repo: {valueOrUnavailable(record.repo)}</span>
            <span>Lane: {valueOrUnavailable(record.lane)}</span>
            <span>Next: {valueOrUnavailable(record.next_action || record.attention_reason)}</span>
          </div>
        </div>
        <ChevronIcon />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <code className="break-all">{record.id}</code>
        <span>Updated {formatTime(record.updated_at || record.requested_at)}</span>
        {record.program_id && <span>Program {record.program_id}</span>}
      </div>
    </button>
  );
}

function DetailField({ label, value }: { label: string; value: string | number | undefined | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm">{valueOrUnavailable(value)}</dd>
    </div>
  );
}

function DetailPanel({
  detail,
  onAction,
  busy,
  notice,
}: {
  detail: ACPRecordDetail | null;
  onAction: (action: ACPAction) => void;
  busy: boolean;
  notice: ActionNotice;
}) {
  const [answer, setAnswer] = useState('');
  const [statement, setStatement] = useState('I approve the frozen plan as displayed.');
  const [cancelConfirmation, setCancelConfirmation] = useState('');

  useEffect(() => {
    setAnswer('');
    setStatement('I approve the frozen plan as displayed.');
    setCancelConfirmation('');
  }, [detail?.id]);

  if (!detail) {
    return (
      <EmptyState
        icon={GitBranch}
        title="Select a work item"
        description="Choose a task or program to inspect its available evidence and operator actions."
        className="min-h-64"
      />
    );
  }

  const digest = detail.approval_snapshot_digest;
  const canAnswer = detail.kind === 'program' && isAwaitingInput(detail.raw_status) && !digest;
  const isJudgment = detail.kind === 'program' && isReviewGate(detail.raw_status);
  const canCancel = detail.kind === 'program' && (isAwaitingInput(detail.raw_status) || isJudgment);

  return (
    <div className="space-y-4" aria-label="ACP record detail">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="break-words text-base font-semibold">{valueOrUnavailable(detail.objective)}</h2>
            <StatusBadge state={detail.state} />
          </div>
          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{detail.id}</p>
        </div>
        <Badge variant="outline">{detail.kind}</Badge>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <DetailField label="Repo" value={detail.repo} />
        <DetailField label="Raw status" value={detail.raw_status} />
        <DetailField label="Lane" value={detail.lane} />
        <DetailField label="Machine" value={detail.machine} />
        <DetailField label="Provider" value={detail.provider} />
        <DetailField label="Model" value={detail.model} />
        <DetailField label="Effort" value={detail.effort} />
        <DetailField label="Attempts" value={detail.attempts} />
        <DetailField label="Duration" value={detail.duration_ms === undefined ? undefined : `${detail.duration_ms} ms`} />
        <DetailField label="Cost" value={detail.cost_usd === undefined ? undefined : `$${detail.cost_usd.toFixed(4)}`} />
        <DetailField label="Input tokens" value={detail.input_tokens} />
        <DetailField label="Output tokens" value={detail.output_tokens} />
        <DetailField label="Requested" value={formatTime(detail.requested_at)} />
        <DetailField label="Updated" value={formatTime(detail.updated_at)} />
        <DetailField label="Verification" value={detail.verification_status || detail.verification} />
        <DetailField label="Verdict" value={detail.verdict} />
        <DetailField label="Worktree/ref" value={detail.worktree_ref} />
        <DetailField label="Receipt" value={detail.receipt_target} />
        <DetailField label="Builder machine" value={detail.builder_machine} />
        <DetailField label="Builder provider" value={detail.builder_provider} />
        <DetailField label="Builder model" value={detail.builder_model} />
        <DetailField label="Builder effort" value={detail.builder_effort} />
        <DetailField label="Reviewer machine" value={detail.reviewer_machine} />
        <DetailField label="Reviewer provider" value={detail.reviewer_provider} />
        <DetailField label="Reviewer model" value={detail.reviewer_model} />
        <DetailField label="Reviewer effort" value={detail.reviewer_effort} />
      </dl>

      {(detail.verdict_reason || detail.blockers?.length || detail.next_action || detail.attention_reason) && (
        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          {detail.next_action && <p><strong>Next action:</strong> {detail.next_action}</p>}
          {detail.attention_reason && <p className="mt-1"><strong>Attention:</strong> {detail.attention_reason}</p>}
          {detail.verdict_reason && <p className="mt-1"><strong>Verdict reason:</strong> {detail.verdict_reason}</p>}
          {detail.blockers?.length ? (
            <div className="mt-2">
              <strong>Blockers:</strong>
              <ul className="ml-5 list-disc">
                {detail.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
              </ul>
            </div>
          ) : null}
        </div>
      )}

      {detail.program && (
        <div className="rounded-md border p-3 text-sm">
          <p className="font-semibold">Program gates and lanes</p>
          <dl className="mt-2 grid gap-2 sm:grid-cols-2">
            <DetailField label="Setup gate" value={detail.program.setup_gate} />
            <DetailField label="Next action" value={detail.program.next_action} />
            <DetailField label="Gates" value={detail.program.gates?.join(', ')} />
            <DetailField label="Lanes" value={detail.program.lanes?.join(', ')} />
            <DetailField label="Dependencies" value={detail.program.dependencies?.join(', ')} />
            <DetailField label="Budget" value={detail.program.budget ? JSON.stringify(detail.program.budget) : undefined} />
          </dl>
        </div>
      )}

      {detail.checkpoints?.length ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Checkpoints</p>
          <ul className="mt-2 space-y-1 text-sm">
            {detail.checkpoints.map((checkpoint) => <li key={checkpoint}>• {checkpoint}</li>)}
          </ul>
        </div>
      ) : null}

      {detail.changed_files?.length ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Changed files</p>
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-md border bg-muted/20 p-2 font-mono text-xs">
            {detail.changed_files.map((file) => <li key={file} className="break-all">{file}</li>)}
          </ul>
        </div>
      ) : null}

      {detail.log_tail && (
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">Safe log tail</summary>
          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">{detail.log_tail}</pre>
        </details>
      )}

      {notice && (
        <div className={notice.kind === 'success' ? 'rounded-md border border-green-500/30 bg-green-500/10 p-3 text-sm' : 'rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive'} role={notice.kind === 'success' ? 'status' : 'alert'}>
          {notice.message}
        </div>
      )}

      {detail.kind === 'program' && digest && (
        <div className="space-y-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
          <div>
            <p className="font-semibold">Frozen plan approval</p>
            <p className="mt-1 text-sm text-muted-foreground">This digest is a concurrency token. The trusted server re-reads the latest snapshot before invoking ACP.</p>
          </div>
          <label className="block text-sm font-medium" htmlFor="approval-digest">Displayed approval digest</label>
          <Input id="approval-digest" value={digest} readOnly className="font-mono text-xs" aria-describedby="approval-digest-help" />
          <p id="approval-digest-help" className="text-xs text-muted-foreground">Do not edit this value.</p>
          <label className="block text-sm font-medium" htmlFor="approval-statement">Approval statement</label>
          <Textarea id="approval-statement" value={statement} onChange={(event) => setStatement(event.target.value)} rows={3} disabled={busy} />
          <Button
            type="button"
            size="mobile-sm"
            onClick={() => onAction({ type: 'approve_program', program_id: detail.id, statement, approval_digest: digest })}
            disabled={busy || !statement.trim()}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="mr-2 h-4 w-4" aria-hidden="true" />}
            Approve frozen plan
          </Button>
        </div>
      )}

      {canAnswer && (
        <div className="space-y-2 rounded-md border p-3">
          <p className="font-semibold">Awaiting your answer</p>
          <p className="text-sm text-muted-foreground">Answer the current ordinary setup prompt. Reserved control answers are rejected here.</p>
          <label className="block text-sm font-medium" htmlFor="program-answer">Answer</label>
          <Textarea id="program-answer" value={answer} onChange={(event) => setAnswer(event.target.value)} rows={3} disabled={busy} />
          <Button
            type="button"
            size="mobile-sm"
            onClick={() => onAction({ type: 'answer_program', program_id: detail.id, answer })}
            disabled={busy || !answer.trim()}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Submit answer
          </Button>
        </div>
      )}

      {isJudgment && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <p className="font-semibold">Judgment or review gate</p>
          <p className="mt-1">Retry remains available only through the authorized ACP CLI in v1. Use the explicit cancellation path here if this frozen plan should be denied.</p>
        </div>
      )}

      {canCancel && (
        <div className="space-y-2 rounded-md border border-destructive/30 p-3">
          <p className="font-semibold">Cancel or deny this program</p>
          <p className="text-sm text-muted-foreground">Type <code>cancel</code> to confirm. This sends the server-owned cancellation answer to ACP.</p>
          <label className="block text-sm font-medium" htmlFor="cancel-confirmation">Confirmation</label>
          <Input id="cancel-confirmation" value={cancelConfirmation} onChange={(event) => setCancelConfirmation(event.target.value)} placeholder="cancel" disabled={busy} />
          <Button
            type="button"
            size="mobile-sm"
            variant="destructive"
            onClick={() => onAction({ type: 'cancel_program', program_id: detail.id, confirmation: 'cancel' })}
            disabled={busy || cancelConfirmation.trim().toLowerCase() !== 'cancel'}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <XCircle className="mr-2 h-4 w-4" aria-hidden="true" />}
            Cancel program
          </Button>
        </div>
      )}

      {!canAnswer && !digest && !canCancel && !isJudgment && detail.state === 'attention' && (
        <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">This item needs attention, but ACP has not provided a safe workspace action. Inspect the record or use the authorized ACP CLI.</p>
      )}
    </div>
  );
}

function NewTaskForm({
  repositories,
  busy,
  onSubmit,
}: {
  repositories: string[];
  busy: boolean;
  onSubmit: (action: ACPAction) => void;
}) {
  const [repo, setRepo] = useState('');
  const [objective, setObjective] = useState('');
  const [lane, setLane] = useState<'cheap' | 'standard' | 'critical'>('standard');
  const selectedRepo = repo || repositories[0] || '';
  return (
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (selectedRepo && objective.trim()) onSubmit({ type: 'enqueue_task', repo: selectedRepo, objective, lane }); }}>
      <div>
        <label className="text-sm font-medium" htmlFor="new-task-repo">Repository alias</label>
        <select id="new-task-repo" value={selectedRepo} onChange={(event) => setRepo(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" disabled={busy || repositories.length === 0}>
          {repositories.length ? repositories.map((value) => <option key={value} value={value}>{value}</option>) : <option value="">No allowlisted repositories available</option>}
        </select>
      </div>
      <div>
        <label className="text-sm font-medium" htmlFor="new-task-objective">Objective</label>
        <Textarea id="new-task-objective" value={objective} onChange={(event) => setObjective(event.target.value)} rows={5} maxLength={4000} placeholder="Describe the bounded repository task…" disabled={busy} />
        <p className="mt-1 text-xs text-muted-foreground">ACP selects the exact model, effort, machine, and reviewer.</p>
      </div>
      <div>
        <label className="text-sm font-medium" htmlFor="new-task-lane">Risk lane</label>
        <select id="new-task-lane" value={lane} onChange={(event) => setLane(event.target.value as typeof lane)} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" disabled={busy}>
          <option value="cheap">Cheap</option>
          <option value="standard">Standard</option>
          <option value="critical">Critical</option>
        </select>
      </div>
      <Button type="submit" size="mobile-sm" disabled={busy || !selectedRepo || !objective.trim()}>
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="mr-2 h-4 w-4" aria-hidden="true" />}
        Queue task
      </Button>
    </form>
  );
}

function NewProgramForm({
  repositories,
  busy,
  onSubmit,
}: {
  repositories: string[];
  busy: boolean;
  onSubmit: (action: ACPAction) => void;
}) {
  const [repo, setRepo] = useState('');
  const [goal, setGoal] = useState('');
  const selectedRepo = repo || repositories[0] || '';
  return (
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (selectedRepo && goal.trim()) onSubmit({ type: 'start_program', repo: selectedRepo, goal }); }}>
      <div>
        <label className="text-sm font-medium" htmlFor="new-program-repo">Repository alias</label>
        <select id="new-program-repo" value={selectedRepo} onChange={(event) => setRepo(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" disabled={busy || repositories.length === 0}>
          {repositories.length ? repositories.map((value) => <option key={value} value={value}>{value}</option>) : <option value="">No allowlisted repositories available</option>}
        </select>
      </div>
      <div>
        <label className="text-sm font-medium" htmlFor="new-program-goal">Program goal</label>
        <Textarea id="new-program-goal" value={goal} onChange={(event) => setGoal(event.target.value)} rows={5} maxLength={4000} placeholder="Describe the durable development program…" disabled={busy} />
        <p className="mt-1 text-xs text-muted-foreground">The server writes structured setup answers and derives request identity.</p>
      </div>
      <Button type="submit" size="mobile-sm" disabled={busy || !selectedRepo || !goal.trim()}>
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="mr-2 h-4 w-4" aria-hidden="true" />}
        Start program
      </Button>
    </form>
  );
}

function OverviewTab({ data, onSelect }: { data: ACPStatusResult; onSelect: (record: ACPRecordSummary) => void }) {
  const urgent = data.work.records.filter((record) => record.state === 'attention').slice(0, 5);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dispatch</p>
          <div className="mt-2 flex items-center gap-2">
            {data.readiness.ready ? <CheckCircle2 className="h-5 w-5 text-green-600" aria-hidden="true" /> : <CircleAlert className="h-5 w-5 text-amber-600" aria-hidden="true" />}
            <span className="font-semibold">{data.readiness.ready ? 'Ready to dispatch' : 'Blocked'}</span>
          </div>
          {!data.readiness.ready && <p className="mt-2 text-xs text-muted-foreground">{data.readiness.reasons.join(' ') || 'Exact blocking reason unavailable.'}</p>}
          {data.readiness.ready && <p className="mt-2 text-xs text-muted-foreground">Execution route is available; backlog and attention are tracked separately.</p>}
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Needs human</p>
          <p className="mt-2 text-2xl font-bold">{data.work.counts.attention}</p>
          <p className="text-xs text-muted-foreground">Awaiting input, judgment, blocked, or review</p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Active work</p>
          <p className="mt-2 text-2xl font-bold">{data.work.counts.active}</p>
          <p className="text-xs text-muted-foreground">Queued, claimed, starting, or running</p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Release integrity</p>
          <div className="mt-2"><Badge variant={alignmentVariant(data.fleet.release_alignment)}>{data.fleet.release_alignment}</Badge></div>
          <p className="mt-2 text-xs text-muted-foreground">Compared from activated machine facts, not identity alone.</p>
        </div>
      </div>

      {!data.source.available && <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">ACP source unavailable: {data.source.error || 'reason unavailable'}</div>}
      {data.work.partial && <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm" role="status"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />Partial source: {data.work.skipped_count} record(s) were skipped; available Work remains visible.</div>}

      <div className="grid gap-4 lg:grid-cols-2">
        <PolicySummary label="Builder policy" policy={data.routing.builder} resolution={data.routing.latest_builder_resolution} />
        <PolicySummary label="adversary / reviewer policy" policy={data.routing.reviewer} resolution={data.routing.latest_reviewer_resolution} />
      </div>

      <section className="rounded-lg border p-4">
        <SectionHeading title="Most urgent items" description="Needs-review is human attention, not active execution." />
        {urgent.length ? (
          <div className="mt-3 divide-y rounded-md border">
            {urgent.map((record) => <RecordRow key={`${record.kind}:${record.id}`} record={record} selected={false} onSelect={() => onSelect(record)} />)}
          </div>
        ) : (
          <EmptyState icon={CheckCircle2} title="No human decisions are recorded" description="ACP attention is clear in the bounded source snapshot." className="mt-3 min-h-36" />
        )}
      </section>
    </div>
  );
}

function WorkTab({
  data,
  selectedId,
  onSelect,
}: {
  data: ACPStatusResult;
  selectedId: string | null;
  onSelect: (record: ACPRecordSummary) => void;
}) {
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<'all' | ACPRecordSummary['state']>('all');
  const [kindFilter, setKindFilter] = useState<'all' | ACPRecordSummary['kind']>('all');
  const [repoFilter, setRepoFilter] = useState('all');
  const records = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return data.work.records.filter((record) => {
      if (stateFilter !== 'all' && record.state !== stateFilter) return false;
      if (kindFilter !== 'all' && record.kind !== kindFilter) return false;
      if (repoFilter !== 'all' && record.repo !== repoFilter) return false;
      if (!needle) return true;
      return [record.objective, record.repo, record.id, record.raw_status, record.lane, record.next_action, record.program_id]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [data.work.records, kindFilter, repoFilter, search, stateFilter]);
  const visibleRecords = records.slice(0, INITIAL_ROWS);
  const hasFilters = Boolean(search.trim()) || stateFilter !== 'all' || kindFilter !== 'all' || repoFilter !== 'all';

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
        <div>
          <label className="sr-only" htmlFor="acp-work-search">Search ACP work</label>
          <Input id="acp-work-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search objective, repo, ID, lane…" />
        </div>
        <select aria-label="Filter by state" value={stateFilter} onChange={(event) => setStateFilter(event.target.value as typeof stateFilter)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
          <option value="all">All states</option><option value="active">Active</option><option value="attention">Needs human</option><option value="history">History</option>
        </select>
        <select aria-label="Filter by type" value={kindFilter} onChange={(event) => setKindFilter(event.target.value as typeof kindFilter)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
          <option value="all">Tasks + programs</option><option value="task">Tasks</option><option value="program">Programs</option>
        </select>
        <select aria-label="Filter by repository" value={repoFilter} onChange={(event) => setRepoFilter(event.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
          <option value="all">All repos</option>
          {data.routing.repositories.map((repo) => <option key={repo} value={repo}>{repo}</option>)}
        </select>
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground" aria-live="polite">
        <span>{data.work.counts.active} active</span><span>{data.work.counts.attention} needs human</span><span>{data.work.counts.history} history</span><span>{data.work.counts.total} total source records</span>
        {data.work.partial && <span className="text-amber-700 dark:text-amber-300">Partial source ({data.work.skipped_count} skipped)</span>}
      </div>

      {!data.work.available ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive" role="alert">Work unavailable: {data.work.error || 'reason unavailable'}</div>
      ) : data.work.records.length === 0 ? (
        <EmptyState icon={GitBranch} title="No ACP records" description="The bounded ACP source has no task or program records yet." />
      ) : records.length === 0 ? (
        <EmptyState icon={CircleAlert} title="No matching work" description={hasFilters ? 'No records match these search or filter values.' : 'No records are currently visible.'} action={hasFilters ? <Button type="button" variant="outline" size="mobile-sm" onClick={() => { setSearch(''); setStateFilter('all'); setKindFilter('all'); setRepoFilter('all'); }}>Clear filters</Button> : undefined} />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-md border md:block">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr><th className="px-3 py-2">Objective</th><th className="px-3 py-2">Repo / lane</th><th className="px-3 py-2">State</th><th className="px-3 py-2">Updated</th><th className="px-3 py-2">Relationship</th><th className="px-3 py-2" aria-label="Select" /></tr>
              </thead>
              <tbody>
                {visibleRecords.map((record) => <tr key={`${record.kind}:${record.id}`} className={`border-t ${selectedId === record.id ? 'bg-muted/50' : ''}`}>
                  <td className="max-w-[340px] px-3 py-3"><button type="button" onClick={() => onSelect(record)} className="text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{valueOrUnavailable(record.objective)}<code className="mt-1 block break-all text-[11px] font-normal text-muted-foreground">{record.id}</code></button></td>
                  <td className="px-3 py-3"><div>{valueOrUnavailable(record.repo)}</div><div className="text-xs text-muted-foreground">{valueOrUnavailable(record.lane)}</div></td>
                  <td className="px-3 py-3"><StatusBadge state={record.state} /><div className="mt-1 text-xs text-muted-foreground">{record.raw_status}</div></td>
                  <td className="whitespace-nowrap px-3 py-3 text-xs text-muted-foreground">{formatTime(record.updated_at || record.requested_at)}</td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">{valueOrUnavailable(record.program_relation || record.program_id || record.next_action)}</td>
                  <td className="px-3 py-3"><Button type="button" variant="outline" size="sm" onClick={() => onSelect(record)}>Inspect</Button></td>
                </tr>)}
              </tbody>
            </table>
          </div>
          <div className="divide-y rounded-md border md:hidden">
            {visibleRecords.map((record) => <RecordRow key={`${record.kind}:${record.id}`} record={record} selected={selectedId === record.id} onSelect={() => onSelect(record)} />)}
          </div>
          {records.length > INITIAL_ROWS && <p className="text-xs text-muted-foreground">Showing the first {INITIAL_ROWS} matching records from a bounded source response.</p>}
        </>
      )}
    </div>
  );
}

function CapacityTab({ data }: { data: ACPStatusResult }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <PolicySummary label="Builder policy" policy={data.routing.builder} resolution={data.routing.latest_builder_resolution} />
        <PolicySummary label="adversary / reviewer policy" policy={data.routing.reviewer} resolution={data.routing.latest_reviewer_resolution} />
      </div>
      <section className="rounded-lg border p-4">
        <SectionHeading title="Quota pools" description="Raw capacity is subordinate to route policy. Team/shared OpenAI remains visible and nonblocking." />
        {!data.quota.available ? <p className="mt-3 rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">Quota unavailable: {data.quota.error || 'reason unavailable'}</p> : (
          <div className="mt-3 overflow-x-auto rounded-md border">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-2">Provider / pool</th><th className="px-3 py-2">Used / remaining</th><th className="px-3 py-2">Reset</th><th className="px-3 py-2">Freshness</th><th className="px-3 py-2">Role / effect</th></tr></thead>
              <tbody>{data.quota.items.map((item) => <tr key={`${item.provider}:${item.pool_id}`} className="border-t">
                <td className="px-3 py-3"><div>{item.provider}</div><code className="break-all text-xs text-muted-foreground">{item.pool_id}</code></td>
                <td className="px-3 py-3">{item.used_percent === null ? 'Unmeasurable' : `${item.used_percent}%`} / {item.remaining_percent === null ? 'Unavailable' : `${item.remaining_percent}%`}</td>
                <td className="whitespace-nowrap px-3 py-3 text-xs">{formatTime(item.resets_at || undefined)}</td>
                <td className="px-3 py-3"><Badge variant={item.status === 'exhausted' && !item.shared ? 'waiting' : item.confidence === 'measured' ? 'running' : 'secondary'}>{item.confidence}</Badge><div className="mt-1 text-xs text-muted-foreground">Measured {formatTime(item.measured_at || data.quota.generated_at)}</div></td>
                <td className="px-3 py-3"><div>{valueOrUnavailable(item.pool_kind)}</div><div className="text-xs text-muted-foreground">{item.shared ? 'Shared / nonblocking' : valueOrUnavailable(item.effect)}</div></td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function FleetTab({ data }: { data: ACPStatusResult }) {
  const machines = ['heavisidelinux', 'homelinux'];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border p-4">
        <span className="font-semibold">Release comparison</span>
        <Badge variant={alignmentVariant(data.fleet.release_alignment)}>{data.fleet.release_alignment}</Badge>
        {data.fleet.intentional_pin && <span className="text-sm text-muted-foreground">Intentional pin: {data.fleet.intentional_pin}</span>}
        {!data.fleet.intentional_pin && data.fleet.release_alignment === 'different' && <span className="text-sm text-muted-foreground">Divergence is not treated as an intentional pin.</span>}
      </div>
      {!data.fleet.available && <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">Fleet facts unavailable: {data.fleet.error || 'activation and capability facts may be unknown'}</div>}
      <section className="rounded-lg border p-4">
        <SectionHeading title="Activated releases" description="Known activation is not alignment; each machine is shown independently." />
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {machines.map((machine) => {
            const activation = data.fleet.activations.find((row) => row.machine === machine);
            const known = Boolean(activation && activation.open_agents_version !== 'unknown' && activation.open_agents_path !== 'unknown');
            return <div key={machine} className="rounded-md border p-3"><div className="flex items-center justify-between gap-2"><p className="font-medium">{machine}</p><Badge variant={known ? 'running' : 'secondary'}>{known ? 'Known' : 'Unknown'}</Badge></div><dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm"><dt className="text-muted-foreground">Version</dt><dd className="break-words">{valueOrUnavailable(activation?.open_agents_version)}</dd><dt className="text-muted-foreground">Path</dt><dd className="break-all font-mono text-xs">{valueOrUnavailable(activation?.open_agents_path)}</dd><dt className="text-muted-foreground">Measured</dt><dd>{formatTime(activation?.measured_at)}</dd></dl></div>;
          })}
        </div>
      </section>
      <section className="rounded-lg border p-4">
        <SectionHeading title="Capability checks" description="Gateway, dispatch-worker, and release checks are reported with their own freshness." />
        <div className="mt-3 overflow-x-auto rounded-md border"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-2">Machine</th><th className="px-3 py-2">Harness</th><th className="px-3 py-2">Capability</th><th className="px-3 py-2">Result</th><th className="px-3 py-2">Measured</th></tr></thead><tbody>{data.fleet.capabilities.map((item) => <tr key={`${item.machine}:${item.harness}`} className="border-t"><td className="px-3 py-3">{item.machine}</td><td className="px-3 py-3">{item.harness}</td><td className="px-3 py-3">{item.capability}</td><td className="px-3 py-3"><Badge variant={item.available ? 'running' : 'waiting'}>{item.available ? 'Pass' : 'Unknown / failed'}</Badge></td><td className="px-3 py-3 text-xs">{formatTime(item.measured_at)}</td></tr>)}</tbody></table></div>
      </section>
    </div>
  );
}

export default function ACPPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const selectedTaskId = searchParams.get('task_id');
  const selectedProgramId = searchParams.get('program_id');
  const selectedId = selectedTaskId || selectedProgramId;
  const tabParam = searchParams.get('tab');
  const activeTab: ACPTab = tabParam === 'work' || tabParam === 'capacity' || tabParam === 'fleet' ? tabParam : 'overview';
  const [actionSheet, setActionSheet] = useState<ActionSheet>(null);
  const [notice, setNotice] = useState<ActionNotice>(null);
  const query = useQuery({
    queryKey: ['acp', selectedTaskId, selectedProgramId],
    queryFn: () => getACPWorkspace({ task_id: selectedTaskId || undefined, program_id: selectedProgramId || undefined }),
    refetchInterval: 15_000,
  });
  const mutation = useMutation({
    mutationFn: runACPAction,
    onSuccess: (result) => {
      setNotice({ kind: 'success', message: result.accepted ? 'ACP accepted the request. Eventual work completion will appear in Work.' : 'ACP did not accept the request.' });
      setActionSheet(null);
      void queryClient.invalidateQueries({ queryKey: ['acp'] });
    },
    onError: (error: Error) => setNotice({ kind: 'error', message: error.message || 'ACP action failed.' }),
  });
  const data = query.data;
  const selected = data?.work.selected || null;
  const repositories = data?.routing.repositories || [];

  const updateParams = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value); else params.delete(key);
    }
    const next = params.toString();
    router.replace(`/acp${next ? `?${next}` : ''}`, { scroll: false });
  };
  const selectRecord = (record: ACPRecordSummary) => updateParams({ tab: 'work', task_id: record.kind === 'task' ? record.id : null, program_id: record.kind === 'program' ? record.id : null });
  const submitAction = (action: ACPAction) => {
    setNotice(null);
    mutation.mutate(action);
  };

  if (query.isLoading && !data) {
    return <div className="mx-auto flex min-h-64 w-full max-w-7xl items-center justify-center px-3 py-12 text-sm text-muted-foreground" role="status"><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Loading ACP workspace…</div>;
  }
  if (query.error && !data) {
    const permissionDenied = /operator|forbidden|permission/i.test(query.error.message);
    return <div className="mx-auto w-full max-w-7xl px-3 py-12 sm:px-4"><div className="rounded-lg border p-6 text-center"><XCircle className="mx-auto h-8 w-8 text-destructive" aria-hidden="true" /><h1 className="mt-3 text-lg font-semibold">{permissionDenied ? 'ACP permission denied' : 'ACP workspace unavailable'}</h1><p className="mt-1 text-sm text-muted-foreground">{query.error.message}</p><Button size="mobile" className="mt-4" onClick={() => void query.refetch()}>Retry</Button></div></div>;
  }
  if (!data) return null;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 px-3 py-4 sm:px-4 sm:py-6" aria-busy={query.isFetching || mutation.isPending}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><div className="flex items-center gap-2"><GitBranch className="h-6 w-6 text-primary" aria-hidden="true" /><h1 className="text-xl font-bold sm:text-2xl">ACP workspace</h1></div><p className="mt-1 max-w-3xl text-sm text-muted-foreground">Development orchestration for programs, tasks, human decisions, routing, and release readiness.</p></div>
        <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" size="mobile-sm" onClick={() => void query.refetch()} disabled={query.isFetching} aria-label="Refresh ACP workspace"><RefreshCw className={`mr-2 h-4 w-4 ${query.isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh</Button><Button type="button" variant="outline" size="mobile-sm" onClick={() => setActionSheet('program')}><Plus className="mr-2 h-4 w-4" aria-hidden="true" />New program</Button><Button type="button" size="mobile-sm" onClick={() => setActionSheet('task')}><Plus className="mr-2 h-4 w-4" aria-hidden="true" />New task</Button></div>
      </header>

      {query.error && <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm" role="status"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />The ACP source refreshed partially: showing the last valid workspace response.</div>}
      {notice && <div className={notice.kind === 'success' ? 'rounded-md border border-green-500/30 bg-green-500/10 p-3 text-sm' : 'rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive'} role={notice.kind === 'success' ? 'status' : 'alert'}>{notice.message}</div>}

      <Tabs value={activeTab} onValueChange={(value) => updateParams({ tab: value === 'overview' ? null : value })} className="space-y-4">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-4"><TabsTrigger value="overview" className="min-h-11">Overview</TabsTrigger><TabsTrigger value="work" className="min-h-11">Work</TabsTrigger><TabsTrigger value="capacity" className="min-h-11">Capacity and Routing</TabsTrigger><TabsTrigger value="fleet" className="min-h-11">Fleet and Releases</TabsTrigger></TabsList>
        <TabsContent value="overview"><OverviewTab data={data} onSelect={selectRecord} /></TabsContent>
        <TabsContent value="work"><WorkTab data={data} selectedId={selectedId} onSelect={selectRecord} /></TabsContent>
        <TabsContent value="capacity"><CapacityTab data={data} /></TabsContent>
        <TabsContent value="fleet"><FleetTab data={data} /></TabsContent>
      </Tabs>

      {(activeTab === 'work' || selected) && <section className="rounded-lg border p-4"><SectionHeading title="Selected evidence" description="Only fields present in the authoritative ACP record are populated; unavailable fields are explicit." /><div className="mt-3"><DetailPanel detail={selected} onAction={submitAction} busy={mutation.isPending} notice={notice} /></div></section>}

      <Sheet open={actionSheet !== null} onOpenChange={(open) => !open && setActionSheet(null)}>
        <SheetContent side="right" className="overflow-y-auto"><SheetHeader><SheetTitle>{actionSheet === 'task' ? 'New task' : 'New program'}</SheetTitle><SheetDescription>{actionSheet === 'task' ? 'Submit a bounded task to ACP. Risk selects policy; ACP selects the exact route.' : 'Start a durable ACP program with server-generated setup inputs.'}</SheetDescription></SheetHeader>{actionSheet === 'task' ? <NewTaskForm repositories={repositories} busy={mutation.isPending} onSubmit={submitAction} /> : <NewProgramForm repositories={repositories} busy={mutation.isPending} onSubmit={submitAction} />}</SheetContent>
      </Sheet>
    </div>
  );
}
