import { describe, expect, it } from 'vitest';
import type { Host } from '@agent-command/schema';
import type { AuthUser } from '../src/auth/types.js';
import { canAttachTerminal, canControlTerminal, hostSupportsTerminal } from '../src/services/terminalPolicy.js';

function user(role: AuthUser['role']): AuthUser {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    sub: `${role}@example.test`,
    role,
    auth_type: 'jwt',
  };
}

function host(terminal: boolean): Host {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'heavisidelinux',
    tailscale_name: 'heavisidelinux',
    tailscale_ip: '100.64.0.10',
    capabilities: {
      tmux: true,
      spawn: true,
      kill: true,
      console_stream: true,
      terminal,
      claude_hooks: true,
      codex_exec_json: true,
      list_directory: true,
      list_directory_roots: ['/home/cvsloane/dev'],
      list_directory_show_hidden: false,
      providers: { codex: true },
    },
    agent_version: 'test',
    last_seen_at: '2026-05-19T18:00:00.000Z',
    last_acked_seq: 10,
    created_at: '2026-05-19T17:00:00.000Z',
    updated_at: '2026-05-19T18:00:00.000Z',
  };
}

describe('terminal policy', () => {
  it('allows admins and operators to attach and control terminals', () => {
    expect(canAttachTerminal(user('admin'))).toBe(true);
    expect(canAttachTerminal(user('operator'))).toBe(true);
    expect(canControlTerminal(user('admin'))).toBe(true);
    expect(canControlTerminal(user('operator'))).toBe(true);
  });

  it('denies viewers terminal attach and control', () => {
    expect(canAttachTerminal(user('viewer'))).toBe(false);
    expect(canControlTerminal(user('viewer'))).toBe(false);
  });

  it('requires host terminal capability', () => {
    expect(hostSupportsTerminal(host(true))).toBe(true);
    expect(hostSupportsTerminal(host(false))).toBe(false);
    expect(hostSupportsTerminal(null)).toBe(false);
  });
});
