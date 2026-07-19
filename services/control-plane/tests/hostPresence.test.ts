import { afterEach, describe, expect, it, vi } from 'vitest';
import { pubsub } from '../src/services/pubsub.js';
import { getHostPresence, isHostOnline } from '../src/services/hostPresence.js';
import { WS_HEARTBEAT_TIMEOUT_MS } from '../src/services/webSocketHeartbeat.js';

const hostId = '11111111-1111-4111-8111-111111111111';

describe('host presence', () => {
  afterEach(() => {
    pubsub.removeAgentConnection(hostId);
    pubsub.removeUIClient('presence-test');
    vi.restoreAllMocks();
  });

  it('keeps a replacement socket registered when the stale socket closes', () => {
    const uiSend = vi.fn();
    const first = { send: vi.fn() };
    const replacement = { send: vi.fn() };
    pubsub.addUIClient('presence-test', { send: uiSend } as never);
    pubsub.setUISubscriptions('presence-test', [{ type: 'hosts' }]);

    pubsub.addAgentConnection(hostId, first as never);
    pubsub.addAgentConnection(hostId, replacement as never);

    expect(pubsub.removeAgentConnection(hostId, first as never)).toBe(false);
    expect(pubsub.getAgentConnection(hostId)?.ws).toBe(replacement);
    expect(pubsub.removeAgentConnection(hostId, replacement as never)).toBe(true);

    const messages = uiSend.mock.calls.map(([raw]) => JSON.parse(String(raw)));
    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.payload.hosts[0].online)).toEqual([true, false]);
  });

  it('requires a connected, heartbeat-fresh socket', () => {
    const socket = { send: vi.fn() };
    pubsub.addAgentConnection(hostId, socket as never);
    const connection = pubsub.getAgentConnection(hostId)!;

    expect(isHostOnline(hostId, connection.lastHeartbeatAt)).toBe(true);
    expect(isHostOnline(hostId, connection.lastHeartbeatAt + WS_HEARTBEAT_TIMEOUT_MS + 1)).toBe(
      false
    );
    expect(getHostPresence(connection.lastHeartbeatAt)).toEqual([
      expect.objectContaining({
        host_id: hostId,
        online: true,
      }),
    ]);
  });
});
