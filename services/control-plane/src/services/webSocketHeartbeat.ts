import type { WebSocket } from '@fastify/websocket';

export const WS_HEARTBEAT_INTERVAL_MS = 25_000;
export const WS_HEARTBEAT_TIMEOUT_MS = 60_000;

type HeartbeatOptions = {
  intervalMs?: number;
  timeoutMs?: number;
  now?: () => number;
  onHeartbeat?: (at: number) => void;
  onStale?: () => void;
};

export type WebSocketHeartbeat = {
  markAlive: () => void;
  stop: () => void;
};

/**
 * Installs server-side ping/pong liveness checks on one WebSocket.
 * Browser and agent WebSocket implementations answer protocol pings automatically.
 */
export function installWebSocketHeartbeat(
  socket: WebSocket,
  options: HeartbeatOptions = {}
): WebSocketHeartbeat {
  const intervalMs = options.intervalMs ?? WS_HEARTBEAT_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? WS_HEARTBEAT_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  let lastHeartbeatAt = now();
  let stopped = false;

  const markAlive = (): void => {
    if (stopped) return;
    lastHeartbeatAt = now();
    options.onHeartbeat?.(lastHeartbeatAt);
  };

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    socket.off('pong', markAlive);
    socket.off('close', stop);
  };

  socket.on('pong', markAlive);
  socket.on('close', stop);

  const timer = setInterval(() => {
    if (now() - lastHeartbeatAt > timeoutMs) {
      options.onStale?.();
      stop();
      socket.terminate();
      return;
    }

    try {
      socket.ping();
    } catch {
      stop();
      socket.terminate();
    }
  }, intervalMs);
  timer.unref?.();

  return { markAlive, stop };
}
