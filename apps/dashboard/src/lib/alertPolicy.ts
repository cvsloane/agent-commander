import { ALERT_PROVIDER_KEYS, type AlertEventKey, type AlertProviderKey, type AlertSettings } from '@/stores/settings';

export type AlertChannel = 'browser' | 'audio' | 'toast';

function resolveProvider(provider?: string | null): AlertProviderKey {
  if (!provider) return 'unknown';
  if (ALERT_PROVIDER_KEYS.includes(provider as AlertProviderKey)) {
    return provider as AlertProviderKey;
  }
  return 'unknown';
}

export function shouldTriggerAlertChannel(
  settings: AlertSettings,
  channel: AlertChannel,
  event: AlertEventKey,
  provider?: string | null,
  isFocused: boolean = true
): boolean {
  const channelSettings = settings[channel];
  if (!channelSettings?.enabled) return false;
  if (!channelSettings.events?.[event]) return false;
  const providerKey = resolveProvider(provider);
  if (channelSettings.providers && channelSettings.providers[providerKey] === false) {
    return false;
  }
  if (channelSettings.onlyWhenUnfocused && isFocused) {
    return false;
  }
  return true;
}

export function getPrimaryUtilization(entry: {
  weekly_utilization?: number | null;
  five_hour_utilization?: number | null;
  daily_utilization?: number | null;
}): number | null {
  if (entry.weekly_utilization != null) return entry.weekly_utilization;
  if (entry.five_hour_utilization != null) return entry.five_hour_utilization;
  if (entry.daily_utilization != null) return entry.daily_utilization;
  return null;
}
