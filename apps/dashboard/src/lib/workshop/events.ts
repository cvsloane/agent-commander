import type { Event } from '@agent-command/schema';
import type { WorkshopEvent, WorkshopEventType, WorkshopEventRecord } from './types';

export function parseWorkshopEvent(record: WorkshopEventRecord, sessionId?: string): WorkshopEvent | null {
  if (!record.type.startsWith('workshop.')) return null;
  const type = record.type.replace('workshop.', '') as WorkshopEventType;
  const payload = record.payload || {};
  const timestamp = typeof payload.timestamp === 'number'
    ? payload.timestamp
    : record.ts
      ? Date.parse(record.ts)
      : Date.now();

  const base = {
    id: record.id,
    timestamp,
    type,
    sessionId: (payload.sessionId as string) || sessionId || '',
    cwd: payload.cwd as string | undefined,
    provider: payload.provider as string | undefined,
  };

  switch (type) {
    case 'pre_tool_use':
      return {
        ...base,
        type,
        tool: (payload.tool as string) || 'unknown',
        toolInput: payload.toolInput as Record<string, unknown> | undefined,
        toolUseId: payload.toolUseId as string | undefined,
        assistantText: payload.assistantText as string | undefined,
      };
    case 'post_tool_use':
      return {
        ...base,
        type,
        tool: (payload.tool as string) || 'unknown',
        toolInput: payload.toolInput as Record<string, unknown> | undefined,
        toolResponse: payload.toolResponse as Record<string, unknown> | undefined,
        toolUseId: payload.toolUseId as string | undefined,
        success: payload.success as boolean | undefined,
        duration: payload.duration as number | undefined,
      };
    case 'stop':
      return {
        ...base,
        type,
        stopHookActive: payload.stopHookActive as boolean | undefined,
        response: payload.response as string | undefined,
      };
    case 'subagent_stop':
      return {
        ...base,
        type,
        stopHookActive: payload.stopHookActive as boolean | undefined,
      };
    case 'session_start':
      return {
        ...base,
        type,
        source: payload.source as string | undefined,
      };
    case 'session_end':
      return {
        ...base,
        type,
        reason: payload.reason as string | undefined,
      };
    case 'user_prompt_submit':
      return {
        ...base,
        type,
        prompt: (payload.prompt as string) || '',
      };
    case 'notification':
      return {
        ...base,
        type,
        message: payload.message as string | undefined,
        notificationType: payload.notificationType as string | undefined,
      };
    case 'pre_compact':
      return {
        ...base,
        type,
        trigger: payload.trigger as string | undefined,
        customInstructions: payload.customInstructions as string | undefined,
      };
    default:
      return null;
  }
}

export function parseWorkshopEventFromEvent(event: Event): WorkshopEvent | null {
  return parseWorkshopEvent({
    id: event.event_id || String(event.id ?? ''),
    ts: event.ts,
    type: event.type,
    payload: event.payload as Record<string, unknown>,
  }, event.session_id);
}
