import { describe, expect, it, vi } from 'vitest';
import {
  HostEnrollmentError,
  buildAgentdConfig,
  createHostEnrollment,
  enrollmentWebSocketUrl,
  isForbiddenEnrollmentError,
  resolveHostApiBase,
} from './hostEnrollment';

const host = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'buildbox',
  capabilities: {
    tmux: true,
    spawn: true,
    kill: true,
    console_stream: true,
    terminal: false,
    claude_hooks: false,
    codex_exec_json: false,
    list_directory: false,
    list_directory_roots: [],
    list_directory_show_hidden: false,
    providers: {},
  },
  created_at: '2026-07-20T12:00:00.000Z',
  updated_at: '2026-07-20T12:00:00.000Z',
};

describe('host enrollment', () => {
  it('posts the trimmed enrollment fields with the control-plane token', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ host, token: 'ac_agent_once' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    const result = await createHostEnrollment(
      { name: ' buildbox ', tailscaleName: ' buildbox.tailnet ' },
      {
        apiBase: 'https://command.example',
        fetchImpl,
        getToken: async () => 'viewer-jwt',
      }
    );

    expect(result.token).toBe('ac_agent_once');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://command.example/v1/hosts',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer viewer-jwt' }),
        body: JSON.stringify({ name: 'buildbox', tailscale_name: 'buildbox.tailnet' }),
      })
    );
  });

  it('preserves a 403 so the UI can remove admin-only controls', async () => {
    const error = await createHostEnrollment(
      { name: 'viewer-host' },
      {
        apiBase: 'https://command.example',
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
        getToken: async () => 'viewer-jwt',
      }
    ).catch((caught) => caught);

    expect(error).toBeInstanceOf(HostEnrollmentError);
    expect(isForbiddenEnrollmentError(error)).toBe(true);
  });

  it('builds the one-time user config with the agent websocket endpoint', () => {
    expect(enrollmentWebSocketUrl('https://command.example')).toBe(
      'wss://command.example/v1/agent/connect'
    );
    expect(
      buildAgentdConfig({
        hostId: host.id,
        hostName: host.name,
        token: 'ac_agent_once',
        apiBase: 'https://command.example',
      })
    ).toContain('ws_url: "wss://command.example/v1/agent/connect"');
  });

  it('uses ws for a non-TLS control-plane URL', () => {
    expect(enrollmentWebSocketUrl('http://localhost:8080')).toBe(
      'ws://localhost:8080/v1/agent/connect'
    );
    expect(
      buildAgentdConfig({
        hostId: host.id,
        hostName: host.name,
        token: 'ac_agent_once',
        apiBase: 'http://localhost:8080',
      })
    ).toContain('ws_url: "ws://localhost:8080/v1/agent/connect"');
  });

  it('maps an internal configured host back to the browser origin', () => {
    expect(
      resolveHostApiBase(
        { controlPlaneUrl: 'http://control-plane:8080' },
        {},
        { origin: 'https://command.example' }
      )
    ).toBe('https://command.example');
  });
});
