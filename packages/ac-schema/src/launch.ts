import { z } from 'zod';
import { SessionProviderSchema } from './enums.js';
import { SessionSchema } from './session.js';

export const MobileLaunchProviderSchema = z.enum(['codex', 'claude_code']);
export type MobileLaunchProvider = z.infer<typeof MobileLaunchProviderSchema>;

export const LaunchTargetProviderSupportSchema = z.object({
  codex: z.boolean(),
  claude_code: z.boolean(),
});
export type LaunchTargetProviderSupport = z.infer<typeof LaunchTargetProviderSupportSchema>;

export const LaunchRecentProjectSchema = z.object({
  id: z.string().uuid().optional(),
  path: z.string(),
  display_name: z.string().nullable().optional(),
  last_used_at: z.string().datetime({ offset: true }).nullable().optional(),
});
export type LaunchRecentProject = z.infer<typeof LaunchRecentProjectSchema>;

export const LaunchRecentTmuxSchema = z.object({
  session_id: z.string().uuid(),
  title: z.string().nullable().optional(),
  tmux_target: z.string().nullable().optional(),
  pane_id: z.string().nullable().optional(),
  cwd: z.string().nullable().optional(),
  provider: SessionProviderSchema,
  status: z.string(),
});
export type LaunchRecentTmux = z.infer<typeof LaunchRecentTmuxSchema>;

export const RecentLaunchSchema = z.object({
  id: z.string().uuid(),
  host_id: z.string().uuid(),
  provider: MobileLaunchProviderSchema,
  working_directory: z.string(),
  tmux_target: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  launch_count: z.number().int().nonnegative(),
  last_launched_at: z.string().datetime({ offset: true }),
});
export type RecentLaunch = z.infer<typeof RecentLaunchSchema>;

export const LaunchTargetSchema = z.object({
  host_id: z.string().uuid(),
  alias: z.string(),
  display_name: z.string(),
  online: z.boolean(),
  supports_terminal: z.boolean(),
  supports_spawn: z.boolean(),
  supports_directory_listing: z.boolean(),
  providers: LaunchTargetProviderSupportSchema,
  roots: z.array(z.string()),
  recent_projects: z.array(LaunchRecentProjectSchema),
  recent_tmux: z.array(LaunchRecentTmuxSchema),
  recent_launches: z.array(RecentLaunchSchema).default([]),
});
export type LaunchTarget = z.infer<typeof LaunchTargetSchema>;

export const LaunchTargetsResponseSchema = z.object({
  targets: z.array(LaunchTargetSchema),
});
export type LaunchTargetsResponse = z.infer<typeof LaunchTargetsResponseSchema>;

export const LaunchRequestSchema = z.object({
  host_id: z.string().uuid().optional(),
  host_alias: z.string().min(1).optional(),
  provider: MobileLaunchProviderSchema,
  working_directory: z.string().min(1),
  title: z.string().min(1).optional(),
  flags: z.array(z.string()).optional(),
  group_id: z.string().uuid().optional(),
  prompt: z.string().optional(),
  wait: z.boolean().default(true),
  wait_timeout_ms: z.number().int().min(1000).max(30000).default(15000),
  tmux: z
    .object({
      target_session: z.string().min(1).optional(),
      window_name: z.string().min(1).optional(),
    })
    .optional(),
}).refine((value) => Boolean(value.host_id || value.host_alias), {
  message: 'host_id or host_alias is required',
  path: ['host_id'],
});
export type LaunchRequest = z.infer<typeof LaunchRequestSchema>;

export const LaunchStatusSchema = z.enum(['ready', 'starting', 'failed']);
export type LaunchStatus = z.infer<typeof LaunchStatusSchema>;

export const LaunchResponseSchema = z.object({
  session_id: z.string().uuid(),
  cmd_id: z.string(),
  status: LaunchStatusSchema,
  href: z.string(),
  session: SessionSchema,
  terminal: z.object({
    openable: z.boolean(),
    pane_id: z.string().nullable().optional(),
  }),
  prompt_cmd_id: z.string().optional(),
});
export type LaunchResponse = z.infer<typeof LaunchResponseSchema>;

export const TmuxOpenRequestSchema = z.object({
  host_id: z.string().uuid().optional(),
  host_alias: z.string().min(1).optional(),
  tmux_target: z.string().min(1).optional(),
  pane_id: z.string().min(1).optional(),
}).refine((value) => Boolean(value.host_id || value.host_alias), {
  message: 'host_id or host_alias is required',
  path: ['host_id'],
}).refine((value) => Boolean(value.tmux_target || value.pane_id), {
  message: 'tmux_target or pane_id is required',
  path: ['tmux_target'],
});
export type TmuxOpenRequest = z.infer<typeof TmuxOpenRequestSchema>;

export const TmuxOpenResponseSchema = z.object({
  session_id: z.string().uuid(),
  href: z.string(),
  session: SessionSchema,
  adopted: z.boolean(),
  terminal: z.object({
    openable: z.boolean(),
    pane_id: z.string().nullable().optional(),
  }),
});
export type TmuxOpenResponse = z.infer<typeof TmuxOpenResponseSchema>;
