export type WorkshopEventType =
  | 'pre_tool_use'
  | 'post_tool_use'
  | 'stop'
  | 'subagent_stop'
  | 'session_start'
  | 'session_end'
  | 'user_prompt_submit'
  | 'notification'
  | 'pre_compact';

export type ToolName =
  | 'Read'
  | 'Write'
  | 'Edit'
  | 'Bash'
  | 'Grep'
  | 'Glob'
  | 'WebFetch'
  | 'WebSearch'
  | 'Task'
  | 'TodoWrite'
  | 'AskUserQuestion'
  | 'NotebookEdit'
  | string;

export interface WorkshopBaseEvent {
  id: string;
  timestamp: number;
  type: WorkshopEventType;
  sessionId: string;
  cwd?: string;
  provider?: string;
}

export interface PreToolUseEvent extends WorkshopBaseEvent {
  type: 'pre_tool_use';
  tool: ToolName;
  toolInput?: Record<string, unknown>;
  toolUseId?: string;
  assistantText?: string;
}

export interface PostToolUseEvent extends WorkshopBaseEvent {
  type: 'post_tool_use';
  tool: ToolName;
  toolInput?: Record<string, unknown>;
  toolResponse?: Record<string, unknown>;
  toolUseId?: string;
  success?: boolean;
  duration?: number;
}

export interface StopEvent extends WorkshopBaseEvent {
  type: 'stop';
  stopHookActive?: boolean;
  response?: string;
}

export interface SubagentStopEvent extends WorkshopBaseEvent {
  type: 'subagent_stop';
  stopHookActive?: boolean;
}

export interface SessionStartEvent extends WorkshopBaseEvent {
  type: 'session_start';
  source?: 'startup' | 'resume' | 'clear' | 'compact' | string;
}

export interface SessionEndEvent extends WorkshopBaseEvent {
  type: 'session_end';
  reason?: 'clear' | 'logout' | 'prompt_input_exit' | 'other' | string;
}

export interface UserPromptSubmitEvent extends WorkshopBaseEvent {
  type: 'user_prompt_submit';
  prompt: string;
}

export interface NotificationEvent extends WorkshopBaseEvent {
  type: 'notification';
  message?: string;
  notificationType?: string;
}

export interface PreCompactEvent extends WorkshopBaseEvent {
  type: 'pre_compact';
  trigger?: 'manual' | 'auto' | string;
  customInstructions?: string;
}

export type WorkshopEvent =
  | PreToolUseEvent
  | PostToolUseEvent
  | StopEvent
  | SubagentStopEvent
  | SessionStartEvent
  | SessionEndEvent
  | UserPromptSubmitEvent
  | NotificationEvent
  | PreCompactEvent;

export type WorkshopEventPayload = Record<string, unknown>;

export type WorkshopEventRecord = {
  id: string;
  ts?: string;
  type: string;
  payload: WorkshopEventPayload;
};
