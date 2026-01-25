import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ulid } from 'ulid';
import { randomUUID } from 'node:crypto';
import { CommandRequestSchema, CommandPayloadSchema, CommandsDispatchMessageSchema, UpdateSessionRequestSchema, BulkOperationRequestSchema, CopyToSessionPayloadSchema } from '@agent-command/schema';
import * as db from '../db/index.js';
import { pubsub } from '../services/pubsub.js';
import { consoleSubscriptions } from '../services/consoleSubscriptions.js';
import { hasRole } from '../auth/rbac.js';

// Pending command result tracking for cross-host operations
const pendingCommandResults = new Map<string, {
  resolve: (value: { ok: boolean; result?: Record<string, unknown>; error?: { code: string; message: string } }) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}>();

// Called by agent WebSocket handler when a command result is received
export function handleCommandResultForPending(
  cmdId: string,
  result: { ok: boolean; result?: Record<string, unknown>; error?: { code: string; message: string } }
): boolean {
  const pending = pendingCommandResults.get(cmdId);
  if (!pending) return false;

  clearTimeout(pending.timeout);
  pendingCommandResults.delete(cmdId);
  pending.resolve(result);
  return true;
}

// Helper to send command to agent and wait for result
async function sendCommandAndWait(
  hostId: string,
  sessionId: string,
  cmdId: string,
  command: { type: string; payload: unknown },
  timeoutMs = 30000
): Promise<{ ok: boolean; result?: Record<string, unknown>; error?: { code: string; message: string } }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingCommandResults.delete(cmdId);
      reject(new Error('Command timed out'));
    }, timeoutMs);

    pendingCommandResults.set(cmdId, { resolve, reject, timeout });

    const dispatchMessage = CommandsDispatchMessageSchema.parse({
      v: 1,
      type: 'commands.dispatch',
      ts: new Date().toISOString(),
      payload: {
        cmd_id: cmdId,
        session_id: sessionId,
        command,
      },
    });

    const sent = pubsub.sendToAgent(hostId, dispatchMessage);
    if (!sent) {
      clearTimeout(timeout);
      pendingCommandResults.delete(cmdId);
      reject(new Error('Agent not connected'));
    }
  });
}

// Query schemas
const SessionsQuerySchema = z.object({
  host_id: z.string().uuid().optional(),
  status: z.string().optional(),
  provider: z.string().optional(),
  q: z.string().min(1).optional(),
  needs_attention: z
    .string()
    .transform((v) => v === 'true')
    .optional(),
  group_id: z
    .string()
    .transform((v) => (v === 'null' ? null : v))
    .optional(),
  ungrouped: z
    .string()
    .transform((v) => v === 'true')
    .optional(),
  include_archived: z
    .string()
    .transform((v) => v === 'true')
    .optional(),
  archived_only: z
    .string()
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().min(1).max(200).optional(),
  offset: z.coerce.number().min(0).optional(),
});

const EventsQuerySchema = z.object({
  cursor: z.coerce.number().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
});

const SessionUsageQuerySchema = z.object({
  session_ids: z.string().optional(),
});

export function registerSessionRoutes(app: FastifyInstance): void {
  // GET /v1/sessions - List sessions with filters
  app.get('/v1/sessions', async (request, reply) => {
    const query = SessionsQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: 'Invalid query parameters' });
    }

    const { status, ...rest } = query.data;
    const statusList = status
      ? status
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;

    const filters = {
      ...rest,
      status: statusList && statusList.length > 0 ? statusList : undefined,
      group_id: query.data.ungrouped ? null : query.data.group_id,
      include_ungrouped: query.data.ungrouped,
      include_archived: query.data.include_archived,
      archived_only: query.data.archived_only,
    };

    const hasPagination = typeof query.data.limit === 'number' || typeof query.data.offset === 'number';
    const paginationLimit = query.data.limit ?? 20;
    const paginationOffset = query.data.offset ?? 0;

    const { sessions, total } = hasPagination
      ? await db.getSessionsPage({
          ...filters,
          limit: paginationLimit,
          offset: paginationOffset,
        })
      : { sessions: await db.getSessions(filters), total: undefined };

    // Fetch latest snapshots in bulk to avoid N+1 queries
    const snapshotRows = await db.getLatestSnapshots(sessions.map((session) => session.id));
    const snapshotBySession = new Map(snapshotRows.map((row) => [row.session_id, row]));
    const sessionsWithSnapshots = sessions.map((session) => {
      const snapshot = snapshotBySession.get(session.id);
      return {
        ...session,
        latest_snapshot: snapshot
          ? {
              created_at: snapshot.created_at,
              capture_text: snapshot.capture_text,
            }
          : null,
      };
    });

    return {
      sessions: sessionsWithSnapshots,
      ...(hasPagination ? { total, limit: paginationLimit, offset: paginationOffset } : {}),
    };
  });

  // GET /v1/sessions/:id - Get session detail
  app.get<{ Params: { id: string } }>('/v1/sessions/:id', async (request, reply) => {
    const { id } = request.params;

    if (!z.string().uuid().safeParse(id).success) {
      return reply.status(400).send({ error: 'Invalid session ID' });
    }

    const result = await db.getSessionWithSnapshot(id);
    if (!result) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    return result;
  });

  // GET /v1/sessions/:id/events - Get session events with pagination
  app.get<{ Params: { id: string }; Querystring: unknown }>(
    '/v1/sessions/:id/events',
    async (request, reply) => {
      const { id } = request.params;

      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ error: 'Invalid session ID' });
      }

      const query = EventsQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.status(400).send({ error: 'Invalid query parameters' });
      }

      const events = await db.getEvents(id, query.data.cursor, query.data.limit);
      const nextCursor = events.length > 0 ? events[events.length - 1]?.id : undefined;

      return { events, next_cursor: nextCursor };
    }
  );

  // GET /v1/sessions/:id/tool-events - Get tool events timeline
  const ToolEventsQuerySchema = z.object({
    cursor: z.string().optional(),
    limit: z.coerce.number().min(1).max(100).default(50),
  });

  app.get<{ Params: { id: string }; Querystring: unknown }>(
    '/v1/sessions/:id/tool-events',
    async (request, reply) => {
      const { id } = request.params;

      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ error: 'Invalid session ID' });
      }

      const query = ToolEventsQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.status(400).send({ error: 'Invalid query parameters' });
      }

      const result = await db.getToolEvents(id, query.data.cursor, query.data.limit);
      return result;
    }
  );

  // GET /v1/sessions/:id/tool-stats - Get tool usage statistics
  app.get<{ Params: { id: string } }>(
    '/v1/sessions/:id/tool-stats',
    async (request, reply) => {
      const { id } = request.params;

      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ error: 'Invalid session ID' });
      }

      const stats = await db.getToolStats(id);
      return { stats };
    }
  );

  // GET /v1/sessions/usage-latest - Get latest usage for sessions
  app.get('/v1/sessions/usage-latest', async (request, reply) => {
    const query = SessionUsageQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: 'Invalid query parameters' });
    }

    const sessionIds = query.data.session_ids
      ? query.data.session_ids.split(',').map((id) => id.trim()).filter(Boolean)
      : undefined;

    const usage = await db.getSessionUsageLatest(sessionIds);
    return { usage };
  });

  // POST /v1/sessions/:id/commands - Dispatch command to agent
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/v1/sessions/:id/commands',
    async (request, reply) => {
      if (!request.user || !hasRole(request.user, 'operator')) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      const { id: sessionId } = request.params;

      if (!z.string().uuid().safeParse(sessionId).success) {
        return reply.status(400).send({ error: 'Invalid session ID' });
      }

      const bodyResult = CommandRequestSchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({ error: 'Invalid command', details: bodyResult.error });
      }

      const payloadResult = CommandPayloadSchema.safeParse({
        type: bodyResult.data.type,
        payload: bodyResult.data.payload || {},
      });
      if (!payloadResult.success) {
        return reply.status(400).send({ error: 'Invalid command payload', details: payloadResult.error });
      }

      const session = await db.getSessionById(sessionId);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      const cmdId = ulid();

      // Build command dispatch message
      const dispatchMessage = CommandsDispatchMessageSchema.parse({
        v: 1,
        type: 'commands.dispatch',
        ts: new Date().toISOString(),
        payload: {
          cmd_id: cmdId,
          session_id: sessionId,
          command: {
            type: payloadResult.data.type,
            payload: payloadResult.data.payload,
          },
        },
      });

      // Send to agent
      const sent = pubsub.sendToAgent(session.host_id, dispatchMessage);
      if (!sent) {
        return reply.status(503).send({ error: 'Agent not connected' });
      }

      if (payloadResult.data.type === 'console.subscribe') {
        const { subscription_id, pane_id } = payloadResult.data.payload as {
          subscription_id: string;
          pane_id: string;
        };
        consoleSubscriptions.add({
          subscriptionId: subscription_id,
          sessionId,
          hostId: session.host_id,
          paneId: pane_id,
        });
      }
      if (payloadResult.data.type === 'console.unsubscribe') {
        const { subscription_id } = payloadResult.data.payload as { subscription_id: string };
        consoleSubscriptions.remove(subscription_id);
      }

      // Log audit
      await db.createAuditLog(
        'command.dispatch',
        'session',
        sessionId,
        { cmd_id: cmdId, command: bodyResult.data }
        // TODO: Add user ID from auth
      );

      return { cmd_id: cmdId };
    }
  );

  // PATCH /v1/sessions/:id - Update session (title, etc.)
  app.patch<{ Params: { id: string }; Body: unknown }>(
    '/v1/sessions/:id',
    async (request, reply) => {
      if (!request.user || !hasRole(request.user, 'operator')) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      const { id } = request.params;

      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ error: 'Invalid session ID' });
      }

      const bodyResult = UpdateSessionRequestSchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({ error: 'Invalid request body', details: bodyResult.error });
      }

      const updates: { title?: string; idled_at?: string | null } = {};
      if (bodyResult.data.title !== undefined) {
        updates.title = bodyResult.data.title;
      }
      if (bodyResult.data.idle !== undefined) {
        updates.idled_at = bodyResult.data.idle ? new Date().toISOString() : null;
      }

      const session = await db.updateSession(id, updates);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      // Log audit
      await db.createAuditLog('session.update', 'session', id, { updates: bodyResult.data });

      // Broadcast the update via pubsub
      pubsub.publishSessionsChanged([session]);

      return { session };
    }
  );

  // DELETE /v1/sessions/:id - Delete session
  app.delete<{ Params: { id: string } }>('/v1/sessions/:id', async (request, reply) => {
    if (!request.user || !hasRole(request.user, 'operator')) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const { id } = request.params;

    if (!z.string().uuid().safeParse(id).success) {
      return reply.status(400).send({ error: 'Invalid session ID' });
    }

    const session = await db.getSessionById(id);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    await db.deleteSession(id);

    // Log audit
    await db.createAuditLog('session.delete', 'session', id, { session });

    return { success: true };
  });

  // POST /v1/sessions/:id/fork - Fork session to new tmux window
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/v1/sessions/:id/fork',
    async (request, reply) => {
      if (!request.user || !hasRole(request.user, 'operator')) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const { id: sessionId } = request.params;

      if (!z.string().uuid().safeParse(sessionId).success) {
        return reply.status(400).send({ error: 'Invalid session ID' });
      }

      const ForkRequestSchema = z.object({
        branch: z.string().optional(),
        cwd: z.string().optional(),
        provider: z.enum(['claude_code', 'codex', 'opencode', 'shell']).optional(),
        note: z.string().optional(),
        group_id: z.string().uuid().optional(),
      });

      const bodyResult = ForkRequestSchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({ error: 'Invalid request body', details: bodyResult.error });
      }

      const session = await db.getSessionById(sessionId);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      const cmdId = ulid();

      // Build fork command dispatch
      const dispatchMessage = CommandsDispatchMessageSchema.parse({
        v: 1,
        type: 'commands.dispatch',
        ts: new Date().toISOString(),
        payload: {
          cmd_id: cmdId,
          session_id: sessionId,
          command: {
            type: 'fork',
            payload: bodyResult.data,
          },
        },
      });

      // Send to agent
      const sent = pubsub.sendToAgent(session.host_id, dispatchMessage);
      if (!sent) {
        return reply.status(503).send({ error: 'Agent not connected' });
      }

      // Log audit
      await db.createAuditLog(
        'session.fork',
        'session',
        sessionId,
        { cmd_id: cmdId, fork_options: bodyResult.data }
      );

      return { cmd_id: cmdId };
    }
  );

  // POST /v1/sessions/:id/copy-to - Copy content to another session
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/v1/sessions/:id/copy-to',
    async (request, reply) => {
      if (!request.user || !hasRole(request.user, 'operator')) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const { id: sourceSessionId } = request.params;

      if (!z.string().uuid().safeParse(sourceSessionId).success) {
        return reply.status(400).send({ error: 'Invalid source session ID' });
      }

      const bodyResult = CopyToSessionPayloadSchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({ error: 'Invalid request body', details: bodyResult.error });
      }

      const { target_session_id, ...captureOpts } = bodyResult.data;

      // Get both sessions
      const [sourceSession, targetSession] = await Promise.all([
        db.getSessionById(sourceSessionId),
        db.getSessionById(target_session_id),
      ]);

      if (!sourceSession) {
        return reply.status(404).send({ error: 'Source session not found' });
      }
      if (!targetSession) {
        return reply.status(404).send({ error: 'Target session not found' });
      }

      const sameHost = sourceSession.host_id === targetSession.host_id;
      const cmdId = ulid();

      if (sameHost) {
        // Same host - dispatch copy_to_session command directly
        const dispatchMessage = CommandsDispatchMessageSchema.parse({
          v: 1,
          type: 'commands.dispatch',
          ts: new Date().toISOString(),
          payload: {
            cmd_id: cmdId,
            session_id: sourceSessionId,
            command: {
              type: 'copy_to_session',
              payload: bodyResult.data,
            },
          },
        });

        const sent = pubsub.sendToAgent(sourceSession.host_id, dispatchMessage);
        if (!sent) {
          return reply.status(503).send({ error: 'Source agent not connected' });
        }
      } else {
        // Cross-host - capture from source, send to target
        try {
          // Step 1: Capture from source session
          const captureResult = await sendCommandAndWait(
            sourceSession.host_id,
            sourceSessionId,
            cmdId,
            {
              type: 'capture_pane',
              payload: {
                mode: captureOpts.mode,
                line_start: captureOpts.line_start,
                line_end: captureOpts.line_end,
                last_n_lines: captureOpts.last_n_lines,
                strip_ansi: captureOpts.strip_ansi,
              },
            }
          );

          if (!captureResult.ok || !captureResult.result?.content) {
            return reply.status(500).send({
              error: 'Failed to capture content from source session',
              details: captureResult.error,
            });
          }

          const content = captureResult.result.content as string;

          // Step 2: Build combined prompt with prepend/append
          let combined = '';
          if (captureOpts.prepend_text) {
            combined += captureOpts.prepend_text + '\n\n---\n\n';
          }
          combined += content;
          if (captureOpts.append_text) {
            combined += '\n\n---\n\n' + captureOpts.append_text;
          }

          // Step 3: Send to target session
          const sendCmdId = ulid();
          const sendMessage = CommandsDispatchMessageSchema.parse({
            v: 1,
            type: 'commands.dispatch',
            ts: new Date().toISOString(),
            payload: {
              cmd_id: sendCmdId,
              session_id: target_session_id,
              command: {
                type: 'send_input',
                payload: {
                  text: combined,
                  enter: true,
                },
              },
            },
          });

          const sent = pubsub.sendToAgent(targetSession.host_id, sendMessage);
          if (!sent) {
            return reply.status(503).send({ error: 'Target agent not connected' });
          }
        } catch (error) {
          return reply.status(503).send({ error: (error as Error).message });
        }
      }

      // Log audit
      await db.createAuditLog(
        'session.copy_to',
        'session',
        sourceSessionId,
        {
          cmd_id: cmdId,
          target_session_id,
          mode: captureOpts.mode,
          same_host: sameHost,
        }
      );

      return { cmd_id: cmdId, cross_host: !sameHost };
    }
  );

  // POST /v1/sessions/bulk - Bulk operations
  app.post<{ Body: unknown }>('/v1/sessions/bulk', async (request, reply) => {
    if (!request.user || !hasRole(request.user, 'operator')) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const bodyResult = BulkOperationRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: bodyResult.error });
    }

    const { operation, session_ids, group_id } = bodyResult.data;
    let result: db.BulkOperationResult;

    const bulkTerminateSessions = async (ids: string[]): Promise<db.BulkOperationResult> => {
      const errors: db.BulkOperationError[] = [];
      let successCount = 0;

      const sessions = await db.getSessionsByIds(ids);
      const sessionById = new Map(sessions.map((session) => [session.id, session]));
      const archivedIds: string[] = [];

      for (const id of ids) {
        const session = sessionById.get(id);
        if (!session) {
          errors.push({ session_id: id, error: 'Session not found' });
          continue;
        }

        const cmdId = ulid();
        const dispatchMessage = CommandsDispatchMessageSchema.parse({
          v: 1,
          type: 'commands.dispatch',
          ts: new Date().toISOString(),
          payload: {
            cmd_id: cmdId,
            session_id: id,
            command: {
              type: 'kill_session',
              payload: {},
            },
          },
        });

        const sent = pubsub.sendToAgent(session.host_id, dispatchMessage);
        if (!sent) {
          errors.push({ session_id: id, error: 'Agent not connected' });
          continue;
        }

        archivedIds.push(id);
        successCount++;
      }

      if (archivedIds.length > 0) {
        await db.archiveSessions(archivedIds);
      }

      return { success_count: successCount, error_count: errors.length, errors };
    };

    if (operation === 'assign_group') {
      if (group_id === undefined) {
        return reply.status(400).send({ error: 'group_id is required for assign_group' });
      }
      if (group_id) {
        const group = await db.getGroupById(group_id);
        if (!group) {
          return reply.status(404).send({ error: 'Group not found' });
        }
      }
    }

    switch (operation) {
      case 'delete':
        result = await db.bulkDeleteSessions(session_ids);
        break;
      case 'archive':
        result = await db.bulkArchiveSessions(session_ids);
        break;
      case 'unarchive':
        result = await db.bulkUnarchiveSessions(session_ids);
        break;
      case 'assign_group':
        result = await db.bulkAssignGroup(session_ids, group_id ?? null);
        break;
      case 'idle':
        result = await db.bulkIdleSessions(session_ids);
        break;
      case 'unidle':
        result = await db.bulkUnidleSessions(session_ids);
        break;
      case 'terminate':
        result = await bulkTerminateSessions(session_ids);
        break;
      default:
        return reply.status(400).send({ error: 'Unknown operation' });
    }

    // Log audit
    await db.createAuditLog('sessions.bulk', 'sessions', 'bulk', {
      operation,
      session_ids,
      group_id,
      result,
    });

    const failedIds = new Set(result.errors.map((error) => error.session_id));
    const successIds = session_ids.filter((id) => !failedIds.has(id));

    if (operation === 'delete') {
      if (successIds.length > 0) {
        pubsub.publishSessionsChanged([], successIds);
      }
    } else if (successIds.length > 0) {
      const updatedSessions = await db.getSessionsByIds(successIds);
      if (updatedSessions.length > 0) {
        pubsub.publishSessionsChanged(updatedSessions);
      }
    }

    return {
      operation,
      success_count: result.success_count,
      error_count: result.error_count,
      errors: result.errors.length > 0 ? result.errors : undefined,
    };
  });

  // POST /v1/sessions/spawn - Spawn a new session from dashboard
  const DashboardSpawnRequestSchema = z.object({
    host_id: z.string().uuid(),
    provider: z.enum(['claude_code', 'codex', 'gemini_cli', 'opencode', 'aider', 'shell']),
    working_directory: z.string().min(1),
    title: z.string().optional(),
    flags: z.array(z.string()).optional(),
    group_id: z.string().uuid().optional(),
  });

  app.post<{ Body: unknown }>('/v1/sessions/spawn', async (request, reply) => {
    if (!request.user || !hasRole(request.user, 'operator')) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const bodyResult = DashboardSpawnRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: bodyResult.error });
    }

    const { host_id, provider, working_directory, title, flags, group_id } = bodyResult.data;

    // Verify host exists
    const host = await db.getHostById(host_id);
    if (!host) {
      return reply.status(404).send({ error: 'Host not found' });
    }

    // Check if host allows spawning (could add a flag to host capabilities)
    const capabilities = host.capabilities as Record<string, unknown> | null;
    if (capabilities?.spawn === false) {
      return reply.status(403).send({ error: 'Host does not allow remote session spawning' });
    }

    // Check if agent is connected
    if (!pubsub.isAgentConnected(host_id)) {
      return reply.status(503).send({ error: 'Host is offline' });
    }

    // Create session record with STARTING status
    const sessionId = randomUUID();
    let session = await db.upsertSession(host_id, {
      id: sessionId,
      kind: 'tmux_pane',
      provider,
      status: 'STARTING',
      title: title || `${provider} session`,
      cwd: working_directory,
    });

    // Track project usage for autocomplete
    try {
      await db.touchProject({
        user_id: request.user.sub,
        host_id,
        path: working_directory,
        display_name: title || null,
      });
    } catch {
      // Ignore project tracking errors
    }

    // Assign to group if specified
    if (group_id) {
      const updated = await db.assignSessionGroup(sessionId, group_id);
      if (updated) {
        session = updated;
      }
    }

    // Dispatch spawn command to agent
    const cmdId = ulid();
    const dispatchMessage = CommandsDispatchMessageSchema.parse({
      v: 1,
      type: 'commands.dispatch',
      ts: new Date().toISOString(),
      payload: {
        cmd_id: cmdId,
        session_id: sessionId,
        command: {
          type: 'spawn_session',
          payload: {
            provider,
            working_directory,
            title,
            flags,
            group_id,
          },
        },
      },
    });

    const sent = pubsub.sendToAgent(host_id, dispatchMessage);
    if (!sent) {
      return reply.status(503).send({ error: 'Failed to send command to agent' });
    }

    // Publish session created
    pubsub.publishSessionsChanged([session]);

    // Log audit
    await db.createAuditLog('session.spawn', 'session', sessionId, {
      cmd_id: cmdId,
      host_id,
      provider,
      working_directory,
    });

    return { session, cmd_id: cmdId };
  });
}
