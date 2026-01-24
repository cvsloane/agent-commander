'use client';

import { useEffect, useRef, useState } from 'react';
import { Bell, Boxes, Monitor, Moon, Sun, TestTube2, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { requestNotificationPermission, getNotificationPermission } from '@/hooks/useAttentionNotifications';
import { useNotifications } from '@/stores/notifications';
import { useThemeStore } from '@/stores/theme';
import { DEFAULT_ALERT_SETTINGS, useSettingsStore } from '@/stores/settings';

interface SettingsQuickPanelProps {
  className?: string;
}

export function SettingsQuickPanel({ className }: SettingsQuickPanelProps) {
  const notifications = useNotifications();
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const { theme, setTheme } = useThemeStore();
  const {
    notificationsEnabled,
    audioEnabled,
    alertSettings,
    setAlertChannelEnabled,
    setAlertChannelFocus,
    setAlertAudioVolume,
    showVisualizerInSidebar,
    setShowVisualizerInSidebar,
  } = useSettingsStore();

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
    } catch {
      // ignore
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
      if (typeof window !== 'undefined') {
        localStorage.setItem('attention-last-notified', String(Date.now()));
      }
    }
    setAlertChannelEnabled('browser', enabled);
  };

  const handleTestNotification = async () => {
    const result =
      permission === 'granted' ? permission : await requestNotificationPermission();
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
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.volume = alertSettings.audio.volume ?? DEFAULT_ALERT_SETTINGS.audio.volume;
      audioRef.current.play().catch(() => playFallbackBeep());
    } else {
      playFallbackBeep();
    }
  };

  return (
    <div className={cn('space-y-6', className)}>
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Appearance
        </h3>
        <div className="space-y-2">
          <Label className="text-sm font-medium">Theme</Label>
          <RadioGroup
            value={theme}
            onValueChange={(value) => setTheme(value as 'light' | 'dark' | 'system')}
            className="space-y-2"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="light" id="quick-theme-light" />
              <Label htmlFor="quick-theme-light" className="cursor-pointer flex items-center gap-2">
                <Sun className="h-4 w-4" />
                Light
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="dark" id="quick-theme-dark" />
              <Label htmlFor="quick-theme-dark" className="cursor-pointer flex items-center gap-2">
                <Moon className="h-4 w-4" />
                Dark
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="system" id="quick-theme-system" />
              <Label htmlFor="quick-theme-system" className="cursor-pointer flex items-center gap-2">
                <Monitor className="h-4 w-4" />
                System
              </Label>
            </div>
          </RadioGroup>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Notifications
        </h3>

        <div className="rounded-lg border p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium flex items-center gap-2">
                <Bell className="h-4 w-4" />
                Browser Notifications
              </div>
              <div className="text-xs text-muted-foreground">
                Permission: {permission === 'granted' ? 'Granted' : permission === 'denied' ? 'Blocked' : 'Not granted'}
              </div>
            </div>
            <Switch
              checked={notificationsEnabled}
              onCheckedChange={handleBrowserToggle}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Only when app is unfocused</Label>
            <Switch
              checked={alertSettings.browser.onlyWhenUnfocused}
              onCheckedChange={(checked) => setAlertChannelFocus('browser', checked)}
            />
          </div>

          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={handleTestNotification}
          >
            <TestTube2 className="h-4 w-4" />
            Test Notification
          </Button>
        </div>

        <div className="rounded-lg border p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium flex items-center gap-2">
                <Volume2 className="h-4 w-4" />
                Audio Alerts
              </div>
              <div className="text-xs text-muted-foreground">
                Volume: {Math.round((alertSettings.audio.volume ?? 0.5) * 100)}%
              </div>
            </div>
            <Switch
              checked={audioEnabled}
              onCheckedChange={(checked) => setAlertChannelEnabled('audio', checked)}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Volume</Label>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round((alertSettings.audio.volume ?? 0.5) * 100)}
              onChange={(e) => setAlertAudioVolume(Number(e.target.value) / 100)}
              className="w-full"
            />
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Only when app is unfocused</Label>
            <Switch
              checked={alertSettings.audio.onlyWhenUnfocused}
              onCheckedChange={(checked) => setAlertChannelFocus('audio', checked)}
            />
          </div>

          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={handleTestAudio}
          >
            <TestTube2 className="h-4 w-4" />
            Test Audio
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Visualizer
        </h3>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Boxes className="h-4 w-4 text-muted-foreground" />
            <Label htmlFor="quick-show-visualizer" className="cursor-pointer">
              Show in Sidebar
            </Label>
          </div>
          <Switch
            id="quick-show-visualizer"
            checked={showVisualizerInSidebar}
            onCheckedChange={setShowVisualizerInSidebar}
          />
        </div>
      </section>
    </div>
  );
}
