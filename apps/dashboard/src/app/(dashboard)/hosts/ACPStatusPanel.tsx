'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { ACPStatusResult, Host } from '@agent-command/schema';
import { getHostACPStatus } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

type ACPQuotaItem = ACPStatusResult['quota']['items'][number];
type ACPActivation = ACPStatusResult['activations']['rows'][number];
type ACPWorkItem = ACPStatusResult['queue']['items'][number];
const SHARED_POOL_PREFIX = 'codex-account-';
const UNKNOWN_ACTIVATION = 'unknown';

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function TimeValue({ value }: { value: string }) {
  return (
    <time dateTime={value} suppressHydrationWarning>
      {formatTime(value)}
    </time>
  );
}

function Notice({ children, role }: { children: ReactNode; role?: 'status' | 'alert' }) {
  return (
    <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground" role={role}>
      {children}
    </p>
  );
}

function Unavailable({ message }: { message?: string }) {
  return (
    <Notice>
      <Badge variant="error" className="mr-2">
        Unavailable
      </Badge>
      {message || 'This ACP source did not provide this section.'}
    </Notice>
  );
}

function Section({ id, title, status, children }: { id: string; title: string; status?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="min-w-0 space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 id={id} className="font-semibold">
          {title}
        </h3>
        {status}
      </div>
      {children}
    </section>
  );
}

function SectionGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 lg:grid-cols-3">{children}</div>;
}

function QuotaItem({ item }: { item: ACPQuotaItem }) {
  const shared = item.pool_id.startsWith(SHARED_POOL_PREFIX);
  const label = shared
    ? item.status === 'exhausted'
      ? 'Exhausted · Shared / nonblocking'
      : 'Shared / nonblocking'
    : item.status === 'exhausted'
      ? 'Exhausted'
      : item.status === 'unmeasurable'
        ? 'Unmeasurable'
        : 'Measured';
  return (
    <li className="space-y-2 rounded-md border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{item.provider}</p>
          <p className="break-all text-xs text-muted-foreground">{item.pool_id}</p>
        </div>
        <Badge variant={item.status === 'exhausted' && !shared ? 'waiting' : 'secondary'}>{label}</Badge>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Used</dt>
        <dd>{item.used_percent === null ? 'Unmeasurable' : `${item.used_percent}%`}</dd>
        <dt className="text-muted-foreground">Reset</dt>
        <dd>{item.resets_at ? <TimeValue value={item.resets_at} /> : 'Not provided'}</dd>
      </dl>
    </li>
  );
}

function isKnownActivation(row: ACPActivation): boolean {
  return row.open_agents_version !== UNKNOWN_ACTIVATION && row.open_agents_path !== UNKNOWN_ACTIVATION;
}

function ActivationItem({ row }: { row: ACPActivation }) {
  const known = isKnownActivation(row);
  return (
    <li className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="break-words font-medium">{row.machine}</h4>
        <Badge variant={known ? 'running' : 'waiting'}>{known ? 'Known activation' : 'Unknown activation'}</Badge>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Version</dt>
        <dd className="break-words">{row.open_agents_version}</dd>
        <dt className="text-muted-foreground">Path</dt>
        <dd className="break-all font-mono text-xs">{row.open_agents_path}</dd>
        <dt className="text-muted-foreground">Measured</dt>
        <dd>
          <TimeValue value={row.measured_at} />
        </dd>
      </dl>
    </li>
  );
}

function WorkItem({ item }: { item: ACPWorkItem }) {
  return (
    <li className="space-y-1 rounded-md border p-3 text-sm">
      <p className="break-all font-mono text-xs">{item.task_id}</p>
      <p className="break-words">
        <span className="text-muted-foreground">Repo:</span> {item.repo}
      </p>
      <p>
        <span className="text-muted-foreground">Status:</span> {item.status}
      </p>
      <p>
        <span className="text-muted-foreground">Requested:</span> <TimeValue value={item.requested_at} />
      </p>
    </li>
  );
}

export default function ACPStatusPanel({ host }: { host: Host | null }) {
  const hostId = host?.id ?? null;
  const [refreshKey, setRefreshKey] = useState(0);
  const [data, setData] = useState<ACPStatusResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!hostId) {
      setData(null);
      setLoading(false);
      setError(null);
      return () => {
        active = false;
      };
    }
    setData(null);
    setLoading(true);
    setError(null);
    void getHostACPStatus(hostId)
      .then((result) => {
        if (active) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((requestError: unknown) => {
        if (active) {
          setError(requestError instanceof Error ? requestError.message : 'Failed to read ACP status.');
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [hostId, refreshKey]);

  if (!host)
    return (
      <Card className="w-full shadow-sm">
        <CardHeader className="pb-3">
          <h2 className="text-lg font-semibold">ACP status</h2>
        </CardHeader>
        <CardContent>
          <Notice>
            <Badge variant="secondary" className="mr-2">
              Not connected
            </Badge>
            No capable online host is available. An updated online agentd must advertise ACP status.
          </Notice>
        </CardContent>
      </Card>
    );

  const pending = data === null && error === null;
  const blockingQuota =
    data?.quota.available === true &&
    data.quota.items.some((item) => item.status === 'exhausted' && !item.pool_id.startsWith(SHARED_POOL_PREFIX));
  const activationAttention = data?.activations.available === true && data.activations.rows.some((row) => !isKnownActivation(row));
  const partial = data !== null && (!data.quota.available || !data.activations.available || !data.queue.available);
  const statusLabel =
    pending || loading
      ? 'Loading'
      : error
        ? 'Unavailable'
        : partial
          ? 'Partial data'
          : blockingQuota
            ? 'Quota attention'
            : data?.quota.stale
              ? 'Stale data'
              : activationAttention
                ? 'Activation attention'
                : 'Ready';
  const statusVariant: 'running' | 'error' | 'waiting' = pending || loading || statusLabel === 'Ready' ? 'running' : error || statusLabel === 'Unavailable' ? 'error' : 'waiting';
  const retryMessage = pending || loading ? 'Loading status…' : 'ACP status is unavailable. Use Refresh status to try again.';

  return (
    <Card className="w-full shadow-sm">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 pb-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">ACP status</h2>
          <p className="mt-1 text-sm text-muted-foreground">Source: {host.name}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge variant={statusVariant}>{statusLabel}</Badge>
          <Button type="button" variant="outline" size="mobile" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading || pending}>
            {loading ? 'Refreshing…' : 'Refresh status'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
            Failed to load ACP status: {error}
          </div>
        )}
        {!data ? (
          <SectionGrid>
            <Section id="acp-quota-title" title="Quota">
              <Notice>{retryMessage}</Notice>
            </Section>
            <Section id="acp-activations-title" title="Activations">
              <Notice>{retryMessage}</Notice>
            </Section>
            <Section id="acp-work-title" title="Active work">
              <Notice>{retryMessage}</Notice>
            </Section>
          </SectionGrid>
        ) : (
          <SectionGrid>
            <Section
              id="acp-quota-title"
              title="Quota"
              status={
                data.quota.available &&
                (blockingQuota ? (
                  <Badge variant="waiting">Needs attention</Badge>
                ) : data.quota.stale ? (
                  <Badge variant="waiting">Stale</Badge>
                ) : (
                  <Badge variant="running">Measured</Badge>
                ))
              }
            >
              {data.quota.available ? (
                <>
                  {data.quota.generated_at && (
                    <p className="text-xs text-muted-foreground">
                      Generated: <TimeValue value={data.quota.generated_at} />
                    </p>
                  )}
                  {data.quota.items.length ? (
                    <ul className="space-y-3">
                      {data.quota.items.map((item) => (
                        <QuotaItem key={`${item.provider}-${item.pool_id}`} item={item} />
                      ))}
                    </ul>
                  ) : (
                    <Notice>No quota pools were reported.</Notice>
                  )}
                </>
              ) : (
                <Unavailable message={data.quota.error} />
              )}
            </Section>
            <Section
              id="acp-activations-title"
              title="Activations"
              status={data.activations.available && <Badge variant={activationAttention ? 'waiting' : 'running'}>{activationAttention ? 'Needs attention' : 'Known'}</Badge>}
            >
              {data.activations.available ? (
                data.activations.rows.length ? (
                  <ul className="space-y-3">
                    {data.activations.rows.map((row) => (
                      <ActivationItem key={row.machine} row={row} />
                    ))}
                  </ul>
                ) : (
                  <Notice>No activation rows were reported.</Notice>
                )
              ) : (
                <Unavailable message={data.activations.error} />
              )}
            </Section>
            <Section id="acp-work-title" title="Active work" status={data.queue.available && <Badge variant="secondary">{data.queue.items.length} active</Badge>}>
              {data.queue.available ? (
                data.queue.items.length ? (
                  <ul className="space-y-3">
                    {data.queue.items.map((item) => (
                      <WorkItem key={item.task_id} item={item} />
                    ))}
                  </ul>
                ) : (
                  <Notice>No active work is reported.</Notice>
                )
              ) : (
                <Unavailable message={data.queue.error} />
              )}
            </Section>
          </SectionGrid>
        )}
      </CardContent>
    </Card>
  );
}
