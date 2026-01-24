'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getProviderUsage } from '@/lib/api';
import { useNotifications } from '@/stores/notifications';
import { useSettingsStore, ALERT_PROVIDER_KEYS, type AlertProviderKey } from '@/stores/settings';
import { getPrimaryUtilization, shouldTriggerAlertChannel } from '@/lib/alertPolicy';

const isAlertProviderKey = (value: string): value is AlertProviderKey =>
  ALERT_PROVIDER_KEYS.includes(value as AlertProviderKey);

export function useProviderUsageAlerts() {
  const notifications = useNotifications();
  const alertSettings = useSettingsStore((s) => s.alertSettings);
  const warnedRef = useRef<Record<string, Set<number>>>({});
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
    warnedRef.current = {};
  }, [alertSettings.usageThresholds]);

  useEffect(() => {
    if (!data?.usage?.length) return;
    const isFocused = typeof document !== 'undefined' ? document.hasFocus() : true;
    let shouldPlayAudio = false;

    for (const entry of data.usage) {
      const provider = entry.provider || 'unknown';
      if (!isAlertProviderKey(provider)) continue;
      const utilization = getPrimaryUtilization(entry);
      if (utilization == null) continue;

      const thresholds = alertSettings.usageThresholds[provider] || [];
      if (thresholds.length === 0) continue;

      if (!warnedRef.current[provider]) {
        warnedRef.current[provider] = new Set();
      }
      const warned = warnedRef.current[provider];

      for (const threshold of thresholds) {
        if (utilization < threshold || warned.has(threshold)) continue;
        warned.add(threshold);

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
      }
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
