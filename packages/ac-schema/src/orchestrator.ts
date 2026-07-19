import { z } from 'zod';
import { SessionProviderSchema } from './enums.js';
import { MemoryScopeTypeSchema, MemoryTierSchema } from './memory.js';

export const OrchestratorSpawnWorkerRequestSchema = z.object({
  host_id: z.string().uuid(),
  provider: SessionProviderSchema,
  working_directory: z.string().min(1),
  title: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  flags: z.array(z.string()).optional(),
  tmux: z.object({
    target_session: z.string().min(1).optional(),
    window_name: z.string().min(1).optional(),
  }).optional(),
});
export type OrchestratorSpawnWorkerRequest = z.infer<typeof OrchestratorSpawnWorkerRequestSchema>;

export const OrchestratorSendInputRequestSchema = z.object({
  input: z.string().min(1),
  enter: z.boolean().default(true),
});
export type OrchestratorSendInputRequest = z.infer<typeof OrchestratorSendInputRequestSchema>;

export const OrchestratorWorkItemClaimRequestSchema = z.object({
  work_item_id: z.string().uuid().optional(),
  repo_id: z.string().uuid().optional(),
});
export type OrchestratorWorkItemClaimRequest = z.infer<typeof OrchestratorWorkItemClaimRequestSchema>;

export const OrchestratorWorkItemCompleteRequestSchema = z.object({
  status: z.enum(['done', 'blocked', 'cancelled']).default('done'),
  result: z.record(z.unknown()).optional(),
});
export type OrchestratorWorkItemCompleteRequest = z.infer<typeof OrchestratorWorkItemCompleteRequestSchema>;

export const OrchestratorWorkItemsQuerySchema = z.object({
  status: z.enum(['queued', 'in_progress', 'blocked', 'done', 'cancelled']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type OrchestratorWorkItemsQuery = z.infer<typeof OrchestratorWorkItemsQuerySchema>;

export const OrchestratorMemorySearchQuerySchema = z.object({
  q: z.string().min(1),
  scope_type: MemoryScopeTypeSchema.optional(),
  tier: MemoryTierSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type OrchestratorMemorySearchQuery = z.infer<typeof OrchestratorMemorySearchQuerySchema>;

export const OrchestratorMemoryWriteRequestSchema = z.object({
  scope_type: MemoryScopeTypeSchema,
  tier: MemoryTierSchema,
  summary: z.string().min(1),
  content: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  expires_at: z.string().datetime({ offset: true }).optional(),
});
export type OrchestratorMemoryWriteRequest = z.infer<typeof OrchestratorMemoryWriteRequestSchema>;
