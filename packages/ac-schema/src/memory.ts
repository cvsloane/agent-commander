import { z } from 'zod';

export const MemoryScopeTypeSchema = z.enum(['global', 'repo', 'working']);
export type MemoryScopeType = z.infer<typeof MemoryScopeTypeSchema>;

export const MemoryTierSchema = z.enum(['working', 'episodic', 'semantic', 'procedural']);
export type MemoryTier = z.infer<typeof MemoryTierSchema>;

export const MemoryEntrySchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  scope_type: MemoryScopeTypeSchema,
  repo_id: z.string().uuid().nullable().optional(),
  session_id: z.string().uuid().nullable().optional(),
  tier: MemoryTierSchema,
  summary: z.string(),
  content: z.string(),
  metadata: z.record(z.unknown()).default({}),
  confidence: z.number(),
  embedding: z.unknown().optional(),
  embedding_model: z.string().nullable().optional(),
  embedding_dimensions: z.number().int().nullable().optional(),
  access_count: z.number().int().default(0),
  last_accessed_at: z.string().datetime({ offset: true }).nullable().optional(),
  expires_at: z.string().datetime({ offset: true }).nullable().optional(),
  created_at: z.string().datetime({ offset: true }).optional(),
  updated_at: z.string().datetime({ offset: true }).optional(),
});
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

export const MemoryTrajectorySchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  repo_id: z.string().uuid().nullable().optional(),
  session_id: z.string().uuid().nullable().optional(),
  automation_run_id: z.string().uuid().nullable().optional(),
  objective: z.string().nullable().optional(),
  outcome: z.string(),
  summary: z.string(),
  steps_json: z.unknown(),
  distilled_at: z.string().datetime({ offset: true }).nullable().optional(),
  created_at: z.string().datetime({ offset: true }).optional(),
  updated_at: z.string().datetime({ offset: true }).optional(),
});
export type MemoryTrajectory = z.infer<typeof MemoryTrajectorySchema>;

export const UpsertMemoryEntrySchema = z.object({
  scope_type: MemoryScopeTypeSchema,
  repo_id: z.string().uuid().optional(),
  session_id: z.string().uuid().optional(),
  tier: MemoryTierSchema,
  summary: z.string().min(1),
  content: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  expires_at: z.string().datetime({ offset: true }).optional(),
  embedding: z.unknown().optional(),
  embedding_model: z.string().optional(),
  embedding_dimensions: z.number().int().optional(),
});
export type UpsertMemoryEntry = z.infer<typeof UpsertMemoryEntrySchema>;

export const MemorySearchQuerySchema = z.object({
  q: z.string().min(1),
  scope_type: MemoryScopeTypeSchema.optional(),
  repo_id: z.string().uuid().optional(),
  tier: MemoryTierSchema.optional(),
  limit: z.coerce.number().min(1).max(50).default(10),
});
export type MemorySearchQuery = z.infer<typeof MemorySearchQuerySchema>;
