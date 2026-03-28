import { z } from 'zod';

export const RepoSchema = z.object({
  id: z.string().uuid(),
  canonical_key: z.string(),
  git_remote_normalized: z.string().nullable().optional(),
  repo_root_hash: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  last_host_id: z.string().uuid().nullable().optional(),
  last_repo_root: z.string().nullable().optional(),
  created_at: z.string().datetime({ offset: true }).optional(),
  updated_at: z.string().datetime({ offset: true }).optional(),
});
export type Repo = z.infer<typeof RepoSchema>;

export const ResolveRepoRequestSchema = z.object({
  git_remote: z.string().optional(),
  repo_root: z.string().optional(),
  host_id: z.string().uuid().optional(),
  display_name: z.string().optional(),
});
export type ResolveRepoRequest = z.infer<typeof ResolveRepoRequestSchema>;
