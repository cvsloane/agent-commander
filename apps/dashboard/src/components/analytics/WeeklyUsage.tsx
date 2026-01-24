'use client';

import { useQuery } from '@tanstack/react-query';
import { TrendingUp, Settings } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { UsageMeter } from './UsageMeter';
import { DailyChart } from './DailyChart';
import { PlanSelector } from './PlanSelector';
import { getWeeklyUsage, getProviderUsage } from '@/lib/api';
import { useUsageStore, formatTokens, formatCost, getNextMonday, PLAN_LIMITS } from '@/stores/usage';
import { useState } from 'react';

export function WeeklyUsage() {
  const [showPlanSelector, setShowPlanSelector] = useState(false);
  const { plan, getPlanLimit, getUsagePercentage } = useUsageStore();

  const { data: usage, isLoading } = useQuery({
    queryKey: ['weeklyUsage'],
    queryFn: getWeeklyUsage,
    refetchInterval: 60000, // Refresh every minute
  });

  const { data: providerUsage } = useQuery({
    queryKey: ['providerUsage', 'account'],
    queryFn: () => getProviderUsage({ scope: 'account' }),
    refetchInterval: 60000,
  });

  const totalTokens = usage?.total_tokens || 0;
  const limit = getPlanLimit();
  const percentage = getUsagePercentage(totalTokens);
  const totalCost = usage?.total_cost_cents || 0;
  const providerRows = providerUsage?.usage || [];

  // Usage alerts are handled by the global provider alert hook.

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

    // Prefer normalized columns if present
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

    // Fall back to raw_json structure from usage scripts
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

  const parseNumber = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const parsed = Number(trimmed.replace(/,/g, ''));
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  // Check if any utilization metric is at 100% (provider exhausted)
  const isProviderExhausted = (row: any): boolean => {
    if (row.weekly_remaining_tokens === 0 || row.remaining_tokens === 0 || row.remaining_requests === 0) {
      return true;
    }

    // Check normalized columns
    if (row.five_hour_utilization >= 100) return true;
    if (row.weekly_utilization >= 100) return true;
    if (row.weekly_opus_utilization >= 100) return true;
    if (row.weekly_sonnet_utilization >= 100) return true;

    // Check raw_json structure
    const raw = row.raw_json as Record<string, any> | null | undefined;
    if (raw && typeof raw === 'object') {
      const parsedEntries = getParsedEntries(raw) ?? [];
      for (const entry of parsedEntries) {
        const remainingPercent = parseNumber(entry?.remaining_percent ?? entry?.usage_left);
        if (remainingPercent === 0) return true;
        const remainingTokens = parseNumber(entry?.remaining_tokens);
        if (remainingTokens === 0) return true;
        const remainingRequests = parseNumber(entry?.remaining_requests);
        if (remainingRequests === 0) return true;
        const usedPercent = parseNumber(entry?.used_percent);
        if (usedPercent === 100) return true;
      }

      const fiveHour = raw.five_hour;
      const weekly = raw.weekly || raw.seven_day;
      const weeklyOpus = raw.seven_day_opus;
      const weeklySonnet = raw.seven_day_sonnet;

      if (fiveHour?.utilization >= 100) return true;
      if (weekly?.utilization >= 100) return true;
      if (weeklyOpus?.utilization >= 100) return true;
      if (weeklySonnet?.utilization >= 100) return true;
      if (parseNumber(fiveHour?.remaining_tokens) === 0) return true;
      if (parseNumber(weekly?.remaining_tokens) === 0) return true;
      if (parseNumber(weeklyOpus?.remaining_tokens) === 0) return true;
      if (parseNumber(weeklySonnet?.remaining_tokens) === 0) return true;
      if (parseNumber(fiveHour?.remaining_requests) === 0) return true;
      if (parseNumber(weekly?.remaining_requests) === 0) return true;
      if (parseNumber(weeklyOpus?.remaining_requests) === 0) return true;
      if (parseNumber(weeklySonnet?.remaining_requests) === 0) return true;
      if (parseNumber(fiveHour?.remaining_percent) === 0) return true;
      if (parseNumber(weekly?.remaining_percent) === 0) return true;
      if (parseNumber(weeklyOpus?.remaining_percent) === 0) return true;
      if (parseNumber(weeklySonnet?.remaining_percent) === 0) return true;
    }

    return false;
  };

  // Extract credits from raw_json if available
  const getCredits = (row: any): number | null => {
    if (row?.raw_text) {
      const match = String(row.raw_text).match(/credits:\s*([0-9,]+)/i);
      if (match) {
        const rawValue = match[1]?.trim();
        if (rawValue) {
          const parsed = parseNumber(rawValue);
          if (parsed != null) return parsed;
        }
      }
    }

    const raw = row.raw_json as Record<string, any> | null | undefined;
    if (!raw || typeof raw !== 'object') return null;

    // Direct credits field
    const directCredits = parseNumber(raw.credits ?? raw.remaining_credits ?? raw.credits_remaining);
    if (directCredits != null) return directCredits;

    // Nested credits object (e.g., codex-usage JSON)
    const nestedCredits = raw.credits && typeof raw.credits === 'object'
      ? parseNumber(raw.credits.balance ?? raw.credits.remaining ?? raw.credits.amount)
      : null;
    if (nestedCredits != null) return nestedCredits;

    // Check _parsed.credits
    const parsedCredits = raw._parsed
      ? parseNumber(raw._parsed.credits ?? raw._parsed.remaining_credits ?? raw._parsed.credits_remaining)
      : null;
    if (parsedCredits != null) return parsedCredits;

    // Check for credits in entries
    if (Array.isArray(raw.entries)) {
      const creditsEntry = raw.entries.find((e: any) => e?.label === 'credits');
      if (creditsEntry) {
        const entryCredits = parseNumber(creditsEntry.credits ?? creditsEntry.remaining_credits ?? creditsEntry.value);
        if (entryCredits != null) return entryCredits;
      }
    }
    if (raw._parsed && Array.isArray(raw._parsed.entries)) {
      const creditsEntry = raw._parsed.entries.find((e: any) => e?.label === 'credits');
      if (creditsEntry) {
        const entryCredits = parseNumber(creditsEntry.credits ?? creditsEntry.remaining_credits ?? creditsEntry.value);
        if (entryCredits != null) return entryCredits;
      }
    }

    return null;
  };

  const formatEntry = (entry: any) => {
    if (!entry || typeof entry !== 'object') return '—';
    const usedPercent = typeof entry.used_percent === 'number' ? `${entry.used_percent}% used` : '';
    const remainingPercent = typeof entry.remaining_percent === 'number' ? `${entry.remaining_percent}% left` : '';
    const usedTokens = typeof entry.used_tokens === 'number' ? formatTokens(entry.used_tokens) : '';
    const totalTokensValue = typeof entry.total_tokens === 'number' ? formatTokens(entry.total_tokens) : '';
    const remainingTokens = typeof entry.remaining_tokens === 'number' ? `${formatTokens(entry.remaining_tokens)} remaining` : '';
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

  // Calculate days until reset
  const nextReset = getNextMonday();
  const now = new Date();
  const daysUntilReset = Math.ceil((nextReset.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Weekly Usage
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs gap-1"
            onClick={() => setShowPlanSelector(!showPlanSelector)}
          >
            <Settings className="h-3 w-3" />
            {PLAN_LIMITS[plan].description}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {showPlanSelector && (
          <PlanSelector onClose={() => setShowPlanSelector(false)} />
        )}

        {isLoading ? (
          <div className="h-24 flex items-center justify-center text-muted-foreground">
            Loading usage data...
          </div>
        ) : (
          <>
            {/* Usage Meter */}
            <UsageMeter
              current={totalTokens}
              limit={limit}
              percentage={percentage}
            />

            {/* Token counts */}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                {formatTokens(totalTokens)} / {limit === Infinity ? 'Unlimited' : formatTokens(limit)} tokens
              </span>
              <span className="text-muted-foreground">
                {Math.round(percentage)}%
              </span>
            </div>

            {/* Daily Chart */}
            {usage?.daily && usage.daily.length > 0 && (
              <div className="pt-2">
                <DailyChart data={usage.daily} />
              </div>
            )}

            {/* Provider-reported remaining usage */}
            {providerRows.length > 0 && (
              <div className="pt-2 border-t text-xs text-muted-foreground space-y-1">
                <div className="font-medium text-foreground/80">Provider Remaining</div>
                {providerRows.map((row, index) => {
                  const label = row.provider === 'claude_code'
                    ? 'Claude Code'
                    : row.provider === 'codex'
                      ? 'Codex'
                      : row.provider;
                  const parsedEntries = getParsedEntries(row.raw_json) ?? deriveEntriesFromRow(row);
                  const exhausted = isProviderExhausted(row);
                  const credits = getCredits(row);
                  let value = '—';
                  if (row.weekly_remaining_tokens !== null && row.weekly_remaining_tokens !== undefined) {
                    value = `${formatTokens(row.weekly_remaining_tokens)} weekly remaining`;
                  } else if (row.remaining_tokens !== null && row.remaining_tokens !== undefined) {
                    value = `${formatTokens(row.remaining_tokens)} remaining`;
                  } else if (row.remaining_requests !== null && row.remaining_requests !== undefined) {
                    value = `${row.remaining_requests} requests remaining`;
                  } else if (row.raw_text) {
                    value = row.raw_text.length > 80 ? `${row.raw_text.slice(0, 80)}…` : row.raw_text;
                  }
                  return (
                    <div key={`${row.provider}-${row.scope}-${index}`} className="space-y-1">
                      <div className="flex justify-between gap-3">
                        <span className="truncate">{label}</span>
                        {!parsedEntries && (
                          <span className="text-foreground/80 text-right">{value}</span>
                        )}
                      </div>
                      {parsedEntries && (
                        <div className="space-y-1 text-foreground/80">
                          {parsedEntries.map((entry, entryIndex) => (
                            <div key={`${label}-${entryIndex}`} className="flex justify-between gap-3">
                              <span className="truncate">{formatEntryLabel(entry?.label)}</span>
                              <span className="text-right">{formatEntry(entry)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {credits !== null && !exhausted && (
                        <div className="mt-1 text-foreground/70 text-xs flex justify-between items-center">
                          <span>Credits remaining</span>
                          <span>{credits.toLocaleString()} credits</span>
                        </div>
                      )}
                      {/* Show credits prominently when provider usage is exhausted */}
                      {exhausted && credits !== null && (
                        <div className="mt-1 px-2 py-1 bg-amber-500/10 border border-amber-500/30 rounded text-amber-600 dark:text-amber-400 text-xs font-medium flex justify-between items-center">
                          <span>Credits remaining</span>
                          <span>{credits.toLocaleString()} credits</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Footer info */}
            <div className="flex justify-between text-xs text-muted-foreground pt-2 border-t">
              <span>
                Resets in {daysUntilReset} day{daysUntilReset !== 1 ? 's' : ''}
              </span>
              <span>
                Est. cost: {formatCost(totalCost)}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
