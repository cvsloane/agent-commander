import { z } from 'zod';

// Session Kind - what type of session this is
export const SessionKindSchema = z.enum(['tmux_pane', 'job', 'service']);
export type SessionKind = z.infer<typeof SessionKindSchema>;

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
  'session.created',
  'session.updated',
  'session.deleted',
  'approval.requested',
  'approval.decided',
  'command.dispatched',
  'command.completed',
  'claude.hook',
  'codex.event',
  'console.chunk',
  'error',
]);
export type EventType = z.infer<typeof EventTypeSchema>;
