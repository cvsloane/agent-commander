import { z } from 'zod';

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  host_id: z.string().uuid(),
  path: z.string(),
  display_name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  last_used_at: z.string().datetime({ offset: true }).nullable().optional(),
  usage_count: z.number().int().optional(),
  git_remote: z.string().nullable().optional(),
  default_branch: z.string().nullable().optional(),
  created_at: z.string().datetime({ offset: true }).optional(),
  updated_at: z.string().datetime({ offset: true }).optional(),
});

export type Project = z.infer<typeof ProjectSchema>;
