import { z } from 'zod';

// Session Context Schema
export const SessionContextSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  key: z.string().min(1).max(255),
  value: z.string(),
  updated_at: z.string(),
});
export type SessionContext = z.infer<typeof SessionContextSchema>;

// Create/Update Context Request
export const UpsertContextSchema = z.object({
  value: z.string(),
});
export type UpsertContext = z.infer<typeof UpsertContextSchema>;

// List Context Response
export const ListContextResponseSchema = z.object({
  context: z.array(SessionContextSchema.pick({
    key: true,
    value: true,
    updated_at: true,
  })),
});
export type ListContextResponse = z.infer<typeof ListContextResponseSchema>;
