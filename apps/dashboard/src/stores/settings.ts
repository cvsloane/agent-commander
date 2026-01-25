import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SpawnProvider } from '@/lib/api';

// Types for repo picker settings
export interface DevFolder {
  hostId: string;
  path: string;
  label?: string;
}

export type RepoSortBy = 'name' | 'last_modified' | 'last_used';
export type SessionNamingPattern = 'repo_name' | 'branch_name' | 'repo_branch';
export type SessionTemplate = 'single' | 'claude_codex' | 'full_dev';
export type LinkType = 'complement' | 'review';
export const ALERT_PROVIDER_KEYS = [
  'claude_code',
  'codex',
  'gemini_cli',
  'opencode',
  'cursor',
  'aider',
  'continue',
  'shell',
  'unknown',
] as const;
export type AlertProviderKey = (typeof ALERT_PROVIDER_KEYS)[number];
export const ALERT_EVENT_KEYS = [
  'approvals',
  'waiting_input',
  'waiting_approval',
  'error',
  'snapshot_action',
  'usage_thresholds',
  'approval_decisions',
] as const;
export type AlertEventKey = (typeof ALERT_EVENT_KEYS)[number];
export type AlertEventToggles = Record<AlertEventKey, boolean>;
export type AlertProviderFilters = Record<AlertProviderKey, boolean>;
export type AlertChannelSettings = {
  enabled: boolean;
  onlyWhenUnfocused: boolean;
  events: AlertEventToggles;
  providers: AlertProviderFilters;
};
export type AlertAudioChannelSettings = AlertChannelSettings & {
  volume: number;
};
export const CLAWDBOT_CHANNEL_OPTIONS = [
  'telegram',
  'discord',
  'slack',
  'whatsapp',
  'signal',
  'imessage',
] as const;
export type ClawdbotChannelOption = (typeof CLAWDBOT_CHANNEL_OPTIONS)[number];
export type ClawdbotChannelSettings = AlertChannelSettings & {
  baseUrl?: string;
  token?: string;
  channel?: ClawdbotChannelOption;
  recipient?: string;
};
export type UsageThresholds = Record<AlertProviderKey, number[]>;
export type AlertSettings = {
  browser: AlertChannelSettings;
  audio: AlertAudioChannelSettings;
  toast: AlertChannelSettings;
  clawdbot?: ClawdbotChannelSettings;
  usageThresholds: UsageThresholds;
};
export type AlertChannelSettingsInput = {
  enabled?: boolean;
  onlyWhenUnfocused?: boolean;
  events?: Partial<AlertEventToggles>;
  providers?: Partial<AlertProviderFilters>;
};
export type AlertAudioChannelSettingsInput = AlertChannelSettingsInput & {
  volume?: number;
};
export type ClawdbotChannelSettingsInput = AlertChannelSettingsInput & {
  baseUrl?: string;
  token?: string;
  channel?: ClawdbotChannelOption;
  recipient?: string;
};
export type AlertSettingsInput = {
  browser?: AlertChannelSettingsInput;
  audio?: AlertAudioChannelSettingsInput;
  toast?: AlertChannelSettingsInput;
  clawdbot?: ClawdbotChannelSettingsInput;
  usageThresholds?: Partial<UsageThresholds>;
};
export const DEFAULT_ALERT_EVENTS: AlertEventToggles = {
  approvals: true,
  waiting_input: true,
  waiting_approval: true,
  error: true,
  snapshot_action: true,
  usage_thresholds: true,
  approval_decisions: true,
};
export const DEFAULT_ALERT_PROVIDERS: AlertProviderFilters = {
  claude_code: true,
  codex: true,
  gemini_cli: true,
  opencode: true,
  cursor: true,
  aider: true,
  continue: true,
  shell: true,
  unknown: true,
};
export const DEFAULT_USAGE_THRESHOLDS: UsageThresholds = ALERT_PROVIDER_KEYS.reduce(
  (acc, provider) => {
    acc[provider] = [50, 75, 90, 100];
    return acc;
  },
  {} as UsageThresholds
);
export const DEFAULT_CLAWDBOT_SETTINGS: ClawdbotChannelSettings = {
  enabled: false,
  onlyWhenUnfocused: false,
  events: { ...DEFAULT_ALERT_EVENTS },
  providers: { ...DEFAULT_ALERT_PROVIDERS },
  baseUrl: 'http://localhost:18789',
  token: '',
  channel: undefined,
  recipient: '',
};
export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  browser: {
    enabled: false,
    onlyWhenUnfocused: false,
    events: { ...DEFAULT_ALERT_EVENTS },
    providers: { ...DEFAULT_ALERT_PROVIDERS },
  },
  audio: {
    enabled: false,
    onlyWhenUnfocused: false,
    events: { ...DEFAULT_ALERT_EVENTS },
    providers: { ...DEFAULT_ALERT_PROVIDERS },
    volume: 0.5,
  },
  toast: {
    enabled: true,
    onlyWhenUnfocused: false,
    events: { ...DEFAULT_ALERT_EVENTS },
    providers: { ...DEFAULT_ALERT_PROVIDERS },
  },
  clawdbot: { ...DEFAULT_CLAWDBOT_SETTINGS },
  usageThresholds: { ...DEFAULT_USAGE_THRESHOLDS },
};
export const DEFAULT_VIRTUAL_KEY_ORDER = [
  'ctrl_c',
  'esc',
  'tab',
  'shift_tab',
  'arrow_up',
  'arrow_down',
  'arrow_left',
  'arrow_right',
  'enter',
] as const;
export type VirtualKeyboardKey = (typeof DEFAULT_VIRTUAL_KEY_ORDER)[number];

const clampThresholds = (values: number[]): number[] => {
  const unique = new Set<number>();
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    const rounded = Math.max(1, Math.min(100, Math.round(value)));
    unique.add(rounded);
  }
  return Array.from(unique).sort((a, b) => a - b);
};

export const normalizeAlertSettings = (
  input?: AlertSettingsInput | null,
  overrides?: AlertSettingsInput
): AlertSettings => {
  const base: AlertSettings = {
    ...DEFAULT_ALERT_SETTINGS,
    ...overrides,
    browser: {
      ...DEFAULT_ALERT_SETTINGS.browser,
      ...(overrides?.browser ?? {}),
      events: {
        ...DEFAULT_ALERT_SETTINGS.browser.events,
        ...(overrides?.browser?.events ?? {}),
      },
      providers: {
        ...DEFAULT_ALERT_SETTINGS.browser.providers,
        ...(overrides?.browser?.providers ?? {}),
      },
    },
    audio: {
      ...DEFAULT_ALERT_SETTINGS.audio,
      ...(overrides?.audio ?? {}),
      events: {
        ...DEFAULT_ALERT_SETTINGS.audio.events,
        ...(overrides?.audio?.events ?? {}),
      },
      providers: {
        ...DEFAULT_ALERT_SETTINGS.audio.providers,
        ...(overrides?.audio?.providers ?? {}),
      },
    },
    toast: {
      ...DEFAULT_ALERT_SETTINGS.toast,
      ...(overrides?.toast ?? {}),
      events: {
        ...DEFAULT_ALERT_SETTINGS.toast.events,
        ...(overrides?.toast?.events ?? {}),
      },
      providers: {
        ...DEFAULT_ALERT_SETTINGS.toast.providers,
        ...(overrides?.toast?.providers ?? {}),
      },
    },
    clawdbot: {
      ...DEFAULT_CLAWDBOT_SETTINGS,
      ...(overrides?.clawdbot ?? {}),
      events: {
        ...DEFAULT_CLAWDBOT_SETTINGS.events,
        ...(overrides?.clawdbot?.events ?? {}),
      },
      providers: {
        ...DEFAULT_CLAWDBOT_SETTINGS.providers,
        ...(overrides?.clawdbot?.providers ?? {}),
      },
    },
    usageThresholds: {
      ...DEFAULT_ALERT_SETTINGS.usageThresholds,
      ...(overrides?.usageThresholds ?? {}),
    },
  };

  const mergeChannel = (
    channel: AlertChannelSettingsInput | undefined,
    defaults: AlertChannelSettings
  ): AlertChannelSettings => ({
    enabled: channel?.enabled ?? defaults.enabled,
    onlyWhenUnfocused: channel?.onlyWhenUnfocused ?? defaults.onlyWhenUnfocused,
    events: {
      ...defaults.events,
      ...(channel?.events ?? {}),
    },
    providers: {
      ...defaults.providers,
      ...(channel?.providers ?? {}),
    },
  });

  const mergeAudioChannel = (
    channel: AlertAudioChannelSettingsInput | undefined,
    defaults: AlertAudioChannelSettings
  ): AlertAudioChannelSettings => ({
    ...mergeChannel(channel, defaults),
    volume:
      typeof channel?.volume === 'number' && Number.isFinite(channel.volume)
        ? Math.max(0, Math.min(1, channel.volume))
        : defaults.volume,
  });

  const mergeClawdbotChannel = (
    channel: ClawdbotChannelSettingsInput | undefined,
    defaults: ClawdbotChannelSettings
  ): ClawdbotChannelSettings => ({
    ...mergeChannel(channel, defaults),
    baseUrl: channel?.baseUrl ?? defaults.baseUrl,
    token: channel?.token ?? defaults.token,
    channel: channel?.channel ?? defaults.channel,
    recipient: channel?.recipient ?? defaults.recipient,
  });

  const usageThresholds: UsageThresholds = { ...base.usageThresholds };
  if (input?.usageThresholds) {
    for (const provider of ALERT_PROVIDER_KEYS) {
      const next = input.usageThresholds[provider];
      if (Array.isArray(next)) {
        usageThresholds[provider] = clampThresholds(next);
      }
    }
  }

  return {
    browser: mergeChannel(input?.browser, base.browser),
    audio: mergeAudioChannel(input?.audio, base.audio),
    toast: mergeChannel(input?.toast, base.toast),
    clawdbot: mergeClawdbotChannel(input?.clawdbot, base.clawdbot!),
    usageThresholds,
  };
};

interface SettingsStore {
  // Provider visibility
  visibleProviders: {
    claude_code: boolean;
    codex: boolean;
    gemini_cli: boolean;
    opencode: boolean;
  };
  setProviderVisibility: (provider: keyof SettingsStore['visibleProviders'], visible: boolean) => void;

  // Visualizer in sidebar
  showVisualizerInSidebar: boolean;
  setShowVisualizerInSidebar: (show: boolean) => void;

  // Notifications and alerts
  notificationsEnabled: boolean;
  setNotificationsEnabled: (enabled: boolean) => void;
  audioEnabled: boolean;
  setAudioEnabled: (enabled: boolean) => void;
  alertSettings: AlertSettings;
  setAlertSettings: (settings: AlertSettings) => void;
  setAlertChannelEnabled: (channel: keyof AlertSettings, enabled: boolean) => void;
  setAlertChannelFocus: (channel: keyof AlertSettings, onlyWhenUnfocused: boolean) => void;
  setAlertChannelEvent: (
    channel: keyof AlertSettings,
    event: AlertEventKey,
    enabled: boolean
  ) => void;
  setAlertChannelProvider: (
    channel: keyof AlertSettings,
    provider: AlertProviderKey,
    enabled: boolean
  ) => void;
  setAlertAudioVolume: (volume: number) => void;
  setUsageThresholds: (provider: AlertProviderKey, thresholds: number[]) => void;

  // Clawdbot settings
  setClawdbotBaseUrl: (url: string) => void;
  setClawdbotToken: (token: string) => void;
  setClawdbotChannel: (channel: ClawdbotChannelOption | undefined) => void;
  setClawdbotRecipient: (recipient: string) => void;

  // Virtual keyboard
  virtualKeyboardKeys: VirtualKeyboardKey[];
  setVirtualKeyboardKeys: (keys: VirtualKeyboardKey[]) => void;

  // Repo Picker settings
  devFolders: DevFolder[];
  addDevFolder: (folder: DevFolder) => void;
  removeDevFolder: (index: number) => void;
  updateDevFolder: (index: number, folder: DevFolder) => void;
  repoSortBy: RepoSortBy;
  setRepoSortBy: (sortBy: RepoSortBy) => void;
  showHiddenFolders: boolean;
  setShowHiddenFolders: (show: boolean) => void;
  repoLastUsed: Record<string, number>;
  markRepoUsed: (hostId: string, path: string) => void;

  // Session Generator settings
  defaultProvider: SpawnProvider;
  setDefaultProvider: (provider: SpawnProvider) => void;
  sessionNamingPattern: SessionNamingPattern;
  setSessionNamingPattern: (pattern: SessionNamingPattern) => void;
  autoCreateGroup: boolean;
  setAutoCreateGroup: (auto: boolean) => void;
  defaultSessionTemplate: SessionTemplate;
  setDefaultSessionTemplate: (template: SessionTemplate) => void;
  autoLinkSessions: boolean;
  setAutoLinkSessions: (auto: boolean) => void;
  defaultLinkType: LinkType;
  setDefaultLinkType: (linkType: LinkType) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      // Default all providers visible
      visibleProviders: {
        claude_code: true,
        codex: true,
        gemini_cli: true,
        opencode: true,
      },
      setProviderVisibility: (provider, visible) =>
        set((state) => ({
          visibleProviders: {
            ...state.visibleProviders,
            [provider]: visible,
          },
        })),

      // Default visualizer visible in sidebar
      showVisualizerInSidebar: true,
      setShowVisualizerInSidebar: (show) => set({ showVisualizerInSidebar: show }),

      // Alert settings defaults
      notificationsEnabled: false,
      setNotificationsEnabled: (enabled) =>
        set((state) => ({
          notificationsEnabled: enabled,
          alertSettings: {
            ...state.alertSettings,
            browser: {
              ...state.alertSettings.browser,
              enabled,
            },
          },
        })),
      audioEnabled: false,
      setAudioEnabled: (enabled) =>
        set((state) => ({
          audioEnabled: enabled,
          alertSettings: {
            ...state.alertSettings,
            audio: {
              ...state.alertSettings.audio,
              enabled,
            },
          },
        })),
      alertSettings: { ...DEFAULT_ALERT_SETTINGS },
      setAlertSettings: (settings) =>
        set({
          alertSettings: settings,
          notificationsEnabled: settings.browser.enabled,
          audioEnabled: settings.audio.enabled,
        }),
      setAlertChannelEnabled: (channel, enabled) =>
        set((state) => {
          const current = channel === 'clawdbot'
            ? (state.alertSettings.clawdbot ?? DEFAULT_CLAWDBOT_SETTINGS)
            : (state.alertSettings[channel] as AlertChannelSettings | AlertAudioChannelSettings);
          const updated = { ...current, enabled };
          const next = {
            ...state.alertSettings,
            [channel]: updated,
          };
          return {
            alertSettings: next,
            notificationsEnabled: channel === 'browser' ? enabled : state.notificationsEnabled,
            audioEnabled: channel === 'audio' ? enabled : state.audioEnabled,
          };
        }),
      setAlertChannelFocus: (channel, onlyWhenUnfocused) =>
        set((state) => {
          const current = channel === 'clawdbot'
            ? (state.alertSettings.clawdbot ?? DEFAULT_CLAWDBOT_SETTINGS)
            : (state.alertSettings[channel] as AlertChannelSettings | AlertAudioChannelSettings);
          const updated = { ...current, onlyWhenUnfocused };
          return {
            alertSettings: {
              ...state.alertSettings,
              [channel]: updated,
            },
          };
        }),
      setAlertChannelEvent: (channel, event, enabled) =>
        set((state) => {
          const current = channel === 'clawdbot'
            ? (state.alertSettings.clawdbot ?? DEFAULT_CLAWDBOT_SETTINGS)
            : (state.alertSettings[channel] as AlertChannelSettings | AlertAudioChannelSettings);
          const updated = {
            ...current,
            events: {
              ...current.events,
              [event]: enabled,
            },
          };
          return {
            alertSettings: {
              ...state.alertSettings,
              [channel]: updated,
            },
          };
        }),
      setAlertChannelProvider: (channel, provider, enabled) =>
        set((state) => {
          const current = channel === 'clawdbot'
            ? (state.alertSettings.clawdbot ?? DEFAULT_CLAWDBOT_SETTINGS)
            : (state.alertSettings[channel] as AlertChannelSettings | AlertAudioChannelSettings);
          const updated = {
            ...current,
            providers: {
              ...current.providers,
              [provider]: enabled,
            },
          };
          return {
            alertSettings: {
              ...state.alertSettings,
              [channel]: updated,
            },
          };
        }),
      setAlertAudioVolume: (volume) =>
        set((state) => ({
          alertSettings: {
            ...state.alertSettings,
            audio: {
              ...state.alertSettings.audio,
              volume: Math.max(0, Math.min(1, volume)),
            },
          },
        })),
      setUsageThresholds: (provider, thresholds) =>
        set((state) => ({
          alertSettings: {
            ...state.alertSettings,
            usageThresholds: {
              ...state.alertSettings.usageThresholds,
              [provider]: clampThresholds(thresholds),
            },
          },
        })),

      // Clawdbot settings
      setClawdbotBaseUrl: (url) =>
        set((state) => ({
          alertSettings: {
            ...state.alertSettings,
            clawdbot: {
              ...(state.alertSettings.clawdbot ?? DEFAULT_CLAWDBOT_SETTINGS),
              baseUrl: url,
            },
          },
        })),
      setClawdbotToken: (token) =>
        set((state) => ({
          alertSettings: {
            ...state.alertSettings,
            clawdbot: {
              ...(state.alertSettings.clawdbot ?? DEFAULT_CLAWDBOT_SETTINGS),
              token,
            },
          },
        })),
      setClawdbotChannel: (channel) =>
        set((state) => ({
          alertSettings: {
            ...state.alertSettings,
            clawdbot: {
              ...(state.alertSettings.clawdbot ?? DEFAULT_CLAWDBOT_SETTINGS),
              channel,
            },
          },
        })),
      setClawdbotRecipient: (recipient) =>
        set((state) => ({
          alertSettings: {
            ...state.alertSettings,
            clawdbot: {
              ...(state.alertSettings.clawdbot ?? DEFAULT_CLAWDBOT_SETTINGS),
              recipient,
            },
          },
        })),

      // Virtual keyboard defaults
      virtualKeyboardKeys: [...DEFAULT_VIRTUAL_KEY_ORDER],
      setVirtualKeyboardKeys: (keys) => set({ virtualKeyboardKeys: keys }),

      // Repo Picker defaults
      devFolders: [],
      addDevFolder: (folder) =>
        set((state) => ({
          devFolders: [...state.devFolders, folder],
        })),
      removeDevFolder: (index) =>
        set((state) => ({
          devFolders: state.devFolders.filter((_, i) => i !== index),
        })),
      updateDevFolder: (index, folder) =>
        set((state) => ({
          devFolders: state.devFolders.map((f, i) => (i === index ? folder : f)),
        })),
      repoSortBy: 'name',
      setRepoSortBy: (sortBy) => set({ repoSortBy: sortBy }),
      showHiddenFolders: false,
      setShowHiddenFolders: (show) => set({ showHiddenFolders: show }),
      repoLastUsed: {},
      markRepoUsed: (hostId, path) =>
        set((state) => ({
          repoLastUsed: {
            ...state.repoLastUsed,
            [`${hostId}:${path}`]: Date.now(),
          },
        })),

      // Session Generator defaults
      defaultProvider: 'claude_code',
      setDefaultProvider: (provider) => set({ defaultProvider: provider }),
      sessionNamingPattern: 'repo_name',
      setSessionNamingPattern: (pattern) => set({ sessionNamingPattern: pattern }),
      autoCreateGroup: true,
      setAutoCreateGroup: (auto) => set({ autoCreateGroup: auto }),
      defaultSessionTemplate: 'single',
      setDefaultSessionTemplate: (template) => set({ defaultSessionTemplate: template }),
      autoLinkSessions: true,
      setAutoLinkSessions: (auto) => set({ autoLinkSessions: auto }),
      defaultLinkType: 'complement',
      setDefaultLinkType: (linkType) => set({ defaultLinkType: linkType }),
    }),
    {
      name: 'settings-storage',
    }
  )
);
