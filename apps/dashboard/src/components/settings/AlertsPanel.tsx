'use client';

import { useState } from 'react';
import { Bell, Bot, TestTube2 } from 'lucide-react';
import { sendTestNotification } from '@/lib/api';
import { useNotifications } from '@/stores/notifications';
import {
  CLAWDBOT_CHANNEL_OPTIONS,
  DEFAULT_CLAWDBOT_SETTINGS,
  DEFAULT_CLAWDBOT_THROTTLE,
  type ClawdbotChannelOption,
  useSettingsStore,
} from '@/stores/settings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { AlertRuleControls, UsageThresholdControls } from './AlertRuleControls';

const CHANNEL_LABELS: Record<ClawdbotChannelOption, string> = {
  telegram: 'Telegram',
  discord: 'Discord',
  slack: 'Slack',
  whatsapp: 'WhatsApp',
  signal: 'Signal',
  imessage: 'iMessage',
};

const selectClassName =
  'h-11 w-full rounded-md border bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function AlertsPanel() {
  const notifications = useNotifications();
  const [testing, setTesting] = useState(false);
  const alertSettings = useSettingsStore((state) => state.alertSettings);
  const setAlertChannelEnabled = useSettingsStore((state) => state.setAlertChannelEnabled);
  const setClawdbotBaseUrl = useSettingsStore((state) => state.setClawdbotBaseUrl);
  const setClawdbotToken = useSettingsStore((state) => state.setClawdbotToken);
  const setClawdbotChannel = useSettingsStore((state) => state.setClawdbotChannel);
  const setClawdbotRecipient = useSettingsStore((state) => state.setClawdbotRecipient);
  const setClawdbotThrottle = useSettingsStore((state) => state.setClawdbotThrottle);
  const setClawdbotActionableOnly = useSettingsStore((state) => state.setClawdbotActionableOnly);
  const openClaw = alertSettings.clawdbot ?? DEFAULT_CLAWDBOT_SETTINGS;

  const handleTest = async () => {
    if (!openClaw.enabled || !openClaw.baseUrl || !openClaw.token) {
      notifications.error(
        'OpenClaw Not Configured',
        'Enable OpenClaw and provide a URL and token.'
      );
      return;
    }
    setTesting(true);
    try {
      await sendTestNotification({ channel: 'clawdbot' });
      notifications.success('Test Sent', 'Check your messaging app for the notification.');
    } catch (error) {
      notifications.error(
        'Test Failed',
        error instanceof Error ? error.message : 'Could not connect to the server.'
      );
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="space-y-4" aria-labelledby="alerts-settings-title">
      <h2
        id="alerts-settings-title"
        className="text-sm font-medium uppercase tracking-wider text-muted-foreground"
      >
        Alerts
      </h2>
      <div className="space-y-4 rounded-lg border p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label htmlFor="openclaw-enabled" className="flex items-center gap-2 text-sm font-medium">
              <Bot className="h-4 w-4" aria-hidden="true" />
              OpenClaw Messaging
            </Label>
            <div className="text-xs text-muted-foreground">
              Receive alerts via Telegram, WhatsApp, Discord, and other channels.
            </div>
          </div>
          <Switch
            id="openclaw-enabled"
            checked={openClaw.enabled}
            onCheckedChange={(checked) => setAlertChannelEnabled('clawdbot', checked)}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="openclaw-url">OpenClaw URL</Label>
            <Input
              id="openclaw-url"
              className="h-11 font-mono"
              value={openClaw.baseUrl ?? ''}
              onChange={(event) => setClawdbotBaseUrl(event.target.value)}
              placeholder="http://localhost:18789"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="openclaw-token">Token</Label>
            <Input
              id="openclaw-token"
              type="password"
              className="h-11"
              value={openClaw.token ?? ''}
              onChange={(event) => setClawdbotToken(event.target.value)}
              placeholder="Your OpenClaw token"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="openclaw-channel">Channel</Label>
            <select
              id="openclaw-channel"
              value={openClaw.channel ?? ''}
              onChange={(event) =>
                setClawdbotChannel((event.target.value as ClawdbotChannelOption) || undefined)
              }
              className={selectClassName}
            >
              <option value="">Select channel…</option>
              {CLAWDBOT_CHANNEL_OPTIONS.map((channel) => (
                <option key={channel} value={channel}>
                  {CHANNEL_LABELS[channel]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="openclaw-recipient">Recipient (optional)</Label>
            <Input
              id="openclaw-recipient"
              className="h-11"
              value={openClaw.recipient ?? ''}
              onChange={(event) => setClawdbotRecipient(event.target.value)}
              placeholder="Channel-specific recipient"
            />
          </div>
        </div>
        <div className="flex min-h-11 items-center justify-between gap-3">
          <div>
            <Label htmlFor="openclaw-actionable">Actionable items only</Label>
            <div className="text-xs text-muted-foreground">
              Only notify for items requiring immediate action.
            </div>
          </div>
          <Switch
            id="openclaw-actionable"
            checked={openClaw.actionableOnly ?? true}
            onCheckedChange={setClawdbotActionableOnly}
          />
        </div>
        <div className="grid gap-4 border-t pt-4 md:grid-cols-3">
          <RangeSetting
            id="openclaw-hourly"
            label="Max per hour"
            min={1}
            max={200}
            value={openClaw.throttle?.maxPerHour ?? DEFAULT_CLAWDBOT_THROTTLE.maxPerHour}
            display={(value) => String(value)}
            onChange={(value) => setClawdbotThrottle({ maxPerHour: value })}
          />
          <RangeSetting
            id="openclaw-batch"
            label="Batch window"
            min={100}
            max={10000}
            step={100}
            value={openClaw.throttle?.batchDelayMs ?? DEFAULT_CLAWDBOT_THROTTLE.batchDelayMs}
            display={(value) => `${(value / 1000).toFixed(1)}s`}
            onChange={(value) => setClawdbotThrottle({ batchDelayMs: value })}
          />
          <RangeSetting
            id="openclaw-cooldown"
            label="Session cooldown"
            min={0}
            max={600000}
            step={5000}
            value={
              openClaw.throttle?.sessionCooldownMs ?? DEFAULT_CLAWDBOT_THROTTLE.sessionCooldownMs
            }
            display={(value) => `${Math.round(value / 1000)}s`}
            onChange={(value) => setClawdbotThrottle({ sessionCooldownMs: value })}
          />
        </div>
        <AlertRuleControls channel="clawdbot" />
        <Button
          variant="outline"
          size="mobile"
          className="gap-2"
          onClick={() => void handleTest()}
          disabled={testing}
        >
          <TestTube2 className="h-4 w-4" aria-hidden="true" />
          {testing ? 'Sending…' : 'Test Notification'}
        </Button>
      </div>

      <div className="space-y-4 rounded-lg border p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Bell className="h-4 w-4" aria-hidden="true" />
          Usage thresholds by provider
        </div>
        <p className="text-xs text-muted-foreground">
          Choose which utilization thresholds trigger alerts.
        </p>
        <UsageThresholdControls />
      </div>
    </section>
  );
}

function RangeSetting({
  id,
  label,
  min,
  max,
  step,
  value,
  display,
  onChange,
}: {
  id: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  display: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className="text-xs text-muted-foreground">
          {label}
        </Label>
        <span className="font-mono text-xs">{display(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-11 w-full"
      />
    </div>
  );
}
