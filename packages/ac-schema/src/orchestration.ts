import { z } from 'zod';

export const SessionRoleSchema = z.enum(['orchestrator', 'worker', 'standalone']);
export type SessionRole = z.infer<typeof SessionRoleSchema>;

export const SessionEdgeTypeSchema = z.enum([
  'orchestrates',
  'spawned',
  'forked',
  'reviews',
  'implements',
]);
export type SessionEdgeType = z.infer<typeof SessionEdgeTypeSchema>;

export const SessionEdgeSchema = z.object({
  parent_session_id: z.string().uuid(),
  child_session_id: z.string().uuid(),
  edge_type: SessionEdgeTypeSchema,
  created_at: z.string().datetime({ offset: true }),
});
export type SessionEdge = z.infer<typeof SessionEdgeSchema>;

export const AgentTaskStatusSchema = z.enum(['running', 'completed', 'failed']);
export type AgentTaskStatus = z.infer<typeof AgentTaskStatusSchema>;

export const AgentTaskSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  tool_use_id: z.string().min(1),
  description: z.string(),
  status: AgentTaskStatusSchema,
  started_at: z.string().datetime({ offset: true }),
  ended_at: z.string().datetime({ offset: true }).nullable().optional(),
  metadata: z.record(z.unknown()).default({}),
});
export type AgentTask = z.infer<typeof AgentTaskSchema>;
