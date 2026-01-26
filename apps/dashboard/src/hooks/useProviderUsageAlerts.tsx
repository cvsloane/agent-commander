'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getProviderUsage } from '@/lib/api';
import { useNotifications } from '@/stores/notifications';
import { useSettingsStore, ALERT_PROVIDER_KEYS, type AlertProviderKey } from '@/stores/settings';
import { getPrimaryUtilization, shouldTriggerAlertChannel } from '@/lib/alertPolicy';

const isAlertProviderKey = (value: string): value is AlertProviderKey =>
  ALERT_PROVIDER_KEYS.includes(value as AlertProviderKey);

const WARNED_STORAGE_KEY = 'ac-usage-threshold-warned-v1';
const FALLBACK_WARNED_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type WarnedStore = Record<string, Record<string, number>>;

const loadWarnedStore = (): WarnedStore => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(WARNED_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as WarnedStore;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
};

const saveWarnedStore = (store: WarnedStore) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(WARNED_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore storage errors.
  }
};

const getWarningExpiry = (entry: {
  weekly_reset_at?: string | null;
  five_hour_reset_at?: string | null;
  daily_reset_at?: string | null;
  reset_at?: string | null;
}, now: number): number => {
  const resetAt =
    entry.weekly_reset_at ||
    entry.five_hour_reset_at ||
    entry.daily_reset_at ||
    entry.reset_at ||
    null;
  if (resetAt) {
    const ts = Date.parse(resetAt);
    if (!Number.isNaN(ts) && ts > now) {
      return ts;
    }
  }
  return now + FALLBACK_WARNED_TTL_MS;
};

const pruneWarnedStore = (store: WarnedStore, now: number): WarnedStore => {
  let changed = false;
  const next: WarnedStore = {};
  for (const [provider, thresholds] of Object.entries(store)) {
    const filtered: Record<string, number> = {};
    for (const [threshold, expiry] of Object.entries(thresholds || {})) {
      if (typeof expiry !== 'number') {
        changed = true;
        continue;
      }
      if (expiry > now) {
        filtered[threshold] = expiry;
      } else {
        changed = true;
      }
    }
    if (Object.keys(filtered).length > 0) {
      next[provider] = filtered;
    } else if (Object.keys(thresholds || {}).length > 0) {
      changed = true;
    }
  }
  if (changed) {
    saveWarnedStore(next);
  }
  return next;
};

export function useProviderUsageAlerts() {
  const notifications = useNotifications();
  const alertSettings = useSettingsStore((s) => s.alertSettings);
  const warnedRef = useRef<WarnedStore>(loadWarnedStore());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const { data } = useQuery({
    queryKey: ['provider-usage', 'account'],
    queryFn: () => getProviderUsage({ scope: 'account' }),
    refetchInterval: 60000,
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!audioRef.current) {
      const audio = new Audio('/sounds/notification.mp3');
      audioRef.current = audio;
    }
    return () => {
      audioRef.current = null;
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const now = Date.now();
    warnedRef.current = pruneWarnedStore(warnedRef.current, now);
  }, [alertSettings.usageThresholds]);

  useEffect(() => {
    if (!data?.usage?.length) return;
    const isFocused = typeof document !== 'undefined' ? document.hasFocus() : true;
    let shouldPlayAudio = false;

    let warnedUpdated = false;

    for (const entry of data.usage) {
      const provider = entry.provider || 'unknown';
      if (!isAlertProviderKey(provider)) continue;
      const utilization = getPrimaryUtilization(entry);
      if (utilization == null) continue;

      const thresholds = alertSettings.usageThresholds[provider] || [];
      if (thresholds.length === 0) continue;

      if (!warnedRef.current[provider]) {
        warnedRef.current[provider] = {};
      }
      const warned = warnedRef.current[provider];

      for (const threshold of thresholds) {
        if (utilization < threshold) continue;
        const key = String(threshold);
        const now = Date.now();
        const expiry = warned[key];
        if (typeof expiry === 'number' && expiry > now) {
          continue;
        }

        const title = `${provider.toUpperCase()} Usage`;
        const message =
          threshold >= 100
            ? `Usage limit reached for ${provider}.`
            : `${threshold}% of ${provider} usage limit reached.`;

        if (shouldTriggerAlertChannel(alertSettings, 'toast', 'usage_thresholds', provider, isFocused)) {
          if (threshold >= 100) {
            notifications.error('Usage Limit Reached', message, { duration: 0 });
          } else {
            notifications.warning('Usage Warning', message, { duration: 6000 });
          }
        }

        if (shouldTriggerAlertChannel(alertSettings, 'browser', 'usage_thresholds', provider, isFocused)) {
          if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
            new Notification(title, { body: message, tag: `usage-${provider}-${threshold}` });
          }
        }

        if (shouldTriggerAlertChannel(alertSettings, 'audio', 'usage_thresholds', provider, isFocused)) {
          shouldPlayAudio = true;
        }

        warned[key] = getWarningExpiry(entry, now);
        warnedUpdated = true;
      }
    }

    if (warnedUpdated) {
      saveWarnedStore(warnedRef.current);
    }

    if (shouldPlayAudio) {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.volume = alertSettings.audio.volume ?? 0.5;
        audioRef.current.play().catch(() => {
          if (!audioContextRef.current) {
            audioContextRef.current = new AudioContext();
          }
          const ctx = audioContextRef.current;
          const oscillator = ctx.createOscillator();
          const gain = ctx.createGain();
          oscillator.type = 'sine';
          oscillator.frequency.value = 880;
          gain.gain.value = 0.05;
          oscillator.connect(gain);
          gain.connect(ctx.destination);
          oscillator.start();
          oscillator.stop(ctx.currentTime + 0.15);
        });
      }
    }
  }, [data, alertSettings, notifications]);
}
