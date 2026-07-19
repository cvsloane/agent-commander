import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installWebSocketHeartbeat } from '../src/services/webSocketHeartbeat.js';

class FakeSocket extends EventEmitter {
  ping = vi.fn();
  terminate = vi.fn(() => this.emit('close'));
}

describe('webSocketHeartbeat', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pings healthy sockets and terminates sockets beyond the liveness timeout', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const socket = new FakeSocket();
    const onStale = vi.fn();

    installWebSocketHeartbeat(socket as never, {
      intervalMs: 10,
      timeoutMs: 25,
      onStale,
    });

    await vi.advanceTimersByTimeAsync(30);

    expect(socket.ping).toHaveBeenCalledTimes(2);
    expect(onStale).toHaveBeenCalledOnce();
    expect(socket.terminate).toHaveBeenCalledOnce();
  });

  it('refreshes liveness on pong and application activity', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const socket = new FakeSocket();
    const onHeartbeat = vi.fn();
    const heartbeat = installWebSocketHeartbeat(socket as never, {
      intervalMs: 10,
      timeoutMs: 25,
      onHeartbeat,
    });

    await vi.advanceTimersByTimeAsync(20);
    socket.emit('pong');
    await vi.advanceTimersByTimeAsync(20);
    heartbeat.markAlive();
    await vi.advanceTimersByTimeAsync(20);

    expect(onHeartbeat).toHaveBeenCalledTimes(2);
    expect(socket.terminate).not.toHaveBeenCalled();
    heartbeat.stop();
  });
});
