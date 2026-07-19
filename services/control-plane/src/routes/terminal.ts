import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import * as db from '../db/index.js';
import { pubsub } from '../services/pubsub.js';
import { verifyRequestToken } from '../auth/verify.js';
import { canAttachTerminal, canControlTerminal, hostSupportsTerminal } from '../services/terminalPolicy.js';
import type { AuthUser } from '../auth/types.js';
import { installWebSocketHeartbeat } from '../services/webSocketHeartbeat.js';

// Track active terminal channels
const activeChannels = new Map<
  string,
  {
    uiSocket: WebSocket;
    hostId: string;
    paneId: string;
    sessionId: string;
    user: AuthUser;
    idleTimeout?: NodeJS.Timeout;
  }
>();

// Called by agent WebSocket handler when terminal output is received
export function handleTerminalOutput(
  channelId: string,
  data: string,
  encoding?: 'base64' | 'utf8'
): boolean {
  const channel = activeChannels.get(channelId);
  if (!channel) return false;

  try {
    channel.uiSocket.send(JSON.stringify({ type: 'output', data, encoding }));
    resetIdleTimeout(channelId);
    return true;
  } catch {
    return false;
  }
}

// Called when terminal is attached/detached
export function handleTerminalStatus(
  channelId: string,
  status: 'attached' | 'detached' | 'error' | 'readonly' | 'control',
  message?: string
): void {
  const channel = activeChannels.get(channelId);
  if (!channel) return;

  try {
    channel.uiSocket.send(JSON.stringify({ type: status, message }));
    if (status === 'detached' || status === 'error') {
      cleanupChannel(channelId);
    }
  } catch {
    cleanupChannel(channelId);
  }
}

function resetIdleTimeout(channelId: string): void {
  const channel = activeChannels.get(channelId);
  if (!channel) return;

  if (channel.idleTimeout) {
    clearTimeout(channel.idleTimeout);
  }

  // 10 minute idle timeout
  channel.idleTimeout = setTimeout(() => {
    const ch = activeChannels.get(channelId);
    if (ch) {
      try {
        if (ch.uiSocket.readyState === 1) {
          ch.uiSocket.send(JSON.stringify({ type: 'idle_timeout' }));
        }
      } catch {
        // Ignore send errors on idle timeout
      }
      detachChannel(channelId);
    }
  }, 10 * 60 * 1000);
}

function cleanupChannel(channelId: string): void {
  const channel = activeChannels.get(channelId);
  if (channel) {
    if (channel.idleTimeout) {
      clearTimeout(channel.idleTimeout);
    }
    activeChannels.delete(channelId);
  }
}

function detachChannel(channelId: string): void {
  const channel = activeChannels.get(channelId);
  if (!channel) return;

  // Send detach command to agent
  pubsub.sendToAgent(channel.hostId, {
    v: 1,
    type: 'terminal.detach',
    ts: new Date().toISOString(),
    payload: { channel_id: channelId },
  });

  cleanupChannel(channelId);
}

const TerminalInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('input'), data: z.string() }),
  z.object({ type: z.literal('resize'), cols: z.number(), rows: z.number() }),
  z.object({ type: z.literal('control') }),
  z.object({ type: z.literal('detach') }),
]);

export function registerTerminalRoutes(app: FastifyInstance): void {
  // WebSocket route for terminal
  app.get<{ Params: { sessionId: string } }>(
    '/v1/ui/terminal/:sessionId',
    { websocket: true },
    async (socket: WebSocket, request: FastifyRequest<{ Params: { sessionId: string } }>) => {
      const { sessionId } = request.params;
      const heartbeat = installWebSocketHeartbeat(socket, {
        onStale: () => app.log.warn({ sessionId }, 'Terminating stale terminal WebSocket'),
      });

      // Validate session ID
      if (!z.string().uuid().safeParse(sessionId).success) {
        socket.close(4001, 'Invalid session ID');
        return;
      }

      // Verify authentication (token from query param for WebSocket)
      const url = new URL(request.url, `http://${request.headers.host}`);
      const token = url.searchParams.get('token');

      if (!token) {
        socket.close(4002, 'Missing authentication token');
        return;
      }

      // Create mock request with authorization header for verification
      const mockRequest = {
        headers: { authorization: `Bearer ${token}` },
      } as FastifyRequest;

      const user = await verifyRequestToken(mockRequest);
      if (!user) {
        socket.close(4003, 'Invalid authentication token');
        return;
      }

      if (!canAttachTerminal(user)) {
        socket.close(4008, 'Terminal access requires operator role');
        return;
      }

      // Get session
      const session = await db.getSessionById(sessionId);
      if (!session) {
        socket.close(4004, 'Session not found');
        return;
      }

      if (!session.tmux_pane_id) {
        socket.close(4005, 'Session has no tmux pane');
        return;
      }

      const host = await db.getHostById(session.host_id);
      if (!hostSupportsTerminal(host)) {
        socket.close(4009, 'Host does not support terminal sessions');
        return;
      }

      // Check if agent is connected
      const agentConn = pubsub.getAgentConnection(session.host_id);
      if (!agentConn) {
        socket.close(4006, 'Host agent not connected');
        return;
      }

      // Create terminal channel
      const channelId = randomUUID();

      activeChannels.set(channelId, {
        uiSocket: socket,
        hostId: session.host_id,
        paneId: session.tmux_pane_id,
        sessionId,
        user,
      });

      // Send attach command to agent
      const sent = pubsub.sendToAgent(session.host_id, {
        v: 1,
        type: 'terminal.attach',
        ts: new Date().toISOString(),
        payload: {
          channel_id: channelId,
          pane_id: session.tmux_pane_id,
          session_id: sessionId,
        },
      });

      if (!sent) {
        cleanupChannel(channelId);
        socket.close(4007, 'Failed to send attach command');
        return;
      }

      // Start idle timeout
      resetIdleTimeout(channelId);

      app.log.info({ channelId, sessionId, paneId: session.tmux_pane_id }, 'Terminal attached');

      // Handle messages from UI
      socket.on('message', (data: Buffer) => {
        heartbeat.markAlive();
        try {
          const raw = JSON.parse(data.toString());
          const parseResult = TerminalInputSchema.safeParse(raw);

          if (!parseResult.success) {
            app.log.warn({ error: parseResult.error }, 'Invalid terminal message');
            return;
          }

          const message = parseResult.data;
          const channel = activeChannels.get(channelId);
          if (!channel) return;

          switch (message.type) {
            case 'input':
              if (!canControlTerminal(channel.user)) {
                socket.close(4008, 'Terminal input requires operator role');
                return;
              }
              pubsub.sendToAgent(channel.hostId, {
                v: 1,
                type: 'terminal.input',
                ts: new Date().toISOString(),
                payload: { channel_id: channelId, data: message.data },
              });
              resetIdleTimeout(channelId);
              break;

            case 'resize':
              pubsub.sendToAgent(channel.hostId, {
                v: 1,
                type: 'terminal.resize',
                ts: new Date().toISOString(),
                payload: { channel_id: channelId, cols: message.cols, rows: message.rows },
              });
              break;

            case 'detach':
              detachChannel(channelId);
              break;
            case 'control':
              if (!canControlTerminal(channel.user)) {
                socket.close(4008, 'Terminal control requires operator role');
                return;
              }
              pubsub.sendToAgent(channel.hostId, {
                v: 1,
                type: 'terminal.control',
                ts: new Date().toISOString(),
                payload: { channel_id: channelId },
              });
              break;
          }
        } catch (error) {
          app.log.error({ error }, 'Error processing terminal message');
        }
      });

      socket.on('close', () => {
        app.log.info({ channelId, sessionId }, 'Terminal WebSocket closed');
        detachChannel(channelId);
      });

      socket.on('error', (error: unknown) => {
        app.log.error({ error, channelId, sessionId }, 'Terminal WebSocket error');
        detachChannel(channelId);
      });
    }
  );
}
