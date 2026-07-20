'use client';

import Link from 'next/link';
import { AlertTriangle, Bot, MessageSquare, Pause, Play, Terminal } from 'lucide-react';
import type { AutomationAgent, AutomationRun, Host } from '@agent-command/schema';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn, getProviderDisplayName } from '@/lib/utils';
import {
  automationBudgetProgress,
  describeConcurrency,
  describeRuntime,
  describeSchedule,
  describeScheduler,
  getAutomationBadgeVariant,
} from './automationUi';

interface AutomationAgentCardProps {
  agent: AutomationAgent;
  host?: Host;
  hostsUnavailable: boolean;
  runs: AutomationRun[];
  busy: boolean;
  onWake: (agent: AutomationAgent) => void;
  onToggle: (agent: AutomationAgent) => void;
  onNudge: (agent: AutomationAgent) => void;
}

export function AutomationAgentCard({
  agent,
  host,
  hostsUnavailable,
  runs,
  busy,
  onWake,
  onToggle,
  onNudge,
}: AutomationAgentCardProps) {
  const budget = automationBudgetProgress(agent, runs);
  const budgetTone = budget.percent >= 100
    ? 'bg-destructive'
    : budget.percent >= 80 ? 'bg-amber-500' : 'bg-emerald-500';
  const runtimeSessionId = agent.runtime_state?.active_session_id;
  const runtimeHostId = agent.runtime_state?.active_host_id;

  return (
    <Card>
      <CardHeader className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 shrink-0 text-primary" />
              <CardTitle className="truncate text-base sm:text-lg">{agent.name}</CardTitle>
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {agent.role} · {getProviderDisplayName(agent.provider)} · {agent.slug}
            </p>
          </div>
          <Badge variant={getAutomationBadgeVariant(agent.status)}>{agent.status}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-0 text-sm">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <div><p className="text-xs text-muted-foreground">Schedule</p><p>{describeSchedule(agent.wake_policy_json)}</p></div>
          <div><p className="text-xs text-muted-foreground">Runtime</p><p>{describeRuntime(agent)}</p></div>
          <div><p className="text-xs text-muted-foreground">Concurrency</p><p>{describeConcurrency(agent.wake_policy_json)}</p></div>
          <div><p className="text-xs text-muted-foreground">Scheduler</p><p>{describeScheduler(agent.wake_policy_json)}</p></div>
          <div>
            <p className="text-xs text-muted-foreground">Host</p>
            <p>
              {agent.fixed_host_id
                ? host?.name || (hostsUnavailable ? 'Host data unavailable' : 'Unknown pinned host')
                : 'Auto-select'}
            </p>
          </div>
          <div><p className="text-xs text-muted-foreground">Working dir</p><p className="truncate">{agent.default_cwd || 'From repo'}</p></div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-medium">{budget.label}</span>
            <span className="text-muted-foreground">
              {budget.limitCents
                ? `${budget.complete ? '' : 'at least '}$${(budget.usedCents / 100).toFixed(2)} / $${(budget.limitCents / 100).toFixed(2)} · ${budget.percent}%`
                : 'No limit configured'}
            </span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label={`${agent.name} ${budget.label.toLowerCase()}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={budget.percent}
          >
            <div className={cn('h-full rounded-full transition-[width]', budgetTone)} style={{ width: `${budget.percent}%` }} />
          </div>
          <p className="text-[11px] text-muted-foreground">
            {budget.complete
              ? 'Usage estimate from all loaded runs; enforcement remains server-authoritative.'
              : 'Lower bound from the latest 100 runs; the server enforces the complete budget.'}
          </p>
        </div>

        {agent.preflight && agent.preflight.issues.length > 0 && (
          <div className="space-y-1.5 rounded-md border bg-muted/30 p-2.5">
            {agent.preflight.issues.map((issue) => (
              <div key={`${issue.code}-${issue.message}`} className="flex items-start gap-2">
                <AlertTriangle className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', issue.level === 'error' ? 'text-destructive' : 'text-amber-500')} />
                <p className="text-xs text-muted-foreground">{issue.message}</p>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <Button size="mobile-sm" onClick={() => onWake(agent)} disabled={busy} className="gap-1.5">
            <Play className="h-4 w-4" /> Wake
          </Button>
          <Button
            size="mobile-sm"
            variant="outline"
            onClick={() => onNudge(agent)}
            disabled={busy || !runtimeSessionId}
            className="gap-1.5"
            title={runtimeSessionId ? 'Send input to attached runtime' : 'No attached runtime to nudge'}
          >
            <MessageSquare className="h-4 w-4" /> Nudge
          </Button>
          <Button size="mobile-sm" variant="outline" onClick={() => onToggle(agent)} disabled={busy} className="gap-1.5">
            {agent.status === 'active' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {agent.status === 'active' ? 'Pause' : 'Resume'}
          </Button>
          {runtimeSessionId && (
            <Button asChild size="mobile-sm" variant="outline" className="gap-1.5">
              <Link href={`/tmux?${runtimeHostId ? `host_id=${encodeURIComponent(runtimeHostId)}&` : ''}session_id=${encodeURIComponent(runtimeSessionId)}&mode=terminal&attach=1`}>
                <Terminal className="h-4 w-4" /> Terminal
              </Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
