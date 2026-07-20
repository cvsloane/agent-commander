import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { CommandRequestSchema, CommandPayloadSchema, UpdateSessionRequestSchema, BulkOperationRequestSchema, CopyToSessionPayloadSchema, DashboardSpawnRequestSchema, SCROLLBACK_MAX_LINES, ScrollbackRequestSchema, ScrollbackResponseSchema } from '@agent-command/schema';
import * as db from '../db/index.js';
import { sessionGraph } from '../db/sessionGraph.js';
import { agentTasks } from '../db/agentTasks.js';
import { pubsub } from '../services/pubsub.js';
import { consoleSubscriptions } from '../services/consoleSubscriptions.js';
import { spawnSessionOnHost } from '../services/sessionSpawn.js';
import { bootstrapSessionMemory, prepareSessionMemoryForSpawn } from '../services/sessionMemory.js';
import { hasRole } from '../auth/rbac.js';
import { commandRouter } from '../services/commandRouter.js';
import { hostSupportsTmuxCommands } from '../services/terminalPolicy.js';
import {
  fingerprintIdempotentRequest,
  getIdempotencyKey,
  IdempotencyConflictError,
  InvalidIdempotencyKeyError,
  scopeIdempotencyKey,
} from '../services/idempotency.js';

const PRIVILEGED_COMMAND_TYPES = new Set([
  'spawn_session',
  'spawn_job',
  'list_directory',
  'kill_session',
]);

const TMUX_COMMAND_TYPES = new Set([
  'new_window',
  'kill_window',
  'rename_window',
  'split_pane',
  'select_window',
  'select_pane',
  'resize_pane',
  'zoom_pane',
]);

function capScrollbackResult(
  result: Awaited<ReturnType<typeof commandRouter.dispatchAndWait>>
): Awaited<ReturnType<typeof commandRouter.dispatchAndWait>> {
  const content = result.result?.content;
  if (typeof content !== 'string') return result;

  const hadTrailingNewline = content.endsWith('\n');
  const lines = content.split('\n');
  if (hadTrailingNewline) lines.pop();
  if (lines.length <= SCROLLBACK_MAX_LINES) return result;

  return {
    ...result,
    result: {
      ...result.result,
      content: `${lines.slice(-SCROLLBACK_MAX_LINES).join('\n')}${hadTrailingNewline ? '\n' : ''}`,
      truncated: true,
    },
  };
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

type SessionsQuery = z.infer<typeof SessionsQuerySchema>;

function normalizeSessionFilters(query: SessionsQuery): Parameters<typeof db.getSessions>[0] {
  const { status, limit: _limit, offset: _offset, ...rest } = query;
  const statusList = status
    ? status
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  return {
    ...rest,
    status: statusList && statusList.length > 0 ? statusList : undefined,
    group_id: query.ungrouped ? null : query.group_id,
    include_ungrouped: query.ungrouped,
    include_archived: query.include_archived,
    archived_only: query.archived_only,
  };
}

export function registerSessionRoutes(app: FastifyInstance): void {
  // GET /v1/sessions - List sessions with filters
  app.get('/v1/sessions', async (request, reply) => {
    const query = SessionsQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: 'Invalid query parameters' });
    }

    const filters = normalizeSessionFilters(query.data);

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
              capture_hash: snapshot.capture_hash,
            }
          : null,
      };
    });

    return {
      sessions: sessionsWithSnapshots,
      ...(hasPagination ? { total, limit: paginationLimit, offset: paginationOffset } : {}),
    };
  });

  // GET /v1/sessions/total - Count sessions with filters
  app.get('/v1/sessions/total', async (request, reply) => {
    const query = SessionsQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: 'Invalid query parameters' });
    }

    const filters = normalizeSessionFilters(query.data);
    const total = await db.getSessionsTotal(filters);
    return { total };
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

  // GET /v1/sessions/:id/graph - Get connected edges and direct-child rollups
  app.get<{ Params: { id: string } }>(
    '/v1/sessions/:id/graph',
    async (request, reply) => {
      const { id } = request.params;
      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ error: 'Invalid session ID' });
      }
      const session = await db.getSessionById(id);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      const [edges, rollup] = await Promise.all([
        sessionGraph.list(id),
        sessionGraph.rollup(id),
      ]);
      return { session_id: id, edges, rollup };
    }
  );

  // GET /v1/sessions/:id/agent-tasks - Get in-process provider subagents
  app.get<{ Params: { id: string } }>(
    '/v1/sessions/:id/agent-tasks',
    async (request, reply) => {
      const { id } = request.params;
      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ error: 'Invalid session ID' });
      }
      const session = await db.getSessionById(id);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      return {
        session_id: id,
        agent_tasks: await agentTasks.list(id),
      };
    }
  );

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

      if (PRIVILEGED_COMMAND_TYPES.has(payloadResult.data.type)) {
        return reply.status(403).send({
          error: `${payloadResult.data.type} must use a dedicated policy-checked endpoint`,
        });
      }

      if (TMUX_COMMAND_TYPES.has(payloadResult.data.type)) {
        const host = await db.getHostById(session.host_id);
        if (!hostSupportsTmuxCommands(host)) {
          return reply.status(403).send({
            error: 'Host does not support tmux terminal commands',
          });
        }
      }

      const cmdId = randomUUID();
      const sent = await commandRouter.dispatch(session.host_id, sessionId, cmdId, {
        type: payloadResult.data.type,
        payload: payloadResult.data.payload,
      });
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
        { cmd_id: cmdId, command: bodyResult.data },
        request.user.id
      );

      return { cmd_id: cmdId };
    }
  );

  // POST /v1/sessions/:id/scrollback - Capture bounded pane history
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/v1/sessions/:id/scrollback',
    async (request, reply) => {
      if (!request.user || !hasRole(request.user, 'operator')) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      const { id: sessionId } = request.params;
      if (!z.string().uuid().safeParse(sessionId).success) {
        return reply.status(400).send({ error: 'Invalid session ID' });
      }

      const body = ScrollbackRequestSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: 'Invalid scrollback request', details: body.error });
      }

      const session = await db.getSessionById(sessionId);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      const host = await db.getHostById(session.host_id);
      if (!hostSupportsTmuxCommands(host)) {
        return reply.status(403).send({
          error: 'Host does not support tmux terminal commands',
        });
      }

      const cmdId = randomUUID();
      try {
        const result = capScrollbackResult(await commandRouter.dispatchAndWait(
          session.host_id,
          sessionId,
          cmdId,
          {
            type: 'capture_pane',
            payload: {
              mode: body.data.mode,
              ...(body.data.last_n_lines !== undefined
                ? { last_n_lines: body.data.last_n_lines }
                : {}),
              ...(body.data.start_line !== undefined
                ? { line_start: body.data.start_line }
                : {}),
              ...(body.data.end_line !== undefined
                ? { line_end: body.data.end_line }
                : {}),
              strip_ansi: body.data.strip_ansi,
            },
          }
        ));
        const response = ScrollbackResponseSchema.parse({ cmd_id: cmdId, ...result });
        await db.createAuditLog(
          'session.scrollback',
          'session',
          sessionId,
          { cmd_id: cmdId, request: body.data },
          request.user.id
        );
        return response;
      } catch (error) {
        return reply.status(503).send({ error: (error as Error).message });
      }
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

      if (
        bodyResult.data.title !== undefined
        && pubsub.isAgentConnected(session.host_id)
      ) {
        const cmdId = randomUUID();
        try {
          const sent = await commandRouter.dispatch(session.host_id, id, cmdId, {
            type: 'rename_session',
            payload: { title: bodyResult.data.title },
          });
          if (!sent) {
            request.log.warn(
              { host_id: session.host_id, session_id: id, cmd_id: cmdId },
              'Session title was persisted, but the owning agent disconnected before rename'
            );
          }
        } catch (error) {
          request.log.warn(
            { err: error, host_id: session.host_id, session_id: id, cmd_id: cmdId },
            'Session title was persisted, but agent rename dispatch failed'
          );
        }
      }

      // Log audit
      await db.createAuditLog('session.update', 'session', id, { updates: bodyResult.data }, request.user.id);

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
    await db.createAuditLog('session.delete', 'session', id, { session }, request.user.id);

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

      const cmdId = randomUUID();
      const sent = await commandRouter.dispatch(session.host_id, sessionId, cmdId, {
        type: 'fork',
        payload: bodyResult.data,
      });
      if (!sent) {
        return reply.status(503).send({ error: 'Agent not connected' });
      }

      const backfilled = await sessionGraph.backfillForkEdges(sessionId);
      if (backfilled.length > 0) {
        pubsub.publishSessionEdgesChanged(sessionId, backfilled);
      }

      // Log audit
      await db.createAuditLog(
        'session.fork',
        'session',
        sessionId,
        { cmd_id: cmdId, fork_options: bodyResult.data },
        request.user.id
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
      const cmdId = randomUUID();

      if (sameHost) {
        // Same host - dispatch copy_to_session command directly
        const sent = await commandRouter.dispatch(sourceSession.host_id, sourceSessionId, cmdId, {
          type: 'copy_to_session',
          payload: bodyResult.data,
        });
        if (!sent) {
          return reply.status(503).send({ error: 'Source agent not connected' });
        }
      } else {
        // Cross-host - capture from source, send to target
        try {
          // Step 1: Capture from source session
          const captureResult = await commandRouter.dispatchAndWait(
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
          const sendCmdId = randomUUID();
          const sent = await commandRouter.dispatch(targetSession.host_id, target_session_id, sendCmdId, {
            type: 'send_input',
            payload: {
              text: combined,
              enter: true,
            },
          });
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
        },
        request.user.id
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

        const cmdId = randomUUID();
        const sent = await commandRouter.dispatch(session.host_id, id, cmdId, {
          type: 'kill_session',
          payload: {},
        });
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
    }, request.user.id);

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
  app.post<{ Body: unknown }>('/v1/sessions/spawn', async (request, reply) => {
    if (!request.user || !hasRole(request.user, 'operator')) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    let rawIdempotencyKey: string | undefined;
    try {
      rawIdempotencyKey = getIdempotencyKey(request.headers['idempotency-key']);
    } catch (error) {
      if (error instanceof InvalidIdempotencyKeyError) {
        return reply.status(400).send({ error: error.message });
      }
      throw error;
    }

    const bodyResult = DashboardSpawnRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: bodyResult.error });
    }

    const {
      host_id,
      provider,
      working_directory,
      title,
      flags,
      group_id,
      parent_session_id,
      role,
      tmux,
    } = bodyResult.data;
    const idempotencyKey = scopeIdempotencyKey(
      rawIdempotencyKey,
      'sessions.spawn',
      request.user.id
    );
    const idempotencyFingerprint = rawIdempotencyKey
      ? fingerprintIdempotentRequest(bodyResult.data)
      : undefined;

    try {
      const memoryPlan = await prepareSessionMemoryForSpawn({
        user_id: request.user.id,
        provider,
        host_id,
        working_directory,
        source: 'automatic',
      });
      const result = await spawnSessionOnHost({
        actorUserId: request.user.id,
        host_id,
        provider,
        working_directory,
        repo_id: memoryPlan.repoId,
        memory_files: memoryPlan.memoryFiles,
        title,
        flags,
        group_id,
        parent_session_id,
        role,
        tmux,
        idempotencyKey,
        idempotencyFingerprint,
      });
      if (!result.queued && !result.replayed) {
        void bootstrapSessionMemory({
          host_id,
          session_id: result.session.id,
          source: 'automatic',
        }).catch((error) => {
          request.log.warn({ error, sessionId: result.session.id }, 'Failed to bootstrap session memory');
        });
      }
      return { session: result.session, cmd_id: result.cmd_id };
    } catch (error) {
      const message = (error as Error).message;
      const status =
        error instanceof IdempotencyConflictError
          || message === 'Idempotency-Key was used with a different request' ? 409
        : message === 'Host not found' ? 404
        : message === 'Parent session not found' ? 404
        : message === 'Host does not allow remote session spawning' ? 403
        : message.startsWith('Host does not advertise provider support') ? 400
        : message === 'Host is offline' || message === 'Failed to send command to agent' ? 503
        : 500;
      return reply.status(status).send({ error: message });
    }
  });
}
