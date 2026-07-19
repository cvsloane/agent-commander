import type { FastifyInstance } from 'fastify';
import {
  LaunchRequestSchema,
  LaunchTargetsResponseSchema,
  LaunchResponseSchema,
  type Host,
  type Project,
  type Session,
} from '@agent-command/schema';
import * as db from '../db/index.js';
import { hasRole } from '../auth/rbac.js';
import { isHostOnline } from '../services/hostPresence.js';
import {
  sendInputToSession,
  spawnSessionOnHost,
  waitForSessionOpenable,
} from '../services/sessionSpawn.js';
import { bootstrapSessionMemory, prepareSessionMemoryForSpawn } from '../services/sessionMemory.js';
import {
  fingerprintIdempotentRequest,
  getIdempotencyKey,
  IdempotencyConflictError,
  InvalidIdempotencyKeyError,
  scopeIdempotencyKey,
} from '../services/idempotency.js';

function getHostAlias(host: Host): string {
  return host.tailscale_name || host.name;
}

function getProviderSupport(host: Host): { codex: boolean; claude_code: boolean } {
  const providers = host.capabilities?.providers ?? {};
  const hasExplicitProviders = Object.keys(providers).length > 0;
  return {
    codex: !hasExplicitProviders || providers.codex === true,
    claude_code: !hasExplicitProviders || providers.claude_code === true,
  };
}

function recentProject(project: Project) {
  return {
    id: project.id,
    path: project.path,
    display_name: project.display_name,
    last_used_at: project.last_used_at,
  };
}

function recentTmux(session: Session) {
  return {
    session_id: session.id,
    title: session.title,
    tmux_target: session.tmux_target,
    pane_id: session.tmux_pane_id,
    cwd: session.cwd,
    provider: session.provider,
    status: session.status,
  };
}

async function resolveLaunchHost(hostId?: string, hostAlias?: string): Promise<Host | null> {
  if (hostId) {
    return db.getHostById(hostId);
  }

  const alias = hostAlias?.trim().toLowerCase();
  if (!alias) return null;

  const hosts = await db.getHosts();
  return hosts.find((host) => (
    host.name.toLowerCase() === alias ||
    host.tailscale_name?.toLowerCase() === alias
  )) ?? null;
}

function defaultTmuxTargetFromPath(path: string): string | undefined {
  return path.split('/').filter(Boolean).pop() || undefined;
}

function launchHref(hostId: string, sessionId: string): string {
  const params = new URLSearchParams({
    host_id: hostId,
    session_id: sessionId,
    mode: 'terminal',
    attach: '1',
  });
  return `/tmux?${params.toString()}`;
}

export function registerLaunchRoutes(app: FastifyInstance): void {
  app.get('/v1/launch/targets', async (request, reply) => {
    if (!request.user || !hasRole(request.user, 'viewer')) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const hosts = await db.getHosts();
    const targets = await Promise.all(hosts.map(async (host) => {
      const [projects, tmuxSessions, recentLaunches] = await Promise.all([
        db.getProjects(request.user!.id, { host_id: host.id, limit: 5 }),
        db.getTmuxRosterSessions(host.id),
        db.getRecentLaunches(request.user!.id, { host_id: host.id, limit: 5 }),
      ]);
      const roots = host.capabilities?.list_directory_roots ?? [];
      return {
        host_id: host.id,
        alias: getHostAlias(host),
        display_name: host.name,
        online: isHostOnline(host.id),
        supports_terminal: host.capabilities?.terminal === true,
        supports_spawn: host.capabilities?.spawn !== false,
        supports_directory_listing: host.capabilities?.list_directory === true,
        providers: getProviderSupport(host),
        roots,
        recent_projects: projects.slice(0, 5).map(recentProject),
        recent_tmux: tmuxSessions.slice(0, 5).map(recentTmux),
        recent_launches: recentLaunches,
      };
    }));

    return LaunchTargetsResponseSchema.parse({ targets });
  });

  app.post<{ Body: unknown }>('/v1/launch', async (request, reply) => {
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

    const body = LaunchRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: body.error });
    }

    const launch = body.data;
    const idempotencyKey = scopeIdempotencyKey(
      rawIdempotencyKey,
      'launch',
      request.user.id
    );
    const idempotencyFingerprint = rawIdempotencyKey
      ? fingerprintIdempotentRequest(launch)
      : undefined;
    const host = await resolveLaunchHost(launch.host_id, launch.host_alias);
    if (!host) {
      return reply.status(404).send({ error: 'Host not found' });
    }
    if (host.capabilities?.spawn === false) {
      return reply.status(403).send({ error: 'Host does not allow remote session spawning' });
    }
    const providerSupport = getProviderSupport(host);
    if (!providerSupport[launch.provider]) {
      return reply.status(400).send({ error: `Host does not advertise provider support for ${launch.provider}` });
    }

    try {
      const title = launch.title || `${launch.provider} session`;
      const tmux = {
        target_session: launch.tmux?.target_session || defaultTmuxTargetFromPath(launch.working_directory),
        window_name: launch.tmux?.window_name || title,
      };
      const memoryPlan = await prepareSessionMemoryForSpawn({
        user_id: request.user.id,
        provider: launch.provider,
        host_id: host.id,
        working_directory: launch.working_directory,
        source: 'automatic',
      });
      const spawned = await spawnSessionOnHost({
        actorUserId: request.user.id,
        host_id: host.id,
        provider: launch.provider,
        working_directory: launch.working_directory,
        repo_id: memoryPlan.repoId,
        memory_files: memoryPlan.memoryFiles,
        title,
        flags: launch.flags,
        group_id: launch.group_id,
        tmux,
        auditAction: 'launch.spawn',
        failureAuditAction: 'launch.spawn_failed',
        idempotencyKey,
        idempotencyFingerprint,
      });

      if (!spawned.queued && !spawned.replayed) {
        void bootstrapSessionMemory({
          host_id: host.id,
          session_id: spawned.session.id,
          source: 'automatic',
        }).catch((error) => {
          request.log.warn({ error, sessionId: spawned.session.id }, 'Failed to bootstrap launch session memory');
        });
      }

      const session = launch.wait && !spawned.queued
        ? await waitForSessionOpenable(spawned.session.id, launch.wait_timeout_ms)
        : spawned.session;
      const finalSession = session || spawned.session;
      const openable = Boolean(finalSession.tmux_pane_id);
      let promptCmdId: string | undefined;

      if (!spawned.replayed && openable && launch.prompt?.trim()) {
        promptCmdId = await sendInputToSession({
          host_id: host.id,
          session_id: finalSession.id,
          text: launch.prompt.trim(),
          enter: true,
        });
      }

      if (!spawned.replayed) {
        await db.recordRecentLaunch({
          user_id: request.user.id,
          host_id: host.id,
          provider: launch.provider,
          working_directory: launch.working_directory,
          tmux_target: tmux.target_session || null,
          title,
          prompt: launch.prompt,
        });
      }

      const status = openable
        ? 'ready'
        : finalSession.status === 'ERROR'
          ? 'failed'
          : 'starting';

      return LaunchResponseSchema.parse({
        session_id: finalSession.id,
        cmd_id: spawned.cmd_id,
        status,
        href: launchHref(host.id, finalSession.id),
        session: finalSession,
        terminal: {
          openable,
          pane_id: finalSession.tmux_pane_id ?? null,
        },
        prompt_cmd_id: promptCmdId,
      });
    } catch (error) {
      const message = (error as Error).message;
      const status =
        error instanceof IdempotencyConflictError
          || message === 'Idempotency-Key was used with a different request' ? 409
        : message === 'Host not found' ? 404
        : message === 'Host does not allow remote session spawning' ? 403
        : message.startsWith('Host does not advertise provider support') ? 400
        : message === 'Host is offline' || message === 'Failed to send command to agent' ? 503
        : 500;
      return reply.status(status).send({ error: message });
    }
  });
}
