'use client';

import { cn } from '@/lib/utils';
import {
  ALERT_EVENT_KEYS,
  ALERT_PROVIDER_KEYS,
  DEFAULT_ALERT_EVENTS,
  DEFAULT_CLAWDBOT_EVENTS,
  DEFAULT_CLAWDBOT_SETTINGS,
  DEFAULT_USAGE_THRESHOLDS,
  type AlertEventKey,
  type AlertProviderKey,
  useSettingsStore,
} from '@/stores/settings';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export type AlertRuleChannel = 'browser' | 'audio' | 'toast' | 'clawdbot';

const EVENT_LABELS: Record<AlertEventKey, string> = {
  approvals: 'Approvals required',
  waiting_input: 'Waiting for input',
  waiting_approval: 'Waiting for approval',
  error: 'Errors',
  snapshot_action: 'Snapshot actions',
  usage_thresholds: 'Usage thresholds',
  approval_decisions: 'Approval decisions',
};

export const PROVIDER_LABELS: Record<AlertProviderKey, string> = {
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

export function AlertRuleControls({ channel }: { channel: AlertRuleChannel }) {
  const alertSettings = useSettingsStore((state) => state.alertSettings);
  const setAlertChannelEvent = useSettingsStore((state) => state.setAlertChannelEvent);
  const setAlertChannelProvider = useSettingsStore((state) => state.setAlertChannelProvider);
  const channelSettings =
    channel === 'clawdbot'
      ? (alertSettings.clawdbot ?? DEFAULT_CLAWDBOT_SETTINGS)
      : alertSettings[channel];
  const defaultEvents = channel === 'clawdbot' ? DEFAULT_CLAWDBOT_EVENTS : DEFAULT_ALERT_EVENTS;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">Events</div>
        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-1">
          {ALERT_EVENT_KEYS.map((event) => {
            const id = `${channel}-event-${event}`;
            return (
              <div key={id} className="flex min-h-11 items-center justify-between gap-3">
                <Label htmlFor={id} className="text-xs text-muted-foreground">
                  {EVENT_LABELS[event]}
                </Label>
                <Switch
                  id={id}
                  checked={channelSettings.events[event] ?? defaultEvents[event]}
                  onCheckedChange={(checked) => setAlertChannelEvent(channel, event, checked)}
                />
              </div>
            );
          })}
        </div>
      </div>
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">Providers</div>
        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-1">
          {ALERT_PROVIDER_KEYS.map((provider) => {
            const id = `${channel}-provider-${provider}`;
            return (
              <div key={id} className="flex min-h-11 items-center justify-between gap-3">
                <Label htmlFor={id} className="text-xs text-muted-foreground">
                  {PROVIDER_LABELS[provider]}
                </Label>
                <Switch
                  id={id}
                  checked={channelSettings.providers[provider] ?? true}
                  onCheckedChange={(checked) => setAlertChannelProvider(channel, provider, checked)}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function UsageThresholdControls() {
  const alertSettings = useSettingsStore((state) => state.alertSettings);
  const setUsageThresholds = useSettingsStore((state) => state.setUsageThresholds);

  return (
    <div className="space-y-4">
      {ALERT_PROVIDER_KEYS.map((provider) => {
        const current =
          alertSettings.usageThresholds[provider] ?? DEFAULT_USAGE_THRESHOLDS[provider];
        return (
          <div key={provider} className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">
              {PROVIDER_LABELS[provider]}
            </div>
            <div className="flex flex-wrap gap-2">
              {USAGE_THRESHOLD_OPTIONS.map((threshold) => {
                const enabled = current.includes(threshold);
                return (
                  <button
                    type="button"
                    key={`${provider}-${threshold}`}
                    aria-pressed={enabled}
                    onClick={() => {
                      const next = enabled
                        ? current.filter((value) => value !== threshold)
                        : [...current, threshold];
                      setUsageThresholds(provider, next);
                    }}
                    className={cn(
                      'min-h-11 min-w-11 rounded-md border px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      enabled
                        ? 'border-primary/40 bg-primary/10 text-primary'
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
      })}
    </div>
  );
}
