import { resolveControlPlaneAuthMode, type RuntimeConfig } from './config.js';
import {
  FeatureUnavailableError,
  isMissingRoute,
  requestJson,
  requiresSessionOrServiceAuth,
  type Fetch,
} from './http.js';

export class OperatorModeRequiredError extends Error {
  constructor(readonly operation: string) {
    super(
      `${operation} requires AC_CONTROL_PLANE_AUTH_MODE=operator and an operator credential`,
    );
    this.name = 'OperatorModeRequiredError';
  }
}

function waitConditionMet(until: WaitUntil, initial: string, current: string): boolean {
  switch (until) {
    case 'done':
      return current === 'DONE' || current === 'ERROR';
    case 'waiting':
      return current === 'WAITING_FOR_INPUT'
        || current === 'WAITING_FOR_APPROVAL'
        || current === 'IDLE';
    case 'any-change':
      return current !== initial;
  }
}

export interface SpawnWorkerInput {
  provider: string;
  cwd: string;
  prompt?: string;
  placement: 'window' | 'split';
  split_target?: string;
  name?: string;
  env?: Record<string, string>;
  flags?: string[];
  host_id?: string;
  host_alias?: string;
}

export interface SpawnWorkerResult {
  session_id: string;
  tmux_target: string;
  pane_id: string;
}

export interface RemoteSpawnWorkerResult {
  session_id: string;
  status?: string;
  terminal?: { openable?: boolean; pane_id?: string | null };
}

export interface AgentSession {
  session_id: string;
  pane_id?: string;
  tmux_target?: string;
  provider: string;
  status: string;
  name?: string;
  cwd?: string;
  parent_session_id?: string;
  child_session_ids: string[];
}

export interface ListSessionsResult {
  sessions: AgentSession[];
}

export interface ControlPlaneSession {
  id: string;
  provider: string;
  status: string;
  title?: string | null;
  working_directory?: string | null;
  parent_session_id?: string | null;
  host_id?: string | null;
  tmux_target?: string | null;
}

export interface RemoteListSessionsResult {
  sessions: ControlPlaneSession[];
  total?: number;
  limit?: number;
  offset?: number;
  session_id?: string;
  rollup?: unknown;
  agent_tasks?: unknown[];
}

export interface ListSessionsInput {
  remote?: boolean;
  host_id?: string;
}

export interface SendInput {
  session_id: string;
  input: string;
  enter?: boolean;
  remote?: boolean;
}

export interface OkResult {
  ok: boolean;
}

export interface CommandDispatchResult {
  cmd_id: string;
}

export interface KillSessionInput {
  session_id: string;
  tree?: boolean;
  remote?: boolean;
}

export interface KillSessionResult {
  killed_session_ids: string[];
}

export interface BulkKillResult {
  operation: 'terminate';
  success_count: number;
  error_count: number;
}

interface SessionGraphResult {
  edges: Array<{
    parent_session_id: string;
    child_session_id: string;
  }>;
}

export type WaitUntil = 'done' | 'waiting' | 'any-change';

export interface WaitForInput {
  session_id: string;
  until: WaitUntil;
  timeout_ms: number;
  remote?: boolean;
}

export interface WaitForResult {
  session: AgentSession | ControlPlaneSession;
}

export type ReportOutcome = 'succeeded' | 'failed' | 'blocked';

export interface ReportResultInput {
  outcome: ReportOutcome;
  summary: string;
  detail?: string;
  run_id?: string;
}

export type ReportResult = OkResult | Record<string, unknown>;

export interface WorkItem extends Record<string, unknown> {
  id: string;
  title: string;
  status: string;
}

export interface ListWorkItemsInput {
  status?: string;
  repo_id?: string;
  assigned_automation_agent_id?: string;
  limit?: number;
}

export interface ListWorkItemsResult {
  work_items: WorkItem[];
}

export interface ClaimWorkItemInput {
  work_item_id?: string;
  repo_id?: string;
}

export interface WorkItemResult {
  work_item: WorkItem;
}

export type WorkCompletionStatus = 'done' | 'blocked' | 'cancelled';

export type MemoryScope = 'global' | 'repo' | 'working';
export type MemoryTier = 'working' | 'episodic' | 'semantic' | 'procedural';

export interface MemorySearchInput {
  q: string;
  scope_type?: MemoryScope;
  repo_id?: string;
  tier?: MemoryTier;
  limit?: number;
}

export interface MemoryEntry extends Record<string, unknown> {
  id: string;
  summary: string;
}

export interface MemorySearchResult {
  results: MemoryEntry[];
}

export interface MemoryWriteInput {
  scope_type: MemoryScope;
  repo_id?: string;
  session_id?: string;
  tier: MemoryTier;
  summary: string;
  content: string;
  metadata?: Record<string, unknown>;
  confidence?: number;
  expires_at?: string;
}

export interface MemoryWriteResult {
  entry: MemoryEntry;
}

export interface RosterSession extends Record<string, unknown> {
  id: string;
  tmux_target?: string | null;
  title?: string | null;
  status?: string;
}

export interface RosterResult {
  sessions: RosterSession[];
  total: number;
}

export class AgentCommandClient {
  constructor(
    private readonly config: RuntimeConfig,
    private readonly fetch: Fetch,
  ) {}

  async spawnWorker(input: SpawnWorkerInput): Promise<SpawnWorkerResult | RemoteSpawnWorkerResult> {
    if (input.host_id || input.host_alias) {
      if (input.placement === 'split') {
        throw new Error('Cross-host spawn does not support split placement');
      }
      if (input.env && Object.keys(input.env).length > 0) {
        throw new Error('Cross-host spawn does not support custom environment variables');
      }
      if (input.host_alias && !this.isOperatorMode()) {
        throw new OperatorModeRequiredError('Cross-host spawn by host alias');
      }
      if (input.host_id) {
        try {
          return await this.provisionalControlRequest(
            'session-scoped cross-host spawning',
            '/v1/orchestrator/spawn',
            {
              host_id: input.host_id,
              provider: input.provider,
              working_directory: input.cwd,
              ...(input.name ? { title: input.name } : {}),
              ...(input.flags ? { flags: input.flags } : {}),
              ...(input.prompt ? { prompt: input.prompt } : {}),
            },
            'POST',
          );
        } catch (error) {
          if (!this.canUseOperatorFallback(error)) throw error;
        }
      }
      return this.controlRequest('/v1/launch', {
        ...(input.host_id ? { host_id: input.host_id } : {}),
        ...(input.host_alias ? { host_alias: input.host_alias } : {}),
        provider: input.provider,
        working_directory: input.cwd,
        ...(input.name ? { title: input.name } : {}),
        ...(input.flags ? { flags: input.flags } : {}),
        ...(input.prompt ? { prompt: input.prompt } : {}),
        ...(this.config.sessionId ? { parent_session_id: this.config.sessionId } : {}),
        role: 'worker',
        wait: true,
      }, 'POST');
    }

    const { host_id: _hostId, host_alias: _hostAlias, ...localInput } = input;
    return this.localRequest('/v1/agent/spawn', localInput, 'POST');
  }

  async listSessions(
    input: ListSessionsInput = {},
  ): Promise<ListSessionsResult | RemoteListSessionsResult> {
    if ((input.remote || input.host_id) && !this.isOperatorMode()) {
      try {
        const result = await this.provisionalControlRequest<{
          session_id: string;
          children: ControlPlaneSession[];
          rollup: unknown;
          agent_tasks: unknown[];
        }>('session-scoped child listing', '/v1/orchestrator/children');
        const sessions = input.host_id
          ? result.children.filter((child) => child.host_id === input.host_id)
          : result.children;
        return {
          session_id: result.session_id,
          sessions,
          rollup: input.host_id ? undefined : result.rollup,
          agent_tasks: result.agent_tasks,
        };
      } catch (error) {
        if (!this.canUseOperatorFallback(error)) throw error;
      }
    }
    if (input.remote || input.host_id) {
      const query = new URLSearchParams();
      if (input.host_id) query.set('host_id', input.host_id);
      const suffix = query.size > 0 ? `?${query.toString()}` : '';
      return this.controlRequest(`/v1/sessions${suffix}`);
    }
    return this.localRequest('/v1/agent/sessions');
  }

  async sendInput(input: SendInput): Promise<OkResult | CommandDispatchResult> {
    const { remote, ...request } = input;
    if (remote) {
      try {
        return await this.provisionalControlRequest(
          'session-scoped child input',
          `/v1/orchestrator/children/${encodeURIComponent(input.session_id)}/input`,
          { input: input.input, enter: input.enter ?? true },
          'POST',
        );
      } catch (error) {
        if (!this.canUseOperatorFallback(error)) throw error;
      }
      return this.controlRequest(
        `/v1/sessions/${encodeURIComponent(input.session_id)}/commands`,
        {
          type: 'send_input',
          payload: { text: input.input, enter: input.enter ?? true },
        },
        'POST',
      );
    }
    return this.localRequest('/v1/agent/send', request, 'POST');
  }

  async killSession(input: KillSessionInput): Promise<KillSessionResult | BulkKillResult> {
    const { remote, ...request } = input;
    if (remote) {
      this.requireOperatorMode('Cross-host kill');
      let sessionIds = [input.session_id];
      if (input.tree) {
        sessionIds = await this.remoteDescendantFirst(input.session_id);
      }
      return this.controlRequest('/v1/sessions/bulk', {
        operation: 'terminate',
        session_ids: sessionIds,
      }, 'POST');
    }
    return this.localRequest('/v1/agent/kill', request, 'POST');
  }

  async waitFor(input: WaitForInput): Promise<WaitForResult> {
    const { remote, ...request } = input;
    if (!remote) return this.localRequest('/v1/agent/wait', request, 'POST');

    const startedAt = Date.now();
    let initialStatus: string | undefined;
    while (true) {
      const result = await this.getRemoteSession(input.session_id);
      const currentStatus = result.session.status;
      if (initialStatus === undefined) initialStatus = currentStatus;
      if (waitConditionMet(input.until, initialStatus, currentStatus)) {
        return { session: result.session };
      }

      const elapsed = Date.now() - startedAt;
      if (elapsed >= input.timeout_ms) {
        throw new Error(`Wait timed out after ${input.timeout_ms}ms`);
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(250, input.timeout_ms - elapsed)));
    }
  }

  async reportResult(input: ReportResultInput): Promise<ReportResult> {
    const { run_id, ...report } = input;
    if (run_id) {
      return this.provisionalControlRequest(
        'structured automation-run reporting',
        `/v1/automation-runs/${encodeURIComponent(run_id)}/report`,
        report,
        'POST',
      );
    }
    return this.localRequest('/v1/agent/report', report, 'POST');
  }

  async listWorkItems(input: ListWorkItemsInput = {}): Promise<ListWorkItemsResult> {
    if (!this.isOperatorMode() && (input.repo_id || input.assigned_automation_agent_id)) {
      throw new OperatorModeRequiredError(
        'Filtering work items by explicit repository or automation agent',
      );
    }
    const scopedQuery = new URLSearchParams();
    if (input.status) scopedQuery.set('status', input.status);
    if (input.limit !== undefined) scopedQuery.set('limit', String(input.limit));
    const scopedSuffix = scopedQuery.size > 0 ? `?${scopedQuery.toString()}` : '';
    if (!this.isOperatorMode() || (!input.repo_id && !input.assigned_automation_agent_id)) {
      try {
        return await this.provisionalControlRequest<ListWorkItemsResult>(
          'session-scoped work-item listing',
          `/v1/orchestrator/work-items${scopedSuffix}`,
        );
      } catch (error) {
        if (!this.canUseOperatorFallback(error)) throw error;
      }
    }
    const query = new URLSearchParams(scopedQuery);
    if (input.repo_id) query.set('repo_id', input.repo_id);
    if (input.assigned_automation_agent_id) {
      query.set('assigned_automation_agent_id', input.assigned_automation_agent_id);
    }
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    return this.controlRequest(`/v1/work-items${suffix}`);
  }

  async claimWorkItem(input: ClaimWorkItemInput): Promise<WorkItemResult> {
    return this.provisionalControlRequest(
      'session-scoped work-item claims',
      '/v1/orchestrator/work-items/claim',
      input,
      'POST',
    );
  }

  async completeWorkItem(
    workItemId: string,
    status: WorkCompletionStatus = 'done',
    result?: Record<string, unknown>,
  ): Promise<WorkItemResult> {
    return this.provisionalControlRequest(
      'session-scoped work-item completion',
      `/v1/orchestrator/work-items/${encodeURIComponent(workItemId)}/complete`,
      { status, ...(result ? { result } : {}) },
      'POST',
    );
  }

  async searchMemory(input: MemorySearchInput): Promise<MemorySearchResult> {
    if (input.repo_id && !this.isOperatorMode()) {
      throw new OperatorModeRequiredError('Searching memory for an explicit repository');
    }
    const query = new URLSearchParams({ q: input.q });
    if (input.scope_type) query.set('scope_type', input.scope_type);
    if (input.repo_id) query.set('repo_id', input.repo_id);
    if (input.tier) query.set('tier', input.tier);
    if (input.limit !== undefined) query.set('limit', String(input.limit));
    if (!input.repo_id) {
      try {
        return await this.provisionalControlRequest(
          'session-scoped memory search',
          `/v1/orchestrator/memory/search?${query.toString()}`,
        );
      } catch (error) {
        if (!this.canUseOperatorFallback(error)) throw error;
      }
    }
    return this.controlRequest(`/v1/memory/search?${query.toString()}`);
  }

  async writeMemory(input: MemoryWriteInput): Promise<MemoryWriteResult> {
    if (!this.isOperatorMode() && (input.repo_id || input.session_id)) {
      throw new OperatorModeRequiredError('Writing memory for an explicit repository or session');
    }
    if (!input.repo_id && !input.session_id) {
      const {
        repo_id: _repoId,
        session_id: _sessionId,
        ...sessionScopedInput
      } = input;
      try {
        return await this.provisionalControlRequest(
          'session-scoped memory writes',
          '/v1/orchestrator/memory',
          sessionScopedInput,
          'POST',
        );
      } catch (error) {
        if (!this.canUseOperatorFallback(error)) throw error;
      }
    }
    return this.controlRequest('/v1/memory', {
      ...input,
      session_id: input.session_id ?? this.config.sessionId,
    }, 'POST');
  }

  async getRoster(hostId?: string): Promise<RosterResult> {
    if (!this.isOperatorMode()) {
      const result = await this.provisionalControlRequest<{
        children: ControlPlaneSession[];
      }>('session-scoped roster', '/v1/orchestrator/children');
      const sessions: RosterSession[] = result.children
        .filter((child) => !hostId || child.host_id === hostId)
        .map((child) => ({
          id: child.id,
          tmux_target: child.tmux_target,
          title: child.title,
          status: child.status,
          host_id: child.host_id,
          provider: child.provider,
        }));
      return { sessions, total: sessions.length };
    }
    const query = new URLSearchParams();
    if (hostId) query.set('host_id', hostId);
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    return this.controlRequest(`/v1/tmux/roster${suffix}`);
  }

  private async localRequest<T>(
    path: string,
    body?: unknown,
    method: 'GET' | 'POST' = 'GET',
  ): Promise<T> {
    if (!this.config.sessionId) {
      throw new Error('AC_SESSION_ID is required for local agentd operations');
    }
    return requestJson<T>(this.fetch, `${this.config.agentdUrl}${path}`, {
      method,
      headers: { 'X-AC-Session-Id': this.config.sessionId },
      body,
    });
  }


  private async controlRequest<T>(
    path: string,
    body?: unknown,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
  ): Promise<T> {
    if (!this.config.controlPlaneUrl || !this.config.controlPlaneToken) {
      throw new Error(
        'Control-plane operations require AC_CONTROL_PLANE_URL and AC_CONTROL_PLANE_TOKEN',
      );
    }
    return requestJson<T>(this.fetch, `${this.config.controlPlaneUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.config.controlPlaneToken}`,
        ...(this.config.sessionId ? { 'X-AC-Session-Id': this.config.sessionId } : {}),
      },
      body,
    });
  }

  private async provisionalControlRequest<T>(
    feature: string,
    path: string,
    body?: unknown,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
  ): Promise<T> {
    try {
      return await this.controlRequest(path, body, method);
    } catch (error) {
      if (isMissingRoute(error)) throw new FeatureUnavailableError(feature);
      throw error;
    }
  }

  private isOperatorMode(): boolean {
    return resolveControlPlaneAuthMode(this.config) === 'operator';
  }

  private requireOperatorMode(operation: string): void {
    if (!this.isOperatorMode()) throw new OperatorModeRequiredError(operation);
  }

  private canUseOperatorFallback(error: unknown): boolean {
    return this.isOperatorMode()
      && (error instanceof FeatureUnavailableError || requiresSessionOrServiceAuth(error));
  }

  private async remoteDescendantFirst(rootSessionId: string): Promise<string[]> {
    const result: string[] = [];
    const visited = new Set<string>();
    const visit = async (sessionId: string): Promise<void> => {
      if (visited.has(sessionId)) return;
      visited.add(sessionId);
      const graph = await this.controlRequest<SessionGraphResult>(
        `/v1/sessions/${encodeURIComponent(sessionId)}/graph`,
      );
      const childIds = graph.edges
        .filter((edge) => edge.parent_session_id === sessionId)
        .map((edge) => edge.child_session_id);
      for (const childId of childIds) await visit(childId);
      result.push(sessionId);
    };
    await visit(rootSessionId);
    return result;
  }

  private async getRemoteSession(
    sessionId: string,
  ): Promise<{ session: ControlPlaneSession }> {
    const encoded = encodeURIComponent(sessionId);
    try {
      return await this.provisionalControlRequest(
        'session-scoped child status',
        `/v1/orchestrator/children/${encoded}`,
      );
    } catch (error) {
      if (!this.canUseOperatorFallback(error)) throw error;
      return this.controlRequest(`/v1/sessions/${encoded}`);
    }
  }
}
