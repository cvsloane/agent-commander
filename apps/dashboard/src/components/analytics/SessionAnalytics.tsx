'use client';

import { useQuery } from '@tanstack/react-query';
import { BarChart3, Clock, Coins, MessageSquare, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { getSessionAnalytics, getProviderUsage } from '@/lib/api';
import type { SessionMetrics } from '@/lib/api';

interface SessionAnalyticsProps {
  sessionId: string;
}

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toString();
}

function formatCost(cents: number): string {
  const dollars = cents / 100;
  return `$${dollars.toFixed(2)}`;
}

function formatDuration(firstEvent: string | null, lastEvent: string | null): string {
  if (!firstEvent || !lastEvent) return '-';

  const start = new Date(firstEvent);
  const end = new Date(lastEvent);
  const diffMs = end.getTime() - start.getTime();

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  subValue?: string;
  color?: string;
}

function StatCard({ icon, label, value, subValue, color = 'text-primary' }: StatCardProps) {
  return (
    <div className="bg-muted/30 rounded-lg p-3">
      <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
        {icon}
        {label}
      </div>
      <div className={`text-lg font-semibold ${color}`}>{value}</div>
      {subValue && <div className="text-xs text-muted-foreground">{subValue}</div>}
    </div>
  );
}

export function SessionAnalytics({ sessionId }: SessionAnalyticsProps) {
  const { data: metrics, isLoading, error } = useQuery({
    queryKey: ['session-analytics', sessionId],
    queryFn: () => getSessionAnalytics(sessionId),
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const { data: providerUsage } = useQuery({
    queryKey: ['provider-usage', 'session', sessionId],
    queryFn: () => getProviderUsage({ session_id: sessionId, scope: 'session' }),
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        Loading analytics...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-center text-destructive">
        Failed to load analytics
      </div>
    );
  }

  if (!metrics) {
    return null;
  }

  const totalTokens = metrics.tokens_in + metrics.tokens_out;
  const cacheTokens = metrics.tokens_cache_read + metrics.tokens_cache_write;
  const totalApprovals = metrics.approvals_requested;
  const hasActivity = totalTokens > 0 || metrics.tool_calls > 0 || totalApprovals > 0;
  const approvalRate = totalApprovals > 0
    ? Math.round((metrics.approvals_granted / totalApprovals) * 100)
    : 0;
  const sessionUsage = providerUsage?.usage || [];

  const getParsedEntries = (raw: unknown) => {
    if (!raw || typeof raw !== 'object') return null;
    const record = raw as Record<string, any>;
    if (Array.isArray(record.entries)) return record.entries as any[];
    if (record._parsed && Array.isArray(record._parsed.entries)) return record._parsed.entries as any[];
    return null;
  };

  const formatResetLabel = (value: string | null | undefined) => {
    if (!value) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
  };

  const deriveEntriesFromRow = (row: any) => {
    const entries: any[] = [];
    const pushEntry = (label: string, usedPercent?: number | null, resetAt?: string | null) => {
      if (usedPercent == null && !resetAt) return;
      const entry: any = { label };
      if (usedPercent != null) entry.used_percent = usedPercent;
      const resetLabel = formatResetLabel(resetAt);
      if (resetLabel) entry.reset_text = resetLabel;
      entries.push(entry);
    };

    if (
      row.five_hour_utilization != null ||
      row.weekly_utilization != null ||
      row.weekly_opus_utilization != null ||
      row.weekly_sonnet_utilization != null
    ) {
      pushEntry('5h limit', row.five_hour_utilization, row.five_hour_reset_at);
      pushEntry('Weekly limit', row.weekly_utilization, row.weekly_reset_at);
      pushEntry('Weekly Opus', row.weekly_opus_utilization, row.weekly_opus_reset_at);
      pushEntry('Weekly Sonnet', row.weekly_sonnet_utilization, row.weekly_sonnet_reset_at);
      return entries.length > 0 ? entries : null;
    }

    const raw = row.raw_json as Record<string, any> | null | undefined;
    if (raw && typeof raw === 'object') {
      const fiveHour = raw.five_hour;
      const weekly = raw.weekly || raw.seven_day;
      const weeklyOpus = raw.seven_day_opus;
      const weeklySonnet = raw.seven_day_sonnet;

      if (fiveHour && typeof fiveHour === 'object') {
        pushEntry('5h limit', fiveHour.utilization, fiveHour.resets_at);
      }
      if (weekly && typeof weekly === 'object') {
        pushEntry('Weekly limit', weekly.utilization, weekly.resets_at);
      }
      if (weeklyOpus && typeof weeklyOpus === 'object') {
        pushEntry('Weekly Opus', weeklyOpus.utilization, weeklyOpus.resets_at);
      }
      if (weeklySonnet && typeof weeklySonnet === 'object') {
        pushEntry('Weekly Sonnet', weeklySonnet.utilization, weeklySonnet.resets_at);
      }
    }

    return entries.length > 0 ? entries : null;
  };

  const formatEntry = (entry: any) => {
    if (!entry || typeof entry !== 'object') return '—';
    const usedPercent = typeof entry.used_percent === 'number' ? `${entry.used_percent}% used` : '';
    const remainingPercent = typeof entry.remaining_percent === 'number' ? `${entry.remaining_percent}% left` : '';
    const usedTokens = typeof entry.used_tokens === 'number' ? formatNumber(entry.used_tokens) : '';
    const totalTokensValue = typeof entry.total_tokens === 'number' ? formatNumber(entry.total_tokens) : '';
    const remainingTokens = typeof entry.remaining_tokens === 'number' ? `${formatNumber(entry.remaining_tokens)} remaining` : '';
    const credits = typeof entry.credits === 'number' ? `${entry.credits} credits` : '';
    const spentCents = typeof entry.spent_cents === 'number'
      ? entry.spent_cents
      : typeof entry.spent_cost_cents === 'number'
        ? entry.spent_cost_cents
        : null;
    const limitCents = typeof entry.limit_cents === 'number'
      ? entry.limit_cents
      : typeof entry.limit_cost_cents === 'number'
        ? entry.limit_cost_cents
        : null;
    const costLabel = spentCents != null && limitCents != null
      ? `${formatCost(spentCents)} / ${formatCost(limitCents)} spent`
      : spentCents != null
        ? `${formatCost(spentCents)} spent`
        : limitCents != null
          ? `${formatCost(limitCents)} limit`
          : '';
    const resetText = typeof entry.reset_text === 'string' && entry.reset_text
      ? entry.reset_text.toLowerCase().startsWith('resets')
        ? entry.reset_text
        : `resets ${entry.reset_text}`
      : '';

    const parts: string[] = [];
    if (usedPercent) parts.push(usedPercent);
    if (remainingPercent) parts.push(remainingPercent);
    if (usedTokens && totalTokensValue) parts.push(`${usedTokens} used / ${totalTokensValue}`);
    if (remainingTokens && !remainingPercent) parts.push(remainingTokens);
    if (credits) parts.push(credits);
    if (costLabel) parts.push(costLabel);
    if (resetText) parts.push(resetText);

    return parts.length > 0 ? parts.join(' • ') : '—';
  };

  const formatEntryLabel = (label: string | undefined) => {
    switch (label) {
      case 'current_session':
        return 'Current session';
      case 'weekly_all_models':
        return 'Weekly (all models)';
      case 'weekly_sonnet':
        return 'Weekly (Sonnet)';
      case 'extra_usage':
        return 'Extra usage';
      case 'extra usage':
        return 'Extra usage';
      case 'context_window':
        return 'Context window';
      case '5h limit':
        return '5h limit';
      case 'weekly limit':
        return 'Weekly limit';
      case 'credits':
        return 'Credits';
      case 'session_ref':
        return 'Session';
      default:
        return label || 'Usage';
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
        <BarChart3 className="h-4 w-4" />
        Session Analytics
      </h3>

      {!hasActivity && (
        <div className="text-sm text-muted-foreground">
          No analytics recorded yet. This panel updates when hooks report usage or approvals.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<MessageSquare className="h-3 w-3" />}
          label="Total Tokens"
          value={formatNumber(totalTokens)}
          subValue={`In: ${formatNumber(metrics.tokens_in)} / Out: ${formatNumber(metrics.tokens_out)}`}
        />

        <StatCard
          icon={<BarChart3 className="h-3 w-3" />}
          label="Tool Calls"
          value={formatNumber(metrics.tool_calls)}
        />

        <StatCard
          icon={<Clock className="h-3 w-3" />}
          label="Duration"
          value={formatDuration(metrics.first_event_at, metrics.last_event_at)}
        />

        <StatCard
          icon={<Coins className="h-3 w-3" />}
          label="Est. Cost"
          value={formatCost(metrics.estimated_cost_cents)}
          color="text-green-600"
        />
      </div>

      {(totalApprovals > 0 || cacheTokens > 0) && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {totalApprovals > 0 && (
            <>
              <StatCard
                icon={<AlertCircle className="h-3 w-3" />}
                label="Approvals"
                value={totalApprovals.toString()}
                subValue={`${approvalRate}% granted`}
              />
              <StatCard
                icon={<CheckCircle className="h-3 w-3" />}
                label="Granted"
                value={metrics.approvals_granted.toString()}
                color="text-green-600"
              />
              <StatCard
                icon={<XCircle className="h-3 w-3" />}
                label="Denied"
                value={metrics.approvals_denied.toString()}
                color="text-red-600"
              />
            </>
          )}

          {cacheTokens > 0 && (
            <StatCard
              icon={<BarChart3 className="h-3 w-3" />}
              label="Cache Tokens"
              value={formatNumber(cacheTokens)}
              subValue={`Read: ${formatNumber(metrics.tokens_cache_read)} / Write: ${formatNumber(metrics.tokens_cache_write)}`}
            />
          )}
        </div>
      )}

      {sessionUsage.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {sessionUsage.map((row, index) => {
            const providerLabel = row.provider === 'claude_code'
              ? 'Claude Code'
              : row.provider === 'codex'
                ? 'Codex'
                : row.provider;
              const parsedEntries = getParsedEntries(row.raw_json) ?? deriveEntriesFromRow(row);
              let value = '—';
            let subValue: string | undefined;
            if (row.weekly_remaining_tokens !== null && row.weekly_remaining_tokens !== undefined) {
              value = formatNumber(row.weekly_remaining_tokens);
              subValue = 'Weekly remaining';
            } else if (row.remaining_tokens !== null && row.remaining_tokens !== undefined) {
              value = formatNumber(row.remaining_tokens);
              subValue = 'Remaining tokens';
            } else if (row.remaining_requests !== null && row.remaining_requests !== undefined) {
              value = row.remaining_requests.toString();
              subValue = 'Remaining requests';
              } else if (row.raw_text) {
                value = row.raw_text.length > 60 ? `${row.raw_text.slice(0, 60)}…` : row.raw_text;
              }
            if (parsedEntries && parsedEntries.length > 0) {
              return (
                <div key={`${row.provider}-${row.scope}-${index}`} className="bg-muted/30 rounded-lg p-3 space-y-2">
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <Coins className="h-3 w-3" />
                    {providerLabel} Usage
                  </div>
                  <div className="space-y-1 text-xs">
                    {parsedEntries.map((entry, entryIndex) => (
                      <div key={`${providerLabel}-${entryIndex}`} className="flex justify-between gap-3">
                        <span className="text-muted-foreground">{formatEntryLabel(entry?.label)}</span>
                        <span className="text-foreground">{formatEntry(entry)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            }

            return (
              <StatCard
                key={`${row.provider}-${row.scope}-${index}`}
                icon={<Coins className="h-3 w-3" />}
                label={`${providerLabel} Usage`}
                value={value}
                subValue={subValue}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
