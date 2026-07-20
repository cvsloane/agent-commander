import { z } from 'zod';
import { AutomationRunReportRequestSchema } from './automation.js';
import { ApprovalRequestedPayloadSchema } from './approval.js';
import { EventTypeSchema, SessionProviderSchema, type EventType } from './enums.js';

// Event schema for database/API. Unknown types remain readable because ingest
// intentionally preserves forward-compatible telemetry after warning.
export const EventSchema = z.object({
  id: z.number().optional(),
  session_id: z.string().uuid(),
  ts: z.string().datetime({ offset: true }),
  type: z.string(),
  event_id: z.string().nullable().optional(),
  payload: z.record(z.string(), z.unknown()),
});
export type Event = z.infer<typeof EventSchema>;

export const EventAppendPayloadSchema = z.object({
  session_id: z.string().uuid(),
  event_id: z.string().optional(),
  event_type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});
export type EventAppendPayload = z.infer<typeof EventAppendPayloadSchema>;

const UsagePayloadSchema = z.record(z.string(), z.unknown());

export const HookEventPayloadSchema = z.object({
  hook_name: z.string().min(1),
  hook_data: z.record(z.string(), z.unknown()),
  tool_name: z.string().min(1).optional(),
  usage: UsagePayloadSchema.optional(),
}).passthrough();
export type HookEventPayload = z.infer<typeof HookEventPayloadSchema>;

// Backward-compatible export used by hook consumers.
export const ClaudeHookPayloadSchema = HookEventPayloadSchema;
export type ClaudeHookPayload = z.infer<typeof ClaudeHookPayloadSchema>;

export const ProviderStreamEventPayloadSchema = z.object({
  event_type: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  thread_id: z.string().optional(),
  turn_id: z.string().optional(),
  item: z.record(z.string(), z.unknown()).optional(),
  error: z.union([
    z.object({
      code: z.string().optional(),
      message: z.string(),
    }).passthrough(),
    z.string(),
  ]).optional(),
  usage: UsagePayloadSchema.optional(),
}).passthrough().refine(
  (payload) => Boolean(payload.event_type || payload.type),
  { message: 'event_type or type is required' }
);

export const CodexEventPayloadSchema = ProviderStreamEventPayloadSchema;
export type CodexEventPayload = z.infer<typeof CodexEventPayloadSchema>;

const WorkshopBasePayloadSchema = z.object({
  sessionId: z.string().uuid(),
  provider: SessionProviderSchema,
  cwd: z.string(),
  timestamp: z.union([z.number(), z.string()]),
  occurred_at: z.string().datetime({ offset: true }).optional(),
}).passthrough();

const WorkshopToolPayloadSchema = WorkshopBasePayloadSchema.extend({
  tool: z.string().min(1).optional(),
  toolUseId: z.string().min(1).optional(),
  tool_use_id: z.string().min(1).optional(),
  toolInput: z.record(z.string(), z.unknown()).optional(),
});

const WorkshopSubagentPayloadSchema = WorkshopBasePayloadSchema.extend({
  toolUseId: z.string().min(1).optional(),
  tool_use_id: z.string().min(1).optional(),
  agent_id: z.string().min(1).optional(),
  description: z.string().optional(),
  started_at: z.string().datetime({ offset: true }).optional(),
  stopped_at: z.string().datetime({ offset: true }).optional(),
});

export const ApprovalDecidedEventPayloadSchema = z.object({
  approval_id: z.string().uuid(),
  session_id: z.string().uuid(),
  decision: z.enum(['allow', 'deny']),
  mode: z.enum(['hook', 'keystroke', 'both']),
  decided_by_user_id: z.string().uuid(),
}).passthrough();

export const CommandCompletedEventPayloadSchema = z.object({
  cmd_id: z.string().min(1),
  ok: z.boolean(),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }).passthrough().optional(),
}).passthrough();

export const TerminalAuditEventPayloadSchema = z.object({
  event_type: z.literal('terminal.audit'),
  action: z.enum(['attach', 'detach', 'control_transfer']),
  channel_id: z.string().uuid(),
  session_id: z.string().uuid(),
  pane_id: z.string().min(1),
  previous_controller_channel_id: z.string().uuid().optional(),
}).passthrough();

export const EventPayloadSchemaRegistry = {
  'approval.requested': ApprovalRequestedPayloadSchema.passthrough(),
  'approval.decided': ApprovalDecidedEventPayloadSchema,
  'command.completed': CommandCompletedEventPayloadSchema,
  'claude.hook': HookEventPayloadSchema,
  'claude.event': ProviderStreamEventPayloadSchema,
  'codex.hook': HookEventPayloadSchema,
  'codex.event': CodexEventPayloadSchema,
  'workshop.pre_tool_use': WorkshopToolPayloadSchema,
  'workshop.post_tool_use': WorkshopToolPayloadSchema.extend({
    success: z.boolean(),
    toolResponse: z.unknown().optional(),
  }),
  'workshop.user_prompt_submit': WorkshopBasePayloadSchema.extend({
    prompt: z.string().optional(),
  }),
  'workshop.stop': WorkshopBasePayloadSchema.extend({ response: z.string().optional() }),
  'workshop.notification': WorkshopBasePayloadSchema.extend({
    notificationType: z.string().optional(),
    message: z.string().optional(),
  }),
  'workshop.session_start': WorkshopBasePayloadSchema.extend({ source: z.string().optional() }),
  'workshop.session_end': WorkshopBasePayloadSchema.extend({ reason: z.string().optional() }),
  'workshop.subagent_start': WorkshopSubagentPayloadSchema,
  'workshop.subagent_stop': WorkshopSubagentPayloadSchema,
  'workshop.pre_compact': WorkshopBasePayloadSchema.extend({
    trigger: z.string().optional(),
    customInstructions: z.string().optional(),
  }),
  'orchestrator.report': AutomationRunReportRequestSchema.passthrough(),
  'terminal.audit': TerminalAuditEventPayloadSchema,
} satisfies Record<EventType, z.ZodTypeAny>;

export type EventPayloadValidation =
  | { status: 'valid'; eventType: EventType }
  | { status: 'unknown'; eventType: string }
  | { status: 'invalid'; eventType: EventType; error: z.ZodError };

export function validateEventPayload(
  eventType: string,
  payload: Record<string, unknown>
): EventPayloadValidation {
  const knownType = EventTypeSchema.safeParse(eventType);
  if (!knownType.success) return { status: 'unknown', eventType };
  const parsed = EventPayloadSchemaRegistry[knownType.data].safeParse(payload);
  if (!parsed.success) {
    return { status: 'invalid', eventType: knownType.data, error: parsed.error };
  }
  return { status: 'valid', eventType: knownType.data };
}
