import { describe, expect, it } from 'vitest';
import {
  LaunchRequestSchema,
  LaunchResponseSchema,
  LaunchTargetsResponseSchema,
  TmuxOpenRequestSchema,
  TmuxOpenResponseSchema,
} from '../src/launch';

describe('launch schemas', () => {
  it('requires a host id or alias for launch requests', () => {
    expect(LaunchRequestSchema.safeParse({
      provider: 'codex',
      working_directory: '/home/cvsloane/dev/agent-command',
    }).success).toBe(false);
    expect(LaunchRequestSchema.safeParse({
      host_alias: 'heavisidelinux',
      provider: 'claude_code',
      working_directory: '/home/cvsloane/dev/agent-command',
    }).success).toBe(true);
  });

  it('validates launch targets and openable launch responses', () => {
    expect(LaunchTargetsResponseSchema.parse({
      targets: [{
        host_id: '11111111-1111-4111-8111-111111111111',
        alias: 'heavisidelinux',
        display_name: 'heavisidelinux',
        online: true,
        supports_terminal: true,
        supports_spawn: true,
        supports_directory_listing: true,
        providers: { codex: true, claude_code: true },
        roots: ['/home/cvsloane/dev'],
        recent_projects: [{
          id: '22222222-2222-4222-8222-222222222222',
          path: '/home/cvsloane/dev/agent-command',
          display_name: 'agent-command',
          last_used_at: '2026-05-19T18:00:00.000Z',
        }],
        recent_tmux: [{
          session_id: '33333333-3333-4333-8333-333333333333',
          title: 'Codex',
          tmux_target: 'agents:0.0',
          pane_id: '%1',
          cwd: '/home/cvsloane/dev/agent-command',
          provider: 'codex',
          status: 'RUNNING',
        }],
      }],
    }).targets).toHaveLength(1);

    expect(LaunchResponseSchema.parse({
      session_id: '33333333-3333-4333-8333-333333333333',
      cmd_id: '01HZXLAUNCH000000000000000',
      status: 'ready',
      href: '/tmux?host_id=11111111-1111-4111-8111-111111111111&session_id=33333333-3333-4333-8333-333333333333&mode=terminal&attach=1',
      terminal: { openable: true, pane_id: '%1' },
      session: {
        id: '33333333-3333-4333-8333-333333333333',
        host_id: '11111111-1111-4111-8111-111111111111',
        user_id: null,
        repo_id: null,
        kind: 'tmux_pane',
        provider: 'codex',
        status: 'RUNNING',
        title: 'Codex',
        cwd: '/home/cvsloane/dev/agent-command',
        repo_root: '/home/cvsloane/dev/agent-command',
        git_remote: null,
        git_branch: 'main',
        tmux_pane_id: '%1',
        tmux_target: 'agents:0.0',
        metadata: null,
        created_at: '2026-05-19T18:00:00.000Z',
        updated_at: '2026-05-19T18:00:00.000Z',
        last_activity_at: '2026-05-19T18:00:00.000Z',
        idled_at: null,
        group_id: null,
        forked_from: null,
        fork_depth: 0,
        archived_at: null,
      },
    }).status).toBe('ready');
  });

  it('validates tmux open requests and responses', () => {
    expect(TmuxOpenRequestSchema.safeParse({
      host_alias: 'heavisidelinux',
      tmux_target: 'agents:0.0',
    }).success).toBe(true);
    expect(TmuxOpenRequestSchema.safeParse({
      host_alias: 'heavisidelinux',
    }).success).toBe(false);

    expect(TmuxOpenResponseSchema.parse({
      session_id: '33333333-3333-4333-8333-333333333333',
      href: '/tmux?host_id=11111111-1111-4111-8111-111111111111&session_id=33333333-3333-4333-8333-333333333333&mode=terminal&attach=1',
      adopted: true,
      terminal: { openable: true, pane_id: '%1' },
      session: {
        id: '33333333-3333-4333-8333-333333333333',
        host_id: '11111111-1111-4111-8111-111111111111',
        user_id: null,
        repo_id: null,
        kind: 'tmux_pane',
        provider: 'codex',
        status: 'RUNNING',
        title: 'Codex',
        cwd: '/home/cvsloane/dev/agent-command',
        repo_root: '/home/cvsloane/dev/agent-command',
        git_remote: null,
        git_branch: 'main',
        tmux_pane_id: '%1',
        tmux_target: 'agents:0.0',
        metadata: { unmanaged: false },
        created_at: '2026-05-19T18:00:00.000Z',
        updated_at: '2026-05-19T18:00:00.000Z',
        last_activity_at: '2026-05-19T18:00:00.000Z',
        idled_at: null,
        group_id: null,
        forked_from: null,
        fork_depth: 0,
        archived_at: null,
      },
    }).adopted).toBe(true);
  });
});
