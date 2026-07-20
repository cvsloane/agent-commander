import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  OrchestratorMemorySearchQuerySchema,
  OrchestratorMemoryWriteRequestSchema,
  OrchestratorFleetResponseSchema,
  OrchestratorSendInputRequestSchema,
  OrchestratorSpawnWorkerRequestSchema,
  OrchestratorWorkItemClaimRequestSchema,
  OrchestratorWorkItemCompleteRequestSchema,
  OrchestratorWorkItemsQuerySchema,
  type AutomationAgent,
  type AutomationRun,
  type FleetWorkItemCount,
  type Session,
  type SessionWithSnapshot,
} from '@agent-command/schema';
import * as db from '../db/index.js';
import * as automationDb from '../db/automationMemory.js';
import { sessionGraph } from '../db/sessionGraph.js';
import { agentTasks } from '../db/agentTasks.js';
import { mintSessionToken } from '../auth/verify.js';
import { hasRole } from '../auth/rbac.js';
import { pubsub } from '../services/pubsub.js';
import {
  prepareSessionMemoryForSpawn,
} from '../services/sessionMemory.js';
import {
  queueInputToSession,
  spawnSessionOnHost,
} from '../services/sessionSpawn.js';
import { listAutomationAgentViews } from '../services/automation.js';
import {
  fingerprintIdempotentRequest,
  getIdempotencyKey,
  IdempotencyConflictError,
  InvalidIdempotencyKeyError,
  scopeIdempotencyKey,
} from '../services/idempotency.js';

type CallerSession = Session & { user_id?: string | null; repo_id?: string | null };

const FLEET_PAGE_SIZE = 100;
const FLEET_QUERY_CONCURRENCY = 4;

function batches<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const result: R[] = [];
  for (let index = 0; index < items.length; index += concurrency) {
    result.push(...await Promise.all(items.slice(index, index + concurrency).map(mapper)));
  }
  return result;
}

async function loadFleetRows<T>(
  ids: string[],
  loader: (batchIds: string[]) => Promise<T[]>
): Promise<T[]> {
  const rows = await mapWithConcurrency(
    batches(ids, FLEET_PAGE_SIZE),
    FLEET_QUERY_CONCURRENCY,
    loader
  );
  return rows.flat();
}

async function loadOrchestratorSessions(): Promise<Session[]> {
  const sessions: Session[] = [];
  let offset = 0;
  while (true) {
    const page = await db.getSessionsPage({
      role: 'orchestrator',
      include_archived: false,
      limit: FLEET_PAGE_SIZE,
      offset,
    });
    sessions.push(...page.sessions);
    offset += page.sessions.length;
    if (page.sessions.length === 0 || offset >= page.total) return sessions;
  }
}

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

function runTimestamp(run: AutomationRun): number {
  const value = run.ended_at || run.started_at;
  return value ? new Date(value).getTime() : 0;
}

function latestReportSummary(run: AutomationRun | null): string | null {
  if (!run) return null;
  const workerSummary = run.worker_report_json.summary;
  if (typeof workerSummary === 'string' && workerSummary.trim()) return workerSummary;
  if (run.result_summary?.trim()) return run.result_summary;
  return run.objective;
}

function workItemCounts(
  rows: FleetWorkItemCount[],
  familySessionIds: Set<string>,
  automationAgentId: string | null
): {
  total: number;
  by_status: Record<FleetWorkItemCount['status'], number>;
} {
  const byStatus: Record<FleetWorkItemCount['status'], number> = {
    queued: 0,
    in_progress: 0,
    blocked: 0,
    done: 0,
    cancelled: 0,
  };
  for (const row of rows) {
    const belongsToFamily = Boolean(row.session_id && familySessionIds.has(row.session_id));
    const belongsToAgent = Boolean(
      automationAgentId && row.assigned_automation_agent_id === automationAgentId
    );
    if (!belongsToFamily && !belongsToAgent) continue;
    byStatus[row.status] += row.count;
  }
  return {
    total: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
    by_status: byStatus,
  };
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
  app.get('/v1/orchestrator/fleet', async (request, reply) => {
    if (!request.user || !hasRole(request.user, 'operator')) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const userId = request.user.id;
    const orchestratorSessions = await loadOrchestratorSessions();
    if (orchestratorSessions.length === 0) {
      return OrchestratorFleetResponseSchema.parse({ orchestrators: [] });
    }
    const orchestratorIds = orchestratorSessions.map((session) => session.id);
    const [edges, tasks, rollupMaps, automationAgents, recentRuns] = await Promise.all([
      loadFleetRows(orchestratorIds, (ids) => sessionGraph.listMany(ids)),
      loadFleetRows(orchestratorIds, (ids) => agentTasks.listMany(ids)),
      mapWithConcurrency(
        batches(orchestratorIds, FLEET_PAGE_SIZE),
        FLEET_QUERY_CONCURRENCY,
        (ids) => sessionGraph.rollupMany(ids)
      ),
      listAutomationAgentViews(userId),
      automationDb.listAutomationRuns(userId, { limit: 100 }),
    ]);
    const uniqueEdges = [...new Map(edges.map((edge) => [
      `${edge.parent_session_id}:${edge.child_session_id}:${edge.edge_type}`,
      edge,
    ])).values()];
    const orchestratorIdSet = new Set(orchestratorIds);
    const edgesBySession = new Map(orchestratorIds.map((id) => [id, [] as typeof uniqueEdges]));
    const directChildIdsByParent = new Map(orchestratorIds.map((id) => [id, new Set<string>()]));
    for (const edge of uniqueEdges) {
      if (orchestratorIdSet.has(edge.parent_session_id)) {
        edgesBySession.get(edge.parent_session_id)!.push(edge);
        directChildIdsByParent.get(edge.parent_session_id)!.add(edge.child_session_id);
      }
      if (
        edge.child_session_id !== edge.parent_session_id
        && orchestratorIdSet.has(edge.child_session_id)
      ) {
        edgesBySession.get(edge.child_session_id)!.push(edge);
      }
    }
    const directChildIds = [...new Set(
      [...directChildIdsByParent.values()].flatMap((ids) => [...ids])
    )];
    const childIdsToFetch = directChildIds.filter((id) => !orchestratorIdSet.has(id));
    const childSessions = (await loadFleetRows(
      childIdsToFetch,
      (ids) => db.getSessionsByIds(ids)
    )).filter((session) => !session.archived_at);
    const scopedSessions = [...orchestratorSessions, ...childSessions];
    const scopedSessionIds = scopedSessions.map((session) => session.id);
    const snapshots = await loadFleetRows(
      scopedSessionIds,
      (ids) => db.getLatestSnapshots(ids)
    );
    const snapshotBySessionId = new Map(
      snapshots.map((snapshot) => [snapshot.session_id, snapshot])
    );
    const sessionsWithSnapshots = scopedSessions.map((session): SessionWithSnapshot => {
      const snapshot = snapshotBySessionId.get(session.id);
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
    const sessionById = new Map(sessionsWithSnapshots.map((session) => [session.id, session]));
    const tasksBySession = new Map(orchestratorIds.map((id) => [id, [] as typeof tasks]));
    for (const task of tasks) {
      tasksBySession.get(task.session_id)?.push(task);
    }
    const rollupBySession = new Map(rollupMaps.flatMap((rollups) => [...rollups.entries()]));
    const fleetFamilies = orchestratorIds.map((orchestratorId) => {
      const session = sessionById.get(orchestratorId)!;
      const graphEdges = edgesBySession.get(orchestratorId) ?? [];
      const children = [...(directChildIdsByParent.get(orchestratorId) ?? [])]
        .map((childId) => sessionById.get(childId))
        .filter((child): child is SessionWithSnapshot => Boolean(child));
      const familySessionIds = new Set([orchestratorId, ...children.map((child) => child.id)]);
      const automationAgent = automationAgents.find((agent: AutomationAgent) => {
        const runtime = agent.runtime_state;
        return Boolean(
          (runtime?.active_session_id && familySessionIds.has(runtime.active_session_id))
          || (runtime?.last_session_id && familySessionIds.has(runtime.last_session_id))
        );
      }) ?? null;
      return { session, graphEdges, children, familySessionIds, automationAgent };
    });
    const automationAgentIds = [...new Set(
      fleetFamilies.flatMap(({ automationAgent }) => automationAgent ? [automationAgent.id] : [])
    )];
    const [latestRuns, budgetMaps, workItemCountRows] = await Promise.all([
      loadFleetRows(
        automationAgentIds,
        (ids) => automationDb.listLatestAutomationRunsForAgents(userId, ids)
      ),
      mapWithConcurrency(
        batches(automationAgentIds, FLEET_PAGE_SIZE),
        FLEET_QUERY_CONCURRENCY,
        (ids) => automationDb.computeAutomationBudgetUsageForAgents(ids)
      ),
      automationDb.listFleetWorkItemCounts(userId, {
        session_ids: scopedSessionIds,
        automation_agent_ids: automationAgentIds,
      }),
    ]);
    const latestRunByAgent = new Map(latestRuns.map((run) => [run.automation_agent_id, run]));
    const budgetByAgent = new Map(budgetMaps.flatMap((usage) => [...usage.entries()]));

    const orchestrators = fleetFamilies.map(({
      session,
      graphEdges,
      children,
      familySessionIds,
      automationAgent,
    }) => {
      const agentRun = automationAgent ? latestRunByAgent.get(automationAgent.id) : undefined;
      const recentFamilyRun = recentRuns
        .filter((run) => run.session_id && familySessionIds.has(run.session_id))
        .sort((left, right) => runTimestamp(right) - runTimestamp(left))[0];
      const latestRun = agentRun ?? recentFamilyRun ?? null;
      const reportSummary = latestReportSummary(latestRun);
      const rollup = rollupBySession.get(session.id);
      if (!rollup) throw new Error(`Missing fleet rollup for orchestrator ${session.id}`);

      return {
        session,
        children,
        edges: graphEdges,
        agent_tasks: tasksBySession.get(session.id) ?? [],
        rollup,
        work_item_counts: workItemCounts(
          workItemCountRows,
          familySessionIds,
          automationAgent?.id ?? null
        ),
        automation_agent: automationAgent,
        latest_run: latestRun,
        latest_report: latestRun && reportSummary
          ? {
              run_id: latestRun.id,
              status: latestRun.status,
              summary: reportSummary,
              reported_at: latestRun.ended_at || latestRun.started_at || null,
            }
          : null,
        budget_policy: automationAgent?.budget_policy_json ?? {},
        budget_usage: automationAgent
          ? budgetByAgent.get(automationAgent.id) ?? { daily_cents: 0, monthly_cents: 0 }
          : null,
        usage_rollup: automationAgent?.runtime_state?.usage_rollup_json ?? {},
      };
    });

    return OrchestratorFleetResponseSchema.parse({ orchestrators });
  });

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
