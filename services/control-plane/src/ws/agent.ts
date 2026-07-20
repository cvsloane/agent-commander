import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import {
  AgentMessageSchema,
  AgentAckMessageSchema,
  AutomationRunReportRequestSchema,
  CommandsDispatchMessageSchema,
  ToolEventStartSchema,
  ToolEventCompleteSchema,
  ProviderUsageReportSchema,
  SessionUsageSummarySchema,
  type AgentMessage,
  type Session,
  type SessionUpsert,
} from '@agent-command/schema';
import { ulid } from 'ulid';
import { pubsub } from '../services/pubsub.js';
import {
  commandRouter,
  handleCommandResultForPending,
  HOST_COMMAND_SESSION_ID,
  isOutboxCommandId,
} from '../services/commandRouter.js';
import { handleTerminalOutput, handleTerminalStatus } from '../routes/terminal.js';
import * as db from '../db/index.js';
import { consoleSubscriptions } from '../services/consoleSubscriptions.js';
import { installWebSocketHeartbeat } from '../services/webSocketHeartbeat.js';
import { attentionService } from '../services/attention.js';
import { hostProgress } from '../services/hostProgress.js';
import { recordAgentMessageHandlerFailure } from '../metrics.js';
import { agentTasks, agentTaskUpdateFromEvent } from '../db/agentTasks.js';
import { sessionGraph } from '../db/sessionGraph.js';
import { reportAutomationRunForSession } from '../services/automation.js';
import { enforceAgentWebSocketOrigin } from '../security/webSocketAuth.js';

interface AgentState {
  hostId: string | null;
  lastProcessedSeq: number;
  authenticated: boolean;
  failed: boolean;
  helloReceived: boolean;
  outboxDelivered: boolean;
}

/**
 * Registers the `/v1/agent/connect` WebSocket endpoint for agentd connections.
 *
 * Event listeners are attached synchronously before async token validation so
 * that early messages (for example `agent.hello`) are buffered rather than
 * silently dropped. Once authentication succeeds the buffer is drained in order.
 */
export function registerAgentWebSocket(app: FastifyInstance): void {
  app.get(
    '/v1/agent/connect',
    { websocket: true, config: { rateLimit: false } },
    async (socket: WebSocket, request: FastifyRequest) => {
      if (!enforceAgentWebSocketOrigin(app, socket, request)) return;
      const state: AgentState = {
        hostId: null,
        lastProcessedSeq: 0,
        authenticated: false,
        failed: false,
        helloReceived: false,
        outboxDelivered: false,
      };

      const heartbeat = installWebSocketHeartbeat(socket, {
        onHeartbeat: (at) => {
          if (state.hostId) {
            pubsub.markAgentHeartbeat(state.hostId, socket, at);
          }
        },
        onStale: () => {
          app.log.warn({ hostId: state.hostId }, 'Terminating stale agent WebSocket');
        },
      });

      const pendingMessages: Buffer[] = [];
      const MAX_PENDING_MESSAGES = 100;

      let messageQueue = Promise.resolve();
      socket.on('message', (data: Buffer) => {
        heartbeat.markAlive();
        if (state.hostId) {
          pubsub.markAgentHeartbeat(state.hostId, socket);
        }
        if (!state.authenticated) {
          if (pendingMessages.length >= MAX_PENDING_MESSAGES) {
            app.log.warn({ count: pendingMessages.length }, 'Dropping message: pre-auth buffer full');
            return;
          }
          pendingMessages.push(Buffer.from(data));
          return;
        }

        const buffered = Buffer.from(data);
        messageQueue = messageQueue.then(async () => {
          if (state.failed) return;
          await handleSocketMessage(app, socket, state, buffered);
        });
      });

      socket.on('close', () => {
        if (state.hostId) {
          const removed = pubsub.removeAgentConnection(state.hostId, socket);
          void hostProgress.flush(state.hostId).catch((error) => {
            app.log.error({ error, hostId: state.hostId }, 'Failed to flush host progress on disconnect');
          });
          app.log.info({ hostId: state.hostId, removed }, 'Agent disconnected');
        }
      });

      socket.on('error', (error: unknown) => {
        app.log.error({ error, hostId: state.hostId }, 'Agent WebSocket error');
      });

      // Extract token from Authorization header
      const authHeader = request.headers.authorization;
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

      if (!token) {
        socket.close(4001, 'Missing authorization token');
        return;
      }

      // Validate token
      const hostId = await db.validateAgentToken(token);
      if (!hostId) {
        socket.close(4003, 'Invalid token');
        return;
      }

      state.hostId = hostId;
      state.authenticated = true;
      app.log.info({ hostId }, 'Agent connection authenticated');

      // Track connected agent immediately with seq=0; handleAgentHello will
      // re-register with the correct lastAckedSeq from the database.
      pubsub.addAgentConnection(hostId, socket, 0);

      for (const buffered of pendingMessages.splice(0)) {
        messageQueue = messageQueue.then(async () => {
          if (state.failed) return;
          await handleSocketMessage(app, socket, state, buffered);
        });
      }
      await messageQueue;
    }
  );
}

async function handleSocketMessage(
  app: FastifyInstance,
  socket: WebSocket,
  state: AgentState,
  data: Buffer
): Promise<void> {
  try {
    const raw = JSON.parse(data.toString());
    const parseResult = AgentMessageSchema.safeParse(raw);

    if (!parseResult.success) {
      app.log.warn({ error: parseResult.error }, 'Invalid agent message');
      state.failed = true;
      recordAgentMessageHandlerFailure('invalid');
      socket.terminate();
      return;
    }

    const message = parseResult.data;
    await processAgentMessage(app, socket, state, message);
  } catch (error) {
    app.log.error({ error }, 'Error processing agent message');
    state.failed = true;
    recordAgentMessageHandlerFailure('invalid');
    socket.terminate();
  }
}

async function processAgentMessage(
  app: FastifyInstance,
  socket: WebSocket,
  state: AgentState,
  message: AgentMessage
): Promise<void> {
  const seq = message.seq;

  if (message.type !== 'agent.hello' && seq <= state.lastProcessedSeq) {
    if (state.hostId) {
      hostProgress.record(state.hostId);
    }
    sendAck(socket, seq, 'ok');
    return;
  }

  try {
    switch (message.type) {
    case 'agent.hello':
      await handleAgentHello(app, socket, state, message);
      break;

    case 'sessions.upsert':
      await handleSessionsUpsert(app, state, message.payload.sessions);
      await deliverPendingAfterInventory(app, socket, state);
      sendAck(socket, seq, 'ok');
      break;
    case 'sessions.prune':
      await handleSessionsPrune(app, state, message.payload.session_ids);
      await deliverPendingAfterInventory(app, socket, state);
      sendAck(socket, seq, 'ok');
      break;

    case 'sessions.snapshot':
      await handleSessionSnapshot(
        app,
        message.payload.session_id,
        message.payload.capture_hash,
        message.payload.capture_text
      );
      sendAck(socket, seq, 'ok');
      break;

    case 'events.append':
      await handleEventsAppend(app, state, message.payload);
      sendAck(socket, seq, 'ok');
      break;

    case 'commands.result':
      await handleCommandResult(app, state, message.payload);
      sendAck(socket, seq, 'ok');
      break;

    case 'console.chunk':
      handleConsoleChunk(message.payload);
      sendAck(socket, seq, 'ok');
      break;

    case 'mcp.servers':
    case 'mcp.config':
    case 'mcp.project_config':
    case 'mcp.update_result': {
      const payload = message.payload as { cmd_id?: string };
      if (payload.cmd_id && state.hostId) {
        await commandRouter.handleResponse(state.hostId, payload.cmd_id, message.payload);
      }
      sendAck(socket, seq, 'ok');
      break;
    }

    case 'terminal.output': {
      const payload = message.payload as { channel_id: string; data: string; encoding?: 'base64' | 'utf8' };
      handleTerminalOutput(payload.channel_id, payload.data, payload.encoding);
      sendAck(socket, seq, 'ok');
      break;
    }

    case 'terminal.attached':
    case 'terminal.detached':
    case 'terminal.error':
    case 'terminal.readonly':
    case 'terminal.control':
    case 'terminal.lag': {
      const payload = message.payload;
      const status = message.type === 'terminal.attached' ? 'attached'
        : message.type === 'terminal.detached' ? 'detached'
        : message.type === 'terminal.readonly' ? 'readonly'
        : message.type === 'terminal.control' ? 'control'
        : message.type === 'terminal.lag' ? 'lag'
        : 'error';
      handleTerminalStatus(payload.channel_id, status, payload.message, {
        ...(payload.readonly !== undefined ? { readonly: payload.readonly } : {}),
        ...(payload.resumed !== undefined ? { resumed: payload.resumed } : {}),
        ...(payload.resume_token ? { resume_token: payload.resume_token } : {}),
        ...(payload.dropped !== undefined ? { dropped: payload.dropped } : {}),
      });
      sendAck(socket, seq, 'ok');
      break;
    }

    case 'terminal.audit': {
      if (!state.hostId) {
        throw new Error('Terminal audit received before agent authentication');
      }
      const session = await db.getSessionById(message.payload.session_id);
      const auditPayload = {
        host_id: state.hostId,
        channel_id: message.payload.channel_id,
        pane_id: message.payload.pane_id,
        ...(message.payload.previous_controller_channel_id
          ? { previous_controller_channel_id: message.payload.previous_controller_channel_id }
          : {}),
        source: 'agentd',
      };
      if (!session) {
        app.log.warn(
          { hostId: state.hostId, sessionId: message.payload.session_id },
          'Recording terminal audit for a session that no longer exists'
        );
        await db.createAuditLog(
          `terminal.${message.payload.action}`,
          'host',
          state.hostId,
          {
            ...auditPayload,
            session_id: message.payload.session_id,
            unresolved_session: true,
          }
        );
        sendAck(socket, seq, 'ok');
        break;
      }
      if (session.host_id !== state.hostId) {
        throw new Error('Terminal audit session does not belong to authenticated host');
      }
      await db.createAuditLog(
        `terminal.${message.payload.action}`,
        'session',
        message.payload.session_id,
        auditPayload
      );
      sendAck(socket, seq, 'ok');
      break;
    }

    case 'tool.event.started': {
      await handleToolEventStarted(message.payload);
      sendAck(socket, seq, 'ok');
      break;
    }

    case 'tool.event.completed': {
      await handleToolEventCompleted(message.payload);
      sendAck(socket, seq, 'ok');
      break;
    }

    case 'provider.usage': {
      await handleProviderUsageReport(state, message.payload);
      sendAck(socket, seq, 'ok');
      break;
    }

    case 'session.usage': {
      await handleSessionUsageReport(state, message.payload);
      sendAck(socket, seq, 'ok');
      break;
    }
    }
  } catch (error) {
    state.failed = true;
    recordAgentMessageHandlerFailure(message.type);
    app.log.error(
      { error, hostId: state.hostId, seq, messageType: message.type },
      'Agent message handler failed; closing without acknowledgement for redelivery'
    );
    socket.terminate();
    return;
  }

  if (state.failed) return;

  if (state.hostId) {
    let ackedSeq: number | undefined;
    if (seq > state.lastProcessedSeq) {
      state.lastProcessedSeq = seq;
      ackedSeq = seq;
      pubsub.updateAgentAckedSeq(state.hostId, seq);
    }
    hostProgress.record(state.hostId, ackedSeq);
  }
}

async function handleAgentHello(
  app: FastifyInstance,
  socket: WebSocket,
  state: AgentState,
  message: Extract<AgentMessage, { type: 'agent.hello' }>
): Promise<void> {
  const { host, resume } = message.payload;

  // Verify host ID matches authenticated token
  if (host.id !== state.hostId) {
    app.log.warn(
      { expected: state.hostId, received: host.id },
      'Host ID mismatch'
    );
    socket.close(4003, 'Host ID mismatch');
    state.failed = true;
    return;
  }

  // Upsert host in database
  const upserted = await db.upsertHost({
    id: host.id,
    name: host.name,
    tailscale_name: host.tailscale_name,
    tailscale_ip: host.tailscale_ip,
    capabilities: host.capabilities,
    agent_version: host.agent_version,
  });

  state.lastProcessedSeq = Math.max(
    upserted.last_acked_seq || 0,
    resume?.last_acked_seq || 0
  );

  // Register connection
  pubsub.addAgentConnection(host.id, socket, state.lastProcessedSeq);
  state.helloReceived = true;

  app.log.info({ hostId: host.id, name: host.name }, 'Agent registered');

  // Send ack
  sendAck(socket, message.seq, 'ok');
}

async function deliverPendingAfterInventory(
  app: FastifyInstance,
  socket: WebSocket,
  state: AgentState
): Promise<void> {
  if (!state.hostId || !state.helloReceived || state.outboxDelivered) return;
  if (!pubsub.markAgentReady(state.hostId, socket)) return;
  const delivery = await commandRouter.deliverPending(state.hostId);
  state.outboxDelivered = true;
  if (delivery.delivered > 0 || delivery.expired > 0) {
    app.log.info(
      { hostId: state.hostId, ...delivery },
      'Processed command outbox after initial agent inventory'
    );
  }

  const activeConsoleSubs = consoleSubscriptions.getByHost(state.hostId);
  if (activeConsoleSubs.length > 0) {
    app.log.info(
      { hostId: state.hostId, count: activeConsoleSubs.length },
      'Re-subscribing console streams after initial agent inventory'
    );
    for (const sub of activeConsoleSubs) {
      const resend = CommandsDispatchMessageSchema.parse({
        v: 1,
        type: 'commands.dispatch',
        ts: new Date().toISOString(),
        payload: {
          cmd_id: ulid(),
          session_id: sub.sessionId,
          command: {
            type: 'console.subscribe',
            payload: {
              subscription_id: sub.subscriptionId,
              pane_id: sub.paneId,
            },
          },
        },
      });
      pubsub.sendToAgent(state.hostId, resend);
    }
  }
}

async function handleSessionsUpsert(
  app: FastifyInstance,
  state: AgentState,
  sessions: SessionUpsert[]
): Promise<void> {
  if (!state.hostId) return;

  const updatedSessions: Session[] = [];
  let firstFailure: unknown;

  for (const session of sessions) {
    try {
      let updated = await db.upsertSession(state.hostId, session);

      if (session.forked_from) {
        const edgeResult = await sessionGraph.upsert({
          parent_session_id: session.forked_from,
          child_session_id: session.id,
          edge_type: 'forked',
        });
        if (edgeResult.created) {
          pubsub.publishSessionEdgesChanged(session.forked_from, [edgeResult.edge]);
        }
      }
      const parentSessionId = session.metadata?.parent_session_id;
      if (parentSessionId) {
        const edgeResult = await sessionGraph.upsert({
          parent_session_id: parentSessionId,
          child_session_id: session.id,
          edge_type: 'spawned',
        });
        if (edgeResult.created) {
          pubsub.publishSessionEdgesChanged(parentSessionId, [edgeResult.edge]);
        }
      }

      if (
        updated.kind === 'tmux_pane' &&
        !updated.group_id &&
        session.metadata &&
        typeof session.metadata === 'object'
      ) {
        const tmuxMeta = (session.metadata as Record<string, unknown>)?.tmux as
          | Record<string, unknown>
          | undefined;
        const tmuxSessionName =
          typeof tmuxMeta?.session_name === 'string'
            ? tmuxMeta.session_name.trim()
            : '';

        if (tmuxSessionName) {
          try {
            const group = await db.getOrCreateGroupByName(tmuxSessionName);
            const assigned = await db.assignSessionGroup(updated.id, group.id);
            if (assigned) {
              updated = assigned;
            }
          } catch (groupError) {
            app.log.error(
              { error: groupError, sessionId: session.id, group: tmuxSessionName },
              'Failed to auto-group session'
            );
          }
        }
      }

      updated = await attentionService.evaluateStatus(updated);
      updatedSessions.push(updated);
    } catch (error) {
      app.log.error({ error, sessionId: session.id }, 'Failed to upsert session');
      firstFailure ??= error;
    }
  }

  if (updatedSessions.length > 0) {
    pubsub.publishSessionsChanged(updatedSessions);
  }

  if (firstFailure) throw firstFailure;
}

async function handleSessionsPrune(
  app: FastifyInstance,
  state: AgentState,
  sessionIds: string[]
): Promise<void> {
  if (!state.hostId) return;
  const pruned = await db.pruneHostSessions(state.hostId, sessionIds);
  app.log.info({ hostId: state.hostId, pruned }, 'Pruned stale sessions');
}

async function handleSessionSnapshot(
  app: FastifyInstance,
  sessionId: string,
  captureHash: string,
  captureText: string
): Promise<void> {
  const snapshot = await db.insertSnapshot(sessionId, captureHash, captureText);
  const session = await db.getSessionById(sessionId);
  if (session) {
    await attentionService.evaluateSnapshot(
      session,
      snapshot.capture_text,
      snapshot.capture_hash
    );
  }
  pubsub.publishSnapshotUpdated(
    sessionId,
    snapshot.capture_text,
    snapshot.capture_hash,
    snapshot.created_at
  );
}

async function handleEventsAppend(
  app: FastifyInstance,
  state: AgentState,
  payload: {
    session_id: string;
    event_id?: string;
    event_type: string;
    payload: Record<string, unknown>;
  }
): Promise<void> {
  if (!state.hostId) {
    throw new Error('Agent host identity is unavailable');
  }
  const sourceSession = await db.getSessionById(payload.session_id);
  if (!sourceSession || sourceSession.host_id !== state.hostId) {
    throw new Error('Event session does not belong to the authenticated host');
  }
  const event = await db.insertEvent(
    payload.session_id,
    payload.event_type,
    payload.payload,
    payload.event_id
  );

  const agentTaskUpdate = agentTaskUpdateFromEvent(
    payload.session_id,
    payload.event_type,
    payload.payload
  );
  if (agentTaskUpdate) {
    const agentTask = await agentTasks.upsert(agentTaskUpdate);
    pubsub.publishAgentTasksChanged(payload.session_id, [agentTask]);
  }

  if (payload.event_type === 'orchestrator.report') {
    const report = AutomationRunReportRequestSchema.parse(payload.payload);
    const finalized = await reportAutomationRunForSession(payload.session_id, report);
    if (!finalized) {
      app.log.warn(
        { sessionId: payload.session_id },
        'Received orchestrator report without a matching automation run'
      );
    }
  }

  if (event) {
    pubsub.publishEventAppended(payload.session_id, {
      id: event.id!,
      ts: event.ts,
      type: event.type,
      payload: event.payload,
    });

    // Handle special event types that create approvals
    if (payload.event_type === 'approval.requested') {
      const session = await db.getSessionById(payload.session_id);
      if (session) {
        const approvalId =
          typeof payload.payload.approval_id === 'string'
            ? payload.payload.approval_id
            : undefined;
        const provider =
          typeof payload.payload.provider === 'string'
            ? payload.payload.provider
            : session.provider;
        const approval = await db.createApproval(
          payload.session_id,
          provider,
          payload.payload,
          approvalId
        );
        pubsub.publishApprovalCreated(approval, session);
      }
    }

    // Record token usage if present
    const tokenUsage = extractTokenUsage(payload.payload);
    if (tokenUsage) {
      await db.recordTokenUsage({
        session_id: payload.session_id,
        event_id: event.id,
        ...tokenUsage,
      });
    }
  }
}

async function handleCommandResult(
  app: FastifyInstance,
  state: AgentState,
  payload: { cmd_id: string; session_id?: string; ok: boolean; result?: Record<string, unknown>; error?: { code: string; message: string } }
): Promise<void> {
  app.log.info({ cmdId: payload.cmd_id, ok: payload.ok }, 'Command result received');
  if (!state.hostId) return;

  // Resolve any caller waiting on this command id, including host-level commands.
  await handleCommandResultForPending(state.hostId, payload.cmd_id, {
    ok: payload.ok,
    result: payload.result,
    error: payload.error,
  });

  const persisted = isOutboxCommandId(payload.cmd_id)
    ? await commandRouter.getByIdForHost(state.hostId, payload.cmd_id)
    : null;
  let sessionId = persisted?.session_id ?? null;
  if (!persisted && payload.session_id && payload.session_id !== HOST_COMMAND_SESSION_ID) {
    const legacySession = await db.getSessionById(payload.session_id);
    if (legacySession?.host_id === state.hostId) sessionId = legacySession.id;
  }

  if (sessionId) {
    const event = await db.insertEvent(
      sessionId,
      'command.completed',
      {
        cmd_id: payload.cmd_id,
        ok: payload.ok,
        result: payload.result,
        error: payload.error,
      },
      `command:${payload.cmd_id}`
    );

    if (event) {
      pubsub.publishEventAppended(sessionId, {
        id: event.id!,
        ts: event.ts,
        type: event.type,
        payload: event.payload,
      });
    }
  }
}

function handleConsoleChunk(payload: {
  subscription_id: string;
  session_id: string;
  data: string;
  offset: number;
}): void {
  pubsub.publishConsoleChunk(
    payload.subscription_id,
    payload.session_id,
    payload.data,
    payload.offset
  );
}

async function handleToolEventStarted(payload: unknown): Promise<void> {
  const parsed = ToolEventStartSchema.parse(payload);
  const event = await db.insertToolEventStart(parsed);

  // Publish to UI subscribers
  pubsub.publishToolEventStarted(parsed.session_id, event);
}

async function handleToolEventCompleted(payload: unknown): Promise<void> {
  const parsed = ToolEventCompleteSchema.parse(payload);
  const event = await db.completeToolEvent(parsed);

  if (event) {
    // Publish to UI subscribers
    pubsub.publishToolEventCompleted(event.session_id, event);
  }
}

async function handleProviderUsageReport(
  state: AgentState,
  payload: unknown
): Promise<void> {
  if (!state.hostId) return;
  const parsed = ProviderUsageReportSchema.parse(payload);
  const utilizationOverrides = extractUtilizationFromRaw(parsed.raw_json, parsed.provider);
  await db.recordProviderUsage({
      provider: parsed.provider,
      host_id: parsed.host_id || state.hostId,
      session_id: parsed.session_id,
      scope: parsed.scope,
      reported_at: parsed.reported_at,
      raw_text: parsed.raw_text,
      raw_json: parsed.raw_json,
      remaining_tokens: parsed.remaining_tokens,
      remaining_requests: parsed.remaining_requests,
      weekly_limit_tokens: parsed.weekly_limit_tokens,
      weekly_remaining_tokens: parsed.weekly_remaining_tokens,
      weekly_remaining_cost_cents: parsed.weekly_remaining_cost_cents,
      reset_at: parsed.reset_at,
      five_hour_utilization:
        utilizationOverrides.five_hour_utilization ?? parsed.five_hour_utilization,
      five_hour_reset_at: parsed.five_hour_reset_at,
      weekly_utilization: utilizationOverrides.weekly_utilization ?? parsed.weekly_utilization,
      weekly_reset_at: parsed.weekly_reset_at,
      weekly_opus_utilization:
        utilizationOverrides.weekly_opus_utilization ?? parsed.weekly_opus_utilization,
      weekly_opus_reset_at: parsed.weekly_opus_reset_at,
      weekly_sonnet_utilization:
        utilizationOverrides.weekly_sonnet_utilization ?? parsed.weekly_sonnet_utilization,
      weekly_sonnet_reset_at: parsed.weekly_sonnet_reset_at,
      daily_utilization:
        utilizationOverrides.daily_utilization ?? parsed.daily_utilization,
      daily_reset_at:
        utilizationOverrides.daily_reset_at ?? parsed.daily_reset_at,
  });
}

async function handleSessionUsageReport(
  state: AgentState,
  payload: unknown
): Promise<void> {
  const parsed = SessionUsageSummarySchema.parse(payload);
  await db.upsertSessionUsageLatest(parsed);

  pubsub.publishToUI({
    v: 1,
    type: 'session_usage.updated',
    ts: new Date().toISOString(),
    payload: parsed,
  });

  // For Gemini, also record to provider_usage so it shows in dashboard
  if (parsed.provider === 'gemini_cli' && parsed.daily_utilization_percent != null) {
    const resetAt = parsed.daily_reset_hours
      ? new Date(Date.now() + parsed.daily_reset_hours * 60 * 60 * 1000).toISOString()
      : undefined;

    await db.recordProviderUsage({
      provider: parsed.provider,
      host_id: state.hostId,
      session_id: parsed.session_id,
      scope: 'account',
      reported_at: parsed.reported_at,
      daily_utilization: parsed.daily_utilization_percent,
      daily_reset_at: resetAt,
    });
  }
}

function sendAck(
  socket: WebSocket,
  seq: number,
  status: 'ok' | 'error',
  error?: string
): void {
  const ack = AgentAckMessageSchema.parse({
    v: 1,
    type: 'agent.ack',
    ts: new Date().toISOString(),
    payload: { ack_seq: seq, status, error },
  });
  socket.send(JSON.stringify(ack));
}

type TokenUsagePayload = {
  tokens_in?: number;
  tokens_out?: number;
  tokens_cache_read?: number;
  tokens_cache_write?: number;
  tool_name?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

type UtilizationOverrides = {
  five_hour_utilization?: number;
  weekly_utilization?: number;
  weekly_opus_utilization?: number;
  weekly_sonnet_utilization?: number;
  daily_utilization?: number;
  daily_reset_at?: string;
};

function coercePercent(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (value < 0) return undefined;
  if (value > 0 && value < 1 && !Number.isInteger(value)) return value * 100;
  if (value > 100) return undefined;
  return value;
}

/**
 * Extract Gemini utilization from raw_json.
 * Expected format:
 * {
 *   "models": {
 *     "gemini-2.5-flash": { "usage_left": 100, "reset_period": "24h" },
 *     "gemini-2.5-pro": { "usage_left": 85, "reset_period": "24h" }
 *   }
 * }
 * Returns daily_utilization as (100 - min(usage_left across models))
 */
function extractGeminiUtilization(raw: Record<string, unknown> | undefined): UtilizationOverrides {
  if (!raw || !isRecord(raw)) return {};

  const models = raw.models;
  if (!isRecord(models)) return {};

  let minUsageLeft: number | undefined;
  let hasResetPeriod24h = false;

  for (const [_modelName, modelData] of Object.entries(models)) {
    if (!isRecord(modelData)) continue;

    const usageLeft = toNumber(modelData.usage_left);
    if (usageLeft !== undefined) {
      if (minUsageLeft === undefined || usageLeft < minUsageLeft) {
        minUsageLeft = usageLeft;
      }
    }

    if (modelData.reset_period === '24h') {
      hasResetPeriod24h = true;
    }
  }

  if (minUsageLeft === undefined) return {};

  // Convert usage_left to utilization (100 - usage_left)
  const dailyUtilization = 100 - Math.max(0, Math.min(100, minUsageLeft));

  const result: UtilizationOverrides = {
    daily_utilization: dailyUtilization,
  };

  // If we have a 24h reset period, calculate approximate reset time (midnight UTC or similar)
  if (hasResetPeriod24h) {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    result.daily_reset_at = tomorrow.toISOString();
  }

  return result;
}

function extractUtilizationFromRaw(raw: Record<string, unknown> | undefined, provider?: string): UtilizationOverrides {
  if (!raw || !isRecord(raw)) return {};

  // Handle Gemini CLI provider
  if (provider === 'gemini_cli') {
    return extractGeminiUtilization(raw);
  }

  const readUtil = (entry: unknown): number | undefined => {
    if (!isRecord(entry)) return undefined;
    return coercePercent(entry.utilization);
  };

  return {
    five_hour_utilization: readUtil(raw.five_hour),
    weekly_utilization: readUtil(raw.weekly ?? raw.seven_day),
    weekly_opus_utilization: readUtil(raw.seven_day_opus),
    weekly_sonnet_utilization: readUtil(raw.seven_day_sonnet),
  };
}

function extractUsage(source: Record<string, unknown>): TokenUsagePayload {
  const tokensIn =
    toNumber(source.input_tokens) ??
    toNumber(source.prompt_tokens) ??
    toNumber(source.inputTokens) ??
    toNumber(source.promptTokens);
  const tokensOut =
    toNumber(source.output_tokens) ??
    toNumber(source.completion_tokens) ??
    toNumber(source.outputTokens) ??
    toNumber(source.completionTokens);
  const cacheRead =
    toNumber(source.cache_read_input_tokens) ??
    toNumber(source.cache_read_tokens) ??
    toNumber(source.cacheReadInputTokens) ??
    toNumber(source.cacheReadTokens);
  const cacheWrite =
    toNumber(source.cache_creation_input_tokens) ??
    toNumber(source.cache_creation_tokens) ??
    toNumber(source.cacheWriteInputTokens) ??
    toNumber(source.cacheWriteTokens);

  return {
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    tokens_cache_read: cacheRead,
    tokens_cache_write: cacheWrite,
  };
}

function extractTokenUsage(payload: Record<string, unknown>): TokenUsagePayload | null {
  if (!payload || typeof payload !== 'object') return null;

  const toolName =
    typeof payload.tool_name === 'string'
      ? payload.tool_name
      : isRecord(payload.tool) && typeof payload.tool.name === 'string'
        ? payload.tool.name
        : undefined;

  const usageCandidates: Record<string, unknown>[] = [];
  if (isRecord(payload.usage)) usageCandidates.push(payload.usage);
  if (isRecord(payload.token_usage)) usageCandidates.push(payload.token_usage);
  if (isRecord(payload.hook_data) && isRecord(payload.hook_data.usage)) {
    usageCandidates.push(payload.hook_data.usage);
  }
  if (isRecord(payload.result) && isRecord(payload.result.usage)) {
    usageCandidates.push(payload.result.usage);
  }
  if (isRecord(payload.item) && isRecord(payload.item.usage)) {
    usageCandidates.push(payload.item.usage);
  }
  if (isRecord(payload.response) && isRecord(payload.response.usage)) {
    usageCandidates.push(payload.response.usage);
  }

  let usage: TokenUsagePayload | null = null;
  for (const candidate of usageCandidates) {
    const extracted = extractUsage(candidate);
    if (
      extracted.tokens_in !== undefined ||
      extracted.tokens_out !== undefined ||
      extracted.tokens_cache_read !== undefined ||
      extracted.tokens_cache_write !== undefined
    ) {
      usage = extracted;
      break;
    }
  }

  if (!usage) {
    const extracted = extractUsage(payload);
    if (
      extracted.tokens_in !== undefined ||
      extracted.tokens_out !== undefined ||
      extracted.tokens_cache_read !== undefined ||
      extracted.tokens_cache_write !== undefined
    ) {
      usage = extracted;
    }
  }

  if (!usage && !toolName) return null;

  return {
    ...usage,
    tool_name: toolName,
  };
}
