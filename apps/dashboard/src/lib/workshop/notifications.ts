export type NotificationStyle = 'success' | 'info' | 'warning' | 'error' | 'muted';

export const NOTIFICATION_COLORS: Record<NotificationStyle, string> = {
  success: '#4ade80',
  info: '#60a5fa',
  warning: '#fbbf24',
  error: '#f87171',
  muted: '#9ca3af',
};

export const TOOL_NOTIFICATION_STYLES: Record<string, { style: NotificationStyle; icon: string }> = {
  Read: { style: 'info', icon: '📖' },
  Edit: { style: 'warning', icon: '✏️' },
  Write: { style: 'success', icon: '📝' },
  Grep: { style: 'info', icon: '🔍' },
  Glob: { style: 'info', icon: '📁' },
  Bash: { style: 'muted', icon: '⚡' },
  WebFetch: { style: 'info', icon: '🌐' },
  WebSearch: { style: 'info', icon: '🔎' },
  Task: { style: 'success', icon: '🚀' },
  TodoWrite: { style: 'info', icon: '☑️' },
  AskUserQuestion: { style: 'warning', icon: '❓' },
  AskFollowupQuestion: { style: 'warning', icon: '❓' },
  NotebookEdit: { style: 'warning', icon: '📓' },
};

export interface ZoneNotification {
  id: string;
  sessionId: string;
  text: string;
  style: NotificationStyle;
  icon?: string;
  createdAt: number;
  duration: number;
  slot?: number;
}

export function getNotificationForTool(tool: string): { style: NotificationStyle; icon: string } {
  return TOOL_NOTIFICATION_STYLES[tool] ?? { style: 'info', icon: '🔧' };
}
