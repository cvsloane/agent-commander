import { z } from 'zod';
import { CommandTypeSchema, SessionProviderSchema } from './enums.js';
import { SessionRoleSchema } from './orchestration.js';
import { SessionSchema } from './session.js';

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

export const NewWindowPayloadSchema = z.object({
  window_name: z.string().optional(),
  cwd: z.string().optional(),
});
export type NewWindowPayload = z.infer<typeof NewWindowPayloadSchema>;

export const KillWindowPayloadSchema = z.object({
  window_index: z.number().int().nonnegative(),
});
export type KillWindowPayload = z.infer<typeof KillWindowPayloadSchema>;

export const RenameWindowPayloadSchema = z.object({
  window_index: z.number().int().nonnegative(),
  name: z.string().min(1),
});
export type RenameWindowPayload = z.infer<typeof RenameWindowPayloadSchema>;

export const SplitPanePayloadSchema = z.object({
  direction: z.enum(['horizontal', 'vertical']),
  percent: z.number().int().min(1).max(100).optional(),
  cwd: z.string().optional(),
});
export type SplitPanePayload = z.infer<typeof SplitPanePayloadSchema>;

export const SelectWindowPayloadSchema = z.object({
  window_index: z.number().int().nonnegative(),
});
export type SelectWindowPayload = z.infer<typeof SelectWindowPayloadSchema>;

export const SelectPanePayloadSchema = z.object({
  pane_id: z.string().min(1),
});
export type SelectPanePayload = z.infer<typeof SelectPanePayloadSchema>;

export const ResizePanePayloadSchema = z
  .object({
    pane_id: z.string().min(1),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  })
  .refine((payload) => payload.width !== undefined || payload.height !== undefined, {
    message: 'At least one of width or height is required',
  });
export type ResizePanePayload = z.infer<typeof ResizePanePayloadSchema>;

export const ZoomPanePayloadSchema = z.object({
  pane_id: z.string().min(1),
});
export type ZoomPanePayload = z.infer<typeof ZoomPanePayloadSchema>;

// Spawn session command payload (interactive tmux session)
export const SpawnSessionMemoryFileSchema = z.object({
  base_dir: z.enum(['working_directory', 'home']),
  relative_path: z.string().min(1),
  content: z.string(),
  scope: z.enum(['repo', 'global', 'local']).default('repo'),
});
export type SpawnSessionMemoryFile = z.infer<typeof SpawnSessionMemoryFileSchema>;

export const SpawnSessionInteractivePayloadSchema = z.object({
  provider: SessionProviderSchema,
  working_directory: z.string(),
  title: z.string().optional(),
  flags: z.array(z.string()).optional(),
  memory_files: z.array(SpawnSessionMemoryFileSchema).optional(),
  group_id: z.string().uuid().optional(),
  parent_session_id: z.string().uuid().optional(),
  role: SessionRoleSchema.optional(),
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
  memory_files: z.array(SpawnSessionMemoryFileSchema).optional(),
  parent_session_id: z.string().uuid().optional(),
  role: SessionRoleSchema.optional(),
  tmux: z.object({
    target_session: z.string().default('agents'),
    window_name: z.string(),
    command: z.string(),
  }),
  env: z.record(z.string(), z.string()).optional(),
});

export const SpawnSessionPayloadSchema = z.union([
  SpawnSessionInteractivePayloadSchema,
  SpawnSessionWorktreePayloadSchema,
]);
export type SpawnSessionPayload = z.infer<typeof SpawnSessionPayloadSchema>;

export const SpawnProviderSchema = z.enum([
  'claude_code',
  'codex',
  'gemini_cli',
  'opencode',
  'aider',
  'shell',
]);
export type SpawnProvider = z.infer<typeof SpawnProviderSchema>;

export const DashboardSpawnRequestSchema = z.object({
  host_id: z.string().uuid(),
  provider: SpawnProviderSchema,
  working_directory: z.string().min(1),
  title: z.string().optional(),
  flags: z.array(z.string()).optional(),
  group_id: z.string().uuid().optional(),
  parent_session_id: z.string().uuid().optional(),
  role: SessionRoleSchema.optional(),
  tmux: z
    .object({
      target_session: z.string().optional(),
      window_name: z.string().optional(),
    })
    .optional(),
});
export type DashboardSpawnRequest = z.infer<typeof DashboardSpawnRequestSchema>;

export const DashboardSpawnResponseSchema = z.object({
  session: SessionSchema,
  cmd_id: z.string(),
});
export type DashboardSpawnResponse = z.infer<typeof DashboardSpawnResponseSchema>;

// Spawn job command payload
export const SpawnJobPayloadSchema = z.object({
  provider: SessionProviderSchema,
  cwd: z.string(),
  prompt: z.string(),
  env: z.record(z.string(), z.string()).optional(),
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

export const TRANSCRIPT_DEFAULT_PAGE_SIZE = 200;
export const TRANSCRIPT_MAX_PAGE_SIZE = 500;

export const CaptureTranscriptPayloadSchema = z.object({
  page_size: z
    .number()
    .int()
    .positive()
    .max(TRANSCRIPT_MAX_PAGE_SIZE)
    .default(TRANSCRIPT_DEFAULT_PAGE_SIZE),
  before_entry: z.number().int().nonnegative().optional(),
});
export type CaptureTranscriptPayload = z.infer<typeof CaptureTranscriptPayloadSchema>;

export const SCROLLBACK_MAX_LINES = 5000;

export const ScrollbackRequestSchema = z
  .object({
    mode: CaptureModeSchema,
    last_n_lines: z.number().int().positive().max(SCROLLBACK_MAX_LINES).optional(),
    start_line: z.number().int().optional(),
    end_line: z.number().int().optional(),
    strip_ansi: z.boolean().default(true),
  })
  .superRefine((request, context) => {
    if (request.mode === 'last_n' && request.last_n_lines === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['last_n_lines'],
        message: 'last_n_lines is required for last_n mode',
      });
    }
    if (request.mode !== 'range') return;
    if (request.start_line === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['start_line'],
        message: 'start_line is required for range mode',
      });
    }
    if (request.end_line === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['end_line'],
        message: 'end_line is required for range mode',
      });
    }
    if (request.start_line === undefined || request.end_line === undefined) return;
    if (request.end_line < request.start_line) {
      context.addIssue({
        code: 'custom',
        path: ['end_line'],
        message: 'end_line must be greater than or equal to start_line',
      });
      return;
    }
    if (request.end_line - request.start_line + 1 > SCROLLBACK_MAX_LINES) {
      context.addIssue({
        code: 'custom',
        path: ['end_line'],
        message: `range cannot exceed ${SCROLLBACK_MAX_LINES} lines`,
      });
    }
  });
export type ScrollbackRequest = z.infer<typeof ScrollbackRequestSchema>;

export const ScrollbackResponseSchema = z.object({
  cmd_id: z.string().uuid(),
  ok: z.boolean(),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
});
export type ScrollbackResponse = z.infer<typeof ScrollbackResponseSchema>;

export const TranscriptRequestSchema = CaptureTranscriptPayloadSchema;
export type TranscriptRequest = z.infer<typeof TranscriptRequestSchema>;

export const TranscriptEntrySchema = z.record(z.string(), z.unknown());
export type TranscriptEntry = z.infer<typeof TranscriptEntrySchema>;

export const TranscriptResultSchema = z.object({
  entries: z.array(TranscriptEntrySchema),
  first_entry: z.number().int().nonnegative(),
  total_entries: z.number().int().nonnegative(),
  source: z.enum(['hook', 'derived']),
});
export type TranscriptResult = z.infer<typeof TranscriptResultSchema>;

const TranscriptErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

export const TranscriptResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    cmd_id: z.string().uuid(),
    ok: z.literal(true),
    result: TranscriptResultSchema,
  }),
  z.object({
    cmd_id: z.string().uuid(),
    ok: z.literal(false),
    error: TranscriptErrorSchema,
  }),
]);
export type TranscriptResponse = z.infer<typeof TranscriptResponseSchema>;

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
  z.object({ type: z.literal('capture_transcript'), payload: CaptureTranscriptPayloadSchema }),
  z.object({ type: z.literal('list_directory'), payload: ListDirectoryPayloadSchema }),
  z.object({ type: z.literal('new_window'), payload: NewWindowPayloadSchema }),
  z.object({ type: z.literal('kill_window'), payload: KillWindowPayloadSchema }),
  z.object({ type: z.literal('rename_window'), payload: RenameWindowPayloadSchema }),
  z.object({ type: z.literal('split_pane'), payload: SplitPanePayloadSchema }),
  z.object({ type: z.literal('select_window'), payload: SelectWindowPayloadSchema }),
  z.object({ type: z.literal('select_pane'), payload: SelectPanePayloadSchema }),
  z.object({ type: z.literal('resize_pane'), payload: ResizePanePayloadSchema }),
  z.object({ type: z.literal('zoom_pane'), payload: ZoomPanePayloadSchema }),
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
  result: z.record(z.string(), z.unknown()).optional(),
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
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type CommandRequest = z.infer<typeof CommandRequestSchema>;
