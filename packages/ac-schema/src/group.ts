import { z } from 'zod';

// Session group schema
export const SessionGroupSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  parent_id: z.string().uuid().nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6366f1'),
  icon: z.string().max(50).default('folder'),
  sort_order: z.number().int().default(0),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
export type SessionGroup = z.infer<typeof SessionGroupSchema>;

// Session group with session count (from db queries)
export interface SessionGroupWithCount extends SessionGroup {
  session_count: number;
}

// Session group with children (for tree view)
export interface SessionGroupWithChildren extends SessionGroup {
  children: SessionGroupWithChildren[];
  session_count: number;
}

// Schema for validating group with children (used in API responses)
export const SessionGroupWithChildrenSchema: z.ZodType<SessionGroupWithChildren> = SessionGroupSchema.extend({
  children: z.lazy(() => z.array(SessionGroupWithChildrenSchema)).default([]),
  session_count: z.number().int().nonnegative().default(0),
}) as z.ZodType<SessionGroupWithChildren>;

// Create group request
export const CreateGroupRequestSchema = z.object({
  name: z.string().min(1).max(255),
  parent_id: z.string().uuid().nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.string().max(50).optional(),
  sort_order: z.number().int().optional(),
});
export type CreateGroupRequest = z.infer<typeof CreateGroupRequestSchema>;

// Update group request
export const UpdateGroupRequestSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  parent_id: z.string().uuid().nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.string().max(50).optional(),
  sort_order: z.number().int().optional(),
});
export type UpdateGroupRequest = z.infer<typeof UpdateGroupRequestSchema>;

// Assign session to group request
export const AssignSessionGroupRequestSchema = z.object({
  group_id: z.string().uuid().nullable(),
});
export type AssignSessionGroupRequest = z.infer<typeof AssignSessionGroupRequestSchema>;
