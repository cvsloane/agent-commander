'use client';

import { useState, useEffect } from 'react';
import { Bell, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { useNotifications } from '@/stores/notifications';
import { requestNotificationPermission, getNotificationPermission } from '@/hooks/useAttentionNotifications';

interface AttentionSettingsProps {
  compact?: boolean;
}

export function AttentionSettings({ compact = false }: AttentionSettingsProps) {
  const {
    notificationsEnabled,
    audioEnabled,
    setAlertChannelEnabled,
  } = useSettingsStore();
  const notifications = useNotifications();
  const [permission, setPermission] = useState<NotificationPermission>('default');

  useEffect(() => {
    setPermission(getNotificationPermission());
  }, []);

  const handleToggleNotifications = async () => {
    const next = !notificationsEnabled;
    if (next) {
      const result = await requestNotificationPermission();
      setPermission(result);
      if (result !== 'granted') {
        notifications.error(
          'Notifications Blocked',
          'Enable notifications in your browser settings to use alerts.'
        );
        return;
      }
      if (typeof window !== 'undefined') {
        localStorage.setItem('attention-last-notified', String(Date.now()));
      }
    }
    setAlertChannelEnabled('browser', next);
  };

  return (
    <div className={cn('space-y-2', compact && 'space-y-1')}>
      <div className="text-xs text-muted-foreground">Attention</div>
      <button
        type="button"
        onClick={handleToggleNotifications}
        className={cn(
          'flex items-center justify-between w-full rounded-md border px-2 py-1 text-xs',
          notificationsEnabled ? 'bg-primary/10 border-primary/40' : 'bg-background'
        )}
      >
        <span className="flex items-center gap-1">
          <Bell className="h-3.5 w-3.5" />
          Notifications
        </span>
        <span className="text-[10px] text-muted-foreground">
          {notificationsEnabled ? 'On' : permission === 'denied' ? 'Blocked' : 'Off'}
        </span>
      </button>
      <button
        type="button"
        onClick={() => setAlertChannelEnabled('audio', !audioEnabled)}
        className={cn(
          'flex items-center justify-between w-full rounded-md border px-2 py-1 text-xs',
          audioEnabled ? 'bg-primary/10 border-primary/40' : 'bg-background'
        )}
      >
        <span className="flex items-center gap-1">
          <Volume2 className="h-3.5 w-3.5" />
          Audio alerts
        </span>
        <span className="text-[10px] text-muted-foreground">{audioEnabled ? 'On' : 'Off'}</span>
      </button>
    </div>
  );
}
