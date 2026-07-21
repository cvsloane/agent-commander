import type { Session } from '@agent-command/schema';
import type { MobileLaunchProvider } from '@agent-command/schema';

export interface WindowHereLaunchContext {
  hostId: string;
  tmuxSession: string;
  workingDirectory: string;
  provider?: MobileLaunchProvider;
}

export function getWindowHereLaunchContext(
  session: Session
): WindowHereLaunchContext | undefined {
  const tmuxSession =
    session.tmux_session_name
    || session.metadata?.tmux?.session_name
    || session.tmux_target?.split(':')[0]
    || '';
  const workingDirectory = session.cwd || '';
  if (!session.tmux_pane_id || !tmuxSession || !workingDirectory) return undefined;
  const provider = session.provider === 'codex' || session.provider === 'claude_code'
    ? session.provider
    : undefined;
  return {
    hostId: session.host_id,
    tmuxSession,
    workingDirectory,
    provider,
  };
}
