import { Command, CommanderError, InvalidArgumentError } from 'commander';
import { loadRuntimeConfig, type Environment, type RuntimeConfig } from './config.js';
import { ApiError, FeatureUnavailableError, type Fetch } from './http.js';
import { startMcpServer } from './mcp.js';
import {
  AgentCommandClient,
  type AgentSession,
  type ControlPlaneSession,
  type MemoryScope,
  type MemoryTier,
  OperatorModeRequiredError,
  type ReportOutcome,
  type SpawnWorkerInput,
  type WaitUntil,
  type WorkCompletionStatus,
} from './operations.js';

export interface CliDependencies {
  fetch?: Fetch;
  env?: Environment;
  writeOut?: (value: string) => void;
  writeErr?: (value: string) => void;
  startMcp?: (client: AgentCommandClient) => Promise<void>;
}

function cleanObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return `Agent Commander request failed (${error.status}): ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

function jsonError(error: unknown): Record<string, unknown> {
  if (error instanceof OperatorModeRequiredError) {
    return {
      error: {
        code: 'operator_auth_required',
        message: error.message,
        operation: error.operation,
      },
    };
  }
  if (error instanceof FeatureUnavailableError) {
    return {
      error: {
        code: 'feature_unavailable',
        message: error.message,
        feature: error.feature,
        status: error.status,
      },
    };
  }
  if (error instanceof ApiError) {
    return {
      error: {
        code: 'http_error',
        message: error.message,
        status: error.status,
        details: error.details,
      },
    };
  }
  return {
    error: {
      code: 'cli_error',
      message: errorMessage(error),
    },
  };
}

function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError('must be a positive integer');
  }
  return parsed;
}

function confidence(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new InvalidArgumentError('must be a number from 0 to 1');
  }
  return parsed;
}

function jsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new InvalidArgumentError('must be a JSON object');
  }
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function collectEnvironment(
  value: string,
  previous: Record<string, string>,
): Record<string, string> {
  const separator = value.indexOf('=');
  if (separator <= 0) {
    throw new InvalidArgumentError('must use KEY=VALUE');
  }
  return {
    ...previous,
    [value.slice(0, separator)]: value.slice(separator + 1),
  };
}

function waitUntil(value: string): WaitUntil {
  if (value === 'done' || value === 'waiting' || value === 'any-change') return value;
  throw new InvalidArgumentError('must be done, waiting, or any-change');
}

function reportOutcome(value: string): ReportOutcome {
  if (value === 'succeeded' || value === 'failed' || value === 'blocked') return value;
  throw new InvalidArgumentError('must be succeeded, failed, or blocked');
}

function completionStatus(value: string): WorkCompletionStatus {
  if (value === 'done' || value === 'blocked' || value === 'cancelled') return value;
  throw new InvalidArgumentError('must be done, blocked, or cancelled');
}

function spawnPlacement(value: string): SpawnWorkerInput['placement'] {
  if (value === 'window' || value === 'split') return value;
  throw new InvalidArgumentError('must be window or split');
}

function memoryScope(value: string): MemoryScope {
  if (value === 'global' || value === 'repo' || value === 'working') return value;
  throw new InvalidArgumentError('must be global, repo, or working');
}

function memoryTier(value: string): MemoryTier {
  if (
    value === 'working'
    || value === 'episodic'
    || value === 'semantic'
    || value === 'procedural'
  ) return value;
  throw new InvalidArgumentError('must be working, episodic, semantic, or procedural');
}

function sessionLabel(session: AgentSession): string {
  return `${session.name || session.session_id} [${session.status}] (${session.session_id})`;
}

export function formatSessionTree(sessions: AgentSession[]): string {
  const byId = new Map(sessions.map((session) => [session.session_id, session]));
  const children = new Map<string, AgentSession[]>();
  for (const session of sessions) {
    if (session.parent_session_id && byId.has(session.parent_session_id)) {
      const siblings = children.get(session.parent_session_id) ?? [];
      siblings.push(session);
      children.set(session.parent_session_id, siblings);
    }
  }

  const roots = sessions.filter((session) => (
    !session.parent_session_id || !byId.has(session.parent_session_id)
  ));
  const lines: string[] = [];
  const visited = new Set<string>();

  function visit(session: AgentSession, prefix: string, connector: string): void {
    if (visited.has(session.session_id)) return;
    visited.add(session.session_id);
    lines.push(`${prefix}${connector}${sessionLabel(session)}`);
    const descendants = children.get(session.session_id) ?? [];
    descendants.forEach((child, index) => {
      const last = index === descendants.length - 1;
      visit(child, `${prefix}${connector ? (connector === '└─ ' ? '   ' : '│  ') : ''}`, last ? '└─ ' : '├─ ');
    });
  }

  roots.forEach((root) => visit(root, '', ''));
  sessions.forEach((session) => visit(session, '', ''));
  return lines.length > 0 ? `${lines.join('\n')}\n` : 'No sessions.\n';
}

function normalizeSession(session: AgentSession | ControlPlaneSession): AgentSession {
  if ('session_id' in session) return session;
  return {
    session_id: session.id,
    provider: session.provider,
    status: session.status,
    name: session.title ?? undefined,
    cwd: session.working_directory ?? undefined,
    parent_session_id: session.parent_session_id ?? undefined,
    child_session_ids: [],
  };
}

export async function runCli(
  argv: string[],
  dependencies: CliDependencies = {},
): Promise<number> {
  const writeOut = dependencies.writeOut ?? ((value) => process.stdout.write(value));
  const writeErr = dependencies.writeErr ?? ((value) => process.stderr.write(value));
  const wantsJson = argv.includes('--json') || argv.includes('-j');
  let config: RuntimeConfig;
  try {
    config = await loadRuntimeConfig({ env: dependencies.env });
  } catch (error) {
    if (wantsJson) {
      writeErr(`${JSON.stringify(jsonError(error))}\n`);
    } else {
      writeErr(`${errorMessage(error)}\n`);
    }
    return 1;
  }
  const client = new AgentCommandClient(config, dependencies.fetch ?? globalThis.fetch);
  const program = new Command();
  const commanderStderr: string[] = [];

  program
    .name('ac')
    .description('Agent Commander CLI')
    .option('-j, --json', 'emit machine-readable JSON')
    .exitOverride()
    .configureOutput({
      writeOut: (value) => writeOut(value),
      writeErr: (value) => commanderStderr.push(value),
    });

  program
    .command('ls')
    .description('list sessions as a tree')
    .option('--remote', 'use the control plane')
    .option('--host <host-id>', 'filter control-plane sessions by host ID')
    .action(async (options: { remote?: boolean; host?: string }) => {
      const result = await client.listSessions({
        remote: options.remote,
        host_id: options.host,
      });
      if (program.opts<{ json?: boolean }>().json) {
        writeOut(`${JSON.stringify(result)}\n`);
      } else {
        writeOut(formatSessionTree(result.sessions.map(normalizeSession)));
      }
    });

  program
    .command('send')
    .description('send input to a session')
    .argument('<session-id>', 'target session ID')
    .argument('<input>', 'input text')
    .option('--no-enter', 'do not press enter after sending')
    .option('--remote', 'use the control plane')
    .action(async (
      sessionId: string,
      input: string,
      options: { enter: boolean; remote?: boolean },
    ) => {
      const result = await client.sendInput({
        session_id: sessionId,
        input,
        enter: options.enter,
        remote: options.remote,
      });
      if (program.opts<{ json?: boolean }>().json) {
        writeOut(`${JSON.stringify(result)}\n`);
      } else {
        writeOut(`Sent input to ${sessionId}.\n`);
      }
    });

  program
    .command('kill')
    .description('kill a session')
    .argument('<session-id>', 'target session ID')
    .option('--tree', 'kill descendants before the target')
    .option('--remote', 'use the control plane')
    .action(async (
      sessionId: string,
      options: { tree?: boolean; remote?: boolean },
    ) => {
      const result = await client.killSession({
        session_id: sessionId,
        tree: options.tree ?? false,
        remote: options.remote,
      });
      if (program.opts<{ json?: boolean }>().json) {
        writeOut(`${JSON.stringify(result)}\n`);
      } else {
        if ('killed_session_ids' in result) {
          writeOut(`Killed ${result.killed_session_ids.join(', ')}.\n`);
        } else {
          writeOut(`Killed ${result.success_count} session(s); ${result.error_count} failed.\n`);
        }
      }
    });

  program
    .command('wait')
    .description('wait for a session state')
    .argument('<session-id>', 'target session ID')
    .option('--until <state>', 'done, waiting, or any-change', waitUntil, 'done')
    .option('--timeout <milliseconds>', 'timeout in milliseconds', positiveInteger, 60000)
    .option('--remote', 'use the control plane')
    .action(async (
      sessionId: string,
      options: { until: WaitUntil; timeout: number; remote?: boolean },
    ) => {
      const result = await client.waitFor({
        session_id: sessionId,
        until: options.until,
        timeout_ms: options.timeout,
        remote: options.remote,
      });
      if (program.opts<{ json?: boolean }>().json) {
        writeOut(`${JSON.stringify(result)}\n`);
      } else {
        writeOut(`${sessionLabel(normalizeSession(result.session))}\n`);
      }
    });

  program
    .command('report')
    .description('report a structured result for the caller session')
    .argument('<outcome>', 'succeeded, failed, or blocked', reportOutcome)
    .argument('<summary>', 'result summary')
    .option('--detail <text>', 'result detail')
    .option('--run <run-id>', 'report to a control-plane automation run')
    .action(async (
      outcome: ReportOutcome,
      summary: string,
      options: { detail?: string; run?: string },
    ) => {
      const result = await client.reportResult(cleanObject({
        outcome,
        summary,
        detail: options.detail,
        run_id: options.run,
      }));
      if (program.opts<{ json?: boolean }>().json) {
        writeOut(`${JSON.stringify(result)}\n`);
      } else {
        writeOut(`Reported ${outcome}: ${summary}\n`);
      }
    });

  const work = program
    .command('work')
    .description('manage control-plane work items');

  work
    .command('ls')
    .description('list work items')
    .option('--status <status>', 'filter by status')
    .option('--repo <repo-id>', 'filter by repository ID')
    .option('--agent <agent-id>', 'filter by assigned automation agent')
    .option('--limit <count>', 'maximum result count', positiveInteger)
    .action(async (options: {
      status?: string;
      repo?: string;
      agent?: string;
      limit?: number;
    }) => {
      const result = await client.listWorkItems(cleanObject({
        status: options.status,
        repo_id: options.repo,
        assigned_automation_agent_id: options.agent,
        limit: options.limit,
      }));
      if (program.opts<{ json?: boolean }>().json) {
        writeOut(`${JSON.stringify(result)}\n`);
      } else if (result.work_items.length === 0) {
        writeOut('No work items.\n');
      } else {
        writeOut(`${result.work_items.map((item) => (
          `${item.id} [${item.status}] ${item.title}`
        )).join('\n')}\n`);
      }
    });

  work
    .command('claim')
    .description('claim a work item for the caller session')
    .argument('[work-item-id]', 'specific work item ID; omit to claim next')
    .option('--repo <repo-id>', 'limit next-item claim to a repository')
    .action(async (workItemId: string | undefined, options: { repo?: string }) => {
      const result = await client.claimWorkItem(cleanObject({
        work_item_id: workItemId,
        repo_id: options.repo,
      }));
      if (program.opts<{ json?: boolean }>().json) {
        writeOut(`${JSON.stringify(result)}\n`);
      } else {
        writeOut(`Claimed ${result.work_item.id}: ${result.work_item.title}\n`);
      }
    });

  work
    .command('done')
    .description('complete a claimed work item')
    .argument('<work-item-id>', 'work item ID')
    .option('--status <status>', 'done, blocked, or cancelled', completionStatus, 'done')
    .option('--result <json>', 'structured completion evidence', jsonObject)
    .action(async (
      workItemId: string,
      options: { status: WorkCompletionStatus; result?: Record<string, unknown> },
    ) => {
      const result = await client.completeWorkItem(workItemId, options.status, options.result);
      if (program.opts<{ json?: boolean }>().json) {
        writeOut(`${JSON.stringify(result)}\n`);
      } else {
        writeOut(`${options.status} ${result.work_item.id}: ${result.work_item.title}\n`);
      }
    });

  const memory = program
    .command('memory')
    .description('search and write control-plane memory');

  memory
    .command('search')
    .description('search memory')
    .argument('<query>', 'search query')
    .option('--scope <scope>', 'global, repo, or working', memoryScope)
    .option('--repo <repo-id>', 'repository ID')
    .option('--tier <tier>', 'memory tier', memoryTier)
    .option('--limit <count>', 'maximum result count', positiveInteger)
    .action(async (query: string, options: {
      scope?: MemoryScope;
      repo?: string;
      tier?: MemoryTier;
      limit?: number;
    }) => {
      const result = await client.searchMemory(cleanObject({
        q: query,
        scope_type: options.scope,
        repo_id: options.repo,
        tier: options.tier,
        limit: options.limit,
      }));
      if (program.opts<{ json?: boolean }>().json) {
        writeOut(`${JSON.stringify(result)}\n`);
      } else if (result.results.length === 0) {
        writeOut('No memory results.\n');
      } else {
        writeOut(`${result.results.map((entry) => `${entry.id} ${entry.summary}`).join('\n')}\n`);
      }
    });

  memory
    .command('add')
    .description('write a memory entry')
    .requiredOption('--scope <scope>', 'global, repo, or working', memoryScope)
    .requiredOption('--tier <tier>', 'memory tier', memoryTier)
    .requiredOption('--summary <text>', 'memory summary')
    .requiredOption('--content <text>', 'memory content')
    .option('--repo <repo-id>', 'repository ID')
    .option('--session <session-id>', 'session ID; defaults to AC_SESSION_ID')
    .option('--metadata <json>', 'metadata JSON object', jsonObject)
    .option('--confidence <number>', 'confidence from 0 to 1', confidence)
    .option('--expires-at <timestamp>', 'ISO-8601 expiry timestamp')
    .action(async (options: {
      scope: MemoryScope;
      tier: MemoryTier;
      summary: string;
      content: string;
      repo?: string;
      session?: string;
      metadata?: Record<string, unknown>;
      confidence?: number;
      expiresAt?: string;
    }) => {
      const result = await client.writeMemory(cleanObject({
        scope_type: options.scope,
        repo_id: options.repo,
        session_id: options.session,
        tier: options.tier,
        summary: options.summary,
        content: options.content,
        metadata: options.metadata,
        confidence: options.confidence,
        expires_at: options.expiresAt,
      }));
      if (program.opts<{ json?: boolean }>().json) {
        writeOut(`${JSON.stringify(result)}\n`);
      } else {
        writeOut(`Added memory ${result.entry.id}: ${result.entry.summary}\n`);
      }
    });

  program
    .command('roster')
    .description('get the control-plane tmux roster')
    .option('--host <host-id>', 'filter by host ID')
    .action(async (options: { host?: string }) => {
      const result = await client.getRoster(options.host);
      if (program.opts<{ json?: boolean }>().json) {
        writeOut(`${JSON.stringify(result)}\n`);
      } else if (result.sessions.length === 0) {
        writeOut('No tmux sessions.\n');
      } else {
        writeOut(`${result.sessions.map((session) => (
          `${session.tmux_target || session.id} [${session.status || 'unknown'}] ${session.title || ''}`.trim()
        )).join('\n')}\n`);
      }
    });

  program
    .command('mcp')
    .description('start the Agent Commander MCP server over stdio')
    .action(async () => {
      await (dependencies.startMcp ?? startMcpServer)(client);
    });

  program
    .command('spawn')
    .description('spawn a worker session')
    .argument('[prompt]', 'initial worker prompt')
    .requiredOption('-p, --provider <provider>', 'provider name')
    .option('-C, --cwd <path>', 'working directory', process.cwd())
    .option('--placement <placement>', 'window or split', spawnPlacement, 'window')
    .option('--split-target <target>', 'split target pane or self')
    .option('--name <name>', 'worker name')
    .option('--env <key=value>', 'worker environment variable (repeatable)', collectEnvironment, {})
    .option('--flag <flag>', 'provider flag (repeatable)', collect, [])
    .option('--host <host-id>', 'spawn on a control-plane host ID')
    .option('--host-alias <alias>', 'spawn on a control-plane host alias')
    .action(async (prompt: string | undefined, options: {
      provider: string;
      cwd: string;
      placement: SpawnWorkerInput['placement'];
      splitTarget?: string;
      name?: string;
      env: Record<string, string>;
      flag: string[];
      host?: string;
      hostAlias?: string;
    }) => {
      const spawnInput: SpawnWorkerInput = cleanObject({
        provider: options.provider,
        cwd: options.cwd,
        prompt,
        placement: options.placement,
        split_target: options.splitTarget,
        name: options.name,
        env: Object.keys(options.env).length > 0 ? options.env : undefined,
        flags: options.flag.length > 0 ? options.flag : undefined,
        host_id: options.host,
        host_alias: options.hostAlias,
      });
      const result = await client.spawnWorker(spawnInput);
      if (program.opts<{ json?: boolean }>().json) {
        writeOut(`${JSON.stringify(result)}\n`);
      } else {
        if ('tmux_target' in result) {
          writeOut(`Spawned ${result.session_id} at ${result.tmux_target} (${result.pane_id})\n`);
        } else {
          writeOut(`Spawned ${result.session_id}${result.status ? ` [${result.status}]` : ''}\n`);
        }
      }
    });

  try {
    await program.parseAsync(['node', 'ac', ...argv]);
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.exitCode === 0) return 0;
      if (wantsJson) {
        writeErr(`${JSON.stringify({
          error: { code: 'cli_usage_error', message: error.message },
        })}\n`);
      } else {
        writeErr(commanderStderr.join('') || `${error.message}\n`);
      }
      return error.exitCode;
    }
    if (program.opts<{ json?: boolean }>().json) {
      writeErr(`${JSON.stringify(jsonError(error))}\n`);
    } else {
      writeErr(`${errorMessage(error)}\n`);
    }
    return 1;
  }
}
