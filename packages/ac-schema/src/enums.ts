import { z } from 'zod';

// Session Kind - what type of session this is
// No current producer emits the unused legacy `service` session kind.
export const SessionKindSchema = z.enum(['tmux_pane', 'job']);
export type SessionKind = z.infer<typeof SessionKindSchema>;

// Read compatibility for installations where migration 038 correctly leaves
// the label in place because historical service rows still exist.
export const PersistedSessionKindSchema = z.enum(['tmux_pane', 'job', 'service']);
export type PersistedSessionKind = z.infer<typeof PersistedSessionKindSchema>;

// Session Provider - what AI/tool is running
export const SessionProviderSchema = z.enum([
  'claude_code',
  'codex',
  'gemini_cli',
  'opencode',
  'cursor',
  'aider',
  'continue',
  'shell',
  'unknown',
]);
export type SessionProvider = z.infer<typeof SessionProviderSchema>;

// Session Status - normalized state machine
export const SessionStatusSchema = z.enum([
  'STARTING',
  'RUNNING',
  'IDLE',
  'WAITING_FOR_INPUT',
  'WAITING_FOR_APPROVAL',
  'ERROR',
  'DONE',
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

// Approval Decision
export const ApprovalDecisionSchema = z.enum(['allow', 'deny']);
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

// Approval Mode - how to apply the decision
export const ApprovalModeSchema = z.enum(['hook', 'keystroke', 'both']);
export type ApprovalMode = z.infer<typeof ApprovalModeSchema>;

// Command Types
export const CommandTypeSchema = z.enum([
  'send_input',
  'send_keys',
  'interrupt',
  'kill_session',
  'adopt_pane',
  'rename_session',
  'spawn_session',
  'spawn_job',
  'fork',
  'console.subscribe',
  'console.unsubscribe',
  'copy_to_session',
  'capture_pane',
  'list_directory',
]);
export type CommandType = z.infer<typeof CommandTypeSchema>;

// Event Types
export const EventTypeSchema = z.enum([
  'approval.requested',
  'approval.decided',
  'command.completed',
  'claude.hook',
  'claude.event',
  'codex.hook',
  'codex.event',
  'workshop.pre_tool_use',
  'workshop.post_tool_use',
  'workshop.user_prompt_submit',
  'workshop.stop',
  'workshop.notification',
  'workshop.session_start',
  'workshop.session_end',
  'workshop.subagent_start',
  'workshop.subagent_stop',
  'workshop.pre_compact',
  'orchestrator.report',
  'terminal.audit',
]);
export type EventType = z.infer<typeof EventTypeSchema>;
