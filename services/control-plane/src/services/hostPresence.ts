import type { HostPresence } from '@agent-command/schema';
import { pubsub } from './pubsub.js';
import { WS_HEARTBEAT_TIMEOUT_MS } from './webSocketHeartbeat.js';

export function isHostOnline(hostId: string, now = Date.now()): boolean {
  const connection = pubsub.getAgentConnection(hostId);
  return Boolean(connection && now - connection.lastHeartbeatAt <= WS_HEARTBEAT_TIMEOUT_MS);
}

export function getHostPresence(now = Date.now()): HostPresence[] {
  return pubsub.getAgentConnections().map((connection) => ({
    host_id: connection.hostId,
    online: now - connection.lastHeartbeatAt <= WS_HEARTBEAT_TIMEOUT_MS,
    last_heartbeat_at: new Date(connection.lastHeartbeatAt).toISOString(),
  }));
}
