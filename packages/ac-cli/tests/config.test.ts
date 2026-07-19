import { describe, expect, it, vi } from 'vitest';
import { loadRuntimeConfig } from '../src/config.js';

describe('CLI config', () => {
  it('loads the config file and lets environment variables override it', async () => {
    const readFile = vi.fn(async () => JSON.stringify({
      agentdUrl: 'http://127.0.0.1:8888/',
      controlPlaneUrl: 'https://file.example/',
      token: 'file-token',
    }));

    const config = await loadRuntimeConfig({
      env: {
        AC_CONFIG_FILE: '/tmp/ac-cli-test.json',
        AC_SESSION_ID: 'session-1',
        AC_CONTROL_PLANE_URL: 'https://env.example/',
      },
      readFile,
    });

    expect(readFile).toHaveBeenCalledWith('/tmp/ac-cli-test.json', 'utf8');
    expect(config).toEqual({
      agentdUrl: 'http://127.0.0.1:8888',
      sessionId: 'session-1',
      controlPlaneUrl: 'https://env.example',
      controlPlaneToken: 'file-token',
      controlPlaneAuthMode: 'session',
    });
  });

  it('forces orchestrator session JWTs into session-scoped mode', async () => {
    const payload = Buffer.from(JSON.stringify({
      token_use: 'orchestrator_session',
      session_id: 'session-1',
    })).toString('base64url');

    const config = await loadRuntimeConfig({
      env: {
        AC_CONFIG_FILE: '/tmp/ac-cli-test.json',
        AC_CONTROL_PLANE_TOKEN: `header.${payload}.signature`,
        AC_CONTROL_PLANE_AUTH_MODE: 'operator',
      },
      readFile: vi.fn(async () => '{}'),
    });

    expect(config.controlPlaneAuthMode).toBe('session');
  });
});
