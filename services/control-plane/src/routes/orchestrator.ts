import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  OrchestratorMemorySearchQuerySchema,
  OrchestratorMemoryWriteRequestSchema,
  OrchestratorSendInputRequestSchema,
  OrchestratorSpawnWorkerRequestSchema,
  OrchestratorWorkItemClaimRequestSchema,
  OrchestratorWorkItemCompleteRequestSchema,
  OrchestratorWorkItemsQuerySchema,
  type Session,
} from '@agent-command/schema';
import * as db from '../db/index.js';
import * as automationDb from '../db/automationMemory.js';
import { sessionGraph } from '../db/sessionGraph.js';
import { agentTasks } from '../db/agentTasks.js';
import { mintSessionToken } from '../auth/verify.js';
import { pubsub } from '../services/pubsub.js';
import {
  prepareSessionMemoryForSpawn,
} from '../services/sessionMemory.js';
import {
  queueInputToSession,
  spawnSessionOnHost,
} from '../services/sessionSpawn.js';
import {
  fingerprintIdempotentRequest,
  getIdempotencyKey,
  IdempotencyConflictError,
  InvalidIdempotencyKeyError,
  scopeIdempotencyKey,
} from '../services/idempotency.js';

type CallerSession = Session & { user_id?: string | null; repo_id?: string | null };

function serviceSessionId(request: FastifyRequest): string | null {
  const value = String(request.headers['x-ac-session-id'] || '').trim();
  return value || null;
}

async function resolveCallerSession(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<CallerSession | null> {
  if (!request.user || !['service', 'session'].includes(request.user.auth_type)) {
    void reply.status(403).send({ error: 'Service or session authentication required' });
    return null;
  }
  const sessionId = request.user.auth_type === 'session'
    ? request.user.session_id
    : serviceSessionId(request);
  if (!sessionId) {
    void reply.status(400).send({ error: 'X-AC-Session-Id is required for service authentication' });
    return null;
  }
  if (!z.string().uuid().safeParse(sessionId).success) {
    void reply.status(400).send({ error: 'Invalid caller session ID' });
    return null;
  }
  const session = await db.getSessionById(sessionId) as CallerSession | null;
  if (!session) {
    void reply.status(404).send({ error: 'Caller session not found' });
    return null;
  }
  if (
    request.user.auth_type === 'session'
    && session.user_id
    && session.user_id !== request.user.id
  ) {
    void reply.status(403).send({ error: 'Session token scope mismatch' });
    return null;
  }
  return session;
}

function callerUserId(request: FastifyRequest, session: CallerSession): string {
  return session.user_id || request.user!.id;
}

async function childIds(parentSessionId: string): Promise<string[]> {
  const edges = await sessionGraph.list(parentSessionId);
  return Array.from(new Set(
    edges
      .filter((edge) => edge.parent_session_id === parentSessionId)
      .map((edge) => edge.child_session_id)
  ));
}

async function requireChild(
  parentSessionId: string,
  requestedChildId: string,
  reply: FastifyReply
): Promise<Session | null> {
  if (!(await childIds(parentSessionId)).includes(requestedChildId)) {
    void reply.status(404).send({ error: 'Child session not found' });
    return null;
  }
  const child = await db.getSessionById(requestedChildId);
  if (!child) {
    void reply.status(404).send({ error: 'Child session not found' });
    return null;
  }
  return child;
}

export function registerOrchestratorRoutes(app: FastifyInstance): void {
  app.post<{ Body: unknown }>('/v1/orchestrator/spawn', async (request, reply) => {
    const caller = await resolveCallerSession(request, reply);
    if (!caller) return;
    const body = OrchestratorSpawnWorkerRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: body.error });
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
    const userId = callerUserId(request, caller);
    const idempotencyKey = scopeIdempotencyKey(
      rawIdempotencyKey,
      'orchestrator.spawn',
      caller.id
    );
    const idempotencyFingerprint = rawIdempotencyKey
      ? fingerprintIdempotentRequest(body.data)
      : undefined;

    try {
      if (caller.role !== 'orchestrator') {
        const updatedCaller = await sessionGraph.setRole(caller.id, 'orchestrator');
        if (updatedCaller) pubsub.publishSessionsChanged([updatedCaller]);
      }
      const memoryPlan = await prepareSessionMemoryForSpawn({
        user_id: userId,
        provider: body.data.provider,
        host_id: body.data.host_id,
        working_directory: body.data.working_directory,
        source: 'automatic',
      });
      const spawned = await spawnSessionOnHost({
        actorUserId: userId,
        host_id: body.data.host_id,
        provider: body.data.provider,
        working_directory: body.data.working_directory,
        repo_id: memoryPlan.repoId,
        memory_files: memoryPlan.memoryFiles,
        title: body.data.title || `${caller.title || 'orchestrator'} worker`,
        flags: body.data.flags,
        parent_session_id: caller.id,
        role: 'worker',
        tmux: body.data.tmux,
        auditAction: 'orchestrator.worker_spawn',
        failureAuditAction: 'orchestrator.worker_spawn_failed',
        idempotencyKey,
        idempotencyFingerprint,
      });
      const prompt = body.data.prompt
        ? await queueInputToSession({
            session_id: spawned.session.id,
            text: body.data.prompt,
            enter: true,
            idempotencyKey: idempotencyKey ? `${idempotencyKey}:prompt` : undefined,
            idempotencyFingerprint,
          })
        : null;
      const sessionToken = await mintSessionToken({
        session_id: spawned.session.id,
        user_id: userId,
      });

      return reply.status(spawned.queued ? 202 : 200).send({
        session_id: spawned.session.id,
        session: spawned.session,
        cmd_id: spawned.cmd_id,
        queued: spawned.queued,
        replayed: spawned.replayed,
        prompt_cmd_id: prompt?.cmd_id,
        prompt_queued: prompt?.queued,
        session_token: sessionToken.token,
        session_token_expires_at: sessionToken.expires_at,
      });
    } catch (error) {
      const message = (error as Error).message;
      const status =
        error instanceof IdempotencyConflictError ? 409
        : message === 'Host not found' || message === 'Parent session not found' ? 404
        : message === 'Host does not allow remote session spawning' ? 403
        : message.startsWith('Host does not advertise provider support') ? 400
        : 500;
      return reply.status(status).send({ error: message });
    }
  });

  app.get('/v1/orchestrator/children', async (request, reply) => {
    const caller = await resolveCallerSession(request, reply);
    if (!caller) return;
    const ids = await childIds(caller.id);
    const [children, rollup, tasks] = await Promise.all([
      db.getSessionsByIds(ids),
      sessionGraph.rollup(caller.id),
      agentTasks.list(caller.id),
    ]);
    return { session_id: caller.id, children, rollup, agent_tasks: tasks };
  });

  app.get<{ Params: { id: string } }>(
    '/v1/orchestrator/children/:id',
    async (request, reply) => {
      const caller = await resolveCallerSession(request, reply);
      if (!caller) return;
      const child = await requireChild(caller.id, request.params.id, reply);
      if (!child) return;
      const [detail, rollup, tasks] = await Promise.all([
        db.getSessionWithSnapshot(child.id),
        sessionGraph.rollup(child.id),
        agentTasks.list(child.id),
      ]);
      return {
        session: detail?.session || child,
        snapshot: detail?.snapshot || null,
        rollup,
        agent_tasks: tasks,
      };
    }
  );

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/v1/orchestrator/children/:id/input',
    async (request, reply) => {
      const caller = await resolveCallerSession(request, reply);
      if (!caller) return;
      const body = OrchestratorSendInputRequestSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: 'Invalid request body', details: body.error });
      }
      const child = await requireChild(caller.id, request.params.id, reply);
      if (!child) return;
      const dispatched = await queueInputToSession({
        session_id: child.id,
        text: body.data.input,
        enter: body.data.enter,
      });
      await db.createAuditLog(
        'orchestrator.child_input',
        'session',
        child.id,
        { parent_session_id: caller.id, cmd_id: dispatched.cmd_id },
        callerUserId(request, caller)
      );
      return dispatched;
    }
  );

  app.get('/v1/orchestrator/work-items', async (request, reply) => {
    const caller = await resolveCallerSession(request, reply);
    if (!caller) return;
    const query = OrchestratorWorkItemsQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: 'Invalid query parameters', details: query.error });
    }
    const workItems = await automationDb.listWorkItemsForSession({
      user_id: callerUserId(request, caller),
      session_id: caller.id,
      repo_id: caller.repo_id || null,
      query: query.data,
    });
    return { work_items: workItems };
  });

  app.post<{ Body: unknown }>('/v1/orchestrator/work-items/claim', async (request, reply) => {
    const caller = await resolveCallerSession(request, reply);
    if (!caller) return;
    const body = OrchestratorWorkItemClaimRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: body.error });
    }
    if (body.data.repo_id && body.data.repo_id !== caller.repo_id) {
      return reply.status(403).send({ error: 'Requested repo is outside the caller session scope' });
    }
    const workItem = await automationDb.claimWorkItemForSession({
      user_id: callerUserId(request, caller),
      session_id: caller.id,
      repo_id: caller.repo_id || null,
      work_item_id: body.data.work_item_id,
    });
    if (!workItem) {
      return reply.status(404).send({ error: 'No claimable work item found' });
    }
    pubsub.publishWorkItemUpdated(workItem);
    return { work_item: workItem };
  });

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/v1/orchestrator/work-items/:id/complete',
    async (request, reply) => {
      const caller = await resolveCallerSession(request, reply);
      if (!caller) return;
      const body = OrchestratorWorkItemCompleteRequestSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: 'Invalid request body', details: body.error });
      }
      const workItem = await automationDb.completeWorkItemForSession({
        user_id: callerUserId(request, caller),
        session_id: caller.id,
        work_item_id: request.params.id,
        status: body.data.status,
        result: body.data.result,
      });
      if (!workItem) {
        return reply.status(404).send({ error: 'Claimed work item not found' });
      }
      pubsub.publishWorkItemUpdated(workItem);
      return { work_item: workItem };
    }
  );

  app.get('/v1/orchestrator/memory/search', async (request, reply) => {
    const caller = await resolveCallerSession(request, reply);
    if (!caller) return;
    const query = OrchestratorMemorySearchQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: 'Invalid query parameters', details: query.error });
    }
    if (query.data.scope_type === 'repo' && !caller.repo_id) {
      return reply.status(409).send({ error: 'Caller session has no repo scope' });
    }
    const results = await automationDb.searchMemoryForSession({
      user_id: callerUserId(request, caller),
      session_id: caller.id,
      repo_id: caller.repo_id || null,
      query: query.data,
    });
    return { results };
  });

  app.post<{ Body: unknown }>('/v1/orchestrator/memory', async (request, reply) => {
    const caller = await resolveCallerSession(request, reply);
    if (!caller) return;
    const body = OrchestratorMemoryWriteRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: body.error });
    }
    if (body.data.scope_type === 'repo' && !caller.repo_id) {
      return reply.status(409).send({ error: 'Caller session has no repo scope' });
    }
    const entry = await automationDb.createMemoryEntry(callerUserId(request, caller), {
      ...body.data,
      repo_id: body.data.scope_type === 'repo' ? caller.repo_id || undefined : undefined,
      session_id: body.data.scope_type === 'working' ? caller.id : undefined,
      metadata: {
        ...(body.data.metadata || {}),
        source_session_id: caller.id,
      },
    });
    return { entry };
  });
}
