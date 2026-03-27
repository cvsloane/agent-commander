import type { FastifyBaseLogger } from 'fastify';
import type {
  AutomationAgent,
  AutomationConcurrencyPolicy,
  AutomationPreflight,
  AutomationPreflightIssue,
  AutomationRun,
  AutomationRuntimeState,
  Host,
  Repo,
  Session,
  SessionProvider,
  WorkItem,
} from '@agent-command/schema';
import * as db from '../db/index.js';
import * as automationDb from '../db/automationMemory.js';
import { pubsub } from './pubsub.js';
import { spawnSessionOnHost } from './sessionSpawn.js';
import { bootstrapSessionMemory } from './sessionMemory.js';
import {
  recordAutomationRun,
  recordAutomationWakeup,
  recordGovernanceApproval,
} from '../metrics.js';

const SCHEDULER_LOCK_KEY = 427001;
const DEFAULT_TICK_MS = 5000;
const RUN_IDLE_COMPLETION_GRACE_MS = 15_000;

type JsonObject = Record<string, unknown>;

type BudgetPolicy = {
  daily_limit_cents?: number;
  monthly_limit_cents?: number;
  warn_percent?: number;
};

type BudgetAssessment = {
  usage: { daily_cents: number; monthly_cents: number };
  issues: AutomationPreflightIssue[];
  blockedReason: string | null;
};

type PreflightEvaluation = {
  preflight: AutomationPreflight;
  repo: Repo | null;
  host: Host | null;
  cwd: string | null;
  budget: BudgetAssessment;
};

type RuntimeResolution = {
  state: AutomationRuntimeState | null;
  reusableSession: Session | null;
  busySession: Session | null;
};

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function asPositiveInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return null;
}

function getConcurrencyPolicy(value: unknown): AutomationConcurrencyPolicy {
  const raw = asObject(value).concurrency_policy;
  return raw === 'always_enqueue' || raw === 'skip_if_active' || raw === 'coalesce_if_active'
    ? raw
    : 'coalesce_if_active';
}

function getPreferredRepoScope(agent: Pick<AutomationAgent, 'wake_policy_json'>): string | null {
  const wakePolicy = asObject(agent.wake_policy_json);
  if (typeof wakePolicy.repo_id === 'string' && wakePolicy.repo_id.trim()) {
    return wakePolicy.repo_id;
  }
  if (Array.isArray(wakePolicy.repo_ids)) {
    const preferred = wakePolicy.repo_ids.find(
      (value): value is string => typeof value === 'string' && value.trim().length > 0
    );
    return preferred ?? null;
  }
  return null;
}

function getBudgetPolicy(value: unknown): BudgetPolicy {
  return asObject(value) as BudgetPolicy;
}

function hostAllowsSpawn(host: Host | null | undefined): boolean {
  const capabilities = asObject(host?.capabilities);
  return Boolean(host) && capabilities.spawn !== false && pubsub.isAgentConnected(host!.id);
}

function providerSupport(host: Host, provider: SessionProvider): 'supported' | 'unsupported' | 'unknown' {
  const capabilities = asObject(host.capabilities);
  const providers = asObject(capabilities.providers);
  if (Object.keys(providers).length === 0) {
    return 'unknown';
  }
  return providers[provider] === true ? 'supported' : 'unsupported';
}

function mergeContexts(contexts: JsonObject[]): JsonObject {
  const merged: JsonObject = {};
  const objectives: string[] = [];
  const wakeupIds: string[] = [];

  for (const context of contexts) {
    const current = asObject(context.context_json);
    Object.assign(merged, current);
    if (typeof current.objective === 'string' && current.objective.trim()) {
      objectives.push(current.objective.trim());
    }
    if (typeof context.wakeup_id === 'string') {
      wakeupIds.push(context.wakeup_id);
    }
  }

  if (objectives.length > 1) {
    merged.objective = Array.from(new Set(objectives)).join('\n\n');
  }
  if (wakeupIds.length > 0) {
    merged.coalesced_wakeup_ids = wakeupIds;
  }
  merged.coalesced_count = contexts.length;
  return merged;
}

async function publishAutomationRun(run: AutomationRun, provider: string): Promise<void> {
  pubsub.publishAutomationRunUpdated(run);
  recordAutomationRun(run.status, provider);
}

function publishAutomationWakeup(wakeup: automationDb.ClaimedAutomationWakeup | Awaited<ReturnType<typeof automationDb.markAutomationWakeupStatus>> | Awaited<ReturnType<typeof automationDb.requeueAutomationWakeup>> | Awaited<ReturnType<typeof automationDb.coalesceAutomationWakeup>> | Awaited<ReturnType<typeof automationDb.createAutomationWakeup>>): void {
  if (!wakeup) return;
  pubsub.publishAutomationWakeupUpdated(wakeup);
  recordAutomationWakeup(wakeup.status, wakeup.source);
}

async function publishRuntimeState(state: AutomationRuntimeState | null): Promise<void> {
  if (!state) return;
  pubsub.publishAutomationRuntimeStateUpdated(state);
}

async function appendRunEvent(input: {
  automation_run_id: string;
  event_type: string;
  message: string;
  level?: 'info' | 'warn' | 'error';
  payload?: JsonObject;
}): Promise<void> {
  const event = await automationDb.appendAutomationRunEvent(input);
  pubsub.publishAutomationRunEvent(event);
}

async function tryAcquireSchedulerLock(): Promise<boolean> {
  const result = await db.pool.query('SELECT pg_try_advisory_lock($1) AS locked', [SCHEDULER_LOCK_KEY]);
  return Boolean(result.rows[0]?.locked);
}

async function releaseSchedulerLock(): Promise<void> {
  await db.pool.query('SELECT pg_advisory_unlock($1)', [SCHEDULER_LOCK_KEY]);
}

async function createGovernanceApproval(input: Parameters<typeof automationDb.createGovernanceApproval>[0]): Promise<void> {
  const approval = await automationDb.createGovernanceApproval(input);
  pubsub.publishGovernanceApprovalUpdated(approval);
  recordGovernanceApproval(approval.status, approval.type);
}

async function resolveBudgetAssessment(
  automationAgentId: string,
  budgetPolicyValue: unknown
): Promise<BudgetAssessment> {
  const budgetPolicy = getBudgetPolicy(budgetPolicyValue);
  const dailyLimit = asPositiveInt(budgetPolicy.daily_limit_cents);
  const monthlyLimit = asPositiveInt(budgetPolicy.monthly_limit_cents);
  const warnPercent = Math.min(99, Math.max(1, asPositiveInt(budgetPolicy.warn_percent) ?? 80));
  const usage = await automationDb.computeAutomationBudgetUsage(automationAgentId);
  const issues: AutomationPreflightIssue[] = [];

  const dailyBlocked = dailyLimit && usage.daily_cents >= dailyLimit;
  const monthlyBlocked = monthlyLimit && usage.monthly_cents >= monthlyLimit;
  const blockedReason = dailyBlocked
    ? `Daily budget exceeded (${usage.daily_cents}/${dailyLimit} cents).`
    : monthlyBlocked
      ? `Monthly budget exceeded (${usage.monthly_cents}/${monthlyLimit} cents).`
      : null;

  if (blockedReason) {
    issues.push({
      code: 'budget_exceeded',
      level: 'error',
      message: blockedReason,
    });
    return { usage, issues, blockedReason };
  }

  const dailyWarnThreshold = dailyLimit ? Math.floor((dailyLimit * warnPercent) / 100) : null;
  const monthlyWarnThreshold = monthlyLimit ? Math.floor((monthlyLimit * warnPercent) / 100) : null;

  if (dailyWarnThreshold && usage.daily_cents >= dailyWarnThreshold) {
    issues.push({
      code: 'budget_warning',
      level: 'warn',
      message: `Daily budget warning (${usage.daily_cents}/${dailyLimit} cents, warn at ${warnPercent}%).`,
    });
  }
  if (monthlyWarnThreshold && usage.monthly_cents >= monthlyWarnThreshold) {
    issues.push({
      code: 'budget_warning',
      level: 'warn',
      message: `Monthly budget warning (${usage.monthly_cents}/${monthlyLimit} cents, warn at ${warnPercent}%).`,
    });
  }

  return { usage, issues, blockedReason: null };
}

async function selectExecutionHost(input: {
  fixedHostId?: string | null;
  repoLastHostId?: string | null;
  provider: SessionProvider;
}): Promise<{ host: Host | null; issues: AutomationPreflightIssue[] }> {
  const issues: AutomationPreflightIssue[] = [];

  const evaluateCandidate = async (
    hostId: string | null | undefined,
    codePrefix: string
  ): Promise<Host | null> => {
    if (!hostId) return null;
    const host = await db.getHostById(hostId);
    if (!host) {
      issues.push({
        code: `${codePrefix}_missing`,
        level: 'error',
        message: `Preferred host ${hostId} is missing.`,
        host_id: hostId,
      });
      return null;
    }
    if (!pubsub.isAgentConnected(host.id)) {
      issues.push({
        code: `${codePrefix}_offline`,
        level: 'error',
        message: `Preferred host ${host.name} is offline.`,
        host_id: host.id,
      });
      return null;
    }
    if (!hostAllowsSpawn(host)) {
      issues.push({
        code: `${codePrefix}_spawn_disabled`,
        level: 'error',
        message: `Preferred host ${host.name} does not allow spawning.`,
        host_id: host.id,
      });
      return null;
    }

    const support = providerSupport(host, input.provider);
    if (support === 'unsupported') {
      issues.push({
        code: `${codePrefix}_provider_unsupported`,
        level: 'error',
        message: `Preferred host ${host.name} does not advertise ${input.provider}.`,
        host_id: host.id,
      });
      return null;
    }
    if (support === 'unknown') {
      issues.push({
        code: `${codePrefix}_provider_unknown`,
        level: 'warn',
        message: `Preferred host ${host.name} has no provider availability map for ${input.provider}.`,
        host_id: host.id,
      });
    }
    return host;
  };

  const fixedHost = await evaluateCandidate(input.fixedHostId, 'fixed_host');
  if (fixedHost) {
    return { host: fixedHost, issues };
  }

  const repoHost = input.repoLastHostId && input.repoLastHostId !== input.fixedHostId
    ? await evaluateCandidate(input.repoLastHostId, 'repo_host')
    : null;
  if (repoHost) {
    return { host: repoHost, issues };
  }

  const hosts = await db.getHosts();
  const candidates = hosts.filter((host) => hostAllowsSpawn(host));
  const viable = candidates.filter((host) => providerSupport(host, input.provider) !== 'unsupported');

  if (viable.length === 1) {
    const host = viable[0]!;
    if (providerSupport(host, input.provider) === 'unknown') {
      issues.push({
        code: 'provider_unknown',
        level: 'warn',
        message: `Host ${host.name} has no provider availability map for ${input.provider}.`,
        host_id: host.id,
      });
    }
    return { host, issues };
  }

  if (viable.length === 0) {
    issues.push({
      code: 'no_viable_host',
      level: 'error',
      message: `No online spawn-capable host can run ${input.provider}.`,
    });
    return { host: null, issues };
  }

  issues.push({
    code: 'ambiguous_host_selection',
    level: 'error',
    message: 'Multiple viable hosts are online. Pin a host or narrow repo affinity.',
  });
  return { host: null, issues };
}

async function evaluateAutomationPreflightInternal(input: {
  automationAgentId: string;
  provider: SessionProvider;
  budgetPolicyJson: unknown;
  fixedHostId?: string | null;
  defaultCwd?: string | null;
  repoId?: string | null;
  reusableSession?: Session | null;
}): Promise<PreflightEvaluation> {
  const repo = await automationDb.describeRepo(input.repoId || null);
  const budget = await resolveBudgetAssessment(input.automationAgentId, input.budgetPolicyJson);
  const issues: AutomationPreflightIssue[] = [...budget.issues];

  let host: Host | null = null;
  if (input.reusableSession) {
    host = await db.getHostById(input.reusableSession.host_id);
    if (!host || !hostAllowsSpawn(host)) {
      issues.push({
        code: 'runtime_host_unavailable',
        level: 'error',
        message: 'The reusable runtime host is no longer available.',
        host_id: input.reusableSession.host_id,
      });
      host = null;
    } else if (providerSupport(host, input.provider) === 'unknown') {
      issues.push({
        code: 'runtime_provider_unknown',
        level: 'warn',
        message: `Runtime host ${host.name} has no provider availability map for ${input.provider}.`,
        host_id: host.id,
      });
    }
  } else {
    const hostSelection = await selectExecutionHost({
      fixedHostId: input.fixedHostId || null,
      repoLastHostId: repo?.last_host_id || null,
      provider: input.provider,
    });
    host = hostSelection.host;
    issues.push(...hostSelection.issues);
  }

  const cwd = input.reusableSession?.cwd
    || input.reusableSession?.repo_root
    || input.defaultCwd
    || repo?.last_repo_root
    || null;

  if (!cwd) {
    issues.push({
      code: 'missing_working_directory',
      level: 'error',
      message: 'No working directory is available for this automation run.',
    });
  }

  const preflight: AutomationPreflight = {
    status: issues.some((issue) => issue.level === 'error')
      ? 'blocked'
      : issues.some((issue) => issue.level === 'warn')
        ? 'warn'
        : 'ok',
    issues,
  };

  return { preflight, repo, host, cwd, budget };
}

async function replaceRuntimeState(input: Parameters<typeof automationDb.replaceAutomationRuntimeState>[0]): Promise<AutomationRuntimeState> {
  const state = await automationDb.replaceAutomationRuntimeState(input);
  await publishRuntimeState(state);
  return state;
}

async function upsertRuntimeState(input: Parameters<typeof automationDb.upsertAutomationRuntimeState>[0]): Promise<AutomationRuntimeState> {
  const state = await automationDb.upsertAutomationRuntimeState(input);
  await publishRuntimeState(state);
  return state;
}

async function resolveRuntimeContext(input: {
  automationAgentId: string;
  repoId?: string | null;
  provider: SessionProvider;
}): Promise<RuntimeResolution> {
  const state = await automationDb.getAutomationRuntimeState({
    automation_agent_id: input.automationAgentId,
    repo_id: input.repoId || null,
  });
  if (!state?.active_session_id) {
    return { state, reusableSession: null, busySession: null };
  }

  const session = await db.getSessionById(state.active_session_id);
  const hostId = state.active_host_id || session?.host_id || null;
  const hostConnected = hostId ? pubsub.isAgentConnected(hostId) : false;

  if (!session || !hostConnected || session.provider !== input.provider) {
    const next = await replaceRuntimeState({
      automation_agent_id: input.automationAgentId,
      repo_id: input.repoId || null,
      active_session_id: null,
      active_host_id: null,
      last_session_id: session?.id || state.last_session_id || state.active_session_id || null,
      last_run_id: state.last_run_id || null,
      runtime_status: 'stale',
      state_json: {
        ...asObject(state.state_json),
        stale_reason:
          !session ? 'missing_session'
          : !hostConnected ? 'host_offline'
          : 'provider_mismatch',
      },
      usage_rollup_json: asObject(state.usage_rollup_json),
    });
    return { state: next, reusableSession: null, busySession: null };
  }

  if (session.status === 'DONE' || session.status === 'ERROR') {
    const next = await replaceRuntimeState({
      automation_agent_id: input.automationAgentId,
      repo_id: input.repoId || null,
      active_session_id: null,
      active_host_id: null,
      last_session_id: session.id,
      last_run_id: state.last_run_id || null,
      runtime_status: session.status === 'ERROR' ? 'error' : 'idle',
      state_json: {
        ...asObject(state.state_json),
        cleared_reason: session.status.toLowerCase(),
      },
      usage_rollup_json: asObject(state.usage_rollup_json),
    });
    return { state: next, reusableSession: null, busySession: null };
  }

  if (session.status === 'WAITING_FOR_INPUT' || session.status === 'IDLE') {
    const next = await upsertRuntimeState({
      automation_agent_id: input.automationAgentId,
      repo_id: input.repoId || null,
      active_session_id: session.id,
      active_host_id: session.host_id,
      last_session_id: session.id,
      runtime_status: 'attached',
      state_json: {
        ...asObject(state.state_json),
        session_status: session.status,
      },
    });
    return { state: next, reusableSession: session, busySession: null };
  }

  const next = await upsertRuntimeState({
    automation_agent_id: input.automationAgentId,
    repo_id: input.repoId || null,
    active_session_id: session.id,
    active_host_id: session.host_id,
    last_session_id: session.id,
    runtime_status: 'attached',
    state_json: {
      ...asObject(state.state_json),
      session_status: session.status,
    },
  });
  return { state: next, reusableSession: null, busySession: session };
}

function workItemText(workItem: WorkItem | null): string | null {
  if (!workItem) return null;
  return `${workItem.title}\n${workItem.objective}`;
}

async function decorateAgent(agent: AutomationAgent, repoId?: string | null): Promise<AutomationAgent> {
  const effectiveRepoId = repoId ?? getPreferredRepoScope(agent);
  const [runtimeState, preflightResult] = await Promise.all([
    automationDb.getAutomationRuntimeState({
      automation_agent_id: agent.id,
      repo_id: effectiveRepoId || null,
    }),
    evaluateAutomationPreflightInternal({
      automationAgentId: agent.id,
      provider: agent.provider,
      budgetPolicyJson: agent.budget_policy_json,
      fixedHostId: agent.fixed_host_id || null,
      defaultCwd: agent.default_cwd || null,
      repoId: effectiveRepoId || null,
    }),
  ]);

  return {
    ...agent,
    runtime_state: runtimeState ?? undefined,
    preflight: preflightResult.preflight,
  };
}

export async function listAutomationAgentViews(userId: string): Promise<AutomationAgent[]> {
  const agents = await automationDb.listAutomationAgents(userId);
  return Promise.all(agents.map((agent) => decorateAgent(agent)));
}

export async function getAutomationAgentView(
  userId: string,
  id: string,
  repoId?: string | null
): Promise<AutomationAgent | null> {
  const agent = await automationDb.getAutomationAgentById(userId, id);
  if (!agent) return null;
  return decorateAgent(agent, repoId);
}

export async function getAutomationAgentPreflight(
  userId: string,
  id: string,
  repoId?: string | null
): Promise<AutomationPreflight | null> {
  const agent = await automationDb.getAutomationAgentById(userId, id);
  if (!agent) return null;
  const result = await evaluateAutomationPreflightInternal({
    automationAgentId: agent.id,
    provider: agent.provider,
    budgetPolicyJson: agent.budget_policy_json,
    fixedHostId: agent.fixed_host_id || null,
    defaultCwd: agent.default_cwd || null,
    repoId: repoId ?? getPreferredRepoScope(agent),
  });
  return result.preflight;
}

export async function getAutomationRunEvents(
  userId: string,
  runId: string
): Promise<Awaited<ReturnType<typeof automationDb.listAutomationRunEvents>>> {
  return automationDb.listAutomationRunEvents(userId, runId);
}

async function enqueueDueScheduledWakeups(logger: FastifyBaseLogger): Promise<void> {
  const locked = await tryAcquireSchedulerLock();
  if (!locked) return;

  try {
    const agents = await db.pool.query(
      `SELECT
         a.*,
         MAX(w.requested_at) AS last_requested_at
       FROM automation_agents a
       LEFT JOIN automation_wakeups w ON w.automation_agent_id = a.id
       WHERE a.status = 'active'
       GROUP BY a.id`
    );

    for (const row of agents.rows) {
      const wakePolicy = asObject(row.wake_policy_json);
      const intervalMinutes = asPositiveInt(wakePolicy.interval_minutes);
      if (!intervalMinutes) continue;

      const lastRequestedAt = row.last_requested_at ? new Date(row.last_requested_at as string).getTime() : 0;
      const now = Date.now();
      if (lastRequestedAt && now - lastRequestedAt < intervalMinutes * 60_000) {
        continue;
      }

      const repoIds = Array.isArray(wakePolicy.repo_ids)
        ? wakePolicy.repo_ids.filter((value): value is string => typeof value === 'string')
        : typeof wakePolicy.repo_id === 'string'
          ? [wakePolicy.repo_id]
          : [undefined];

      for (const repoId of repoIds) {
        const bucket = Math.floor(now / (intervalMinutes * 60_000));
        const wakeup = await automationDb.createAutomationWakeup(row.user_id as string, row.id as string, {
          source: 'schedule',
          repo_id: repoId,
          idempotency_key: `schedule:${row.id}:${repoId ?? 'global'}:${bucket}`,
          context_json: {
            objective:
              typeof wakePolicy.objective === 'string'
                ? wakePolicy.objective
                : undefined,
          },
        });
        publishAutomationWakeup(wakeup);
      }
    }
  } catch (error) {
    logger.error({ error }, 'Failed to enqueue scheduled automation wakeups');
  } finally {
    await releaseSchedulerLock();
  }
}

async function cancelRunForWake(options: {
  run: AutomationRun;
  wakeup: automationDb.ClaimedAutomationWakeup;
  summary: string;
  wakeStatus: 'skipped' | 'failed' | 'blocked' | 'coalesced';
  contextPatch?: JsonObject;
  eventType: string;
  eventLevel?: 'info' | 'warn' | 'error';
}): Promise<void> {
  await appendRunEvent({
    automation_run_id: options.run.id,
    event_type: options.eventType,
    level: options.eventLevel || 'info',
    message: options.summary,
    payload: options.contextPatch,
  });
  const cancelled = await automationDb.updateAutomationRun(options.run.id, {
    status: options.wakeStatus === 'failed' ? 'failed' : options.wakeStatus === 'blocked' ? 'blocked' : 'cancelled',
    result_summary: options.summary,
    ended_at: new Date().toISOString(),
  });
  if (cancelled) {
    await publishAutomationRun(cancelled, options.wakeup.agent_provider);
  }
  const wakeup = options.wakeStatus === 'coalesced'
    ? await automationDb.coalesceAutomationWakeup(
        options.wakeup.id,
        typeof options.contextPatch?.coalesced_into_run_id === 'string'
          ? options.contextPatch.coalesced_into_run_id
          : options.run.id,
        options.contextPatch
      )
    : await automationDb.markAutomationWakeupStatus(
        options.wakeup.id,
        options.wakeStatus,
        options.contextPatch
      );
  publishAutomationWakeup(wakeup);
}

async function processWakeup(
  logger: FastifyBaseLogger,
  wakeup: automationDb.ClaimedAutomationWakeup
): Promise<void> {
  const runtime = await resolveRuntimeContext({
    automationAgentId: wakeup.automation_agent_id,
    repoId: wakeup.repo_id || null,
    provider: wakeup.agent_provider as SessionProvider,
  });
  const activeRunForScope = await automationDb.getActiveAutomationRunForScope({
    automation_agent_id: wakeup.automation_agent_id,
    repo_id: wakeup.repo_id || null,
  });
  const policy = getConcurrencyPolicy(wakeup.wake_policy_json);
  const activeRunCount = Math.max(
    wakeup.active_run_count ?? 0,
    activeRunForScope ? 1 : 0,
    runtime.busySession ? 1 : 0
  );

  const { objective, workItem: previewWorkItem, repo } = await automationDb.buildObjectiveFromWake(wakeup);

  if (activeRunForScope) {
    if (policy === 'coalesce_if_active') {
      const updatedRun = await automationDb.appendPendingFollowupToRun(activeRunForScope.id, {
        wakeup_id: wakeup.id,
        source: wakeup.source,
        requested_at: wakeup.requested_at,
        repo_id: wakeup.repo_id || null,
        context_json: asObject(wakeup.context_json),
      });
      if (updatedRun) {
        await appendRunEvent({
          automation_run_id: updatedRun.id,
          event_type: 'wakeup.coalesced',
          message: `Wakeup ${wakeup.id} was coalesced into the active run.`,
          payload: { wakeup_id: wakeup.id, source: wakeup.source },
        });
        pubsub.publishAutomationRunUpdated(updatedRun);
      }
      const coalescedWake = await automationDb.coalesceAutomationWakeup(wakeup.id, activeRunForScope.id, {
        reason: 'active_run',
        coalesced_into_run_id: activeRunForScope.id,
      });
      publishAutomationWakeup(coalescedWake);
      return;
    }

    if (policy === 'skip_if_active') {
      const skipped = await automationDb.markAutomationWakeupStatus(wakeup.id, 'skipped', {
        reason: 'active_run',
      });
      publishAutomationWakeup(skipped);
      return;
    }

    const requeued = await automationDb.requeueAutomationWakeup(wakeup.id, {
      reason: 'active_run',
      deferred_until_run_id: activeRunForScope.id,
    });
    publishAutomationWakeup(requeued);
    return;
  }

  if (activeRunCount >= wakeup.max_parallel_runs) {
    if (policy === 'skip_if_active') {
      const skipped = await automationDb.markAutomationWakeupStatus(wakeup.id, 'skipped', {
        reason: 'capacity_limit',
      });
      publishAutomationWakeup(skipped);
      return;
    }

    const requeued = await automationDb.requeueAutomationWakeup(wakeup.id, {
      reason: 'capacity_limit',
    });
    publishAutomationWakeup(requeued);
    return;
  }

  const initialRun = await automationDb.createAutomationRun({
    automation_agent_id: wakeup.automation_agent_id,
    wakeup_id: wakeup.id,
    repo_id: wakeup.repo_id || null,
    status: 'starting',
    objective,
  });
  await publishAutomationRun(initialRun, wakeup.agent_provider);
  await appendRunEvent({
    automation_run_id: initialRun.id,
    event_type: 'wakeup.claimed',
    message: `Wakeup ${wakeup.id} claimed for execution.`,
    payload: { wakeup_id: wakeup.id, source: wakeup.source },
  });

  let workItem = previewWorkItem;
  if (wakeup.agent_role === 'worker') {
    const context = asObject(wakeup.context_json);
    const checkedOut = typeof context.work_item_id === 'string'
      ? await automationDb.checkoutWorkItem({
          work_item_id: context.work_item_id,
          agent_id: wakeup.automation_agent_id,
          run_id: initialRun.id,
        })
      : await automationDb.claimNextWorkItemForAgent({
          user_id: wakeup.agent_user_id,
          agent_id: wakeup.automation_agent_id,
          run_id: initialRun.id,
          repo_id: wakeup.repo_id || null,
        });

    if (!checkedOut && !context.objective) {
      await cancelRunForWake({
        run: initialRun,
        wakeup,
        summary: 'No queued work item available for worker wakeup.',
        wakeStatus: 'skipped',
        contextPatch: { reason: 'no_work_item' },
        eventType: 'work_item.skipped',
      });
      return;
    }

    if (checkedOut) {
      workItem = checkedOut;
      pubsub.publishWorkItemUpdated(checkedOut);
      await appendRunEvent({
        automation_run_id: initialRun.id,
        event_type: 'work_item.checked_out',
        message: `Checked out work item ${checkedOut.id}.`,
        payload: { work_item_id: checkedOut.id },
      });
    }
  }

  const preflight = await evaluateAutomationPreflightInternal({
    automationAgentId: wakeup.automation_agent_id,
    provider: wakeup.agent_provider as SessionProvider,
    budgetPolicyJson: wakeup.budget_policy_json,
    fixedHostId: wakeup.agent_fixed_host_id || null,
    defaultCwd: wakeup.agent_default_cwd || null,
    repoId: wakeup.repo_id || null,
    reusableSession: runtime.reusableSession,
  });

  for (const issue of preflight.preflight.issues.filter(
    (issue: AutomationPreflightIssue) => issue.level === 'warn'
  )) {
    await appendRunEvent({
      automation_run_id: initialRun.id,
      event_type: issue.code === 'budget_warning' ? 'budget.warn' : 'preflight.warn',
      level: 'warn',
      message: issue.message,
      payload: { host_id: issue.host_id || null },
    });
  }

  if (preflight.preflight.status === 'blocked') {
    const primaryIssue = preflight.preflight.issues.find(
      (issue: AutomationPreflightIssue) => issue.level === 'error'
    ) || null;
    const approvalType = primaryIssue?.code === 'budget_exceeded'
      ? 'budget_override'
      : primaryIssue?.code === 'missing_working_directory'
        ? 'scope_escalation'
        : 'host_selection';
    const summary = primaryIssue?.message || 'Automation preflight failed.';

    await appendRunEvent({
      automation_run_id: initialRun.id,
      event_type: primaryIssue?.code === 'budget_exceeded' ? 'budget.block' : 'preflight.failure',
      level: 'error',
      message: summary,
      payload: { issues: preflight.preflight.issues },
    });

    await createGovernanceApproval({
      user_id: wakeup.agent_user_id,
      automation_agent_id: wakeup.automation_agent_id,
      automation_run_id: initialRun.id,
      type: approvalType,
      request_payload: {
        reason: summary,
        issues: preflight.preflight.issues,
        wakeup_id: wakeup.id,
        repo_id: wakeup.repo_id || null,
        budget_usage: preflight.budget.usage,
      },
    });

    await cancelRunForWake({
      run: initialRun,
      wakeup,
      summary,
      wakeStatus: 'blocked',
      contextPatch: { reason: primaryIssue?.code || 'preflight_failed' },
      eventType: 'run.blocked',
      eventLevel: 'error',
    });
    return;
  }

  const currentRun = await automationDb.updateAutomationRun(initialRun.id, {
    status: 'running',
  });
  if (currentRun) {
    await publishAutomationRun(currentRun, wakeup.agent_provider);
  }

  try {
    const currentWorkItemText = workItemText(workItem);

    if (runtime.reusableSession && preflight.host) {
      await appendRunEvent({
        automation_run_id: initialRun.id,
        event_type: 'session.reused',
        message: `Reusing session ${runtime.reusableSession.id}.`,
        payload: {
          host_id: runtime.reusableSession.host_id,
          session_id: runtime.reusableSession.id,
        },
      });

      const bootstrapped = await bootstrapSessionMemory({
        host_id: runtime.reusableSession.host_id,
        session_id: runtime.reusableSession.id,
        source: 'automation',
        objective,
        workItemText: currentWorkItemText,
        agentName: wakeup.agent_name,
      });

      const updatedRun = await automationDb.updateAutomationRun(initialRun.id, {
        session_id: runtime.reusableSession.id,
        memory_snapshot_json: {
          repo: bootstrapped.repoEntryIds,
          global: bootstrapped.globalEntryIds,
          reused_session_id: runtime.reusableSession.id,
        },
      });
      if (updatedRun) {
        await publishAutomationRun(updatedRun, wakeup.agent_provider);
      }

      await upsertRuntimeState({
        automation_agent_id: wakeup.automation_agent_id,
        repo_id: wakeup.repo_id || null,
        active_session_id: runtime.reusableSession.id,
        active_host_id: runtime.reusableSession.host_id,
        last_session_id: runtime.reusableSession.id,
        last_run_id: initialRun.id,
        runtime_status: 'attached',
        state_json: {
          session_status: runtime.reusableSession.status,
          execution_mode: 'reused',
        },
      });

      await appendRunEvent({
        automation_run_id: initialRun.id,
        event_type: bootstrapped.skipped ? 'bootstrap.skipped' : 'bootstrap.sent',
        message: bootstrapped.skipped
          ? 'Memory bootstrap skipped for the reused session.'
          : 'Memory bootstrap sent to the reused session.',
        payload: {
          repo_entry_ids: bootstrapped.repoEntryIds,
          global_entry_ids: bootstrapped.globalEntryIds,
        },
      });
      return;
    }

    await appendRunEvent({
      automation_run_id: initialRun.id,
      event_type: 'host.selected',
      message: `Selected host ${preflight.host?.name || preflight.host?.id}.`,
      payload: { host_id: preflight.host?.id || null, cwd: preflight.cwd },
    });

    const spawned = await spawnSessionOnHost({
      actorUserId: wakeup.agent_user_id,
      host_id: preflight.host!.id,
      provider: wakeup.agent_provider as SessionProvider,
      working_directory: preflight.cwd!,
      title: `[auto] ${wakeup.agent_name}`,
      auditAction: 'automation.run.spawn',
      failureAuditAction: 'automation.run.spawn_failed',
    });

    const runningRun = await automationDb.updateAutomationRun(initialRun.id, {
      session_id: spawned.session.id,
      status: 'running',
    });
    if (runningRun) {
      await publishAutomationRun(runningRun, wakeup.agent_provider);
    }

    await appendRunEvent({
      automation_run_id: initialRun.id,
      event_type: 'session.spawned',
      message: `Spawned session ${spawned.session.id}.`,
      payload: {
        session_id: spawned.session.id,
        host_id: preflight.host!.id,
        cwd: preflight.cwd,
      },
    });

    const bootstrapped = await bootstrapSessionMemory({
      host_id: preflight.host!.id,
      session_id: spawned.session.id,
      source: 'automation',
      objective,
      workItemText: currentWorkItemText,
      agentName: wakeup.agent_name,
    });

    const memoryUpdatedRun = await automationDb.updateAutomationRun(initialRun.id, {
      session_id: spawned.session.id,
      memory_snapshot_json: {
        repo: bootstrapped.repoEntryIds,
        global: bootstrapped.globalEntryIds,
      },
    });
    if (memoryUpdatedRun) {
      await publishAutomationRun(memoryUpdatedRun, wakeup.agent_provider);
    }

    await upsertRuntimeState({
      automation_agent_id: wakeup.automation_agent_id,
      repo_id: wakeup.repo_id || null,
      active_session_id: spawned.session.id,
      active_host_id: preflight.host!.id,
      last_session_id: spawned.session.id,
      last_run_id: initialRun.id,
      runtime_status: 'attached',
      state_json: {
        session_status: spawned.session.status,
        execution_mode: 'spawned',
      },
    });

    await appendRunEvent({
      automation_run_id: initialRun.id,
      event_type: bootstrapped.skipped ? 'bootstrap.skipped' : 'bootstrap.sent',
      message: bootstrapped.skipped
        ? 'Memory bootstrap skipped for the spawned session.'
        : 'Memory bootstrap sent to the spawned session.',
      payload: {
        session_id: spawned.session.id,
        repo_entry_ids: bootstrapped.repoEntryIds,
        global_entry_ids: bootstrapped.globalEntryIds,
      },
    });
  } catch (error) {
    logger.error({ error, wakeupId: wakeup.id }, 'Failed to process automation wakeup');
    await appendRunEvent({
      automation_run_id: initialRun.id,
      event_type: 'internal.error',
      level: 'error',
      message: (error as Error).message,
    });
    await cancelRunForWake({
      run: initialRun,
      wakeup,
      summary: (error as Error).message,
      wakeStatus: 'failed',
      contextPatch: { reason: (error as Error).message },
      eventType: 'run.failed',
      eventLevel: 'error',
    });
    await replaceRuntimeState({
      automation_agent_id: wakeup.automation_agent_id,
      repo_id: wakeup.repo_id || null,
      active_session_id: null,
      active_host_id: null,
      last_session_id: runtime.state?.last_session_id || null,
      last_run_id: initialRun.id,
      runtime_status: 'error',
      state_json: { last_error: (error as Error).message },
      usage_rollup_json: asObject(runtime.state?.usage_rollup_json),
    });
  }
}

async function processQueuedWakeups(logger: FastifyBaseLogger): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    const wakeup = await automationDb.claimNextAutomationWakeup();
    if (!wakeup) return;
    publishAutomationWakeup(wakeup);
    await processWakeup(logger, wakeup);
  }
}

async function queueFollowupWake(run: AutomationRun): Promise<void> {
  const pending = Array.isArray(run.pending_followups_json) ? run.pending_followups_json : [];
  if (pending.length === 0) return;

  const agentResult = await db.pool.query(
    `SELECT user_id
     FROM automation_agents
     WHERE id = $1
     LIMIT 1`,
    [run.automation_agent_id]
  );
  const userId = agentResult.rows[0]?.user_id as string | undefined;
  if (!userId) return;

  const followup = await automationDb.createAutomationWakeup(userId, run.automation_agent_id, {
    source: 'followup',
    repo_id: run.repo_id || undefined,
    context_json: mergeContexts(pending.map((entry: Record<string, unknown>) => asObject(entry))),
    idempotency_key: `followup:${run.id}:${pending.length}`,
  });
  publishAutomationWakeup(followup);

  await automationDb.updateAutomationRun(run.id, {
    pending_followups_json: [],
  });
  await appendRunEvent({
    automation_run_id: run.id,
    event_type: 'followup.queued',
    message: `Queued ${pending.length} coalesced follow-up wakeup${pending.length === 1 ? '' : 's'}.`,
    payload: {
      followup_wakeup_id: followup.id,
      coalesced_count: pending.length,
    },
  });
}

async function syncActiveRuns(logger: FastifyBaseLogger): Promise<void> {
  const activeRuns = await automationDb.listActiveAutomationRuns();
  const now = Date.now();

  for (const run of activeRuns) {
    if (!run.session_id) continue;
    const session = await db.getSessionById(run.session_id);
    if (!session) {
      logger.warn({ automationRunId: run.id }, 'Automation run session missing during sync');
      const failedRun = await automationDb.updateAutomationRun(run.id, {
        status: 'failed',
        result_summary: 'Session missing during automation sync',
        ended_at: new Date().toISOString(),
      });
      if (failedRun) {
        await publishAutomationRun(failedRun, 'unknown');
        await appendRunEvent({
          automation_run_id: failedRun.id,
          event_type: 'internal.error',
          level: 'error',
          message: 'Session missing during automation sync.',
        });
      }
      continue;
    }

    const startedAt = run.started_at ? new Date(run.started_at).getTime() : 0;
    const settledIdle =
      (session.status === 'WAITING_FOR_INPUT' || session.status === 'IDLE')
      && startedAt > 0
      && now - startedAt >= RUN_IDLE_COMPLETION_GRACE_MS;
    const terminal = session.status === 'DONE' || session.status === 'ERROR' || settledIdle;
    if (!terminal) {
      continue;
    }

    try {
      const finalized = await automationDb.finalizeAutomationRunFromSession(run);
      await publishAutomationRun(finalized.run, session.provider);
      await appendRunEvent({
        automation_run_id: finalized.run.id,
        event_type: 'session.finalized',
        message: `Session ${session.id} finalized with status ${session.status}.`,
        payload: {
          session_id: session.id,
          session_status: session.status,
        },
      });
      if (finalized.ingested.memory) {
        await appendRunEvent({
          automation_run_id: finalized.run.id,
          event_type: 'memory.ingested',
          message: `Ingested memory ${finalized.ingested.memory.id}.`,
          payload: {
            memory_id: finalized.ingested.memory.id,
            trajectory_id: finalized.ingested.trajectory?.id || null,
          },
        });
      }
      if (finalized.work_item) {
        pubsub.publishWorkItemUpdated(finalized.work_item);
      }

      if (session.status === 'WAITING_FOR_INPUT' || session.status === 'IDLE') {
        await replaceRuntimeState({
          automation_agent_id: finalized.run.automation_agent_id,
          repo_id: finalized.run.repo_id || null,
          active_session_id: session.id,
          active_host_id: session.host_id,
          last_session_id: session.id,
          last_run_id: finalized.run.id,
          runtime_status: 'attached',
          state_json: {
            session_status: session.status,
            reusable: true,
          },
          usage_rollup_json: asObject(finalized.run.usage_json),
        });
      } else {
        await replaceRuntimeState({
          automation_agent_id: finalized.run.automation_agent_id,
          repo_id: finalized.run.repo_id || null,
          active_session_id: null,
          active_host_id: null,
          last_session_id: session.id,
          last_run_id: finalized.run.id,
          runtime_status: session.status === 'ERROR' ? 'error' : 'idle',
          state_json: {
            session_status: session.status,
            reusable: false,
          },
          usage_rollup_json: asObject(finalized.run.usage_json),
        });
      }

      await queueFollowupWake(finalized.run);
    } catch (error) {
      logger.error({ error, automationRunId: run.id }, 'Failed to finalize automation run');
      await appendRunEvent({
        automation_run_id: run.id,
        event_type: 'internal.error',
        level: 'error',
        message: (error as Error).message,
      });
    }
  }
}

async function syncFinishedSessionsToMemory(logger: FastifyBaseLogger): Promise<void> {
  const sessions = await automationDb.listFinishedSessionsPendingMemoryIngestion(10);
  for (const session of sessions) {
    try {
      const ingested = await automationDb.ingestSessionToMemory({ session_id: session.id });
      if (ingested.memory || ingested.trajectory) {
        logger.info({ sessionId: session.id }, 'Ingested finished session into memory');
      }
    } catch (error) {
      logger.error({ error, sessionId: session.id }, 'Failed to ingest finished session into memory');
    }
  }
}

async function reconcileRuntimeStates(logger: FastifyBaseLogger): Promise<void> {
  const states = await automationDb.listAutomationRuntimeStates();
  for (const state of states) {
    if (!state.active_session_id) continue;
    const session = await db.getSessionById(state.active_session_id);
    const hostId = state.active_host_id || session?.host_id || null;
    const hostConnected = hostId ? pubsub.isAgentConnected(hostId) : false;
    if (!session || !hostConnected || session.status === 'DONE' || session.status === 'ERROR') {
      try {
        await replaceRuntimeState({
          automation_agent_id: state.automation_agent_id,
          repo_id: state.repo_id || null,
          active_session_id: null,
          active_host_id: null,
          last_session_id: session?.id || state.last_session_id || state.active_session_id || null,
          last_run_id: state.last_run_id || null,
          runtime_status: !session || !hostConnected ? 'stale' : session.status === 'ERROR' ? 'error' : 'idle',
          state_json: {
            ...asObject(state.state_json),
            reconciliation_reason:
              !session ? 'missing_session'
              : !hostConnected ? 'host_offline'
              : session.status.toLowerCase(),
          },
          usage_rollup_json: asObject(state.usage_rollup_json),
        });
      } catch (error) {
        logger.error({ error, runtimeStateId: state.id }, 'Failed to reconcile runtime state');
      }
    }
  }
}

export function startAutomationService(logger: FastifyBaseLogger): { stop: () => void } {
  let stopped = false;
  let running = false;
  let lastDistillationAt = 0;

  const tick = async (): Promise<void> => {
    if (stopped || running) return;
    running = true;
    try {
      await enqueueDueScheduledWakeups(logger);
      await reconcileRuntimeStates(logger);
      await processQueuedWakeups(logger);
      await syncActiveRuns(logger);
      await syncFinishedSessionsToMemory(logger);

      const now = Date.now();
      if (now - lastDistillationAt > 60 * 60_000) {
        const promoted = await automationDb.distillTrajectories(10);
        if (promoted > 0) {
          logger.info({ promoted }, 'Distilled memory trajectories into semantic memories');
        }
        lastDistillationAt = now;
      }
    } catch (error) {
      logger.error({ error }, 'Automation service tick failed');
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, DEFAULT_TICK_MS);
  void tick();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
