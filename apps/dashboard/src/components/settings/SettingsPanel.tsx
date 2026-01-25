'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  Bot,
  Boxes,
  FolderOpen,
  Play,
  Plus,
  Trash2,
  Link as LinkIcon,
  Volume2,
  Settings,
  Monitor,
  Moon,
  Sun,
  TestTube2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import { getHosts, sendTestNotification } from '@/lib/api';
import { requestNotificationPermission, getNotificationPermission } from '@/hooks/useAttentionNotifications';
import { useNotifications } from '@/stores/notifications';
import { useThemeStore } from '@/stores/theme';
import {
  ALERT_EVENT_KEYS,
  ALERT_PROVIDER_KEYS,
  CLAWDBOT_CHANNEL_OPTIONS,
  DEFAULT_ALERT_EVENTS,
  DEFAULT_ALERT_SETTINGS,
  DEFAULT_CLAWDBOT_SETTINGS,
  DEFAULT_USAGE_THRESHOLDS,
  DEFAULT_VIRTUAL_KEY_ORDER,
  type AlertEventKey,
  type AlertProviderKey,
  type ClawdbotChannelOption,
  type DevFolder,
  type RepoSortBy,
  type SessionNamingPattern,
  type SessionTemplate,
  type LinkType,
  type VirtualKeyboardKey,
  useSettingsStore,
} from '@/stores/settings';
import { useVisualizerThemeStore, type VisualizerTheme } from '@/stores/visualizerTheme';
import type { SpawnProvider } from '@/lib/api';

interface SettingsPanelProps {
  className?: string;
}

const EVENT_LABELS: Record<AlertEventKey, string> = {
  approvals: 'Approvals required',
  waiting_input: 'Waiting for input',
  waiting_approval: 'Waiting for approval',
  error: 'Errors',
  snapshot_action: 'Snapshot actions',
  usage_thresholds: 'Usage thresholds',
  approval_decisions: 'Approval decisions',
};

const PROVIDER_LABELS: Record<AlertProviderKey, string> = {
  claude_code: 'Claude',
  codex: 'Codex',
  gemini_cli: 'Gemini',
  opencode: 'OpenCode',
  cursor: 'Cursor',
  aider: 'Aider',
  continue: 'Continue',
  shell: 'Shell',
  unknown: 'Unknown',
};

const USAGE_THRESHOLD_OPTIONS = [50, 75, 90, 100];

const CLAWDBOT_CHANNEL_LABELS: Record<ClawdbotChannelOption, string> = {
  telegram: 'Telegram',
  discord: 'Discord',
  slack: 'Slack',
  whatsapp: 'WhatsApp',
  signal: 'Signal',
  imessage: 'iMessage',
};

export function SettingsPanel({ className }: SettingsPanelProps) {
  const notifications = useNotifications();
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [clawdbotTesting, setClawdbotTesting] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Theme settings
  const { theme, setTheme } = useThemeStore();

  // Settings store
  const {
    visibleProviders,
    setProviderVisibility,
    showVisualizerInSidebar,
    setShowVisualizerInSidebar,
    virtualKeyboardKeys,
    setVirtualKeyboardKeys,
    notificationsEnabled,
    audioEnabled,
    alertSettings,
    setAlertChannelEnabled,
    setAlertChannelFocus,
    setAlertChannelEvent,
    setAlertChannelProvider,
    setAlertAudioVolume,
    setUsageThresholds,
    // Clawdbot settings
    setClawdbotBaseUrl,
    setClawdbotToken,
    setClawdbotChannel,
    setClawdbotRecipient,
    // Repo Picker settings
    devFolders,
    addDevFolder,
    removeDevFolder,
    repoSortBy,
    setRepoSortBy,
    showHiddenFolders,
    setShowHiddenFolders,
    // Session Generator settings
    defaultProvider,
    setDefaultProvider,
    sessionNamingPattern,
    setSessionNamingPattern,
    autoCreateGroup,
    setAutoCreateGroup,
    defaultSessionTemplate,
    setDefaultSessionTemplate,
    autoLinkSessions,
    setAutoLinkSessions,
    defaultLinkType,
    setDefaultLinkType,
  } = useSettingsStore();

  // Visualizer theme
  const { theme: visualizerTheme, setTheme: setVisualizerTheme } = useVisualizerThemeStore();

  // Fetch hosts for dev folder dropdown
  const { data: hostsData } = useQuery({
    queryKey: ['hosts'],
    queryFn: getHosts,
  });

  // New dev folder form state
  const [newDevFolder, setNewDevFolder] = useState<Partial<DevFolder>>({});
  const [showAddDevFolder, setShowAddDevFolder] = useState(false);

  const virtualKeyOptions: Array<{ id: VirtualKeyboardKey; label: string }> = [
    { id: 'ctrl_c', label: 'Ctrl + C' },
    { id: 'esc', label: 'Escape' },
    { id: 'tab', label: 'Tab' },
    { id: 'shift_tab', label: 'Shift + Tab' },
    { id: 'arrow_up', label: 'Arrow Up' },
    { id: 'arrow_down', label: 'Arrow Down' },
    { id: 'arrow_left', label: 'Arrow Left' },
    { id: 'arrow_right', label: 'Arrow Right' },
    { id: 'enter', label: 'Enter' },
  ];

  const effectiveVirtualKeys =
    virtualKeyboardKeys.length > 0 ? virtualKeyboardKeys : DEFAULT_VIRTUAL_KEY_ORDER;

  const alertEvents = useMemo(() => ALERT_EVENT_KEYS, []);
  const alertProviders = useMemo(() => ALERT_PROVIDER_KEYS, []);

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

  const handleTestClawdbot = async () => {
    const clawdbot = alertSettings.clawdbot;
    if (!clawdbot?.enabled || !clawdbot?.baseUrl || !clawdbot?.token) {
      notifications.error('Clawdbot Not Configured', 'Enable Clawdbot and provide a URL and token.');
      return;
    }
    setClawdbotTesting(true);
    try {
      await sendTestNotification({ channel: 'clawdbot' });
      notifications.success('Test Sent', 'Check your messaging app for the notification.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not connect to the server.';
      notifications.error('Test Failed', message);
    } finally {
      setClawdbotTesting(false);
    }
  };

  const toggleVirtualKey = (key: VirtualKeyboardKey, enabled: boolean) => {
    const keySet = new Set(effectiveVirtualKeys);
    if (enabled) {
      keySet.add(key);
    } else {
      keySet.delete(key);
    }
    const ordered = DEFAULT_VIRTUAL_KEY_ORDER.filter((entry) => keySet.has(entry));
    setVirtualKeyboardKeys(ordered);
  };

  const resetVirtualKeys = () => {
    setVirtualKeyboardKeys([...DEFAULT_VIRTUAL_KEY_ORDER]);
  };

  const renderEventToggles = (channel: 'browser' | 'audio' | 'toast' | 'clawdbot') => {
    const channelSettings = channel === 'clawdbot'
      ? (alertSettings.clawdbot ?? DEFAULT_CLAWDBOT_SETTINGS)
      : alertSettings[channel];
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {alertEvents.map((event) => (
          <div key={`${channel}-${event}`} className="flex items-center justify-between gap-3">
            <Label className="text-xs text-muted-foreground">{EVENT_LABELS[event]}</Label>
            <Switch
              checked={channelSettings.events[event] ?? DEFAULT_ALERT_EVENTS[event]}
              onCheckedChange={(checked) => setAlertChannelEvent(channel, event, checked)}
            />
          </div>
        ))}
      </div>
    );
  };

  const renderProviderToggles = (channel: 'browser' | 'audio' | 'toast' | 'clawdbot') => {
    const channelSettings = channel === 'clawdbot'
      ? (alertSettings.clawdbot ?? DEFAULT_CLAWDBOT_SETTINGS)
      : alertSettings[channel];
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {alertProviders.map((provider) => (
          <div key={`${channel}-${provider}`} className="flex items-center justify-between gap-3">
            <Label className="text-xs text-muted-foreground">{PROVIDER_LABELS[provider]}</Label>
            <Switch
              checked={channelSettings.providers[provider] ?? true}
              onCheckedChange={(checked) => setAlertChannelProvider(channel, provider, checked)}
            />
          </div>
        ))}
      </div>
    );
  };

  const renderThresholdRow = (provider: AlertProviderKey) => {
    const current = alertSettings.usageThresholds[provider] ?? DEFAULT_USAGE_THRESHOLDS[provider];
    return (
      <div key={`threshold-${provider}`} className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">{PROVIDER_LABELS[provider]}</div>
        <div className="flex flex-wrap gap-2">
          {USAGE_THRESHOLD_OPTIONS.map((threshold) => {
            const enabled = current.includes(threshold);
            return (
              <button
                type="button"
                key={`${provider}-${threshold}`}
                onClick={() => {
                  const next = enabled
                    ? current.filter((value) => value !== threshold)
                    : [...current, threshold];
                  setUsageThresholds(provider, next);
                }}
                className={cn(
                  'px-2 py-1 text-xs rounded border transition-colors',
                  enabled
                    ? 'bg-primary/10 border-primary/40 text-primary'
                    : 'bg-background text-muted-foreground'
                )}
              >
                {threshold}%
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className={cn('space-y-6', className)}>
      {/* Appearance Section */}
      <section className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Appearance
        </h3>

        {/* Theme */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Theme</Label>
          <RadioGroup
            value={theme}
            onValueChange={(value) => setTheme(value as 'light' | 'dark' | 'system')}
            className="space-y-2"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="light" id="theme-light" />
              <Label htmlFor="theme-light" className="cursor-pointer flex items-center gap-2">
                <Sun className="h-4 w-4" />
                Light
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="dark" id="theme-dark" />
              <Label htmlFor="theme-dark" className="cursor-pointer flex items-center gap-2">
                <Moon className="h-4 w-4" />
                Dark
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="system" id="theme-system" />
              <Label htmlFor="theme-system" className="cursor-pointer flex items-center gap-2">
                <Monitor className="h-4 w-4" />
                System
              </Label>
            </div>
          </RadioGroup>
        </div>
      </section>

      {/* Notifications & Alerts */}
      <section className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Notifications & Alerts
        </h3>

        <div className="grid gap-4">
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

            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Events</div>
              {renderEventToggles('browser')}
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Providers</div>
              {renderProviderToggles('browser')}
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

            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Events</div>
              {renderEventToggles('audio')}
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Providers</div>
              {renderProviderToggles('audio')}
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

          <div className="rounded-lg border p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium flex items-center gap-2">
                <Settings className="h-4 w-4" />
                In-app Toasts
              </div>
              <Switch
                checked={alertSettings.toast.enabled}
                onCheckedChange={(checked) => setAlertChannelEnabled('toast', checked)}
              />
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Events</div>
              {renderEventToggles('toast')}
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Providers</div>
              {renderProviderToggles('toast')}
            </div>
          </div>

          <div className="rounded-lg border p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium flex items-center gap-2">
                  <Bot className="h-4 w-4" />
                  Clawdbot (Push Notifications)
                </div>
                <div className="text-xs text-muted-foreground">
                  Receive alerts via Telegram, WhatsApp, Discord, etc.
                </div>
              </div>
              <Switch
                checked={alertSettings.clawdbot?.enabled ?? false}
                onCheckedChange={(checked) => setAlertChannelEnabled('clawdbot', checked)}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Clawdbot URL</Label>
              <input
                type="text"
                value={alertSettings.clawdbot?.baseUrl ?? DEFAULT_CLAWDBOT_SETTINGS.baseUrl}
                onChange={(e) => setClawdbotBaseUrl(e.target.value)}
                placeholder="http://localhost:18789"
                className="w-full px-3 py-2 border rounded-md bg-background text-sm font-mono"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Token</Label>
              <input
                type="password"
                value={alertSettings.clawdbot?.token ?? ''}
                onChange={(e) => setClawdbotToken(e.target.value)}
                placeholder="Your clawdbot token"
                className="w-full px-3 py-2 border rounded-md bg-background text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Channel</Label>
              <select
                value={alertSettings.clawdbot?.channel ?? ''}
                onChange={(e) => setClawdbotChannel(e.target.value as ClawdbotChannelOption || undefined)}
                className="w-full px-3 py-2 border rounded-md bg-background text-sm"
              >
                <option value="">Select channel...</option>
                {CLAWDBOT_CHANNEL_OPTIONS.map((ch) => (
                  <option key={ch} value={ch}>{CLAWDBOT_CHANNEL_LABELS[ch]}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Recipient (optional)</Label>
              <input
                type="text"
                value={alertSettings.clawdbot?.recipient ?? ''}
                onChange={(e) => setClawdbotRecipient(e.target.value)}
                placeholder="Channel-specific recipient"
                className="w-full px-3 py-2 border rounded-md bg-background text-sm"
              />
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Events</div>
              {renderEventToggles('clawdbot')}
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Providers</div>
              {renderProviderToggles('clawdbot')}
            </div>

            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={handleTestClawdbot}
              disabled={clawdbotTesting}
            >
              <TestTube2 className="h-4 w-4" />
              {clawdbotTesting ? 'Sending...' : 'Test Notification'}
            </Button>
          </div>
        </div>

        <div className="rounded-lg border p-4 space-y-4">
          <div className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Bell className="h-4 w-4" />
            Usage Thresholds (per provider)
          </div>
          <p className="text-xs text-muted-foreground">
            Choose which thresholds trigger alerts for each provider.
          </p>
          <div className="space-y-4">
            {alertProviders.map((provider) => renderThresholdRow(provider))}
          </div>
        </div>
      </section>

      {/* Provider Usage Section */}
      <section className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Provider Usage
        </h3>

        <p className="text-xs text-muted-foreground">
          Choose which providers to show in the dashboard usage section.
        </p>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="show-claude" className="cursor-pointer">
              Show Claude
            </Label>
            <Switch
              id="show-claude"
              checked={visibleProviders.claude_code}
              onCheckedChange={(checked) => setProviderVisibility('claude_code', checked)}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="show-codex" className="cursor-pointer">
              Show Codex
            </Label>
            <Switch
              id="show-codex"
              checked={visibleProviders.codex}
              onCheckedChange={(checked) => setProviderVisibility('codex', checked)}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="show-gemini" className="cursor-pointer">
              Show Gemini
            </Label>
            <Switch
              id="show-gemini"
              checked={visibleProviders.gemini_cli}
              onCheckedChange={(checked) => setProviderVisibility('gemini_cli', checked)}
            />
          </div>
        </div>
      </section>

      {/* Virtual Keyboard Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Virtual Keyboard
          </h3>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={resetVirtualKeys}
          >
            Reset
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Choose which quick keys appear on the mobile keyboard row.
        </p>

        <div className="space-y-3">
          {virtualKeyOptions.map((option) => (
            <div key={option.id} className="flex items-center justify-between">
              <Label className="cursor-pointer">{option.label}</Label>
              <Switch
                checked={effectiveVirtualKeys.includes(option.id)}
                onCheckedChange={(checked) => toggleVirtualKey(option.id, checked)}
              />
            </div>
          ))}
        </div>
      </section>

      {/* Visualizer Section */}
      <section className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Visualizer
        </h3>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Boxes className="h-4 w-4 text-muted-foreground" />
              <Label htmlFor="show-visualizer" className="cursor-pointer">
                Show in Sidebar
              </Label>
            </div>
            <Switch
              id="show-visualizer"
              checked={showVisualizerInSidebar}
              onCheckedChange={setShowVisualizerInSidebar}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Visualizer Theme</Label>
            <RadioGroup
              value={visualizerTheme}
              onValueChange={(value) => setVisualizerTheme(value as VisualizerTheme)}
              className="space-y-2"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="botspace" id="viz-botspace" />
                <Label htmlFor="viz-botspace" className="cursor-pointer">
                  Botspace
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="civilization" id="viz-civilization" />
                <Label htmlFor="viz-civilization" className="cursor-pointer">
                  Civilization
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="bridge-control" id="viz-bridge" />
                <Label htmlFor="viz-bridge" className="cursor-pointer">
                  Bridge Control
                </Label>
              </div>
            </RadioGroup>
          </div>
        </div>
      </section>

      {/* Repo Picker Section */}
      <section className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          <FolderOpen className="h-4 w-4 inline mr-1" />
          Repo Picker
        </h3>

        {/* Dev Folders List */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Dev Folders</Label>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAddDevFolder(!showAddDevFolder)}
              className="h-7 px-2"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add
            </Button>
          </div>

          {/* Add new folder form */}
          {showAddDevFolder && (
            <div className="p-3 border rounded-lg space-y-2 bg-accent/30">
              <select
                value={newDevFolder.hostId || ''}
                onChange={(e) =>
                  setNewDevFolder({ ...newDevFolder, hostId: e.target.value })
                }
                className="w-full px-2 py-1.5 border rounded text-sm bg-background"
              >
                <option value="">Select host...</option>
                {hostsData?.hosts.map((host) => (
                  <option key={host.id} value={host.id}>
                    {host.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={newDevFolder.path || ''}
                onChange={(e) =>
                  setNewDevFolder({ ...newDevFolder, path: e.target.value })
                }
                placeholder="Path (e.g., ~/dev)"
                className="w-full px-2 py-1.5 border rounded text-sm bg-background font-mono"
              />
              <input
                type="text"
                value={newDevFolder.label || ''}
                onChange={(e) =>
                  setNewDevFolder({ ...newDevFolder, label: e.target.value })
                }
                placeholder="Label (optional)"
                className="w-full px-2 py-1.5 border rounded text-sm bg-background"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  disabled={!newDevFolder.hostId || !newDevFolder.path}
                  onClick={() => {
                    if (newDevFolder.hostId && newDevFolder.path) {
                      addDevFolder({
                        hostId: newDevFolder.hostId,
                        path: newDevFolder.path,
                        label: newDevFolder.label,
                      });
                      setNewDevFolder({});
                      setShowAddDevFolder(false);
                    }
                  }}
                >
                  Add Folder
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setNewDevFolder({});
                    setShowAddDevFolder(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Existing folders */}
          {devFolders.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">
              No dev folders configured. Add folders to quickly browse repositories.
            </p>
          ) : (
            <div className="space-y-1">
              {devFolders.map((folder, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-2 rounded border bg-accent/20"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">
                      {folder.label || folder.path}
                    </div>
                    <div className="text-xs text-muted-foreground truncate font-mono">
                      {hostsData?.hosts.find((h) => h.id === folder.hostId)?.name}:
                      {folder.path}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 flex-shrink-0"
                    onClick={() => removeDevFolder(idx)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sort order */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Sort Repositories By</Label>
          <select
            value={repoSortBy}
            onChange={(e) => setRepoSortBy(e.target.value as RepoSortBy)}
            className="w-full px-3 py-2 border rounded-md bg-background text-sm"
          >
            <option value="name">Name</option>
            <option value="last_modified">Last Modified</option>
            <option value="last_used">Last Used</option>
          </select>
        </div>

        {/* Show hidden */}
        <div className="flex items-center justify-between">
          <Label htmlFor="show-hidden" className="cursor-pointer">
            Show Hidden Folders
          </Label>
          <Switch
            id="show-hidden"
            checked={showHiddenFolders}
            onCheckedChange={setShowHiddenFolders}
          />
        </div>
      </section>

      {/* Session Generator Section */}
      <section className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          <Play className="h-4 w-4 inline mr-1" />
          Session Generator
        </h3>

        {/* Default provider */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Default Provider</Label>
          <select
            value={defaultProvider}
            onChange={(e) => setDefaultProvider(e.target.value as SpawnProvider)}
            className="w-full px-3 py-2 border rounded-md bg-background text-sm"
          >
            <option value="claude_code">Claude Code</option>
            <option value="codex">Codex</option>
            <option value="gemini_cli">Gemini CLI</option>
            <option value="opencode">OpenCode</option>
            <option value="aider">Aider</option>
            <option value="shell">Shell</option>
          </select>
        </div>

        {/* Session naming pattern */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Session Naming Pattern</Label>
          <select
            value={sessionNamingPattern}
            onChange={(e) =>
              setSessionNamingPattern(e.target.value as SessionNamingPattern)
            }
            className="w-full px-3 py-2 border rounded-md bg-background text-sm"
          >
            <option value="repo_name">Repository Name</option>
            <option value="branch_name">Branch Name</option>
            <option value="repo_branch">Repo + Branch</option>
          </select>
        </div>

        {/* Default template */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Default Template</Label>
          <select
            value={defaultSessionTemplate}
            onChange={(e) =>
              setDefaultSessionTemplate(e.target.value as SessionTemplate)
            }
            className="w-full px-3 py-2 border rounded-md bg-background text-sm"
          >
            <option value="single">Single Session</option>
            <option value="claude_codex">Claude + Codex</option>
            <option value="full_dev">Full Dev Setup</option>
          </select>
        </div>

        {/* Auto-link sessions */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LinkIcon className="h-4 w-4 text-muted-foreground" />
            <Label htmlFor="auto-link-sessions" className="cursor-pointer">
              Auto-link Sessions
            </Label>
          </div>
          <Switch
            id="auto-link-sessions"
            checked={autoLinkSessions}
            onCheckedChange={setAutoLinkSessions}
          />
        </div>

        {/* Default link type */}
        {autoLinkSessions && (
          <div className="space-y-2">
            <Label className="text-sm font-medium">Default Link Type</Label>
            <select
              value={defaultLinkType}
              onChange={(e) => setDefaultLinkType(e.target.value as LinkType)}
              className="w-full px-3 py-2 border rounded-md bg-background text-sm"
            >
              <option value="complement">Complement</option>
              <option value="review">Review</option>
            </select>
          </div>
        )}

        {/* Auto-create group */}
        <div className="flex items-center justify-between">
          <Label htmlFor="auto-create-group" className="cursor-pointer">
            Auto-create Group for Multi-session
          </Label>
          <Switch
            id="auto-create-group"
            checked={autoCreateGroup}
            onCheckedChange={setAutoCreateGroup}
          />
        </div>
      </section>

      {/* Host Access Section */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Host Access
        </h3>
        <p className="text-xs text-muted-foreground">
          Manage directory listing permissions per host.
        </p>
        <Link href="/hosts">
          <Button variant="outline" size="sm">
            Open Host Settings
          </Button>
        </Link>
      </section>
    </div>
  );
}
