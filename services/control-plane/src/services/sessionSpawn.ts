import { randomUUID } from 'node:crypto';
import {
  type SpawnSessionMemoryFile,
  type Session,
  type SessionProvider,
} from '@agent-command/schema';
import * as db from '../db/index.js';
import { pubsub } from './pubsub.js';
import { commandRouter } from './commandRouter.js';
import { isHostOnline } from './hostPresence.js';
import { assertIdempotencyFingerprint } from './idempotency.js';

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
  idempotencyKey?: string;
  idempotencyFingerprint?: string;
};

type SendInputOptions = {
  host_id: string;
  session_id: string;
  text: string;
  enter?: boolean;
};

export async function spawnSessionOnHost(
  options: SpawnSessionOptions
): Promise<{ session: Session; cmd_id: string; replayed: boolean; queued: boolean }> {
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
  if (options.idempotencyKey) {
    const existing = await commandRouter.getByIdempotencyKey(
      options.host_id,
      options.idempotencyKey
    );
    if (existing) {
      assertIdempotencyFingerprint(
        existing.idempotency_fingerprint,
        options.idempotencyFingerprint
      );
      const existingSession = existing.session_id
        ? await db.getSessionById(existing.session_id)
        : null;
      if (!existingSession) {
        throw new Error('Idempotent spawn session not found');
      }
      return {
        session: existingSession,
        cmd_id: existing.cmd_id,
        replayed: true,
        queued: existing.status === 'queued',
      };
    }
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

  const cmdId = randomUUID();
  let receipt;
  try {
    receipt = await commandRouter.dispatchDetailed(
      options.host_id,
      sessionId,
      cmdId,
      {
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
      {
        class: 'durable',
        idempotencyKey: options.idempotencyKey,
        idempotencyFingerprint: options.idempotencyFingerprint,
      }
    );
  } catch (error) {
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
    throw error;
  }

  if (!receipt.created) {
    if (receipt.record.session_id !== sessionId) {
      await db.deleteSession(sessionId);
    }
    assertIdempotencyFingerprint(
      receipt.record.idempotency_fingerprint,
      options.idempotencyFingerprint
    );
    const existingSession = receipt.record.session_id
      ? await db.getSessionById(receipt.record.session_id)
      : null;
    if (!existingSession) {
      throw new Error('Idempotent spawn session not found');
    }
    return {
      session: existingSession,
      cmd_id: receipt.record.cmd_id,
      replayed: true,
      queued: receipt.record.status === 'queued',
    };
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

  return { session, cmd_id: cmdId, replayed: false, queued: !receipt.delivered };
}

export async function sendInputToSession(
  options: SendInputOptions
): Promise<string> {
  const session = await db.getSessionById(options.session_id);
  if (!session) {
    throw new Error('Session not found');
  }
  if (!isHostOnline(options.host_id)) {
    throw new Error('Host is offline');
  }

  const cmdId = randomUUID();
  const sent = await commandRouter.dispatch(
    options.host_id,
    options.session_id,
    cmdId,
    {
      type: 'send_input',
      payload: {
        text: options.text,
        enter: options.enter ?? true,
      },
    },
    { class: 'volatile' }
  );

  if (!sent) {
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

export async function waitForSessionOpenable(
  sessionId: string,
  timeoutMs = 15000,
  pollMs = 500
): Promise<Session | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const session = await db.getSessionById(sessionId);
    if (!session) return null;
    if (session.status === 'ERROR' || session.status === 'DONE') {
      return session;
    }
    if (session.tmux_pane_id) {
      return session;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return db.getSessionById(sessionId);
}
