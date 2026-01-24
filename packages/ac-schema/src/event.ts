import { z } from 'zod';

// Event schema for database/API
export const EventSchema = z.object({
  id: z.number().optional(),
  session_id: z.string().uuid(),
  ts: z.string().datetime({ offset: true }),
  type: z.string(),
  event_id: z.string().nullable().optional(), // ULID for dedupe
  payload: z.record(z.unknown()),
});
export type Event = z.infer<typeof EventSchema>;

// Event append payload (from agent)
export const EventAppendPayloadSchema = z.object({
  session_id: z.string().uuid(),
  event_id: z.string().optional(), // ULID for dedupe
  event_type: z.string(),
  payload: z.record(z.unknown()),
});
export type EventAppendPayload = z.infer<typeof EventAppendPayloadSchema>;

// Claude hook event payload
export const ClaudeHookPayloadSchema = z.object({
  hook_name: z.string(),
  session_id: z.string().optional(),
  transcript_path: z.string().optional(),
  tool_name: z.string().optional(),
  tool_input: z.record(z.unknown()).optional(),
  tool_result: z.record(z.unknown()).optional(),
  permission_request: z
    .object({
      tool: z.string(),
      input: z.record(z.unknown()).optional(),
      reason: z.string().optional(),
    })
    .optional(),
  notification: z
    .object({
      type: z.string(),
      message: z.string().optional(),
    })
    .optional(),
});
export type ClaudeHookPayload = z.infer<typeof ClaudeHookPayloadSchema>;

// Codex event payload (from exec --json)
export const CodexEventPayloadSchema = z.object({
  event_type: z.string(), // thread.started, turn.started, turn.completed, item.*, error
  thread_id: z.string().optional(),
  turn_id: z.string().optional(),
  item: z.record(z.unknown()).optional(),
  error: z
    .object({
      code: z.string().optional(),
      message: z.string(),
    })
    .optional(),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
    })
    .optional(),
});
export type CodexEventPayload = z.infer<typeof CodexEventPayloadSchema>;
