'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertCircle, Clock3, Server } from 'lucide-react';
import { AccountUsage } from '@/components/analytics';
import { getHosts, getSessions } from '@/lib/api';
import { isHostOnline } from '@/lib/utils';

const WORKFLOW_STATUSES = 'RUNNING,STARTING,WAITING_FOR_INPUT,WAITING_FOR_APPROVAL,ERROR,IDLE';

interface MetricLinkProps {
  href: string;
  label: string;
  value: number | null;
  context: string;
  icon: React.ReactNode;
}

function MetricLink({ href, label, value, context, icon }: MetricLinkProps) {
  return (
    <Link
      href={href}
      className="flex min-h-20 items-center gap-3 rounded-lg border bg-card px-3 py-3 transition-colors hover:border-primary/50 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-2xl font-bold tabular-nums">{value ?? '—'}</span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{context}</span>
      </span>
    </Link>
  );
}

export function UsageOverview() {
  const sessionsQuery = useQuery({
    queryKey: ['sessions', 'settings-usage'],
    queryFn: () => getSessions({ include_archived: false, status: WORKFLOW_STATUSES }),
  });
  const hostsQuery = useQuery({
    queryKey: ['hosts'],
    queryFn: getHosts,
  });

  const metrics = useMemo(() => {
    const sessions = sessionsQuery.data?.sessions;
    const hosts = hostsQuery.data?.hosts;
    return {
      active: sessions ? sessions.filter((session) => ['RUNNING', 'STARTING'].includes(session.status)).length : null,
      attention: sessions ? sessions.filter((session) => ['WAITING_FOR_INPUT', 'WAITING_FOR_APPROVAL', 'ERROR'].includes(session.status)).length : null,
      idle: sessions ? sessions.filter((session) => session.status === 'IDLE' || session.idled_at).length : null,
      onlineHosts: hosts ? hosts.filter((host) => isHostOnline(host.last_seen_at || null)).length : null,
    };
  }, [hostsQuery.data?.hosts, sessionsQuery.data?.sessions]);
  const partialError = sessionsQuery.error || hostsQuery.error;

  return (
    <section id="usage" className="mb-8 space-y-4" aria-labelledby="usage-heading">
      <div>
        <h2 id="usage-heading" className="text-lg font-semibold">Usage &amp; fleet snapshot</h2>
        <p className="text-sm text-muted-foreground">
          Current workflow counts and provider usage. Provider limits refresh every minute.
        </p>
      </div>

      {partialError && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200" role="status">
          Part of the live snapshot is unavailable. Loaded metrics remain visible.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy={sessionsQuery.isLoading || hostsQuery.isLoading}>
        <MetricLink
          href="/sessions?status=RUNNING,STARTING"
          label="Active"
          value={metrics.active}
          context="Current workflow"
          icon={<Activity className="h-4 w-4 text-emerald-500" />}
        />
        <MetricLink
          href="/orchestrator?tab=attention"
          label="Attention"
          value={metrics.attention}
          context="Needs intervention"
          icon={<AlertCircle className="h-4 w-4 text-orange-500" />}
        />
        <MetricLink
          href="/hosts"
          label="Hosts online"
          value={metrics.onlineHosts}
          context="Live heartbeat"
          icon={<Server className="h-4 w-4 text-cyan-500" />}
        />
        <MetricLink
          href="/sessions?status=IDLE"
          label="Idle"
          value={metrics.idle}
          context="Current workflow"
          icon={<Clock3 className="h-4 w-4 text-blue-500" />}
        />
      </div>

      <AccountUsage />
    </section>
  );
}
