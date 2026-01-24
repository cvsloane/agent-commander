import { z } from 'zod';

// MCP Server Definition (read from host's config.toml, secrets redacted)
export const MCPServerSchema = z.object({
  name: z.string(),
  display_name: z.string().optional(),
  description: z.string().optional(),
  transport: z.enum(['stdio', 'http']).default('stdio'),
  // For stdio MCPs
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  // For http MCPs
  url: z.string().optional(),
  // Env vars - secret values are redacted to "***REDACTED***"
  env: z.record(z.string()).optional(),
  // Flags
  has_secrets: z.boolean().default(false),
  poolable: z.boolean().default(false),
});
export type MCPServer = z.infer<typeof MCPServerSchema>;

// MCP enablement for a session or project
export const MCPEnablementSchema = z.object({
  enabled: z.boolean(),
  scope: z.enum(['session', 'project', 'global']).default('session'),
});
export type MCPEnablement = z.infer<typeof MCPEnablementSchema>;

// MCP config for a session (returned by GET /v1/sessions/:id/mcp)
export const SessionMCPConfigSchema = z.object({
  session_id: z.string().uuid(),
  servers: z.array(MCPServerSchema),
  enablement: z.record(MCPEnablementSchema), // keyed by mcp name
  restart_required: z.boolean().default(false),
});
export type SessionMCPConfig = z.infer<typeof SessionMCPConfigSchema>;

// Request to update MCP config for a session
export const UpdateMCPConfigRequestSchema = z.object({
  enablement: z.record(z.object({
    enabled: z.boolean(),
    scope: z.enum(['session', 'project', 'global']).optional(),
  })),
});
export type UpdateMCPConfigRequest = z.infer<typeof UpdateMCPConfigRequestSchema>;

// MCP Pool configuration
export const MCPPoolConfigSchema = z.object({
  enabled: z.boolean().default(false),
  pool_all: z.boolean().default(false),
  exclude_mcps: z.array(z.string()).optional(),
});
export type MCPPoolConfig = z.infer<typeof MCPPoolConfigSchema>;

// Messages for MCP operations
export const MCPListRequestMessageSchema = z.object({
  v: z.literal(1),
  type: z.literal('mcp.list_servers'),
  ts: z.string().datetime({ offset: true }),
  payload: z.object({
    cmd_id: z.string(),
    host_id: z.string().uuid(),
  }),
});

export const MCPGetConfigMessageSchema = z.object({
  v: z.literal(1),
  type: z.literal('mcp.get_config'),
  ts: z.string().datetime({ offset: true }),
  payload: z.object({
    cmd_id: z.string(),
    session_id: z.string().uuid(),
  }),
});

export const MCPUpdateConfigMessageSchema = z.object({
  v: z.literal(1),
  type: z.literal('mcp.update_config'),
  ts: z.string().datetime({ offset: true }),
  payload: z.object({
    cmd_id: z.string(),
    session_id: z.string().uuid(),
    enablement: z.record(z.object({
      enabled: z.boolean(),
      scope: z.enum(['session', 'project', 'global']).optional(),
    })),
  }),
});

export const MCPServersResponseMessageSchema = z.object({
  v: z.literal(1),
  type: z.literal('mcp.servers'),
  ts: z.string().datetime({ offset: true }),
  seq: z.number().int().positive(),
  payload: z.object({
    cmd_id: z.string(),
    servers: z.array(MCPServerSchema),
    pool_config: MCPPoolConfigSchema.optional(),
  }),
});

export const MCPConfigResponseMessageSchema = z.object({
  v: z.literal(1),
  type: z.literal('mcp.config'),
  ts: z.string().datetime({ offset: true }),
  seq: z.number().int().positive(),
  payload: SessionMCPConfigSchema.extend({
    cmd_id: z.string(),
  }),
});

export const MCPProjectConfigResponseMessageSchema = z.object({
  v: z.literal(1),
  type: z.literal('mcp.project_config'),
  ts: z.string().datetime({ offset: true }),
  seq: z.number().int().positive(),
  payload: z.object({
    cmd_id: z.string(),
    enablement: z.record(MCPEnablementSchema),
  }),
});

export const MCPUpdateResultMessageSchema = z.object({
  v: z.literal(1),
  type: z.literal('mcp.update_result'),
  ts: z.string().datetime({ offset: true }),
  seq: z.number().int().positive(),
  payload: z.object({
    cmd_id: z.string(),
    success: z.boolean(),
    restart_required: z.boolean(),
    error: z.string().optional(),
  }),
});
