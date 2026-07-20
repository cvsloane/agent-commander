'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import {
  Bot,
  CheckCircle2,
  CircleDot,
  GitBranch,
  Loader2,
  MessageSquareText,
  Send,
  Terminal,
  Users,
  XCircle,
} from 'lucide-react';
import type { AgentTask, AutomationRun, SessionWithSnapshot } from '@agent-command/schema';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { InlineApproval } from './InlineApproval';
import { sendCommand, type SessionGraphRollup } from '@/lib/api';
import { cn, formatRelativeTime, getProviderDisplayName, getSessionDisplayName } from '@/lib/utils';
import type { OrchestratorItem } from '@/stores/orchestrator';

interface OrchestratorFleetCardProps {
  session: SessionWithSnapshot;
  children: SessionWithSnapshot[];
  agentTasks: AgentTask[];
  rollup?: SessionGraphRollup;
  latestRun?: AutomationRun;
  attentionItems: OrchestratorItem[];
  isLoading: boolean;
  errors: Error[];
  onRefresh: () => void;
}

function statusVariant(status: string): 'running' | 'approval' | 'error' | 'secondary' | 'outline' {
  if (status === 'ERROR' || status === 'failed') return 'error';
  if (status.startsWith('WAITING')) return 'approval';
  if (status === 'RUNNING' || status === 'STARTING' || status === 'running') return 'running';
  if (status === 'completed' || status === 'DONE') return 'secondary';
  return 'outline';
}

function reportSummary(run: AutomationRun): string {
  const workerSummary = run.worker_report_json?.summary;
  return typeof workerSummary === 'string' && workerSummary.trim()
    ? workerSummary.trim()
    : run.result_summary?.trim() || run.objective;
}

function TaskIcon({ status }: { status: AgentTask['status'] }) {
  if (status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />;
  if (status === 'failed') return <XCircle className="h-3.5 w-3.5 text-destructive" />;
  return <CircleDot className="h-3.5 w-3.5 animate-pulse text-cyan-600" />;
}

export function OrchestratorFleetCard({
  session,
  children,
  agentTasks,
  rollup,
  latestRun,
  attentionItems,
  isLoading,
  errors,
  onRefresh,
}: OrchestratorFleetCardProps) {
  const [prompt, setPrompt] = useState('');
  const [sending, setSending] = useState(false);
  const [sendState, setSendState] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const terminalHref = `/?host_id=${encodeURIComponent(session.host_id)}&session_id=${encodeURIComponent(session.id)}&mode=terminal&attach=1`;
  const pendingApprovals = attentionItems.filter((item) => (
    item.source === 'governance'
    || (
      item.source === 'approval'
      && (!item.approvalType || ['binary', 'plan_review'].includes(item.approvalType))
    )
  ));

  const submitPrompt = async (event: FormEvent) => {
    event.preventDefault();
    if (!prompt.trim() || sending) return;
    setSending(true);
    setSendState(null);
    try {
      await sendCommand(session.id, {
        type: 'send_input',
        payload: { text: prompt.trim(), enter: true },
      });
      setPrompt('');
      setSendState({ type: 'success', message: 'Prompt sent to orchestrator.' });
    } catch (caught) {
      setSendState({
        type: 'error',
        message: caught instanceof Error ? caught.message : 'Could not send prompt.',
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Card id={`orchestrator-${session.id}`} data-testid="orchestrator-card" className="overflow-hidden">
      <CardHeader className="space-y-3 border-b bg-muted/20 p-4 sm:p-5">
        <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 shrink-0 text-cyan-600 dark:text-cyan-400" />
              <CardTitle className="break-words text-lg">{getSessionDisplayName(session)}</CardTitle>
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {getProviderDisplayName(session.provider)} · {session.cwd || 'No working directory'}
            </p>
          </div>
          <Badge variant={statusVariant(session.status)} className="shrink-0 text-[10px] sm:text-xs">
            {session.status.replaceAll('_', ' ')}
          </Badge>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md border bg-background px-2 py-2">
            <div className="text-lg font-semibold">{rollup?.child_sessions.total ?? children.length}</div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Workers</div>
          </div>
          <div className="rounded-md border bg-background px-2 py-2">
            <div className="text-lg font-semibold">{rollup?.agent_tasks.running ?? agentTasks.filter((task) => task.status === 'running').length}</div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Tasks live</div>
          </div>
          <div className="rounded-md border bg-background px-2 py-2">
            <div className="text-lg font-semibold">{attentionItems.length}</div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Needs you</div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 p-4 sm:p-5">
        {errors.length > 0 && (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-200" role="status">
            Some fleet details are unavailable. The command actions below still work.
          </p>
        )}

        {pendingApprovals.length > 0 && (
          <section aria-label="Pending approvals" className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pending decisions</h3>
            {pendingApprovals.map((item) => (
              <InlineApproval key={item.id} item={item} onDecided={onRefresh} />
            ))}
          </section>
        )}

        <section aria-label="Subagent tree" className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <GitBranch className="h-3.5 w-3.5" /> Subagent tree
            </h3>
            {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Loading subagents" />}
          </div>
          {children.length === 0 && agentTasks.length === 0 && !isLoading ? (
            <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              No worker sessions or in-process tasks yet.
            </p>
          ) : (
            <div className="space-y-1.5 border-l-2 border-muted pl-3">
              {children.map((child) => (
                <Link
                  key={child.id}
                  href={`/?host_id=${encodeURIComponent(child.host_id)}&session_id=${encodeURIComponent(child.id)}&mode=terminal`}
                  className="flex min-h-11 items-center justify-between gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{getSessionDisplayName(child)}</span>
                    <span className="block truncate text-xs text-muted-foreground">Worker session · {child.tmux_target || child.cwd}</span>
                  </span>
                  <Badge variant={statusVariant(child.status)} className="shrink-0 text-[10px]">
                    {child.status.replaceAll('_', ' ')}
                  </Badge>
                </Link>
              ))}
              {agentTasks.map((task) => (
                <div key={task.id} className="flex min-h-10 items-center justify-between gap-3 rounded-md px-2 py-1.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <TaskIcon status={task.status} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{task.description || 'In-process subagent'}</span>
                      <span className="block text-xs text-muted-foreground">Provider task</span>
                    </span>
                  </span>
                  <span className="shrink-0 text-[10px] uppercase text-muted-foreground">{task.status}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section aria-label="Latest report" className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <MessageSquareText className="h-3.5 w-3.5" /> Latest report
          </h3>
          {latestRun ? (
            <div className="rounded-md border bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <Badge variant={statusVariant(latestRun.status)} className="text-[10px]">{latestRun.status}</Badge>
                <span className="text-[11px] text-muted-foreground" suppressHydrationWarning>
                  {latestRun.ended_at || latestRun.started_at
                    ? formatRelativeTime(latestRun.ended_at || latestRun.started_at || '')
                    : 'No timestamp'}
                </span>
              </div>
              <p className="mt-2 line-clamp-4 text-sm leading-relaxed">{reportSummary(latestRun)}</p>
            </div>
          ) : (
            <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              No structured report has been submitted by this fleet yet.
            </p>
          )}
        </section>

        <form onSubmit={submitPrompt} className="space-y-2">
          <label htmlFor={`prompt-${session.id}`} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Prompt orchestrator
          </label>
          <Textarea
            id={`prompt-${session.id}`}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Steer this orchestrator without opening its terminal…"
            className="min-h-[84px] resize-y"
          />
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="submit"
              size="mobile-sm"
              disabled={!prompt.trim() || sending || ['DONE', 'ERROR'].includes(session.status)}
              className="gap-1.5"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send prompt
            </Button>
            <Button asChild variant="outline" size="mobile-sm" className="gap-1.5">
              <Link href={terminalHref}>
                <Terminal className="h-4 w-4" /> Open terminal
              </Link>
            </Button>
          </div>
          <div
            className={cn(
              'min-h-4 text-xs',
              sendState?.type === 'error' ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-400'
            )}
            role={sendState?.type === 'error' ? 'alert' : 'status'}
            aria-live="polite"
          >
            {sendState?.message}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
