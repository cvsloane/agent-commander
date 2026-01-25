'use client';

import { useState } from 'react';
import { Clock, Calendar, Sparkles, Zap, Sun, ChevronDown, ChevronRight } from 'lucide-react';
import { useSettingsStore } from '@/stores/settings';
import { formatCost } from '@/stores/usage';

interface UtilizationBarProps {
  label: string;
  utilization: number;
  resetAt?: string | null;
  icon?: React.ReactNode;
  remainingLabel?: string | null;
}

function UtilizationBar({ label, utilization, resetAt, icon, remainingLabel }: UtilizationBarProps) {
  const safeUtilization = Number.isFinite(utilization) ? utilization : 0;

  const getBarColor = (util: number) => {
    if (util >= 90) return 'bg-red-500';
    if (util >= 75) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const formatResetTime = (isoDate: string) => {
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return `resets at ${isoDate}`;

    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short',
    });
    const formatted = formatter.format(date).replace(',', ' at');

    if (diffMs <= 0) return `resets on ${formatted}`;
    if (diffHours >= 24) {
      const days = Math.floor(diffHours / 24);
      return `resets in ${days}d on ${formatted}`;
    }
    if (diffHours > 0) {
      return `resets in ${diffHours}h ${diffMinutes}m on ${formatted}`;
    }
    return `resets in ${diffMinutes}m on ${formatted}`;
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground flex items-center gap-1.5">
          {icon}
          {label}
        </span>
        <span className="font-medium">
          {safeUtilization.toFixed(0)}%
          {remainingLabel && (
            <span className="text-muted-foreground font-normal ml-2">
              {remainingLabel}
            </span>
          )}
          {typeof resetAt === 'string' && resetAt.length > 0 && (
            <span className="text-muted-foreground font-normal ml-2">
              {formatResetTime(resetAt)}
            </span>
          )}
        </span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full ${getBarColor(safeUtilization)} transition-all duration-300`}
          style={{ width: `${Math.min(safeUtilization, 100)}%` }}
        />
      </div>
    </div>
  );
}

interface GeminiModelUsage {
  usage_left: number;
  reset_period?: string;
}

interface ProviderUsageData {
  provider: string;
  host_id?: string | null;
  session_id?: string | null;
  scope?: string | null;
  reported_at?: string | null;
  raw_text?: string | null;
  five_hour_utilization?: number | null;
  five_hour_reset_at?: string | null;
  weekly_utilization?: number | null;
  weekly_reset_at?: string | null;
  weekly_opus_utilization?: number | null;
  weekly_opus_reset_at?: string | null;
  weekly_sonnet_utilization?: number | null;
  weekly_sonnet_reset_at?: string | null;
  daily_utilization?: number | null;
  daily_reset_at?: string | null;
  remaining_tokens?: number | null;
  remaining_requests?: number | null;
  weekly_remaining_tokens?: number | null;
  reset_at?: string | null;
  raw_json?: Record<string, unknown> | null;
}

interface ProviderUtilizationProps {
  usage: ProviderUsageData[];
}

export function ProviderUtilization({ usage }: ProviderUtilizationProps) {
  const [expandedModels, setExpandedModels] = useState<Record<string, boolean>>({});
  const { visibleProviders } = useSettingsStore();

  const parseReportedAt = (value?: string | null) => {
    if (!value) return 0;
    const ts = new Date(value).getTime();
    return Number.isNaN(ts) ? 0 : ts;
  };

  const getRemainingLabel = (entry: ProviderUsageData): string | null => {
    if (entry.weekly_remaining_tokens != null) {
      return `${entry.weekly_remaining_tokens.toLocaleString()} weekly remaining`;
    }
    if (entry.remaining_tokens != null) {
      return `${entry.remaining_tokens.toLocaleString()} remaining`;
    }
    if (entry.remaining_requests != null) {
      return `${entry.remaining_requests.toLocaleString()} requests remaining`;
    }
    return null;
  };

  const parseNumber = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const parsed = Number(trimmed.replace(/[$,]/g, '').replace(/%$/, ''));
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  const normalizeTimestamp = (value: unknown): string | null => {
    if (value == null) return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
      const ts = value > 1_000_000_000_000 ? value : value * 1000;
      const date = new Date(ts);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const date = new Date(trimmed);
      return Number.isNaN(date.getTime()) ? trimmed : date.toISOString();
    }
    return null;
  };

  type ExtraUsageInfo = {
    spentCents?: number | null;
    limitCents?: number | null;
    usedCredits?: number | null;
    limitCredits?: number | null;
    utilization?: number | null;
    resetText?: string | null;
  };

  const parseDollarToCents = (value: string): number | null => {
    const cleaned = value.replace(/[^0-9.]/g, '');
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed)) return null;
    return Math.round(parsed * 100);
  };

  const getParsedEntries = (rawJson?: Record<string, unknown> | null): Array<Record<string, unknown>> => {
    if (!rawJson || typeof rawJson !== 'object') return [];
    const entries = (rawJson as Record<string, any>).entries;
    if (Array.isArray(entries)) return entries as Array<Record<string, unknown>>;
    const parsedEntries = (rawJson as Record<string, any>)._parsed?.entries;
    if (Array.isArray(parsedEntries)) return parsedEntries as Array<Record<string, unknown>>;
    return [];
  };

  const getCreditsFromRawJson = (rawJson?: Record<string, unknown> | null): number | null => {
    if (!rawJson || typeof rawJson !== 'object') return null;
    const record = rawJson as Record<string, any>;
    const directCredits = parseNumber(record.credits ?? record.remaining_credits ?? record.credits_remaining);
    if (directCredits != null) return directCredits;
    if (record.credits && typeof record.credits === 'object') {
      const nestedCredits = parseNumber(record.credits.balance ?? record.credits.remaining ?? record.credits.amount);
      if (nestedCredits != null) return nestedCredits;
    }
    return getCreditsFromEntries(getParsedEntries(rawJson));
  };

  const getCreditsFromRawText = (rawText?: string | null): number | null => {
    if (!rawText) return null;
    const match = rawText.match(/credits:\s*([0-9,]+)/i);
    if (!match) return null;
    return parseNumber(match[1]);
  };

  const getCreditsFromEntries = (entries: Array<Record<string, unknown>>): number | null => {
    for (const entry of entries) {
      const label = typeof entry.label === 'string' ? entry.label.toLowerCase() : '';
      if (label !== 'credits') continue;
      const credits = parseNumber(entry.credits ?? entry.remaining_credits ?? entry.value);
      if (credits != null) return credits;
    }
    return null;
  };

  const getExtraUsageFromRawText = (
    rawText?: string | null
  ): ExtraUsageInfo | null => {
    if (!rawText) return null;
    const lines = rawText.split('\n');
    const costRe = /\$([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*\/\s*\$([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*spent/i;
    for (const line of lines) {
      const match = line.match(costRe);
      if (!match) continue;
      const spentCents = parseDollarToCents(match[1]);
      const limitCents = parseDollarToCents(match[2]);
      const resetMatch = line.match(/resets[^·\n]*/i);
      const resetText = resetMatch ? resetMatch[0] : null;
      return { spentCents, limitCents, resetText };
    }
    return null;
  };

  const getExtraUsageFromEntries = (
    entries: Array<Record<string, unknown>>
  ): ExtraUsageInfo | null => {
    for (const entry of entries) {
      const label = typeof entry.label === 'string' ? entry.label.toLowerCase() : '';
      if (label !== 'extra_usage' && label !== 'extra usage') continue;
      const spentCents = parseNumber(entry.spent_cents ?? entry.spent_cost_cents ?? entry.spent);
      const limitCents = parseNumber(entry.limit_cents ?? entry.limit_cost_cents ?? entry.limit);
      const usedCredits = parseNumber(entry.used_credits ?? entry.credits_used ?? entry.used);
      const limitCredits = parseNumber(entry.monthly_limit ?? entry.limit_credits ?? entry.credits_limit);
      const utilization = parseNumber(entry.utilization);
      const resetText = typeof entry.reset_text === 'string' ? entry.reset_text : null;
      return { spentCents, limitCents, usedCredits, limitCredits, utilization, resetText };
    }
    return null;
  };

  const getExtraUsageFromRawJson = (rawJson?: Record<string, unknown> | null): ExtraUsageInfo | null => {
    if (!rawJson || typeof rawJson !== 'object') return null;
    const record = rawJson as Record<string, any>;
    const extra = record.extra_usage;
    if (!extra || typeof extra !== 'object') return null;
    const usedCredits = parseNumber(extra.used_credits ?? extra.credits_used ?? extra.used);
    const limitCredits = parseNumber(extra.monthly_limit ?? extra.limit ?? extra.limit_credits ?? extra.monthly_limit_credits);
    const utilization = parseNumber(extra.utilization);
    return { usedCredits, limitCredits, utilization };
  };

  const mergeExtraUsage = (...parts: Array<ExtraUsageInfo | null | undefined>): ExtraUsageInfo | null => {
    const merged: ExtraUsageInfo = {};
    for (const part of parts) {
      if (!part) continue;
      if (merged.spentCents == null && part.spentCents != null) merged.spentCents = part.spentCents;
      if (merged.limitCents == null && part.limitCents != null) merged.limitCents = part.limitCents;
      if (merged.usedCredits == null && part.usedCredits != null) merged.usedCredits = part.usedCredits;
      if (merged.limitCredits == null && part.limitCredits != null) merged.limitCredits = part.limitCredits;
      if (merged.utilization == null && part.utilization != null) merged.utilization = part.utilization;
      if (merged.resetText == null && part.resetText != null) merged.resetText = part.resetText;
    }
    // Claude extra_usage uses credits as cents (e.g. 5000 => $50.00)
    if (merged.spentCents == null && merged.usedCredits != null) {
      merged.spentCents = merged.usedCredits;
    }
    if (merged.limitCents == null && merged.limitCredits != null) {
      merged.limitCents = merged.limitCredits;
    }
    if (
      merged.spentCents == null &&
      merged.limitCents == null &&
      merged.usedCredits == null &&
      merged.limitCredits == null &&
      merged.utilization == null &&
      merged.resetText == null
    ) {
      return null;
    }
    return merged;
  };

  const getRemainingPercentLabel = (
    entries: Array<Record<string, unknown>>,
    matches: (label: string) => boolean
  ): string | null => {
    for (const entry of entries) {
      const label = typeof entry.label === 'string' ? entry.label.toLowerCase() : '';
      if (!label || !matches(label)) continue;
      const remaining = parseNumber(entry.remaining_percent ?? entry.usage_left);
      if (remaining != null) {
        return `${remaining}% left`;
      }
    }
    return null;
  };

  const getOpenCodeStats = (entry: ProviderUsageData): {
    modelLabel?: string | null;
    utilization?: number | null;
    remainingLabel?: string | null;
    resetAt?: string | null;
  } | null => {
    const rawJson = entry.raw_json as Record<string, any> | null;
    const modelRemains =
      (Array.isArray(rawJson?.model_remains) ? rawJson?.model_remains : undefined) ??
      (Array.isArray(rawJson?.data?.model_remains) ? rawJson?.data?.model_remains : undefined);
    const firstModel = Array.isArray(modelRemains) ? modelRemains[0] : null;
    if (!firstModel && entry.remaining_requests == null && entry.reset_at == null) {
      return null;
    }

    const modelLabel =
      typeof firstModel?.model === 'string'
        ? firstModel.model
        : typeof firstModel?.model_name === 'string'
          ? firstModel.model_name
          : typeof firstModel?.model_id === 'string'
            ? firstModel.model_id
            : typeof firstModel?.name === 'string'
              ? firstModel.name
              : null;

    const totalRequests = parseNumber(
      firstModel?.current_interval_total_count ??
        firstModel?.total ??
        firstModel?.total_count ??
        firstModel?.interval_total ??
        firstModel?.limit
    );
    const overrideLimit = parseNumber(
      rawJson?.request_limit ??
        rawJson?.requestLimit ??
        rawJson?.limit_requests ??
        rawJson?.requests_limit ??
        rawJson?.requestLimitCount
    );
    const effectiveTotal = overrideLimit ?? totalRequests;
    const usedRequests = parseNumber(
      firstModel?.current_interval_usage_count ??
        firstModel?.used ??
        firstModel?.used_count ??
        firstModel?.usage_count
    );
    let remainingRequests =
      entry.remaining_requests ??
      parseNumber(firstModel?.remaining ?? firstModel?.remaining_count ?? firstModel?.remaining_requests);

    if (remainingRequests == null && effectiveTotal != null && usedRequests != null) {
      remainingRequests = effectiveTotal - usedRequests;
    }
    if (overrideLimit != null && remainingRequests != null && remainingRequests > overrideLimit) {
      remainingRequests = overrideLimit;
    }

    let utilization: number | null = null;
    let usedFromRemaining: number | null = null;
    if (effectiveTotal != null && effectiveTotal > 0) {
      if (overrideLimit != null) {
        if (remainingRequests != null) {
          usedFromRemaining = Math.max(0, effectiveTotal - remainingRequests);
          utilization = (usedFromRemaining / effectiveTotal) * 100;
        } else if (usedRequests != null) {
          utilization = (usedRequests / effectiveTotal) * 100;
        }
      } else if (usedRequests != null) {
        utilization = (usedRequests / effectiveTotal) * 100;
      } else if (remainingRequests != null) {
        utilization = ((effectiveTotal - remainingRequests) / effectiveTotal) * 100;
      }
    }
    if (utilization != null) {
      utilization = Math.max(0, Math.min(100, utilization));
    }

    const resetAt =
      normalizeTimestamp(firstModel?.end_time ?? firstModel?.reset_at ?? firstModel?.resetAt ?? firstModel?.reset_time) ??
      entry.reset_at ??
      null;

    const remainingLabel =
      remainingRequests != null
        ? overrideLimit != null
          ? `${Math.round((usedFromRemaining ?? Math.max(0, overrideLimit - remainingRequests))).toLocaleString()} / ${Math.round(overrideLimit).toLocaleString()} used • ${Math.max(0, Math.round(remainingRequests)).toLocaleString()} remaining`
          : `${Math.max(0, Math.round(remainingRequests)).toLocaleString()} requests remaining`
        : null;

    return { modelLabel, utilization, remainingLabel, resetAt };
  };

  const getWeeklyUtilizationFromRawJson = (rawJson?: Record<string, unknown> | null): number | null => {
    if (!rawJson || typeof rawJson !== 'object') return null;
    const record = rawJson as Record<string, any>;
    const weekly = record.weekly ?? record.seven_day;
    if (weekly && typeof weekly === 'object') {
      const util = parseNumber(weekly.utilization);
      if (util != null) return util;
    }
    return null;
  };

  const isWeeklyExhausted = (entry: ProviderUsageData, parsedEntries: Array<Record<string, unknown>>): boolean => {
    if (entry.weekly_utilization != null) {
      return entry.weekly_utilization >= 100;
    }
    if (entry.weekly_remaining_tokens === 0) return true;
    if (entry.remaining_tokens === 0 || entry.remaining_requests === 0) return true;

    const rawWeekly = getWeeklyUtilizationFromRawJson(entry.raw_json);
    if (rawWeekly != null) return rawWeekly >= 100;

    for (const item of parsedEntries) {
      const label = typeof item.label === 'string' ? item.label.toLowerCase() : '';
      if (!label.includes('weekly')) continue;
      const used = parseNumber(item.used_percent);
      if (used != null && used >= 100) return true;
      const remaining = parseNumber(item.remaining_percent);
      if (remaining != null && remaining <= 0) return true;
    }
    return false;
  };

  const hasUsageText = (rawText?: string | null): boolean => {
    if (!rawText) return false;
    const lower = rawText.toLowerCase();
    return (
      lower.includes('current session') ||
      lower.includes('current week') ||
      lower.includes('extra usage')
    );
  };

  const hasAnyUtilization = (entry: ProviderUsageData) => {
    if (
      entry.five_hour_utilization != null ||
      entry.weekly_utilization != null ||
      entry.weekly_opus_utilization != null ||
      entry.weekly_sonnet_utilization != null ||
      entry.daily_utilization != null ||
      entry.weekly_remaining_tokens != null ||
      entry.remaining_tokens != null ||
      entry.remaining_requests != null
    ) {
      return true;
    }

    const parsedEntries = getParsedEntries(entry.raw_json);
    const extraUsage = mergeExtraUsage(
      getExtraUsageFromEntries(parsedEntries),
      getExtraUsageFromRawJson(entry.raw_json),
      getExtraUsageFromRawText(entry.raw_text)
    );
    if (
      extraUsage?.spentCents != null ||
      extraUsage?.limitCents != null ||
      extraUsage?.usedCredits != null ||
      extraUsage?.limitCredits != null ||
      extraUsage?.utilization != null
    ) {
      return true;
    }
    return hasUsageText(entry.raw_text);
  };

  // Filter to only entries with utilization data
  const entriesWithUtilization = usage.filter(hasAnyUtilization);

  if (entriesWithUtilization.length === 0) {
    return null;
  }

  const getProviderLabel = (provider: string) => {
    switch (provider) {
      case 'claude_code': return 'Claude';
      case 'codex': return 'Codex';
      case 'gemini_cli': return 'Gemini';
      case 'opencode': return 'OpenCode';
      default: return provider;
    }
  };

  const toggleModels = (key: string) => {
    setExpandedModels(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const geminiModelPriority = [
    'gemini-3-pro',
    'gemini-3-pro-preview',
    'gemini-3-flash',
    'gemini-3-flash-preview',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
  ];

  const getModelPriority = (name: string) => {
    const idx = geminiModelPriority.indexOf(name);
    return idx === -1 ? geminiModelPriority.length + 1 : idx;
  };

  const getGeminiModels = (entry: ProviderUsageData): Array<{ name: string; utilization: number }> => {
    const models = entry.raw_json?.models as Record<string, GeminiModelUsage> | undefined;
    if (!models) return [];
    return Object.entries(models)
      .map(([name, data]) => ({
        name,
        utilization: 100 - Math.max(0, Math.min(100, data.usage_left ?? 100)),
      }))
      .sort((a, b) => {
        const priorityDiff = getModelPriority(a.name) - getModelPriority(b.name);
        if (priorityDiff !== 0) return priorityDiff;
        return b.utilization - a.utilization;
      });
  };

  const mergeGeminiModels = (entries: ProviderUsageData[]) => {
    const merged: Record<string, GeminiModelUsage> = {};
    for (const entry of entries) {
      const models = entry.raw_json?.models as Record<string, GeminiModelUsage> | undefined;
      if (!models) continue;
      for (const [name, data] of Object.entries(models)) {
        if (!merged[name]) {
          merged[name] = data;
          continue;
        }
        const existing = merged[name];
        const existingLeft = existing.usage_left ?? 100;
        const incomingLeft = data.usage_left ?? 100;
        if (incomingLeft < existingLeft) {
          merged[name] = data;
        }
      }
    }
    return Object.keys(merged).length ? merged : undefined;
  };

  const consolidateEntries = (entries: ProviderUsageData[]) => {
    const grouped = new Map<string, ProviderUsageData[]>();
    for (const entry of entries) {
      const key = entry.provider || 'unknown';
      const list = grouped.get(key) ?? [];
      list.push(entry);
      grouped.set(key, list);
    }

    const consolidated: ProviderUsageData[] = [];
    for (const [provider, providerEntries] of Array.from(grouped.entries())) {
      if (providerEntries.length === 1) {
        consolidated.push(providerEntries[0]);
        continue;
      }

      const sortedByTime = [...providerEntries].sort(
        (a, b) => parseReportedAt(b.reported_at) - parseReportedAt(a.reported_at)
      );
      const withModels = sortedByTime.find(entry => entry.raw_json?.models);
      const base = withModels ?? sortedByTime[0];

      if (provider === 'gemini_cli') {
        const mergedModels = mergeGeminiModels(providerEntries);
        consolidated.push({
          ...base,
          raw_json: mergedModels ? { models: mergedModels } : base.raw_json,
        });
      } else {
        consolidated.push(base);
      }
    }

    return consolidated;
  };

  const consolidatedEntries = consolidateEntries(entriesWithUtilization);

  // Filter by provider visibility settings
  const filteredEntries = consolidatedEntries.filter((entry) => {
    const provider = entry.provider as keyof typeof visibleProviders;
    return visibleProviders[provider] !== false;
  });

  if (filteredEntries.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {filteredEntries.map((entry, index) => {
        const openCodeStats = entry.provider === 'opencode' ? getOpenCodeStats(entry) : null;
        const geminiModels = entry.provider === 'gemini_cli' ? getGeminiModels(entry) : [];
        const parsedEntries = getParsedEntries(entry.raw_json);
        const fiveHourRemaining = getRemainingPercentLabel(parsedEntries, (label) => label.includes('5h'));
        const weeklyRemaining = getRemainingPercentLabel(parsedEntries, (label) => label.includes('weekly'));
        const dailyRemaining = getRemainingPercentLabel(parsedEntries, (label) => label.includes('daily'));
        const credits = getCreditsFromRawJson(entry.raw_json) ?? getCreditsFromRawText(entry.raw_text);
        const extraUsage = mergeExtraUsage(
          getExtraUsageFromEntries(parsedEntries),
          getExtraUsageFromRawJson(entry.raw_json),
          getExtraUsageFromRawText(entry.raw_text)
        );
        const extraUsageLabel = extraUsage
          ? extraUsage.spentCents != null && extraUsage.limitCents != null
            ? `${formatCost(extraUsage.spentCents)} / ${formatCost(extraUsage.limitCents)} spent`
            : extraUsage.spentCents != null
              ? `${formatCost(extraUsage.spentCents)} spent`
              : extraUsage.limitCents != null
                ? `${formatCost(extraUsage.limitCents)} limit`
                : null
          : null;
        const extraUsageParts: string[] = [];
        if (extraUsageLabel) extraUsageParts.push(extraUsageLabel);
        if (extraUsage?.utilization != null) {
          extraUsageParts.push(`${Math.round(extraUsage.utilization)}% used`);
        }
        if (extraUsage?.resetText) {
          extraUsageParts.push(extraUsage.resetText);
        }
        const extraUsageText = extraUsageParts.length > 0 ? extraUsageParts.join(' • ') : null;

        const remainingLabel = getRemainingLabel(entry);
        const weeklyExhausted = isWeeklyExhausted(entry, parsedEntries);
        return (
          <div key={`${entry.provider}-${index}`} className="bg-muted/30 rounded-lg p-3 space-y-3">
          <div className="text-xs font-medium text-muted-foreground">
            {getProviderLabel(entry.provider)} Rate Limits
          </div>

          <div className="space-y-2">
            {entry.provider === 'opencode' && openCodeStats?.utilization != null && (
              <UtilizationBar
                label={openCodeStats.modelLabel ? `${openCodeStats.modelLabel} requests` : 'Requests'}
                utilization={openCodeStats.utilization}
                resetAt={openCodeStats.resetAt}
                remainingLabel={openCodeStats.remainingLabel}
                icon={<Clock className="h-3 w-3" />}
              />
            )}

            {entry.five_hour_utilization != null && (
              <UtilizationBar
                label="5-hour limit"
                utilization={entry.five_hour_utilization}
                resetAt={entry.five_hour_reset_at}
                remainingLabel={fiveHourRemaining}
                icon={<Clock className="h-3 w-3" />}
              />
            )}

            {entry.weekly_utilization != null && (
              <UtilizationBar
                label="Weekly limit"
                utilization={entry.weekly_utilization}
                resetAt={entry.weekly_reset_at}
                remainingLabel={weeklyRemaining}
                icon={<Calendar className="h-3 w-3" />}
              />
            )}

            {entry.weekly_opus_utilization != null && (
              <UtilizationBar
                label="Weekly Opus"
                utilization={entry.weekly_opus_utilization}
                resetAt={entry.weekly_opus_reset_at}
                icon={<Sparkles className="h-3 w-3" />}
              />
            )}

            {entry.weekly_sonnet_utilization != null && (
              <UtilizationBar
                label="Weekly Sonnet"
                utilization={entry.weekly_sonnet_utilization}
                resetAt={entry.weekly_sonnet_reset_at}
                icon={<Zap className="h-3 w-3" />}
              />
            )}

            {entry.daily_utilization != null && (
              <UtilizationBar
                label="Daily limit"
                utilization={entry.daily_utilization}
                resetAt={entry.daily_reset_at}
                remainingLabel={dailyRemaining}
                icon={<Sun className="h-3 w-3" />}
              />
            )}

            {remainingLabel && !(entry.provider === 'opencode' && openCodeStats?.remainingLabel) && (
              <div className="text-xs text-foreground/80">{remainingLabel}</div>
            )}

            {weeklyExhausted && extraUsageText && (
              <div className="text-xs text-foreground/80 flex items-center justify-between">
                <span>Extra usage</span>
                <span>{extraUsageText}</span>
              </div>
            )}

            {weeklyExhausted && credits != null && (
              <div className="text-xs text-foreground/80 flex items-center justify-between">
                <span>Credits remaining</span>
                <span>{credits.toLocaleString()} credits</span>
              </div>
            )}

            {/* Gemini per-model breakdown */}
            {entry.provider === 'gemini_cli' && entry.raw_json?.models != null && (
              <div className="mt-2">
                {geminiModels.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    Top models: {geminiModels.slice(0, 3).map(model => model.name).join(', ')}
                  </div>
                )}
                <button
                  onClick={() => toggleModels(`${entry.provider}-${index}`)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {expandedModels[`${entry.provider}-${index}`] ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  Per-model breakdown
                </button>
                {expandedModels[`${entry.provider}-${index}`] && (
                  <div className="mt-2 pl-4 space-y-2 border-l border-muted">
                    {geminiModels.map((model) => (
                      <UtilizationBar
                        key={model.name}
                        label={model.name}
                        utilization={model.utilization}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        );
      })}
    </div>
  );
}
