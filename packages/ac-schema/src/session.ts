import { z } from 'zod';
import { SessionKindSchema, SessionProviderSchema, SessionStatusSchema } from './enums.js';

// Session Link Types
export const SessionLinkTypeSchema = z.enum(['complement', 'review', 'implement', 'research']);
export type SessionLinkType = z.infer<typeof SessionLinkTypeSchema>;

// Session Link Schema
export const SessionLinkSchema = z.object({
  id: z.string().uuid(),
  source_session_id: z.string().uuid(),
  target_session_id: z.string().uuid(),
  link_type: SessionLinkTypeSchema,
  created_at: z.string(),
});
export type SessionLink = z.infer<typeof SessionLinkSchema>;

// Session Link with linked session details (for UI)
export const SessionLinkWithSessionSchema = SessionLinkSchema.extend({
  linked_session_id: z.string().uuid(),
  linked_session_title: z.string().nullable(),
  linked_session_provider: SessionProviderSchema,
  linked_session_status: SessionStatusSchema,
  linked_session_cwd: z.string().nullable(),
  direction: z.enum(['outgoing', 'incoming']),
});
export type SessionLinkWithSession = z.infer<typeof SessionLinkWithSessionSchema>;

// Create Session Link Request
export const CreateSessionLinkSchema = z.object({
  target_session_id: z.string().uuid(),
  link_type: SessionLinkTypeSchema,
});
export type CreateSessionLink = z.infer<typeof CreateSessionLinkSchema>;

// Tmux metadata
export const TmuxMetadataSchema = z.object({
  pane_pid: z.number().optional(),
  current_command: z.string().optional(),
  session_name: z.string().optional(),
  window_name: z.string().optional(),
  window_index: z.number().optional(),
  pane_index: z.number().optional(),
});
export type TmuxMetadata = z.infer<typeof TmuxMetadataSchema>;

// Session metadata
export const SessionMetadataSchema = z.object({
  tmux: TmuxMetadataSchema.optional(),
  unmanaged: z.boolean().optional(),
  claude_session_id: z.string().optional(),
  codex_thread_id: z.string().optional(),
  status_detail: z.string().nullable().optional(),
  git_status: z.object({
    branch: z.string().optional(),
    upstream: z.string().optional(),
    ahead: z.number().int().optional(),
    behind: z.number().int().optional(),
    staged: z.number().int().optional(),
    unstaged: z.number().int().optional(),
    untracked: z.number().int().optional(),
    unmerged: z.number().int().optional(),
    updated_at: z.string().datetime({ offset: true }).optional(),
  }).optional(),
  approval: z.object({
    id: z.string().uuid().optional(),
    reason: z.string().optional(),
    tool: z.string().optional(),
    summary: z.string().optional(),
  }).nullable().optional(),
});
export type SessionMetadata = z.infer<typeof SessionMetadataSchema>;

// Session schema for database/API
export const SessionSchema = z.object({
  id: z.string().uuid(),
  host_id: z.string().uuid(),
  kind: SessionKindSchema,
  provider: SessionProviderSchema,
  status: SessionStatusSchema,
  title: z.string().nullable().optional(),
  cwd: z.string().nullable().optional(),
  repo_root: z.string().nullable().optional(),
  git_remote: z.string().nullable().optional(),
  git_branch: z.string().nullable().optional(),
  tmux_pane_id: z.string().nullable().optional(),
  tmux_target: z.string().nullable().optional(),
  metadata: SessionMetadataSchema.nullable().optional(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
  last_activity_at: z.string().datetime({ offset: true }).nullable().optional(),
  idled_at: z.string().datetime({ offset: true }).nullable().optional(),
  // Group support
  group_id: z.string().uuid().nullable().optional(),
  // Forking support
  forked_from: z.string().uuid().nullable().optional(),
  fork_depth: z.number().int().nonnegative().default(0),
  // Archive support
  archived_at: z.string().datetime({ offset: true }).nullable().optional(),
});
export type Session = z.infer<typeof SessionSchema>;

// Session upsert payload (from agent)
export const SessionUpsertSchema = z.object({
  id: z.string().uuid(),
  host_id: z.string().uuid().optional(),
  kind: SessionKindSchema,
  provider: SessionProviderSchema,
  status: SessionStatusSchema,
  title: z.string().optional(),
  cwd: z.string().optional(),
  repo_root: z.string().optional(),
  git_branch: z.string().optional(),
  git_remote: z.string().optional(),
  tmux_pane_id: z.string().nullable().optional(),
  tmux_target: z.string().nullable().optional(),
  metadata: SessionMetadataSchema.optional(),
  group_id: z.string().uuid().nullable().optional(),
  forked_from: z.string().uuid().nullable().optional(),
  fork_depth: z.number().int().nonnegative().optional(),
  last_activity_at: z.string().datetime({ offset: true }).optional(),
  archived_at: z.string().datetime({ offset: true }).nullable().optional(),
});
export type SessionUpsert = z.infer<typeof SessionUpsertSchema>;

// Session snapshot
export const SessionSnapshotSchema = z.object({
  id: z.number().optional(),
  session_id: z.string().uuid(),
  created_at: z.string().datetime({ offset: true }),
  capture_text: z.string(),
  capture_hash: z.string(),
});
export type SessionSnapshot = z.infer<typeof SessionSnapshotSchema>;

// Session with latest snapshot (for list view)
export const SessionWithSnapshotSchema = SessionSchema.extend({
  latest_snapshot: SessionSnapshotSchema.pick({
    created_at: true,
    capture_text: true,
  })
    .nullable()
    .optional(),
});
export type SessionWithSnapshot = z.infer<typeof SessionWithSnapshotSchema>;

// Update session request (for PATCH /v1/sessions/:id)
export const UpdateSessionRequestSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  idle: z.boolean().optional(),
});
export type UpdateSessionRequest = z.infer<typeof UpdateSessionRequestSchema>;

// Bulk operation types
export const BulkOperationTypeSchema = z.enum([
  'delete',
  'archive',
  'unarchive',
  'assign_group',
  'idle',
  'unidle',
  'terminate',
]);
export type BulkOperationType = z.infer<typeof BulkOperationTypeSchema>;

// Bulk operation request
export const BulkOperationRequestSchema = z.object({
  operation: BulkOperationTypeSchema,
  session_ids: z.array(z.string().uuid()).min(1).max(100),
  // For assign_group operation
  group_id: z.string().uuid().nullable().optional(),
});
export type BulkOperationRequest = z.infer<typeof BulkOperationRequestSchema>;

// Bulk operation result
export const BulkOperationResultSchema = z.object({
  operation: BulkOperationTypeSchema,
  success_count: z.number(),
  error_count: z.number(),
  errors: z.array(z.object({
    session_id: z.string().uuid(),
    error: z.string(),
  })).optional(),
});
export type BulkOperationResult = z.infer<typeof BulkOperationResultSchema>;
