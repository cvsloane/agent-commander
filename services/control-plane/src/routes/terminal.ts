import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { z } from 'zod';
import {
  BrowserTerminalClientMessageSchema,
  TerminalDimensionSchema,
  type BrowserTerminalNavigationResultMessage,
  type BrowserTerminalServerMessage,
  type TerminalNavigationResultMessage,
} from '@agent-command/schema';
import { randomUUID } from 'crypto';
import * as db from '../db/index.js';
import { pubsub } from '../services/pubsub.js';
import { canAttachTerminal, canControlTerminal, hostSupportsTerminal } from '../services/terminalPolicy.js';
import type { AuthUser } from '../auth/types.js';
import { installWebSocketHeartbeat } from '../services/webSocketHeartbeat.js';
import { authenticateBrowserWebSocket } from '../security/webSocketAuth.js';
import {
  recordTerminalNavigation,
  type TerminalNavigationOperation,
} from '../metrics.js';

interface ActiveTerminalChannel {
  channelId: string;
  uiSocket: WebSocket;
  hostId: string;
  paneId: string;
  sessionId: string;
  user: AuthUser;
  binary: boolean;
  resumeToken?: string;
  idleTimeout?: NodeJS.Timeout;
  attachedAt: number;
  attached: boolean;
  detachAudited: boolean;
  log: FastifyBaseLogger;
}

// Track active terminal channels
const activeChannels = new Map<string, ActiveTerminalChannel>();
const pendingNavigationRequests = new Map<string, {
  channelId: string;
  operation: TerminalNavigationOperation;
  startedAt: number;
}>();

function auditPayload(
  channel: ActiveTerminalChannel,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    user_id: channel.user.id,
    user_email: channel.user.email,
    user_name: channel.user.name,
    user_role: channel.user.role,
    session_id: channel.sessionId,
    host_id: channel.hostId,
    pane_id: channel.paneId,
    channel_id: channel.channelId,
    duration_ms: Math.max(0, Date.now() - channel.attachedAt),
    source: 'control_plane',
    ...extra,
  };
}

async function recordTerminalAudit(
  channel: ActiveTerminalChannel,
  action: 'terminal.attach' | 'terminal.control_grant' | 'terminal.detach',
  extra: Record<string, unknown> = {}
): Promise<void> {
  try {
    await db.createAuditLog(
      action,
      'session',
      channel.sessionId,
      auditPayload(channel, extra),
      channel.user.id
    );
  } catch (error) {
    channel.log.error(
      { error, action, sessionId: channel.sessionId, hostId: channel.hostId },
      'Failed to persist terminal audit event'
    );
  }
}

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

export function handleTerminalNavigationResult(
  payload: TerminalNavigationResultMessage['payload'],
  sourceHostId: string
): void {
  const channel = activeChannels.get(payload.channel_id);
  const pending = pendingNavigationRequests.get(payload.request_id);
  if (
    !channel
    || channel.hostId !== sourceHostId
    || pending?.channelId !== payload.channel_id
  ) return;

  pendingNavigationRequests.delete(payload.request_id);
  recordTerminalNavigation(
    pending.operation,
    payload.ok ? 'success' : 'failure',
    (Date.now() - pending.startedAt) / 1000
  );

  try {
    const browserMessage: BrowserTerminalNavigationResultMessage = payload.ok
      ? {
          type: 'navigation_result',
          request_id: payload.request_id,
          ok: true,
          pane_id: payload.pane_id,
          window_index: payload.window_index,
          zoomed: payload.zoomed,
        }
      : {
          type: 'navigation_result',
          request_id: payload.request_id,
          ok: false,
          message: payload.message,
          ...(payload.pane_id ? { pane_id: payload.pane_id } : {}),
          ...(payload.window_index !== undefined ? { window_index: payload.window_index } : {}),
          ...(payload.zoomed !== undefined ? { zoomed: payload.zoomed } : {}),
        };
    channel.uiSocket.send(JSON.stringify(browserMessage));
    resetIdleTimeout(payload.channel_id);
  } catch {
    cleanupChannel(payload.channel_id, 'navigation_result_delivery_error');
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
    if (status === 'control' && channel.attached) {
      void recordTerminalAudit(channel, 'terminal.control_grant');
    }
    channel.uiSocket.send(JSON.stringify(browserMessage));
    if (status === 'detached' || status === 'error') {
      cleanupChannel(channelId, `agent_${status}`);
    }
  } catch {
    cleanupChannel(channelId, 'status_delivery_error');
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
      detachChannel(channelId, 'idle_timeout');
    }
  }, 10 * 60 * 1000);
}

function cleanupChannel(channelId: string, detachReason?: string): void {
  for (const [requestId, pending] of pendingNavigationRequests) {
    if (pending.channelId !== channelId) continue;
    pendingNavigationRequests.delete(requestId);
    recordTerminalNavigation(
      pending.operation,
      'abandoned',
      (Date.now() - pending.startedAt) / 1000
    );
  }
  const channel = activeChannels.get(channelId);
  if (channel) {
    if (detachReason && channel.attached && !channel.detachAudited) {
      channel.detachAudited = true;
      void recordTerminalAudit(channel, 'terminal.detach', { reason: detachReason });
    }
    if (channel.idleTimeout) {
      clearTimeout(channel.idleTimeout);
    }
    activeChannels.delete(channelId);
  }
}

function detachChannel(channelId: string, reason = 'server_request'): void {
  const channel = activeChannels.get(channelId);
  if (!channel) return;

  // Send detach command to agent
  pubsub.sendToAgent(channel.hostId, {
    v: 1,
    type: 'terminal.detach',
    ts: new Date().toISOString(),
    payload: { channel_id: channelId },
  });

  cleanupChannel(channelId, reason);
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
    detachChannel(channelId, 'resume_replaced');
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
    { websocket: true, config: { rateLimit: false } },
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
          detachChannel(channelId, 'socket_closed');
        }
      });

      socket.on('error', (error: unknown) => {
        app.log.error({ error, channelId, sessionId }, 'Terminal WebSocket error');
        if (channelId) {
          detachChannel(channelId, 'socket_error');
        }
      });

      // Validate session ID
      if (!z.string().uuid().safeParse(sessionId).success) {
        socket.close(4001, 'Invalid session ID');
        return;
      }

      const url = new URL(request.url, `http://${request.headers.host}`);
      const parsedCols = TerminalDimensionSchema.safeParse(Number(url.searchParams.get('cols')));
      const parsedRows = TerminalDimensionSchema.safeParse(Number(url.searchParams.get('rows')));
      const resumeToken = url.searchParams.get('resume_token') || undefined;
      const letterbox =
        url.searchParams.get('letterbox') === '1' && parsedCols.success && parsedRows.success;

      const user = await authenticateBrowserWebSocket(app, socket, request);
      if (!user) return;

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
        channelId: activeChannelId,
        uiSocket: socket,
        hostId: session.host_id,
        paneId: session.tmux_pane_id,
        sessionId,
        user,
        binary: false,
        resumeToken,
        attachedAt: Date.now(),
        attached: false,
        detachAudited: false,
        log: app.log,
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

            case 'navigate': {
              if (!canControlTerminal(channel.user)) {
                socket.close(4008, 'Terminal navigation requires operator role');
                return;
              }
              const { type: _type, ...navigation } = message;
              const correlatedNavigation =
                navigation.op === 'focus_pane' || navigation.op === 'viewer_state'
                  ? navigation
                  : null;
              if (correlatedNavigation) {
                pendingNavigationRequests.set(correlatedNavigation.request_id, {
                  channelId: activeChannelId,
                  operation: correlatedNavigation.op,
                  startedAt: Date.now(),
                });
              }
              const sent = pubsub.sendToAgent(channel.hostId, {
                v: 1,
                type: 'terminal.navigate',
                ts: new Date().toISOString(),
                payload: { channel_id: activeChannelId, ...navigation },
              });
              if (!sent && correlatedNavigation) {
                handleTerminalNavigationResult({
                  channel_id: activeChannelId,
                  request_id: correlatedNavigation.request_id,
                  ok: false,
                  message: 'Host agent is not available.',
                }, channel.hostId);
              }
              resetIdleTimeout(activeChannelId);
              break;
            }

            case 'detach':
              detachChannel(activeChannelId, 'client_request');
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
          ...(letterbox ? { letterbox: true } : {}),
        },
      });

      if (!sent) {
        cleanupChannel(activeChannelId);
        socket.close(4007, 'Failed to send attach command');
        return;
      }

      attachedToAgent = true;
      const activeChannel = activeChannels.get(activeChannelId);
      if (activeChannel) {
        activeChannel.attached = true;
        await recordTerminalAudit(activeChannel, 'terminal.attach');
      }
      for (const data of deferredMessages.splice(0)) {
        processBrowserMessage(data);
      }

      // Start idle timeout
      resetIdleTimeout(activeChannelId);

      app.log.info({ channelId: activeChannelId, sessionId, paneId: session.tmux_pane_id }, 'Terminal attached');

    }
  );
}
