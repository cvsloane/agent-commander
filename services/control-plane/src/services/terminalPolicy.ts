import type { Host } from '@agent-command/schema';
import type { AuthUser } from '../auth/types.js';
import { hasRole } from '../auth/rbac.js';

export function canAttachTerminal(user: AuthUser): boolean {
  return hasRole(user, 'operator');
}

export function canControlTerminal(user: AuthUser): boolean {
  return hasRole(user, 'operator');
}

export function hostSupportsTerminal(host: Host | null | undefined): boolean {
  return Boolean(host?.capabilities?.terminal);
}

export function hostSupportsTmuxCommands(host: Host | null | undefined): boolean {
  return Boolean(host?.capabilities?.tmux && host.capabilities.terminal);
}
