import { z } from 'zod';
import { SessionProviderSchema } from './enums.js';

export const RepoSortBySchema = z.enum(['name', 'last_modified', 'last_used']);
export type RepoSortBy = z.infer<typeof RepoSortBySchema>;

export const SessionNamingPatternSchema = z.enum(['repo_name', 'branch_name', 'repo_branch']);
export type SessionNamingPattern = z.infer<typeof SessionNamingPatternSchema>;

export const SessionTemplateSchema = z.enum(['single', 'claude_codex', 'full_dev']);
export type SessionTemplate = z.infer<typeof SessionTemplateSchema>;

export const LinkTypeSchema = z.enum(['complement', 'review']);
export type LinkType = z.infer<typeof LinkTypeSchema>;

export const VisualizerThemeSchema = z.enum(['botspace', 'civilization', 'bridge-control']);
export type VisualizerTheme = z.infer<typeof VisualizerThemeSchema>;

export const DevFolderSchema = z.object({
  hostId: z.string().uuid(),
  path: z.string(),
  label: z.string().optional(),
});
export type DevFolder = z.infer<typeof DevFolderSchema>;

export const VisibleProvidersSchema = z.object({
  claude_code: z.boolean(),
  codex: z.boolean(),
  gemini_cli: z.boolean(),
});
export type VisibleProviders = z.infer<typeof VisibleProvidersSchema>;

export const AlertEventSchema = z.enum([
  'approvals',
  'waiting_input',
  'waiting_approval',
  'error',
  'snapshot_action',
  'usage_thresholds',
  'approval_decisions',
]);
export type AlertEvent = z.infer<typeof AlertEventSchema>;

export const AlertEventTogglesSchema = z.object({
  approvals: z.boolean(),
  waiting_input: z.boolean(),
  waiting_approval: z.boolean(),
  error: z.boolean(),
  snapshot_action: z.boolean(),
  usage_thresholds: z.boolean(),
  approval_decisions: z.boolean(),
});
export type AlertEventToggles = z.infer<typeof AlertEventTogglesSchema>;

export const AlertProviderFiltersSchema = z.record(SessionProviderSchema, z.boolean());
export type AlertProviderFilters = z.infer<typeof AlertProviderFiltersSchema>;

export const AlertChannelSchema = z.object({
  enabled: z.boolean(),
  onlyWhenUnfocused: z.boolean(),
  events: AlertEventTogglesSchema,
  providers: AlertProviderFiltersSchema,
});
export type AlertChannelSettings = z.infer<typeof AlertChannelSchema>;

export const AlertAudioChannelSchema = AlertChannelSchema.extend({
  volume: z.number().min(0).max(1),
});
export type AlertAudioChannelSettings = z.infer<typeof AlertAudioChannelSchema>;

export const ClawdbotChannelOptionsSchema = z.enum([
  'telegram',
  'discord',
  'slack',
  'whatsapp',
  'signal',
  'imessage',
]);
export type ClawdbotChannelOption = z.infer<typeof ClawdbotChannelOptionsSchema>;

export const ClawdbotChannelSchema = AlertChannelSchema.extend({
  baseUrl: z.string().url().optional(),
  token: z.string().optional(),
  channel: ClawdbotChannelOptionsSchema.optional(),
  recipient: z.string().optional(),
});
export type ClawdbotChannelSettings = z.infer<typeof ClawdbotChannelSchema>;

export const UsageThresholdsSchema = z.record(
  SessionProviderSchema,
  z.array(z.number().int().min(1).max(100))
);
export type UsageThresholds = z.infer<typeof UsageThresholdsSchema>;

export const AlertSettingsSchema = z.object({
  browser: AlertChannelSchema,
  audio: AlertAudioChannelSchema,
  toast: AlertChannelSchema,
  clawdbot: ClawdbotChannelSchema.optional(),
  usageThresholds: UsageThresholdsSchema,
});
export type AlertSettings = z.infer<typeof AlertSettingsSchema>;

export const VirtualKeyboardKeySchema = z.enum([
  'ctrl_c',
  'esc',
  'tab',
  'shift_tab',
  'arrow_up',
  'arrow_down',
  'arrow_left',
  'arrow_right',
  'enter',
]);
export type VirtualKeyboardKey = z.infer<typeof VirtualKeyboardKeySchema>;

const DEFAULT_VIRTUAL_KEYBOARD_KEYS: VirtualKeyboardKey[] = [
  'ctrl_c',
  'esc',
  'tab',
  'shift_tab',
  'arrow_up',
  'arrow_down',
  'arrow_left',
  'arrow_right',
  'enter',
];

export const UserSettingsDataSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  visualizerTheme: VisualizerThemeSchema,
  notificationsEnabled: z.boolean(),
  audioEnabled: z.boolean(),
  sidebarCollapsed: z.boolean(),
  visibleProviders: VisibleProvidersSchema,
  showVisualizerInSidebar: z.boolean(),
  alertSettings: AlertSettingsSchema,
  virtualKeyboardKeys: z.array(VirtualKeyboardKeySchema).default(DEFAULT_VIRTUAL_KEYBOARD_KEYS),
  devFolders: z.array(DevFolderSchema),
  repoSortBy: RepoSortBySchema,
  showHiddenFolders: z.boolean(),
  repoLastUsed: z.record(z.string(), z.number()),
  defaultProvider: SessionProviderSchema,
  sessionNamingPattern: SessionNamingPatternSchema,
  autoCreateGroup: z.boolean(),
  defaultSessionTemplate: SessionTemplateSchema,
  autoLinkSessions: z.boolean(),
  defaultLinkType: LinkTypeSchema,
});
export type UserSettingsData = z.infer<typeof UserSettingsDataSchema>;

export const UserSettingsSchema = z.object({
  version: z.number().int().default(1),
  data: UserSettingsDataSchema,
});
export type UserSettings = z.infer<typeof UserSettingsSchema>;
