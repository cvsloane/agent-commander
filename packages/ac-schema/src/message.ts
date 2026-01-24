import { z } from 'zod';
import { AgentHostInfoSchema } from './host.js';
import { SessionSchema, SessionUpsertSchema, SessionSnapshotSchema } from './session.js';
import { EventAppendPayloadSchema } from './event.js';
import { CommandDispatchSchema, CommandResultSchema } from './command.js';
import { ApprovalDecisionPayloadSchema } from './approval.js';
import {
  MCPServersResponseMessageSchema,
  MCPConfigResponseMessageSchema,
  MCPProjectConfigResponseMessageSchema,
  MCPUpdateResultMessageSchema,
} from './mcp.js';
import { ToolEventStartSchema, ToolEventCompleteSchema, ToolEventSchema } from './toolEvent.js';
import { ProviderUsageReportSchema, SessionUsageSummarySchema } from './analytics.js';

// Message envelope (base)
export const MessageEnvelopeBaseSchema = z.object({
  v: z.literal(1),
  ts: z.string().datetime({ offset: true }),
});

// Agent message envelope (includes seq)
export const AgentMessageEnvelopeSchema = MessageEnvelopeBaseSchema.extend({
  seq: z.number().int().positive(),
});

// Server message envelope (includes cmd_id for commands)
export const ServerMessageEnvelopeSchema = MessageEnvelopeBaseSchema;

// =====================
// Agent -> Control Plane Messages
// =====================

// Agent hello
export const AgentHelloMessageSchema = AgentMessageEnvelopeSchema.extend({
  type: z.literal('agent.hello'),
  payload: z.object({
    host: AgentHostInfoSchema,
    resume: z
      .object({
        last_acked_seq: z.number().int().optional(),
      })
      .optional(),
  }),
});
export type AgentHelloMessage = z.infer<typeof AgentHelloMessageSchema>;

// Sessions upsert
export const SessionsUpsertMessageSchema = AgentMessageEnvelopeSchema.extend({
  type: z.literal('sessions.upsert'),
  payload: z.object({
    sessions: z.array(SessionUpsertSchema),
  }),
});
export type SessionsUpsertMessage = z.infer<typeof SessionsUpsertMessageSchema>;

// Session snapshot
export const SessionSnapshotMessageSchema = AgentMessageEnvelopeSchema.extend({
  type: z.literal('sessions.snapshot'),
  payload: SessionSnapshotSchema.pick({
    session_id: true,
    capture_hash: true,
    capture_text: true,
  }),
});
export type SessionSnapshotMessage = z.infer<typeof SessionSnapshotMessageSchema>;

// Events append
export const EventsAppendMessageSchema = AgentMessageEnvelopeSchema.extend({
  type: z.literal('events.append'),
  payload: EventAppendPayloadSchema,
});
export type EventsAppendMessage = z.infer<typeof EventsAppendMessageSchema>;

// Command result
export const CommandResultMessageSchema = AgentMessageEnvelopeSchema.extend({
  type: z.literal('commands.result'),
  payload: CommandResultSchema,
});
export type CommandResultMessage = z.infer<typeof CommandResultMessageSchema>;

// Console chunk
export const ConsoleChunkMessageSchema = AgentMessageEnvelopeSchema.extend({
  type: z.literal('console.chunk'),
  payload: z.object({
    subscription_id: z.string().uuid(),
    session_id: z.string().uuid(),
    data: z.string(),
    offset: z.number().int(),
  }),
});
export type ConsoleChunkMessage = z.infer<typeof ConsoleChunkMessageSchema>;

// Terminal output (agent -> control plane)
export const TerminalOutputMessageSchema = AgentMessageEnvelopeSchema.extend({
  type: z.literal('terminal.output'),
  payload: z.object({
    channel_id: z.string().uuid(),
    data: z.string(),
    encoding: z.enum(['base64', 'utf8']).optional(),
  }),
});
export type TerminalOutputMessage = z.infer<typeof TerminalOutputMessageSchema>;

// Terminal status (agent -> control plane)
export const TerminalStatusMessageSchema = AgentMessageEnvelopeSchema.extend({
  type: z.enum([
    'terminal.attached',
    'terminal.detached',
    'terminal.error',
    'terminal.readonly',
    'terminal.control',
  ]),
  payload: z.object({
    channel_id: z.string().uuid(),
    message: z.string().optional(),
  }),
});
export type TerminalStatusMessage = z.infer<typeof TerminalStatusMessageSchema>;

// Sessions prune (agent -> control plane)
export const SessionsPruneMessageSchema = AgentMessageEnvelopeSchema.extend({
  type: z.literal('sessions.prune'),
  payload: z.object({
    session_ids: z.array(z.string().uuid()),
  }),
});
export type SessionsPruneMessage = z.infer<typeof SessionsPruneMessageSchema>;

// Tool event started (agent -> control plane)
export const ToolEventStartedMessageSchema = AgentMessageEnvelopeSchema.extend({
  type: z.literal('tool.event.started'),
  payload: ToolEventStartSchema,
});
export type ToolEventStartedMessage = z.infer<typeof ToolEventStartedMessageSchema>;

// Tool event completed (agent -> control plane)
export const ToolEventCompletedMessageSchema = AgentMessageEnvelopeSchema.extend({
  type: z.literal('tool.event.completed'),
  payload: ToolEventCompleteSchema,
});
export type ToolEventCompletedMessage = z.infer<typeof ToolEventCompletedMessageSchema>;

// Provider usage report (agent -> control plane)
export const ProviderUsageReportMessageSchema = AgentMessageEnvelopeSchema.extend({
  type: z.literal('provider.usage'),
  payload: ProviderUsageReportSchema,
});
export type ProviderUsageReportMessage = z.infer<typeof ProviderUsageReportMessageSchema>;

// Session usage summary (agent -> control plane, parsed from console output)
export const SessionUsageMessageSchema = AgentMessageEnvelopeSchema.extend({
  type: z.literal('session.usage'),
  payload: SessionUsageSummarySchema,
});
export type SessionUsageMessage = z.infer<typeof SessionUsageMessageSchema>;

// Union of all agent messages
export const AgentMessageSchema = z.discriminatedUnion('type', [
  AgentHelloMessageSchema,
  SessionsUpsertMessageSchema,
  SessionsPruneMessageSchema,
  SessionSnapshotMessageSchema,
  EventsAppendMessageSchema,
  CommandResultMessageSchema,
  ConsoleChunkMessageSchema,
  TerminalOutputMessageSchema,
  TerminalStatusMessageSchema,
  ToolEventStartedMessageSchema,
  ToolEventCompletedMessageSchema,
  ProviderUsageReportMessageSchema,
  SessionUsageMessageSchema,
  MCPServersResponseMessageSchema,
  MCPConfigResponseMessageSchema,
  MCPProjectConfigResponseMessageSchema,
  MCPUpdateResultMessageSchema,
]);
export type AgentMessage = z.infer<typeof AgentMessageSchema>;

// =====================
// Control Plane -> Agent Messages
// =====================

// Agent ack
export const AgentAckMessageSchema = ServerMessageEnvelopeSchema.extend({
  type: z.literal('agent.ack'),
  payload: z.object({
    ack_seq: z.number().int(),
    status: z.enum(['ok', 'error']),
    error: z.string().optional(),
  }),
});
export type AgentAckMessage = z.infer<typeof AgentAckMessageSchema>;

// Commands dispatch
export const CommandsDispatchMessageSchema = ServerMessageEnvelopeSchema.extend({
  type: z.literal('commands.dispatch'),
  payload: CommandDispatchSchema,
});
export type CommandsDispatchMessage = z.infer<typeof CommandsDispatchMessageSchema>;

// Terminal control (control plane -> agent)
export const TerminalAttachMessageSchema = ServerMessageEnvelopeSchema.extend({
  type: z.literal('terminal.attach'),
  payload: z.object({
    channel_id: z.string().uuid(),
    pane_id: z.string(),
    session_id: z.string().uuid(),
  }),
});
export type TerminalAttachMessage = z.infer<typeof TerminalAttachMessageSchema>;

export const TerminalInputMessageSchema = ServerMessageEnvelopeSchema.extend({
  type: z.literal('terminal.input'),
  payload: z.object({
    channel_id: z.string().uuid(),
    data: z.string(),
  }),
});
export type TerminalInputMessage = z.infer<typeof TerminalInputMessageSchema>;

export const TerminalResizeMessageSchema = ServerMessageEnvelopeSchema.extend({
  type: z.literal('terminal.resize'),
  payload: z.object({
    channel_id: z.string().uuid(),
    cols: z.number().int(),
    rows: z.number().int(),
  }),
});
export type TerminalResizeMessage = z.infer<typeof TerminalResizeMessageSchema>;

export const TerminalDetachMessageSchema = ServerMessageEnvelopeSchema.extend({
  type: z.literal('terminal.detach'),
  payload: z.object({
    channel_id: z.string().uuid(),
  }),
});
export type TerminalDetachMessage = z.infer<typeof TerminalDetachMessageSchema>;

export const TerminalControlMessageSchema = ServerMessageEnvelopeSchema.extend({
  type: z.literal('terminal.control'),
  payload: z.object({
    channel_id: z.string().uuid(),
  }),
});
export type TerminalControlMessage = z.infer<typeof TerminalControlMessageSchema>;

// Approvals decision
export const ApprovalsDecisionMessageSchema = ServerMessageEnvelopeSchema.extend({
  type: z.literal('approvals.decision'),
  payload: ApprovalDecisionPayloadSchema,
});
export type ApprovalsDecisionMessage = z.infer<typeof ApprovalsDecisionMessageSchema>;

// Union of all server messages to agent
export const ServerToAgentMessageSchema = z.discriminatedUnion('type', [
  AgentAckMessageSchema,
  CommandsDispatchMessageSchema,
  TerminalAttachMessageSchema,
  TerminalInputMessageSchema,
  TerminalResizeMessageSchema,
  TerminalDetachMessageSchema,
  TerminalControlMessageSchema,
  ApprovalsDecisionMessageSchema,
]);
export type ServerToAgentMessage = z.infer<typeof ServerToAgentMessageSchema>;

// =====================
// UI WebSocket Messages
// =====================

// UI subscribe
export const UISubscribeMessageSchema = MessageEnvelopeBaseSchema.extend({
  type: z.literal('ui.subscribe'),
  payload: z.object({
    topics: z.array(
      z.object({
        type: z.enum([
          'sessions',
          'approvals',
          'events',
          'console',
          'snapshots',
          'tool_events',
          'session_usage',
        ]),
        filter: z.record(z.unknown()).optional(),
      })
    ),
  }),
});
export type UISubscribeMessage = z.infer<typeof UISubscribeMessageSchema>;

// Sessions changed
export const SessionsChangedMessageSchema = ServerMessageEnvelopeSchema.extend({
  type: z.literal('sessions.changed'),
  payload: z.object({
    sessions: z.array(SessionSchema),
    deleted: z.array(z.string().uuid()).optional(),
  }),
});
export type SessionsChangedMessage = z.infer<typeof SessionsChangedMessageSchema>;

// Approvals created
export const ApprovalsCreatedMessageSchema = ServerMessageEnvelopeSchema.extend({
  type: z.literal('approvals.created'),
  payload: z.object({
    approval_id: z.string().uuid(),
    session_id: z.string().uuid(),
    provider: z.string(),
    requested_payload: z.record(z.unknown()),
  }),
});
export type ApprovalsCreatedMessage = z.infer<typeof ApprovalsCreatedMessageSchema>;

// Approvals updated
export const ApprovalsUpdatedMessageSchema = ServerMessageEnvelopeSchema.extend({
  type: z.literal('approvals.updated'),
  payload: z.object({
    approval_id: z.string().uuid(),
    decision: z.enum(['allow', 'deny']),
    decided_by_user_id: z.string().uuid().optional(),
  }),
});
export type ApprovalsUpdatedMessage = z.infer<typeof ApprovalsUpdatedMessageSchema>;

// Events appended
export const EventsAppendedMessageSchema = ServerMessageEnvelopeSchema.extend({
  type: z.literal('events.appended'),
  payload: z.object({
    session_id: z.string().uuid(),
    event: z.object({
      id: z.number(),
      ts: z.string().datetime({ offset: true }),
      type: z.string(),
      payload: z.record(z.unknown()),
    }),
  }),
});
export type EventsAppendedMessage = z.infer<typeof EventsAppendedMessageSchema>;

// Console chunk (to UI)
export const UIConsoleChunkMessageSchema = ServerMessageEnvelopeSchema.extend({
  type: z.literal('console.chunk'),
  payload: z.object({
    subscription_id: z.string().uuid(),
    session_id: z.string().uuid(),
    data: z.string(),
    offset: z.number().int(),
  }),
});
export type UIConsoleChunkMessage = z.infer<typeof UIConsoleChunkMessageSchema>;

// Snapshots updated (to UI)
export const UISnapshotUpdatedMessageSchema = ServerMessageEnvelopeSchema.extend({
  type: z.literal('snapshots.updated'),
  payload: z.object({
    session_id: z.string().uuid(),
    capture_text: z.string(),
    capture_hash: z.string(),
    created_at: z.string().datetime({ offset: true }).optional(),
  }),
});
export type UISnapshotUpdatedMessage = z.infer<typeof UISnapshotUpdatedMessageSchema>;

// Tool event started (to UI)
export const UIToolEventStartedMessageSchema = ServerMessageEnvelopeSchema.extend({
  type: z.literal('tool_event.started'),
  payload: z.object({
    session_id: z.string().uuid(),
    event: ToolEventSchema,
  }),
});
export type UIToolEventStartedMessage = z.infer<typeof UIToolEventStartedMessageSchema>;

// Tool event completed (to UI)
export const UIToolEventCompletedMessageSchema = ServerMessageEnvelopeSchema.extend({
  type: z.literal('tool_event.completed'),
  payload: z.object({
    session_id: z.string().uuid(),
    event: ToolEventSchema,
  }),
});
export type UIToolEventCompletedMessage = z.infer<typeof UIToolEventCompletedMessageSchema>;

// Session usage updated (to UI)
export const UISessionUsageUpdatedMessageSchema = ServerMessageEnvelopeSchema.extend({
  type: z.literal('session_usage.updated'),
  payload: SessionUsageSummarySchema,
});
export type UISessionUsageUpdatedMessage = z.infer<typeof UISessionUsageUpdatedMessageSchema>;

// Union of all UI messages from server
export const ServerToUIMessageSchema = z.discriminatedUnion('type', [
  SessionsChangedMessageSchema,
  ApprovalsCreatedMessageSchema,
  ApprovalsUpdatedMessageSchema,
  EventsAppendedMessageSchema,
  UIConsoleChunkMessageSchema,
  UISnapshotUpdatedMessageSchema,
  UIToolEventStartedMessageSchema,
  UIToolEventCompletedMessageSchema,
  UISessionUsageUpdatedMessageSchema,
]);
export type ServerToUIMessage = z.infer<typeof ServerToUIMessageSchema>;
