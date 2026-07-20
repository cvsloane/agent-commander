import { describe, expect, it } from 'vitest';
import { resolveControlPlaneWebSocketUrl } from './wsUrl';

describe('resolveControlPlaneWebSocketUrl', () => {
  it('uses the browser origin when no control-plane URL is configured', () => {
    expect(resolveControlPlaneWebSocketUrl(
      { type: 'events' },
      {
        runtime: {},
        env: {},
        location: { protocol: 'https:', host: 'commander.example.com' },
      }
    )).toBe('wss://commander.example.com/v1/ui/stream');
  });

  it('derives event and terminal endpoints from a configured WebSocket URL', () => {
    const sources = {
      runtime: { controlPlaneWsUrl: 'wss://control.example.com/proxy/v1/ui/stream' },
      env: {},
      location: { protocol: 'https:', host: 'commander.example.com' },
    };

    expect(resolveControlPlaneWebSocketUrl({ type: 'events' }, sources)).toBe(
      'wss://control.example.com/proxy/v1/ui/stream'
    );
    expect(resolveControlPlaneWebSocketUrl({
      type: 'terminal',
      sessionId: '11111111-1111-4111-8111-111111111111',
      ticket: 'one-time ticket',
    }, sources)).toBe(
      'wss://control.example.com/proxy/v1/ui/terminal/11111111-1111-4111-8111-111111111111?ticket=one-time+ticket'
    );
    expect(resolveControlPlaneWebSocketUrl({ type: 'voice', ticket: 'voice-ticket' }, sources)).toBe(
      'wss://control.example.com/proxy/v1/voice/transcribe?ticket=voice-ticket'
    );
  });

  it('converts an HTTPS control-plane base path into WebSocket endpoints', () => {
    const sources = {
      runtime: { controlPlaneUrl: 'https://control.example.com/proxy' },
      env: {},
      location: { protocol: 'https:', host: 'commander.example.com' },
    };

    expect(resolveControlPlaneWebSocketUrl({ type: 'events' }, sources)).toBe(
      'wss://control.example.com/proxy/v1/ui/stream'
    );
    expect(resolveControlPlaneWebSocketUrl({
      type: 'terminal',
      sessionId: '11111111-1111-4111-8111-111111111111',
      ticket: 'ticket',
    }, sources)).toBe(
      'wss://control.example.com/proxy/v1/ui/terminal/11111111-1111-4111-8111-111111111111?ticket=ticket'
    );
  });

  it('ignores a stale configured WebSocket host when it disagrees with the API base', () => {
    expect(resolveControlPlaneWebSocketUrl(
      { type: 'events' },
      {
        runtime: {
          controlPlaneUrl: 'https://control.example.com/proxy',
          controlPlaneWsUrl: 'wss://stale.example.com/v1/ui/stream',
        },
        env: {},
        location: { protocol: 'https:', host: 'commander.example.com' },
      }
    )).toBe('wss://control.example.com/proxy/v1/ui/stream');
  });

  it('rewrites an internal service hostname to the browser origin', () => {
    expect(resolveControlPlaneWebSocketUrl(
      { type: 'events' },
      {
        runtime: { controlPlaneWsUrl: 'ws://control-plane:8080/v1/ui/stream' },
        env: {},
        location: { protocol: 'https:', host: 'commander.example.com' },
      }
    )).toBe('wss://commander.example.com/v1/ui/stream');
  });

  it('falls back to the API base when the configured WebSocket URL is invalid', () => {
    expect(resolveControlPlaneWebSocketUrl(
      { type: 'events' },
      {
        runtime: {
          controlPlaneUrl: 'https://control.example.com',
          controlPlaneWsUrl: 'not a URL',
        },
        env: {},
        location: { protocol: 'https:', host: 'commander.example.com' },
      }
    )).toBe('wss://control.example.com/v1/ui/stream');
  });
});
