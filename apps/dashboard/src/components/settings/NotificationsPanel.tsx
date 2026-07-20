'use client';

import { useEffect, useRef, useState } from 'react';
import { Bell, Settings, TestTube2, Volume2 } from 'lucide-react';
import {
  requestNotificationPermission,
  getNotificationPermission,
} from '@/hooks/useAttentionNotifications';
import { useNotifications } from '@/stores/notifications';
import { DEFAULT_ALERT_SETTINGS, useSettingsStore } from '@/stores/settings';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { PushNotificationsCard } from '@/components/pwa/PushNotificationsCard';
import { AlertRuleControls } from './AlertRuleControls';

export function NotificationsPanel() {
  const notifications = useNotifications();
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const notificationsEnabled = useSettingsStore((state) => state.notificationsEnabled);
  const audioEnabled = useSettingsStore((state) => state.audioEnabled);
  const alertSettings = useSettingsStore((state) => state.alertSettings);
  const setAlertChannelEnabled = useSettingsStore((state) => state.setAlertChannelEnabled);
  const setAlertChannelFocus = useSettingsStore((state) => state.setAlertChannelFocus);
  const setAlertAudioVolume = useSettingsStore((state) => state.setAlertAudioVolume);

  useEffect(() => {
    setPermission(getNotificationPermission());
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const audio = new Audio('/sounds/notification.mp3');
    audio.volume = alertSettings.audio.volume ?? DEFAULT_ALERT_SETTINGS.audio.volume;
    audioRef.current = audio;
    return () => {
      audioRef.current = null;
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
    };
  }, [alertSettings.audio.volume]);

  const playFallbackBeep = () => {
    if (typeof window === 'undefined') return;
    try {
      if (!audioContextRef.current) audioContextRef.current = new AudioContext();
      const context = audioContextRef.current;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 880;
      gain.gain.value = 0.05;
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.15);
    } catch {
      // Audio feedback is best-effort.
    }
  };

  const handleBrowserToggle = async (enabled: boolean) => {
    if (enabled) {
      const result = await requestNotificationPermission();
      setPermission(result);
      if (result !== 'granted') {
        notifications.error(
          'Notifications Blocked',
          'Enable notifications in your browser settings to use alerts.'
        );
        return;
      }
      localStorage.setItem('attention-last-notified', String(Date.now()));
    }
    setAlertChannelEnabled('browser', enabled);
  };

  const handleTestNotification = async () => {
    const result = permission === 'granted' ? permission : await requestNotificationPermission();
    setPermission(result);
    if (result !== 'granted') {
      notifications.error('Notifications Blocked', 'Enable notifications to test alerts.');
      return;
    }
    new Notification('Agent Commander Test', {
      body: 'Browser notifications are working.',
      tag: 'agent-command-test',
    });
  };

  const handleTestAudio = () => {
    if (!audioRef.current) {
      playFallbackBeep();
      return;
    }
    audioRef.current.currentTime = 0;
    audioRef.current.volume = alertSettings.audio.volume ?? DEFAULT_ALERT_SETTINGS.audio.volume;
    audioRef.current.play().catch(playFallbackBeep);
  };

  return (
    <section className="space-y-4" aria-labelledby="notifications-settings-title">
      <h2
        id="notifications-settings-title"
        className="text-sm font-medium uppercase tracking-wider text-muted-foreground"
      >
        Notifications
      </h2>
      <div className="grid gap-4">
        <div className="space-y-4 rounded-lg border p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label htmlFor="browser-notifications" className="flex items-center gap-2 text-sm font-medium">
                <Bell className="h-4 w-4" aria-hidden="true" />
                Browser Notifications
              </Label>
              <div className="text-xs text-muted-foreground">
                Permission:{' '}
                {permission === 'granted'
                  ? 'Granted'
                  : permission === 'denied'
                    ? 'Blocked'
                    : 'Not granted'}
              </div>
            </div>
            <Switch
              id="browser-notifications"
              checked={notificationsEnabled}
              onCheckedChange={handleBrowserToggle}
            />
          </div>
          <div className="flex min-h-11 items-center justify-between gap-3">
            <Label htmlFor="browser-unfocused" className="text-xs text-muted-foreground">
              Only when app is unfocused
            </Label>
            <Switch
              id="browser-unfocused"
              checked={alertSettings.browser.onlyWhenUnfocused}
              onCheckedChange={(checked) => setAlertChannelFocus('browser', checked)}
            />
          </div>
          <AlertRuleControls channel="browser" />
          <Button
            variant="outline"
            size="mobile"
            className="gap-2"
            onClick={() => void handleTestNotification()}
          >
            <TestTube2 className="h-4 w-4" aria-hidden="true" />
            Test Notification
          </Button>
        </div>

        <PushNotificationsCard />

        <div className="space-y-4 rounded-lg border p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label htmlFor="audio-alerts" className="flex items-center gap-2 text-sm font-medium">
                <Volume2 className="h-4 w-4" aria-hidden="true" />
                Audio Alerts
              </Label>
              <div className="text-xs text-muted-foreground">
                Volume: {Math.round((alertSettings.audio.volume ?? 0.5) * 100)}%
              </div>
            </div>
            <Switch
              id="audio-alerts"
              checked={audioEnabled}
              onCheckedChange={(checked) => setAlertChannelEnabled('audio', checked)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="audio-volume" className="text-xs text-muted-foreground">
              Volume
            </Label>
            <input
              id="audio-volume"
              type="range"
              min={0}
              max={100}
              value={Math.round((alertSettings.audio.volume ?? 0.5) * 100)}
              onChange={(event) => setAlertAudioVolume(Number(event.target.value) / 100)}
              className="h-11 w-full"
            />
          </div>
          <div className="flex min-h-11 items-center justify-between gap-3">
            <Label htmlFor="audio-unfocused" className="text-xs text-muted-foreground">
              Only when app is unfocused
            </Label>
            <Switch
              id="audio-unfocused"
              checked={alertSettings.audio.onlyWhenUnfocused}
              onCheckedChange={(checked) => setAlertChannelFocus('audio', checked)}
            />
          </div>
          <AlertRuleControls channel="audio" />
          <Button variant="outline" size="mobile" className="gap-2" onClick={handleTestAudio}>
            <TestTube2 className="h-4 w-4" aria-hidden="true" />
            Test Audio
          </Button>
        </div>

        <div className="space-y-4 rounded-lg border p-4">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="toast-alerts" className="flex items-center gap-2 text-sm font-medium">
              <Settings className="h-4 w-4" aria-hidden="true" />
              In-app Toasts
            </Label>
            <Switch
              id="toast-alerts"
              checked={alertSettings.toast.enabled}
              onCheckedChange={(checked) => setAlertChannelEnabled('toast', checked)}
            />
          </div>
          <AlertRuleControls channel="toast" />
        </div>
      </div>
    </section>
  );
}
