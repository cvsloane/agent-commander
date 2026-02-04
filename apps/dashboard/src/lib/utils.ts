import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRelativeTime(date: Date | string): string {
  const now = new Date();
  const d = typeof date === 'string' ? new Date(date) : date;
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

export const HOST_ONLINE_THRESHOLD_MS = 5 * 60 * 1000;

export function isHostOnline(lastSeen: string | null, now = Date.now()): boolean {
  if (!lastSeen) return false;
  const diff = now - new Date(lastSeen).getTime();
  return diff < HOST_ONLINE_THRESHOLD_MS;
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'RUNNING':
      return 'bg-green-500';
    case 'IDLE':
      return 'bg-gray-400';
    case 'STARTING':
      return 'bg-blue-500';
    case 'WAITING_FOR_INPUT':
      return 'bg-yellow-500';
    case 'WAITING_FOR_APPROVAL':
      return 'bg-orange-500';
    case 'ERROR':
      return 'bg-red-500';
    case 'DONE':
      return 'bg-gray-300';
    default:
      return 'bg-gray-400';
  }
}

// Status indicators from agent-deck style
export interface StatusIndicator {
  symbol: string;
  color: string;
  textColor: string;
  label: string;
}

export const STATUS_INDICATORS: Record<string, StatusIndicator> = {
  RUNNING: { symbol: '●', color: 'bg-green-500', textColor: 'text-green-500', label: 'Running' },
  WAITING_FOR_INPUT: { symbol: '◐', color: 'bg-yellow-500', textColor: 'text-yellow-500', label: 'Input' },
  WAITING_FOR_APPROVAL: { symbol: '◐', color: 'bg-orange-500', textColor: 'text-orange-500', label: 'Approval' },
  IDLE: { symbol: '○', color: 'bg-gray-400', textColor: 'text-gray-400', label: 'Idle' },
  ERROR: { symbol: '✕', color: 'bg-red-500', textColor: 'text-red-500', label: 'Error' },
  DONE: { symbol: '✓', color: 'bg-blue-500', textColor: 'text-blue-500', label: 'Done' },
  STARTING: { symbol: '◌', color: 'bg-gray-400', textColor: 'text-gray-400', label: 'Starting' },
};

export function getStatusIndicator(status: string): StatusIndicator {
  return STATUS_INDICATORS[status] || { symbol: '?', color: 'bg-gray-400', textColor: 'text-gray-400', label: 'Unknown' };
}

// Provider configuration with brand colors
export interface ProviderConfig {
  icon: string;
  color: string;
  bgColor: string;
  name: string;
}

export const PROVIDER_CONFIG: Record<string, ProviderConfig> = {
  claude_code: { icon: 'C', color: 'text-orange-600', bgColor: 'bg-orange-100 dark:bg-orange-900/30', name: 'Claude' },
  codex: { icon: 'X', color: 'text-emerald-600', bgColor: 'bg-emerald-100 dark:bg-emerald-900/30', name: 'Codex' },
  gemini_cli: { icon: 'G', color: 'text-blue-600', bgColor: 'bg-blue-100 dark:bg-blue-900/30', name: 'Gemini' },
  opencode: { icon: 'O', color: 'text-violet-600', bgColor: 'bg-violet-100 dark:bg-violet-900/30', name: 'OpenCode' },
  cursor: { icon: '▸', color: 'text-purple-600', bgColor: 'bg-purple-100 dark:bg-purple-900/30', name: 'Cursor' },
  aider: { icon: 'A', color: 'text-cyan-600', bgColor: 'bg-cyan-100 dark:bg-cyan-900/30', name: 'Aider' },
  continue: { icon: '↪', color: 'text-pink-600', bgColor: 'bg-pink-100 dark:bg-pink-900/30', name: 'Continue' },
  shell: { icon: '$', color: 'text-slate-600', bgColor: 'bg-slate-100 dark:bg-slate-900/30', name: 'Shell' },
};

export function getProviderConfig(provider: string): ProviderConfig {
  return PROVIDER_CONFIG[provider] || { icon: '?', color: 'text-gray-600', bgColor: 'bg-gray-100 dark:bg-gray-900/30', name: 'Unknown' };
}

export function getProviderIcon(provider: string): string {
  return getProviderConfig(provider).icon;
}

export function getProviderDisplayName(provider: string): string {
  return getProviderConfig(provider).name;
}

export function getRepoNameFromSession(session: {
  repo_root?: string | null;
  git_remote?: string | null;
}): string | null {
  if (session.repo_root) {
    const parts = session.repo_root.split('/').filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1] || null;
  }
  if (session.git_remote) {
    const match = session.git_remote.match(/([^/]+\/[^/]+?)(?:\\.git)?$/);
    if (match) {
      const repo = match[1] || '';
      const segments = repo.split('/');
      return segments[segments.length - 1] || repo;
    }
  }
  return null;
}

export function getSessionDisplayName(session: {
  title?: string | null;
  metadata?: Record<string, unknown> | null;
  repo_root?: string | null;
  git_remote?: string | null;
  cwd?: string | null;
  git_branch?: string | null;
  tmux_target?: string | null;
}): string {
  const tmuxMeta = (session.metadata?.tmux || {}) as {
    session_name?: string;
    window_name?: string;
    window_index?: number;
  };
  const windowName = tmuxMeta.window_name?.trim();
  const sessionName = tmuxMeta.session_name?.trim();
  const title = session.title?.trim();
  const tmuxTarget = session.tmux_target?.trim() || '';
  const looksLikeTarget = title ? /^[^:]+:\d+(?:\.\d+)?$/.test(title) : false;
  const isTmuxTargetTitle = title && tmuxTarget && title === tmuxTarget;
  if (title && !isTmuxTargetTitle && !looksLikeTarget) return title;

  const numericWindow =
    !!windowName &&
    /^\d+$/.test(windowName) &&
    typeof tmuxMeta.window_index === 'number' &&
    Number(windowName) === tmuxMeta.window_index;

  if (windowName && !numericWindow) {
    return sessionName ? `${sessionName}:${windowName}` : windowName;
  }

  const repoName = getRepoNameFromSession(session);
  if (repoName) return repoName;

  const cwdName = session.cwd?.split('/').filter(Boolean).pop();
  if (cwdName) return cwdName;

  if (session.git_branch) return session.git_branch;

  if (tmuxTarget) return tmuxTarget;

  return 'Untitled';
}
