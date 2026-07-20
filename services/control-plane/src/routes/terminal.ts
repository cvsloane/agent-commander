import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { z } from 'zod';
import {
  BrowserTerminalClientMessageSchema,
  TerminalDimensionSchema,
  type BrowserTerminalServerMessage,
} from '@agent-command/schema';
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
    binary: boolean;
    resumeToken?: string;
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
    if (channel.binary) {
      channel.uiSocket.send(Buffer.from(data, encoding === 'base64' ? 'base64' : 'utf8'), { binary: true });
    } else {
      channel.uiSocket.send(JSON.stringify({ type: 'output', data, encoding }));
    }
    resetIdleTimeout(channelId);
    return true;
  } catch {
    return false;
  }
}

// Called when terminal is attached/detached
export function handleTerminalStatus(
  channelId: string,
  status: 'attached' | 'detached' | 'error' | 'readonly' | 'control' | 'lag',
  message?: string,
  details: {
    readonly?: boolean;
    resumed?: boolean;
    resume_token?: string;
    dropped?: number;
  } = {}
): void {
  const channel = activeChannels.get(channelId);
  if (!channel) return;

  try {
    if (details.resume_token) {
      channel.resumeToken = details.resume_token;
    }
    const browserMessage: BrowserTerminalServerMessage = {
      type: status,
      ...(message ? { message } : {}),
      ...details,
    };
    channel.uiSocket.send(JSON.stringify(browserMessage));
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

function retireResumedChannel(resumeToken: string, sessionId: string, userId: string): void {
  for (const [channelId, channel] of activeChannels) {
    if (
      channel.resumeToken !== resumeToken
      || channel.sessionId !== sessionId
      || channel.user.id !== userId
    ) {
      continue;
    }
    detachChannel(channelId);
    if (channel.uiSocket.readyState === 1) {
      channel.uiSocket.close(4000, 'Terminal resumed in another connection');
    }
  }
}

export function registerTerminalRoutes(app: FastifyInstance): void {
  // @fastify/websocket owns one server for all routes. Use bounded compression
  // settings so terminal output benefits without retaining compression context
  // or spending work on small voice/control frames handled by sibling routes.
  app.websocketServer.options.perMessageDeflate = {
    threshold: 1024,
    serverNoContextTakeover: true,
    clientNoContextTakeover: true,
    concurrencyLimit: 5,
  };

  // WebSocket route for terminal
  app.get<{ Params: { sessionId: string } }>(
    '/v1/ui/terminal/:sessionId',
    { websocket: true },
    async (socket: WebSocket, request: FastifyRequest<{ Params: { sessionId: string } }>) => {
      const { sessionId } = request.params;
      const heartbeat = installWebSocketHeartbeat(socket, {
        onStale: () => app.log.warn({ sessionId }, 'Terminating stale terminal WebSocket'),
      });
      const pendingMessages: Buffer[] = [];
      let pendingMessageBytes = 0;
      let browserMessageHandler: ((data: Buffer) => void) | null = null;
      let channelId: string | null = null;
      let socketClosed = false;

      // Frames can arrive while this async handler awaits auth and database
      // lookups, so register lifecycle listeners before the first await.
      socket.on('message', (data: Buffer) => {
        heartbeat.markAlive();
        if (browserMessageHandler) {
          browserMessageHandler(Buffer.from(data));
          return;
        }
        if (pendingMessages.length >= 64 || pendingMessageBytes + data.byteLength > 64 * 1024) {
          socket.close(4000, 'Too many pending terminal messages');
          return;
        }
        const buffered = Buffer.from(data);
        pendingMessageBytes += buffered.byteLength;
        pendingMessages.push(buffered);
      });

      socket.on('close', () => {
        socketClosed = true;
        if (channelId) {
          app.log.info({ channelId, sessionId }, 'Terminal WebSocket closed');
          detachChannel(channelId);
        }
      });

      socket.on('error', (error: unknown) => {
        app.log.error({ error, channelId, sessionId }, 'Terminal WebSocket error');
        if (channelId) {
          detachChannel(channelId);
        }
      });

      // Validate session ID
      if (!z.string().uuid().safeParse(sessionId).success) {
        socket.close(4001, 'Invalid session ID');
        return;
      }

      // Verify authentication (token from query param for WebSocket)
      const url = new URL(request.url, `http://${request.headers.host}`);
      const token = url.searchParams.get('token');
      const parsedCols = TerminalDimensionSchema.safeParse(Number(url.searchParams.get('cols')));
      const parsedRows = TerminalDimensionSchema.safeParse(Number(url.searchParams.get('rows')));
      const resumeToken = url.searchParams.get('resume_token') || undefined;

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

      if (socketClosed || socket.readyState !== 1) {
        return;
      }

      if (resumeToken) {
        retireResumedChannel(resumeToken, sessionId, user.id);
      }

      // Create terminal channel
      const activeChannelId = randomUUID();
      channelId = activeChannelId;

      activeChannels.set(activeChannelId, {
        uiSocket: socket,
        hostId: session.host_id,
        paneId: session.tmux_pane_id,
        sessionId,
        user,
        binary: false,
        resumeToken,
      });

      let attachedToAgent = false;
      const deferredMessages: Buffer[] = [];
      const processBrowserMessage = (data: Buffer) => {
        try {
          const raw = JSON.parse(data.toString());
          const parseResult = BrowserTerminalClientMessageSchema.safeParse(raw);

          if (!parseResult.success) {
            app.log.warn({ error: parseResult.error }, 'Invalid terminal message');
            return;
          }

          const message = parseResult.data;
          const channel = activeChannels.get(activeChannelId);
          if (!channel) return;
          if (message.type === 'hello') {
            channel.binary = message.binary;
            return;
          }
          if (!attachedToAgent) {
            deferredMessages.push(data);
            return;
          }

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
                payload: { channel_id: activeChannelId, data: message.data },
              });
              resetIdleTimeout(activeChannelId);
              break;

            case 'resize':
              if (!canControlTerminal(channel.user)) {
                socket.close(4008, 'Terminal resize requires operator role');
                return;
              }
              pubsub.sendToAgent(channel.hostId, {
                v: 1,
                type: 'terminal.resize',
                ts: new Date().toISOString(),
                payload: { channel_id: activeChannelId, cols: message.cols, rows: message.rows },
              });
              break;

            case 'detach':
              detachChannel(activeChannelId);
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
                payload: { channel_id: activeChannelId },
              });
              break;
          }
        } catch (error) {
          app.log.error({ error }, 'Error processing terminal message');
        }
      };
      browserMessageHandler = processBrowserMessage;
      for (const data of pendingMessages.splice(0)) {
        processBrowserMessage(data);
      }
      pendingMessageBytes = 0;

      // Send attach command to agent
      const sent = pubsub.sendToAgent(session.host_id, {
        v: 1,
        type: 'terminal.attach',
        ts: new Date().toISOString(),
        payload: {
          channel_id: activeChannelId,
          pane_id: session.tmux_pane_id,
          session_id: sessionId,
          ...(parsedCols.success && parsedRows.success
            ? { cols: parsedCols.data, rows: parsedRows.data }
            : {}),
          ...(resumeToken ? { resume_token: resumeToken } : {}),
        },
      });

      if (!sent) {
        cleanupChannel(activeChannelId);
        socket.close(4007, 'Failed to send attach command');
        return;
      }

      attachedToAgent = true;
      for (const data of deferredMessages.splice(0)) {
        processBrowserMessage(data);
      }

      // Start idle timeout
      resetIdleTimeout(activeChannelId);

      app.log.info({ channelId: activeChannelId, sessionId, paneId: session.tmux_pane_id }, 'Terminal attached');

    }
  );
}
