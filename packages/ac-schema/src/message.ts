import { z } from 'zod';
import { AgentHostInfoSchema, HostPresenceSchema } from './host.js';
import { SessionSchema, SessionUpsertSchema, SessionSnapshotSchema } from './session.js';
import { EventAppendPayloadSchema } from './event.js';
import { CommandDispatchSchema, CommandResultSchema } from './command.js';
import { ApprovalDecisionPayloadSchema } from './approval.js';
import {
  AutomationRunSchema,
  AutomationRunEventSchema,
  AutomationRuntimeStateSchema,
  AutomationWakeupSchema,
  GovernanceApprovalSchema,
  WorkItemSchema,
} from './automation.js';
import {
  MCPServersResponseMessageSchema,
  MCPConfigResponseMessageSchema,
  MCPProjectConfigResponseMessageSchema,
  MCPUpdateResultMessageSchema,
} from './mcp.js';
import { ToolEventStartSchema, ToolEventCompleteSchema, ToolEventSchema } from './toolEvent.js';
import { ProviderUsageReportSchema, SessionUsageSummarySchema } from './analytics.js';
import { AgentTaskSchema, SessionEdgeSchema } from './orchestration.js';
import { TerminalDimensionSchema } from './terminal.js';

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

// UI messages gain a source-native cursor without changing legacy clients.
export const ServerToUIEnvelopeSchema = ServerMessageEnvelopeSchema.extend({
  seq: z.number().int().nonnegative().optional(),
});

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
    'terminal.lag',
  ]),
  payload: z.object({
    channel_id: z.string().uuid(),
    message: z.string().optional(),
    readonly: z.boolean().optional(),
    resumed: z.boolean().optional(),
    resume_token: z.string().min(1).optional(),
    dropped: z.number().int().positive().optional(),
  }),
});
export type TerminalStatusMessage = z.infer<typeof TerminalStatusMessageSchema>;

// Durable terminal lifecycle audit (agent -> control plane)
export const TerminalAuditMessageSchema = AgentMessageEnvelopeSchema.extend({
  type: z.literal('terminal.audit'),
  payload: z.object({
    event_type: z.literal('terminal.audit'),
    action: z.enum(['attach', 'detach', 'control_transfer']),
    channel_id: z.string().uuid(),
    session_id: z.string().uuid(),
    pane_id: z.string().min(1),
    previous_controller_channel_id: z.string().uuid().optional(),
  }),
});
export type TerminalAuditMessage = z.infer<typeof TerminalAuditMessageSchema>;

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

export const TmuxTopologyPaneSchema = z.object({
  pane_id: z.string().min(1),
  pane_index: z.number().int().nonnegative(),
  active: z.boolean(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  title: z.string(),
  current_command: z.string(),
  current_path: z.string(),
});
export type TmuxTopologyPane = z.infer<typeof TmuxTopologyPaneSchema>;

export const TmuxTopologyWindowSchema = z.object({
  window_index: z.number().int().nonnegative(),
  window_name: z.string(),
  active: z.boolean(),
  zoomed: z.boolean(),
  layout: z.string(),
  bell: z.boolean(),
  activity: z.boolean(),
  panes: z.array(TmuxTopologyPaneSchema),
});
export type TmuxTopologyWindow = z.infer<typeof TmuxTopologyWindowSchema>;

export const TmuxTopologySessionSchema = z.object({
  session_name: z.string().min(1),
  attached: z.boolean(),
  attached_clients: z.number().int().nonnegative().optional(),
  windows: z.array(TmuxTopologyWindowSchema),
});
export type TmuxTopologySession = z.infer<typeof TmuxTopologySessionSchema>;

export const TmuxTopologyPayloadSchema = z.object({
  reason: z.union([
    z.literal('startup'),
    z.literal('poll'),
    z.string().regex(/^hook:.+$/),
  ]),
  tmux_sessions: z.array(TmuxTopologySessionSchema),
});
export type TmuxTopologyPayload = z.infer<typeof TmuxTopologyPayloadSchema>;

// Topology snapshots are volatile and intentionally omit the durable seq cursor.
// Keep the field order aligned with the frozen cross-language fixture.
export const TmuxTopologyMessageSchema = z.object({
  v: z.literal(1),
  type: z.literal('tmux.topology'),
  ts: z.string().datetime({ offset: true }),
  payload: TmuxTopologyPayloadSchema,
});
export type TmuxTopologyMessage = z.infer<typeof TmuxTopologyMessageSchema>;

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
  TerminalAuditMessageSchema,
  ToolEventStartedMessageSchema,
  ToolEventCompletedMessageSchema,
  ProviderUsageReportMessageSchema,
  SessionUsageMessageSchema,
  TmuxTopologyMessageSchema,
  MCPServersResponseMessageSchema,
  MCPConfigResponseMessageSchema,
  MCPProjectConfigResponseMessageSchema,
  MCPUpdateResultMessageSchema,
]);
export type AgentMessage = z.infer<typeof AgentMessageSchema>;

const agentMessageTypes = new Set<string>(
  AgentMessageSchema.options.flatMap((schema) => {
    const typeSchema = schema.shape.type;
    if (typeSchema instanceof z.ZodEnum) return [...typeSchema.options];
    if (typeSchema instanceof z.ZodLiteral) return [String(typeSchema.value)];
    return [];
  })
);

export function isKnownAgentMessageType(type: string): boolean {
  return agentMessageTypes.has(type);
}

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
export const CommandsDispatchMessageSchema = z.object({
  v: z.literal(1),
  type: z.literal('commands.dispatch'),
  ts: z.string().datetime({ offset: true }),
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
    cols: TerminalDimensionSchema.optional(),
    rows: TerminalDimensionSchema.optional(),
    resume_token: z.string().min(1).optional(),
    letterbox: z.boolean().optional(),
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
    cols: TerminalDimensionSchema,
    rows: TerminalDimensionSchema,
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

export const UISubscriptionTopicSchema = z.enum([
  'tmux.topology',
  'sessions',
  'approvals',
  'events',
  'console',
  'snapshots',
  'tool_events',
  'session_usage',
  'automation_runs',
  'automation_run_events',
  'automation_wakeups',
  'governance_approvals',
  'work_items',
  'hosts',
  'session_edges',
  'agent_tasks',
  'attention',
]);
export type UISubscriptionTopic = z.infer<typeof UISubscriptionTopicSchema>;

// UI subscribe
export const UISubscribeMessageSchema = MessageEnvelopeBaseSchema.extend({
  type: z.literal('ui.subscribe'),
  payload: z.object({
    topics: z.array(
      z.object({
        type: UISubscriptionTopicSchema,
        filter: z.record(z.string(), z.unknown()).optional(),
      })
    ),
    since: z
      .union([
        z.number().int().nonnegative(),
        z.record(z.string(), z.number().int().nonnegative()),
      ])
      .optional(),
  }),
});
export type UISubscribeMessage = z.infer<typeof UISubscribeMessageSchema>;

// Sessions changed
export const SessionsChangedMessageSchema = ServerToUIEnvelopeSchema.extend({
  type: z.literal('sessions.changed'),
  payload: z.object({
    sessions: z.array(SessionSchema),
    deleted: z.array(z.string().uuid()).optional(),
  }),
});
export type SessionsChangedMessage = z.infer<typeof SessionsChangedMessageSchema>;

export const SessionEdgesChangedMessageSchema = ServerToUIEnvelopeSchema.extend({
  type: z.literal('session_edges.changed'),
  payload: z.object({
    session_id: z.string().uuid(),
    edges: z.array(SessionEdgeSchema),
  }),
});
export type SessionEdgesChangedMessage = z.infer<typeof SessionEdgesChangedMessageSchema>;

export const AgentTasksChangedMessageSchema = ServerToUIEnvelopeSchema.extend({
  type: z.literal('agent_tasks.changed'),
  payload: z.object({
    session_id: z.string().uuid(),
    agent_tasks: z.array(AgentTaskSchema),
  }),
});
export type AgentTasksChangedMessage = z.infer<typeof AgentTasksChangedMessageSchema>;

export const UITmuxTopologyMessageSchema = ServerToUIEnvelopeSchema.extend({
  type: z.literal('tmux.topology'),
  payload: TmuxTopologyPayloadSchema.extend({
    host_id: z.string().uuid(),
  }),
});
export type UITmuxTopologyMessage = z.infer<typeof UITmuxTopologyMessageSchema>;

// Approvals created
export const ApprovalsCreatedMessageSchema = ServerToUIEnvelopeSchema.extend({
  type: z.literal('approvals.created'),
  payload: z.object({
    approval_id: z.string().uuid(),
    session_id: z.string().uuid(),
    provider: z.string(),
    requested_payload: z.record(z.string(), z.unknown()),
  }),
});
export type ApprovalsCreatedMessage = z.infer<typeof ApprovalsCreatedMessageSchema>;

// Approvals updated
export const ApprovalsUpdatedMessageSchema = ServerToUIEnvelopeSchema.extend({
  type: z.literal('approvals.updated'),
  payload: z.object({
    approval_id: z.string().uuid(),
    decision: z.enum(['allow', 'deny']),
    decided_by_user_id: z.string().uuid().optional(),
    session_id: z.string().uuid().optional(),
    timed_out: z.boolean().optional(),
  }),
});
export type ApprovalsUpdatedMessage = z.infer<typeof ApprovalsUpdatedMessageSchema>;

// Events appended
export const EventsAppendedMessageSchema = ServerToUIEnvelopeSchema.extend({
  type: z.literal('events.appended'),
  payload: z.object({
    session_id: z.string().uuid(),
    event: z.object({
      id: z.number(),
      ts: z.string().datetime({ offset: true }),
      type: z.string(),
      payload: z.record(z.string(), z.unknown()),
    }),
  }),
});
export type EventsAppendedMessage = z.infer<typeof EventsAppendedMessageSchema>;

// Console chunk (to UI)
export const UIConsoleChunkMessageSchema = ServerToUIEnvelopeSchema.extend({
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
export const UISnapshotUpdatedMessageSchema = ServerToUIEnvelopeSchema.extend({
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
export const UIToolEventStartedMessageSchema = ServerToUIEnvelopeSchema.extend({
  type: z.literal('tool_event.started'),
  payload: z.object({
    session_id: z.string().uuid(),
    event: ToolEventSchema,
  }),
});
export type UIToolEventStartedMessage = z.infer<typeof UIToolEventStartedMessageSchema>;

// Tool event completed (to UI)
export const UIToolEventCompletedMessageSchema = ServerToUIEnvelopeSchema.extend({
  type: z.literal('tool_event.completed'),
  payload: z.object({
    session_id: z.string().uuid(),
    event: ToolEventSchema,
  }),
});
export type UIToolEventCompletedMessage = z.infer<typeof UIToolEventCompletedMessageSchema>;

// Session usage updated (to UI)
export const UISessionUsageUpdatedMessageSchema = ServerToUIEnvelopeSchema.extend({
  type: z.literal('session_usage.updated'),
  payload: SessionUsageSummarySchema,
});
export type UISessionUsageUpdatedMessage = z.infer<typeof UISessionUsageUpdatedMessageSchema>;

// Host presence changed (to UI)
export const UIHostsChangedMessageSchema = ServerToUIEnvelopeSchema.extend({
  type: z.literal('hosts.changed'),
  payload: z.object({
    hosts: z.array(HostPresenceSchema),
  }),
});
export type UIHostsChangedMessage = z.infer<typeof UIHostsChangedMessageSchema>;

export const UIAutomationRunUpdatedMessageSchema = ServerToUIEnvelopeSchema.extend({
  type: z.literal('automation.run.updated'),
  payload: AutomationRunSchema,
});
export type UIAutomationRunUpdatedMessage = z.infer<typeof UIAutomationRunUpdatedMessageSchema>;

export const UIAutomationRunEventMessageSchema = ServerToUIEnvelopeSchema.extend({
  type: z.literal('automation.run.event'),
  payload: AutomationRunEventSchema,
});
export type UIAutomationRunEventMessage = z.infer<typeof UIAutomationRunEventMessageSchema>;

export const UIAutomationWakeupUpdatedMessageSchema = ServerToUIEnvelopeSchema.extend({
  type: z.literal('automation.wakeup.updated'),
  payload: AutomationWakeupSchema,
});
export type UIAutomationWakeupUpdatedMessage = z.infer<typeof UIAutomationWakeupUpdatedMessageSchema>;

export const UIGovernanceApprovalUpdatedMessageSchema = ServerToUIEnvelopeSchema.extend({
  type: z.literal('governance_approval.updated'),
  payload: GovernanceApprovalSchema,
});
export type UIGovernanceApprovalUpdatedMessage = z.infer<typeof UIGovernanceApprovalUpdatedMessageSchema>;

export const UIWorkItemUpdatedMessageSchema = ServerToUIEnvelopeSchema.extend({
  type: z.literal('work_item.updated'),
  payload: WorkItemSchema,
});
export type UIWorkItemUpdatedMessage = z.infer<typeof UIWorkItemUpdatedMessageSchema>;

export const UIAutomationRuntimeStateUpdatedMessageSchema = ServerToUIEnvelopeSchema.extend({
  type: z.literal('automation.runtime_state.updated'),
  payload: AutomationRuntimeStateSchema,
});
export type UIAutomationRuntimeStateUpdatedMessage = z.infer<typeof UIAutomationRuntimeStateUpdatedMessageSchema>;

export const UIAttentionChangedMessageSchema = ServerToUIEnvelopeSchema.extend({
  type: z.literal('attention.changed'),
  payload: z.object({
    session_id: z.string().uuid(),
    attention_reason: z.string().nullable(),
    question: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    capture_hash: z.string().optional(),
  }),
});
export type UIAttentionChangedMessage = z.infer<typeof UIAttentionChangedMessageSchema>;

// Union of all UI messages from server
export const ServerToUIMessageSchema = z.discriminatedUnion('type', [
  UITmuxTopologyMessageSchema,
  SessionsChangedMessageSchema,
  SessionEdgesChangedMessageSchema,
  AgentTasksChangedMessageSchema,
  ApprovalsCreatedMessageSchema,
  ApprovalsUpdatedMessageSchema,
  EventsAppendedMessageSchema,
  UIConsoleChunkMessageSchema,
  UISnapshotUpdatedMessageSchema,
  UIToolEventStartedMessageSchema,
  UIToolEventCompletedMessageSchema,
  UISessionUsageUpdatedMessageSchema,
  UIAutomationRunUpdatedMessageSchema,
  UIAutomationRunEventMessageSchema,
  UIAutomationWakeupUpdatedMessageSchema,
  UIGovernanceApprovalUpdatedMessageSchema,
  UIWorkItemUpdatedMessageSchema,
  UIAutomationRuntimeStateUpdatedMessageSchema,
  UIHostsChangedMessageSchema,
  UIAttentionChangedMessageSchema,
]);
export type ServerToUIMessage = z.infer<typeof ServerToUIMessageSchema>;

const UnknownServerToUIMessageSchema = ServerToUIEnvelopeSchema.extend({
  type: z.string().min(1),
  payload: z.unknown(),
}).passthrough();

const serverToUIMessageTypes = new Set<string>(
  ServerToUIMessageSchema.options.map((schema) => schema.shape.type.value)
);

/**
 * Validate known server messages at the browser seam. A structurally valid
 * future message type is ignored so an older dashboard stays connected; known
 * types with invalid payloads still fail validation.
 */
export function parseServerToUIMessage(input: unknown): ServerToUIMessage | null {
  const envelope = UnknownServerToUIMessageSchema.parse(input);
  if (!serverToUIMessageTypes.has(envelope.type)) return null;
  return ServerToUIMessageSchema.parse(input);
}
