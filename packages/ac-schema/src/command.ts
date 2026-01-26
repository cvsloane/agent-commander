import { z } from 'zod';
import { CommandTypeSchema, SessionProviderSchema } from './enums.js';

// Send input command payload
export const SendInputPayloadSchema = z.object({
  text: z.string(),
  enter: z.boolean().default(true),
});
export type SendInputPayload = z.infer<typeof SendInputPayloadSchema>;

// Send keys command payload
export const SendKeysPayloadSchema = z.object({
  keys: z.array(z.string()),
});
export type SendKeysPayload = z.infer<typeof SendKeysPayloadSchema>;

// Adopt pane command payload
export const AdoptPanePayloadSchema = z.object({
  tmux_pane_id: z.string(),
  title: z.string().optional(),
});
export type AdoptPanePayload = z.infer<typeof AdoptPanePayloadSchema>;

// Rename session command payload
export const RenameSessionPayloadSchema = z.object({
  title: z.string(),
});
export type RenameSessionPayload = z.infer<typeof RenameSessionPayloadSchema>;

// Spawn session command payload (interactive tmux session)
export const SpawnSessionInteractivePayloadSchema = z.object({
  provider: SessionProviderSchema,
  working_directory: z.string(),
  title: z.string().optional(),
  flags: z.array(z.string()).optional(),
  group_id: z.string().uuid().optional(),
  tmux: z
    .object({
      target_session: z.string().optional(),
      window_name: z.string().optional(),
    })
    .optional(),
});

// Spawn session command payload (worktree + tmux window)
export const SpawnSessionWorktreePayloadSchema = z.object({
  provider: SessionProviderSchema,
  repo_root: z.string(),
  base_branch: z.string().default('main'),
  branch_name: z.string(),
  worktree_dir: z.string(),
  title: z.string(),
  tmux: z.object({
    target_session: z.string().default('agents'),
    window_name: z.string(),
    command: z.string(),
  }),
  env: z.record(z.string()).optional(),
});

export const SpawnSessionPayloadSchema = z.union([
  SpawnSessionInteractivePayloadSchema,
  SpawnSessionWorktreePayloadSchema,
]);
export type SpawnSessionPayload = z.infer<typeof SpawnSessionPayloadSchema>;

// Spawn job command payload
export const SpawnJobPayloadSchema = z.object({
  provider: SessionProviderSchema,
  cwd: z.string(),
  prompt: z.string(),
  env: z.record(z.string()).optional(),
});
export type SpawnJobPayload = z.infer<typeof SpawnJobPayloadSchema>;

// Console subscribe payload
export const ConsoleSubscribePayloadSchema = z.object({
  subscription_id: z.string().uuid(),
  pane_id: z.string(),
});
export type ConsoleSubscribePayload = z.infer<typeof ConsoleSubscribePayloadSchema>;

// Console unsubscribe payload
export const ConsoleUnsubscribePayloadSchema = z.object({
  subscription_id: z.string().uuid(),
});
export type ConsoleUnsubscribePayload = z.infer<typeof ConsoleUnsubscribePayloadSchema>;

// Fork session command payload
export const ForkPayloadSchema = z.object({
  branch: z.string().optional(),
  cwd: z.string().optional(),
  provider: SessionProviderSchema.optional(),
  note: z.string().optional(),
  group_id: z.string().uuid().optional(),
});
export type ForkPayload = z.infer<typeof ForkPayloadSchema>;

// Capture pane mode enum
export const CaptureModeSchema = z.enum(['visible', 'last_n', 'range', 'full']);
export type CaptureMode = z.infer<typeof CaptureModeSchema>;

// Capture pane command payload (used for cross-host copy)
export const CapturePanePayloadSchema = z.object({
  mode: CaptureModeSchema.default('visible'),
  line_start: z.number().int().optional(),
  line_end: z.number().int().optional(),
  last_n_lines: z.number().int().optional(),
  strip_ansi: z.boolean().default(true),
});
export type CapturePanePayload = z.infer<typeof CapturePanePayloadSchema>;

// Copy to session command payload
export const CopyToSessionPayloadSchema = z.object({
  target_session_id: z.string().uuid(),
  mode: CaptureModeSchema.default('visible'),
  line_start: z.number().int().optional(),
  line_end: z.number().int().optional(),
  last_n_lines: z.number().int().optional(),
  prepend_text: z.string().optional(),
  append_text: z.string().optional(),
  strip_ansi: z.boolean().default(true),
});
export type CopyToSessionPayload = z.infer<typeof CopyToSessionPayloadSchema>;

// List directory command payload
export const ListDirectoryPayloadSchema = z.object({
  path: z.string(),
  show_hidden: z.boolean().default(false),
});
export type ListDirectoryPayload = z.infer<typeof ListDirectoryPayloadSchema>;

// Directory entry (result from list_directory)
export const DirectoryEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  is_directory: z.boolean(),
  is_git_repo: z.boolean(),
  git_branch: z.string().optional(),
  last_modified: z.union([z.number(), z.string()]).nullable().optional(),
});
export type DirectoryEntry = z.infer<typeof DirectoryEntrySchema>;

// Command payload union
export const CommandPayloadSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('send_input'), payload: SendInputPayloadSchema }),
  z.object({ type: z.literal('send_keys'), payload: SendKeysPayloadSchema }),
  z.object({ type: z.literal('interrupt'), payload: z.object({}).optional() }),
  z.object({ type: z.literal('kill_session'), payload: z.object({}).optional() }),
  z.object({ type: z.literal('adopt_pane'), payload: AdoptPanePayloadSchema }),
  z.object({ type: z.literal('rename_session'), payload: RenameSessionPayloadSchema }),
  z.object({ type: z.literal('spawn_session'), payload: SpawnSessionPayloadSchema }),
  z.object({ type: z.literal('spawn_job'), payload: SpawnJobPayloadSchema }),
  z.object({ type: z.literal('fork'), payload: ForkPayloadSchema }),
  z.object({ type: z.literal('console.subscribe'), payload: ConsoleSubscribePayloadSchema }),
  z.object({ type: z.literal('console.unsubscribe'), payload: ConsoleUnsubscribePayloadSchema }),
  z.object({ type: z.literal('copy_to_session'), payload: CopyToSessionPayloadSchema }),
  z.object({ type: z.literal('capture_pane'), payload: CapturePanePayloadSchema }),
  z.object({ type: z.literal('list_directory'), payload: ListDirectoryPayloadSchema }),
]);
export type CommandPayload = z.infer<typeof CommandPayloadSchema>;

// Command dispatch (to agent)
export const CommandDispatchSchema = z.object({
  cmd_id: z.string(),
  session_id: z.string().uuid(),
  command: CommandPayloadSchema,
});
export type CommandDispatch = z.infer<typeof CommandDispatchSchema>;

// Command result (from agent)
export const CommandResultSchema = z.object({
  cmd_id: z.string(),
  session_id: z.string().uuid().optional(),
  ok: z.boolean(),
  result: z.record(z.unknown()).optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
});
export type CommandResult = z.infer<typeof CommandResultSchema>;

// Command request (from dashboard REST API)
export const CommandRequestSchema = z.object({
  type: CommandTypeSchema,
  payload: z.record(z.unknown()).optional(),
});
export type CommandRequest = z.infer<typeof CommandRequestSchema>;
