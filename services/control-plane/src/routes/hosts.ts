import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ulid } from 'ulid';
import path from 'path';
import { CommandsDispatchMessageSchema, DirectoryEntrySchema } from '@agent-command/schema';
import * as db from '../db/index.js';
import { hasRole } from '../auth/rbac.js';
import { pubsub } from '../services/pubsub.js';

// Pending command result tracking for host-level operations
const pendingHostCommandResults = new Map<string, {
  resolve: (value: { ok: boolean; result?: Record<string, unknown>; error?: { code: string; message: string } }) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}>();

const HOME_SENTINEL = '/__home__';

function normalizePath(rawPath: string): string | null {
  const trimmed = rawPath.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('~')) {
    const replaced = `${HOME_SENTINEL}${trimmed.slice(1)}`;
    const normalized = path.posix.normalize(replaced);
    if (!normalized.startsWith(HOME_SENTINEL)) return null;
    const restored = normalized.replace(HOME_SENTINEL, '~');
    return restored.replace(/\/+$/, '') || '~';
  }

  const normalized = path.posix.normalize(trimmed);
  if (!normalized.startsWith('/')) return null;
  return normalized.replace(/\/+$/, '') || '/';
}

function isPathAllowed(rawPath: string, roots: string[]): boolean {
  const normalizedPath = normalizePath(rawPath);
  if (!normalizedPath) return false;
  if (!roots.length) return false;

  return roots.some((root) => {
    const normalizedRoot = normalizePath(root);
    if (!normalizedRoot) return false;
    if (normalizedRoot === '/') return true;
    if (normalizedRoot === '~') {
      return normalizedPath === '~' || normalizedPath.startsWith('~/');
    }
    return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
  });
}

// Called by agent WebSocket handler when a command result is received
export function handleHostCommandResult(
  cmdId: string,
  result: { ok: boolean; result?: Record<string, unknown>; error?: { code: string; message: string } }
): boolean {
  const pending = pendingHostCommandResults.get(cmdId);
  if (!pending) return false;

  clearTimeout(pending.timeout);
  pendingHostCommandResults.delete(cmdId);
  pending.resolve(result);
  return true;
}

// Helper to send host-level command and wait for result
async function sendHostCommandAndWait(
  hostId: string,
  cmdId: string,
  command: { type: string; payload: unknown },
  timeoutMs = 15000
): Promise<{ ok: boolean; result?: Record<string, unknown>; error?: { code: string; message: string } }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingHostCommandResults.delete(cmdId);
      reject(new Error('Command timed out'));
    }, timeoutMs);

    pendingHostCommandResults.set(cmdId, { resolve, reject, timeout });

    // Use a synthetic session_id for host-level commands (agent should recognize this pattern)
    const syntheticSessionId = '00000000-0000-0000-0000-000000000000';

    const dispatchMessage = CommandsDispatchMessageSchema.parse({
      v: 1,
      type: 'commands.dispatch',
      ts: new Date().toISOString(),
      payload: {
        cmd_id: cmdId,
        session_id: syntheticSessionId,
        command,
      },
    });

    const sent = pubsub.sendToAgent(hostId, dispatchMessage);
    if (!sent) {
      clearTimeout(timeout);
      pendingHostCommandResults.delete(cmdId);
      reject(new Error('Agent not connected'));
    }
  });
}

const CreateHostSchema = z.object({
  name: z.string().min(1),
  tailscale_name: z.string().optional(),
  tailscale_ip: z.string().optional(),
  capabilities: z.record(z.unknown()).optional(),
});

const UpdateHostCapabilitiesSchema = z.object({
  capabilities: z.object({
    list_directory: z.boolean().optional(),
    list_directory_roots: z.array(z.string().min(1)).optional(),
    list_directory_show_hidden: z.boolean().optional(),
  }).strict(),
}).strict();

export function registerHostRoutes(app: FastifyInstance): void {
  // GET /v1/hosts - List all hosts
  app.get('/v1/hosts', async () => {
    const hosts = await db.getHosts();
    return { hosts };
  });

  // POST /v1/hosts - Create host + token (admin only)
  app.post<{ Body: unknown }>('/v1/hosts', async (request, reply) => {
    if (!request.user || !hasRole(request.user, 'admin')) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const body = CreateHostSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: body.error });
    }

    const hostId = crypto.randomUUID();
    const host = await db.createHost({
      id: hostId,
      name: body.data.name,
      tailscale_name: body.data.tailscale_name,
      tailscale_ip: body.data.tailscale_ip,
      capabilities: body.data.capabilities,
    });

    const token = `ac_agent_${crypto.randomUUID().replace(/-/g, '')}`;
    await db.createAgentToken(hostId, token);

    await db.createAuditLog('host.create', 'host', hostId, { name: host.name }, request.user.id);

    return { host, token };
  });

  // GET /v1/hosts/:id - Get single host
  app.get<{ Params: { id: string } }>('/v1/hosts/:id', async (request, reply) => {
    const { id } = request.params;

    if (!z.string().uuid().safeParse(id).success) {
      return reply.status(400).send({ error: 'Invalid host ID' });
    }

    const host = await db.getHostById(id);
    if (!host) {
      return reply.status(404).send({ error: 'Host not found' });
    }

    return { host };
  });

  // PATCH /v1/hosts/:id - Update host capabilities (admin only)
  app.patch<{ Params: { id: string }; Body: unknown }>(
    '/v1/hosts/:id',
    async (request, reply) => {
      if (!request.user || !hasRole(request.user, 'admin')) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const { id } = request.params;

      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ error: 'Invalid host ID' });
      }

      const body = UpdateHostCapabilitiesSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: 'Invalid request body', details: body.error });
      }

      const host = await db.getHostById(id);
      if (!host) {
        return reply.status(404).send({ error: 'Host not found' });
      }

      const currentCaps = (host.capabilities || {}) as Record<string, unknown>;
      const nextCaps = { ...currentCaps, ...body.data.capabilities };

      if (Array.isArray(body.data.capabilities.list_directory_roots)) {
        nextCaps.list_directory_roots = body.data.capabilities.list_directory_roots
          .map((root) => root.trim())
          .filter((root) => root.length > 0);
      }

      const updatedHost = await db.updateHostCapabilities(id, nextCaps);
      if (!updatedHost) {
        return reply.status(404).send({ error: 'Host not found' });
      }

      await db.createAuditLog('host.capabilities.update', 'host', id, {
        capabilities: body.data.capabilities,
      }, request.user.id);

      return { host: updatedHost };
    }
  );

  // POST /v1/hosts/:id/token - Generate new agent token
  app.post<{ Params: { id: string } }>('/v1/hosts/:id/token', async (request, reply) => {
    if (!request.user || !hasRole(request.user, 'admin')) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const { id } = request.params;

    if (!z.string().uuid().safeParse(id).success) {
      return reply.status(400).send({ error: 'Invalid host ID' });
    }

    const host = await db.getHostById(id);
    if (!host) {
      return reply.status(404).send({ error: 'Host not found' });
    }

    // Generate new token
    const token = `ac_agent_${crypto.randomUUID().replace(/-/g, '')}`;
    await db.createAgentToken(id, token);

    // Log audit
    await db.createAuditLog('host.token.create', 'host', id, {}, request.user.id);

    return { token };
  });

  // GET /v1/hosts/:id/orphan-panes - List orphan (unmanaged) panes for a host
  app.get<{ Params: { id: string } }>('/v1/hosts/:id/orphan-panes', async (request, reply) => {
    const { id } = request.params;

    if (!z.string().uuid().safeParse(id).success) {
      return reply.status(400).send({ error: 'Invalid host ID' });
    }

    const host = await db.getHostById(id);
    if (!host) {
      return reply.status(404).send({ error: 'Host not found' });
    }

    const orphanPanes = await db.getOrphanPanes(id);
    const snapshotRows = await db.getLatestSnapshots(orphanPanes.map((session) => session.id));
    const snapshotBySession = new Map(snapshotRows.map((row) => [row.session_id, row]));

    const panesWithSnapshots = orphanPanes.map((session) => {
      const snapshot = snapshotBySession.get(session.id);
      return {
        ...session,
        latest_snapshot: snapshot
          ? { created_at: snapshot.created_at, capture_text: snapshot.capture_text }
          : null,
      };
    });

    return { orphan_panes: panesWithSnapshots };
  });

  // POST /v1/hosts/:id/adopt-panes - Adopt orphan panes
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/v1/hosts/:id/adopt-panes',
    async (request, reply) => {
      if (!request.user || !hasRole(request.user, 'operator')) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const { id: hostId } = request.params;

      if (!z.string().uuid().safeParse(hostId).success) {
        return reply.status(400).send({ error: 'Invalid host ID' });
      }

      const AdoptPanesSchema = z.object({
        session_ids: z.array(z.string().uuid()).min(1).max(50),
        title: z.string().optional(),
      });

      const bodyResult = AdoptPanesSchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({ error: 'Invalid request body', details: bodyResult.error });
      }

      const host = await db.getHostById(hostId);
      if (!host) {
        return reply.status(404).send({ error: 'Host not found' });
      }

      // Verify all sessions belong to this host
      const sessions = await db.getSessionsByIds(bodyResult.data.session_ids);
      const invalidSessions = sessions.filter((s) => s.host_id !== hostId);
      if (invalidSessions.length > 0) {
        return reply.status(400).send({
          error: 'Some sessions do not belong to this host',
          invalid_ids: invalidSessions.map((s) => s.id),
        });
      }

      const result = await db.adoptOrphanPanes(bodyResult.data.session_ids, bodyResult.data.title);

      // Log audit
      await db.createAuditLog('host.adopt_panes', 'host', hostId, {
        session_ids: bodyResult.data.session_ids,
        adopted: result.adopted,
        errors: result.errors,
      }, request.user.id);

      // Broadcast updates for adopted sessions
      if (result.adopted.length > 0) {
        const adoptedSessions = await db.getSessionsByIds(result.adopted);
        pubsub.publishSessionsChanged(adoptedSessions);
      }

      return {
        adopted_count: result.adopted.length,
        error_count: result.errors.length,
        adopted: result.adopted,
        errors: result.errors.length > 0 ? result.errors : undefined,
      };
    }
  );

  // GET /v1/hosts/:id/directories - List directory contents on host
  const DirectoryQuerySchema = z.object({
    path: z.string().min(1),
    show_hidden: z.string().transform((v) => v === 'true').optional(),
  });

  app.get<{ Params: { id: string }; Querystring: unknown }>(
    '/v1/hosts/:id/directories',
    async (request, reply) => {
      if (!request.user || !hasRole(request.user, 'operator')) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const { id } = request.params;

      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ error: 'Invalid host ID' });
      }

      const queryResult = DirectoryQuerySchema.safeParse(request.query);
      if (!queryResult.success) {
        return reply.status(400).send({ error: 'Invalid query parameters', details: queryResult.error });
      }

      const host = await db.getHostById(id);
      if (!host) {
        return reply.status(404).send({ error: 'Host not found' });
      }

      const capabilities = host.capabilities as Record<string, unknown> | null;
      if (capabilities?.list_directory !== true) {
        return reply.status(403).send({ error: 'Directory listing is disabled for this host' });
      }

      const rootsRaw = capabilities?.list_directory_roots;
      const roots = Array.isArray(rootsRaw)
        ? rootsRaw.filter((root) => typeof root === 'string' && root.trim().length > 0)
        : [];

      const { path: requestedPath, show_hidden } = queryResult.data;
      if (!isPathAllowed(requestedPath, roots)) {
        return reply.status(403).send({ error: 'Path not allowed for directory listing' });
      }

      if (show_hidden && capabilities?.list_directory_show_hidden !== true) {
        return reply.status(403).send({ error: 'Hidden folders are not allowed for this host' });
      }

      // Check if agent is connected
      if (!pubsub.isAgentConnected(id)) {
        return reply.status(503).send({ error: 'Host is offline' });
      }

      const cmdId = ulid();

      try {
        const result = await sendHostCommandAndWait(
          id,
          cmdId,
          {
            type: 'list_directory',
            payload: {
              path: requestedPath,
              show_hidden: show_hidden ?? false,
            },
          }
        );

        if (!result.ok) {
          return reply.status(500).send({
            error: result.error?.message || 'Failed to list directory',
            code: result.error?.code,
          });
        }

        // Validate and return the result
        const entries = result.result?.entries;
        const currentPath = (result.result?.current_path as string) || requestedPath;

        if (!Array.isArray(entries)) {
          return reply.status(500).send({ error: 'Invalid response from agent' });
        }

        // Validate each entry
        const validatedEntries = entries.map((entry) => {
          const parsed = DirectoryEntrySchema.safeParse(entry);
          if (!parsed.success) {
            return null;
          }
          return parsed.data;
        }).filter(Boolean);

        return {
          entries: validatedEntries,
          current_path: currentPath,
        };
      } catch (error) {
        return reply.status(503).send({ error: (error as Error).message });
      }
    }
  );
}
