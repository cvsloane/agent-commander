import { describe, expect, it } from 'vitest';
import type { Session } from '@agent-command/schema';
import { getWindowHereLaunchContext } from './windowHere';

describe('window-here launch context', () => {
  it('prefills the attached host, tmux session, cwd, and provider', () => {
    expect(getWindowHereLaunchContext({
      id: '22222222-2222-4222-8222-222222222222',
      host_id: '11111111-1111-4111-8111-111111111111',
      provider: 'codex',
      tmux_pane_id: '%12',
      tmux_target: 'agents:3.0',
      cwd: '/work/agent-command',
    } as Session)).toEqual({
      hostId: '11111111-1111-4111-8111-111111111111',
      tmuxSession: 'agents',
      workingDirectory: '/work/agent-command',
      provider: 'codex',
    });
  });

  it('does not offer window-here without an attached pane', () => {
    expect(getWindowHereLaunchContext({
      host_id: '11111111-1111-4111-8111-111111111111',
      provider: 'codex',
      tmux_target: 'agents:3.0',
      cwd: '/work/agent-command',
    } as Session)).toBeUndefined();
  });
});
