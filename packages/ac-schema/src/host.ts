import { z } from 'zod';

// Host capabilities
export const HostCapabilitiesSchema = z.object({
  tmux: z.boolean().default(true),
  spawn: z.boolean().default(true),
  kill: z.boolean().default(true),
  console_stream: z.boolean().default(true),
  terminal: z.boolean().default(false),
  claude_hooks: z.boolean().default(false),
  codex_exec_json: z.boolean().default(false),
  list_directory: z.boolean().default(false),
  list_directory_roots: z.array(z.string()).default([]),
  list_directory_show_hidden: z.boolean().default(false),
});
export type HostCapabilities = z.infer<typeof HostCapabilitiesSchema>;

// Host schema for database/API
export const HostSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  tailscale_name: z.string().nullable().optional(),
  tailscale_ip: z.string().nullable().optional(),
  capabilities: HostCapabilitiesSchema,
  agent_version: z.string().nullable().optional(),
  last_seen_at: z.string().datetime({ offset: true }).nullable().optional(),
  last_acked_seq: z.number().int().optional(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
export type Host = z.infer<typeof HostSchema>;

// Host for agent hello message
export const AgentHostInfoSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  tailscale_name: z.string().optional(),
  tailscale_ip: z.string().optional(),
  agent_version: z.string(),
  capabilities: HostCapabilitiesSchema,
});
export type AgentHostInfo = z.infer<typeof AgentHostInfoSchema>;
