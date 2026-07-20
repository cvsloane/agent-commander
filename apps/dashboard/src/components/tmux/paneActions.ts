import type { CommandRequest, Host } from '@agent-command/schema';

export type SplitDirection = 'horizontal' | 'vertical';

function reportedTmuxVersion(host?: Host | null): string | undefined {
  if (!host) return undefined;
  const capabilities = host.capabilities as Record<string, unknown>;
  const extendedHost = host as Host & { tmux_version?: unknown };
  const candidates = [
    capabilities.tmux_version,
    capabilities.tmuxVersion,
    extendedHost.tmux_version,
    host.agent_version,
  ];
  return candidates.find((candidate): candidate is string => typeof candidate === 'string');
}

export function hostSupportsPercentSplits(host?: Host | null): boolean {
  const version = reportedTmuxVersion(host);
  if (!version) return false;
  const match = version.match(/(\d+)\.(\d+)/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 3 || (major === 3 && minor >= 1);
}

export function buildSplitPaneCommand(
  host: Host | null | undefined,
  direction: SplitDirection,
  cwd?: string
): CommandRequest {
  return {
    type: 'split_pane',
    payload: {
      direction,
      ...(hostSupportsPercentSplits(host) ? { percent: 50 } : {}),
      ...(cwd ? { cwd } : {}),
    },
  };
}
