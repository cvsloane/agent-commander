'use client';

import { useEffect, useRef } from 'react';
import { useOrchestratorStore } from '@/stores/orchestrator';
import { useSettingsStore } from '@/stores/settings';
import { shouldTriggerAlertChannel } from '@/lib/alertPolicy';

/**
 * Dispatches browser notifications for new orchestrator items.
 * Deduplicates by item ID to prevent repeat notifications.
 * Only sends notifications when permission is granted and feature is enabled.
 */
export function useAttentionNotifications() {
  const items = useOrchestratorStore((s) => s.items);
  const alertSettings = useSettingsStore((s) => s.alertSettings);
  const seen = useRef<Set<string>>(new Set());
  const lastNotifiedAt = useRef<number>(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = localStorage.getItem('attention-last-notified');
    if (stored) {
      const value = Number(stored);
      if (!Number.isNaN(value)) {
        lastNotifiedAt.current = value;
      }
    }
  }, []);

  useEffect(() => {
    // Skip if disabled or no permission
    if (!alertSettings.browser.enabled) return;
    if (typeof window === 'undefined') return;
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    for (const item of items) {
      // Skip dismissed items
      if (item.dismissedAt) continue;
      // Skip idled items
      if (item.idledAt) continue;
      // Skip items created before last seen timestamp
      if (item.createdAt && item.createdAt <= lastNotifiedAt.current) continue;
      // Skip already notified items
      if (seen.current.has(item.id)) continue;

      seen.current.add(item.id);
      if (item.createdAt && item.createdAt > lastNotifiedAt.current) {
        lastNotifiedAt.current = item.createdAt;
        localStorage.setItem('attention-last-notified', String(item.createdAt));
      }

      const provider = item.sessionProvider || 'unknown';
      const eventType =
        item.source === 'approval'
          ? 'approvals'
          : item.source === 'snapshot'
            ? 'snapshot_action'
            : item.sessionStatus === 'WAITING_FOR_INPUT'
              ? 'waiting_input'
              : item.sessionStatus === 'WAITING_FOR_APPROVAL'
                ? 'waiting_approval'
                : item.sessionStatus === 'ERROR'
                  ? 'error'
                  : null;

      if (!eventType) continue;
      const isFocused = typeof document !== 'undefined' ? document.hasFocus() : true;
      if (!shouldTriggerAlertChannel(alertSettings, 'browser', eventType, provider, isFocused)) {
        continue;
      }

      const title = item.sessionTitle || 'Session needs attention';
      const body = item.action?.question || 'Action required';

      new Notification(title, {
        body,
        tag: item.id,
      });
    }
  }, [items, alertSettings]);
}

/**
 * Request notification permission from the user.
 * Must be called from a user gesture (e.g., button click).
 * Returns the resulting permission state.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined') return 'denied';
  if (!('Notification' in window)) return 'denied';

  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

/**
 * Check current notification permission state.
 */
export function getNotificationPermission(): NotificationPermission {
  if (typeof window === 'undefined') return 'denied';
  if (!('Notification' in window)) return 'denied';
  return Notification.permission;
}
