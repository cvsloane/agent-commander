import { randomUUID } from 'node:crypto';
import { ulid } from 'ulid';
import {
  CommandsDispatchMessageSchema,
  type SpawnSessionMemoryFile,
  type Session,
  type SessionProvider,
} from '@agent-command/schema';
import * as db from '../db/index.js';
import { pubsub } from './pubsub.js';

type SpawnSessionOptions = {
  actorUserId: string;
  host_id: string;
  provider: SessionProvider;
  working_directory: string;
  repo_id?: string | null;
  memory_files?: SpawnSessionMemoryFile[];
  title?: string;
  flags?: string[];
  group_id?: string;
  tmux?: {
    target_session?: string;
    window_name?: string;
  };
  auditAction?: string;
  failureAuditAction?: string;
};

type SendInputOptions = {
  host_id: string;
  session_id: string;
  text: string;
  enter?: boolean;
};

export async function spawnSessionOnHost(
  options: SpawnSessionOptions
): Promise<{ session: Session; cmd_id: string }> {
  const host = await db.getHostById(options.host_id);
  if (!host) {
    throw new Error('Host not found');
  }

  const capabilities = host.capabilities as Record<string, unknown> | null;
  if (capabilities?.spawn === false) {
    throw new Error('Host does not allow remote session spawning');
  }
  const providerMap = capabilities?.providers && typeof capabilities.providers === 'object'
    ? (capabilities.providers as Record<string, unknown>)
    : null;
  if (
    providerMap
    && Object.keys(providerMap).length > 0
    && providerMap[options.provider] !== true
  ) {
    throw new Error(`Host does not advertise provider support for ${options.provider}`);
  }
  if (!pubsub.isAgentConnected(options.host_id)) {
    throw new Error('Host is offline');
  }

  const sessionId = randomUUID();
  let session = await db.upsertSession(options.host_id, {
    id: sessionId,
    user_id: options.actorUserId,
    repo_id: options.repo_id ?? null,
    kind: 'tmux_pane',
    provider: options.provider,
    status: 'STARTING',
    title: options.title || `${options.provider} session`,
    cwd: options.working_directory,
  });

  try {
    await db.touchProject({
      user_id: options.actorUserId,
      host_id: options.host_id,
      path: options.working_directory,
      display_name: options.title || null,
    });
  } catch {
    // Best effort only.
  }

  if (options.group_id) {
    const updated = await db.assignSessionGroup(sessionId, options.group_id);
    if (updated) {
      session = updated;
    }
  }

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
          provider: options.provider,
          working_directory: options.working_directory,
          title: options.title,
          flags: options.flags,
          memory_files: options.memory_files,
          group_id: options.group_id,
          tmux: options.tmux,
        },
      },
    },
  });

  const sent = pubsub.sendToAgent(options.host_id, dispatchMessage);
  if (!sent) {
    const failedSession = await db.upsertSession(options.host_id, {
      id: sessionId,
      user_id: options.actorUserId,
      repo_id: options.repo_id ?? null,
      kind: 'tmux_pane',
      provider: options.provider,
      status: 'ERROR',
      title: options.title || `${options.provider} session`,
      cwd: options.working_directory,
      metadata: {
        status_detail: 'Failed to send spawn command to agent',
      },
    });
    pubsub.publishSessionsChanged([failedSession]);
    await db.createAuditLog(
      options.failureAuditAction || 'session.spawn_failed',
      'session',
      sessionId,
      {
        host_id: options.host_id,
        provider: options.provider,
        working_directory: options.working_directory,
      },
      options.actorUserId
    );
    throw new Error('Failed to send command to agent');
  }

  pubsub.publishSessionsChanged([session]);
  await db.createAuditLog(
    options.auditAction || 'session.spawn',
    'session',
    sessionId,
    {
      cmd_id: cmdId,
      host_id: options.host_id,
      provider: options.provider,
      working_directory: options.working_directory,
    },
    options.actorUserId
  );

  return { session, cmd_id: cmdId };
}

export async function sendInputToSession(
  options: SendInputOptions
): Promise<string> {
  const session = await db.getSessionById(options.session_id);
  if (!session) {
    throw new Error('Session not found');
  }
  if (!pubsub.isAgentConnected(options.host_id)) {
    throw new Error('Host is offline');
  }

  const cmdId = ulid();
  const dispatchMessage = CommandsDispatchMessageSchema.parse({
    v: 1,
    type: 'commands.dispatch',
    ts: new Date().toISOString(),
    payload: {
      cmd_id: cmdId,
      session_id: options.session_id,
      command: {
        type: 'send_input',
        payload: {
          text: options.text,
          enter: options.enter ?? true,
        },
      },
    },
  });

  if (!pubsub.sendToAgent(options.host_id, dispatchMessage)) {
    throw new Error('Failed to send input command to agent');
  }

  return cmdId;
}

export async function waitForSessionReady(
  sessionId: string,
  timeoutMs = 30000,
  pollMs = 500
): Promise<Session | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const session = await db.getSessionById(sessionId);
    if (!session) return null;
    if (session.status !== 'STARTING') {
      return session;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return db.getSessionById(sessionId);
}
