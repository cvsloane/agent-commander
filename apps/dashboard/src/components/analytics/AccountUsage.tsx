'use client';

import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { getProviderUsage } from '@/lib/api';
import { ProviderUtilization } from './ProviderUtilization';
import { useSettingsStore } from '@/stores/settings';

export function AccountUsage() {
  const { visibleProviders } = useSettingsStore();

  const { data, isLoading, error } = useQuery({
    queryKey: ['provider-usage', 'account'],
    queryFn: () => getProviderUsage({ scope: 'account' }),
    refetchInterval: 60000, // Refresh every minute
  });

  if (isLoading) {
    return (
      <div className="bg-card rounded-lg border p-4">
        <div className="text-sm text-muted-foreground">Loading usage...</div>
      </div>
    );
  }

  if (error || !data?.usage?.length) {
    return null;
  }

  const filteredUsage = data.usage.filter((entry) => {
    const provider = entry.provider as keyof typeof visibleProviders;
    return visibleProviders[provider] !== false;
  });

  const hasAnyUsage = filteredUsage.some((entry) => {
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

    if (entry.raw_json && typeof entry.raw_json === 'object') {
      const raw = entry.raw_json as Record<string, any>;
      if (Array.isArray(raw.entries) || Array.isArray(raw._parsed?.entries)) {
        return true;
      }
      if (raw.weekly || raw.five_hour || raw.seven_day || raw.credits || raw.models) {
        return true;
      }
    }

    if (entry.raw_text) {
      const lower = entry.raw_text.toLowerCase();
      if (
        lower.includes('current session') ||
        lower.includes('current week') ||
        lower.includes('extra usage') ||
        lower.includes('credits')
      ) {
        return true;
      }
    }

    return false;
  });

  if (!hasAnyUsage) {
    return null;
  }

  return (
    <div className="bg-card rounded-lg border p-4 space-y-3">
      <h3 className="text-sm font-medium flex items-center gap-2">
        <Activity className="h-4 w-4" />
        Provider Usage
      </h3>
      <ProviderUtilization usage={filteredUsage} />
    </div>
  );
}
