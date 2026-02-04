import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ulid } from 'ulid';
import { UpdateMCPConfigRequestSchema } from '@agent-command/schema';
import * as db from '../db/index.js';
import { pubsub } from '../services/pubsub.js';
import { hasRole } from '../auth/rbac.js';

// Pending request tracking for async agent responses
const pendingRequests = new Map<string, {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}>();

// Called by agent WebSocket handler when mcp.* response is received
export function handleMCPResponse(cmdId: string, response: unknown): boolean {
  const pending = pendingRequests.get(cmdId);
  if (!pending) return false;

  clearTimeout(pending.timeout);
  pendingRequests.delete(cmdId);
  pending.resolve(response);
  return true;
}

// Helper to send request to agent and wait for response
async function sendToAgentAndWait(
  hostId: string,
  message: unknown,
  cmdId: string,
  timeoutMs = 10000
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(cmdId);
      reject(new Error('Request timed out'));
    }, timeoutMs);

    pendingRequests.set(cmdId, { resolve, reject, timeout });

    const sent = pubsub.sendToAgent(hostId, message);
    if (!sent) {
      clearTimeout(timeout);
      pendingRequests.delete(cmdId);
      reject(new Error('Agent not connected'));
    }
  });
}

export function registerMCPRoutes(app: FastifyInstance): void {
  // GET /v1/hosts/:id/mcp/servers - List MCP servers available on a host
  app.get<{ Params: { id: string } }>(
    '/v1/hosts/:id/mcp/servers',
    async (request, reply) => {
      const { id: hostId } = request.params;

      if (!z.string().uuid().safeParse(hostId).success) {
        return reply.status(400).send({ error: 'Invalid host ID' });
      }

      const host = await db.getHostById(hostId);
      if (!host) {
        return reply.status(404).send({ error: 'Host not found' });
      }

      const cmdId = ulid();
      const message = {
        v: 1,
        type: 'mcp.list_servers',
        ts: new Date().toISOString(),
        cmd_id: cmdId,
        payload: { cmd_id: cmdId, host_id: hostId },
      };

      try {
        const response = await sendToAgentAndWait(hostId, message, cmdId) as {
          servers: unknown[];
          pool_config?: unknown;
        };
        return response;
      } catch (error) {
        return reply.status(503).send({ error: (error as Error).message });
      }
    }
  );

  // GET /v1/sessions/:id/mcp - Get MCP config for a session
  app.get<{ Params: { id: string } }>(
    '/v1/sessions/:id/mcp',
    async (request, reply) => {
      const { id: sessionId } = request.params;

      if (!z.string().uuid().safeParse(sessionId).success) {
        return reply.status(400).send({ error: 'Invalid session ID' });
      }

      const session = await db.getSessionById(sessionId);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      const cmdId = ulid();
      const message = {
        v: 1,
        type: 'mcp.get_config',
        ts: new Date().toISOString(),
        cmd_id: cmdId,
        payload: { cmd_id: cmdId, session_id: sessionId },
      };

      try {
        const response = await sendToAgentAndWait(session.host_id, message, cmdId);
        return response;
      } catch (error) {
        return reply.status(503).send({ error: (error as Error).message });
      }
    }
  );

  // PUT /v1/sessions/:id/mcp - Update MCP config for a session
  app.put<{ Params: { id: string }; Body: unknown }>(
    '/v1/sessions/:id/mcp',
    async (request, reply) => {
      if (!request.user || !hasRole(request.user, 'operator')) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const { id: sessionId } = request.params;

      if (!z.string().uuid().safeParse(sessionId).success) {
        return reply.status(400).send({ error: 'Invalid session ID' });
      }

      const bodyResult = UpdateMCPConfigRequestSchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({ error: 'Invalid request body', details: bodyResult.error });
      }

      const session = await db.getSessionById(sessionId);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      const cmdId = ulid();
      const message = {
        v: 1,
        type: 'mcp.update_config',
        ts: new Date().toISOString(),
        cmd_id: cmdId,
        payload: {
          cmd_id: cmdId,
          session_id: sessionId,
          enablement: bodyResult.data.enablement,
        },
      };

      try {
        const response = await sendToAgentAndWait(session.host_id, message, cmdId);

        // Log audit
        await db.createAuditLog('mcp.update_config', 'session', sessionId, {
          cmd_id: cmdId,
          enablement: bodyResult.data.enablement,
        }, request.user.id);

        return response;
      } catch (error) {
        return reply.status(503).send({ error: (error as Error).message });
      }
    }
  );

  // GET /v1/projects/mcp - Get project-level MCP config
  app.get<{ Querystring: { repo_root: string } }>(
    '/v1/projects/mcp',
    async (request, reply) => {
      const { repo_root: repoRoot } = request.query;

      if (!repoRoot) {
        return reply.status(400).send({ error: 'repo_root query parameter required' });
      }

      // Find a session with this repo_root to determine the host
      const sessions = await db.getSessionsByRepoRoot(repoRoot);
      const session = sessions[0];

      if (!session) {
        return reply.status(404).send({ error: 'No session found for this repo_root' });
      }

      const cmdId = ulid();
      const message = {
        v: 1,
        type: 'mcp.get_project_config',
        ts: new Date().toISOString(),
        cmd_id: cmdId,
        payload: { cmd_id: cmdId, repo_root: repoRoot },
      };

      try {
        const response = await sendToAgentAndWait(session.host_id, message, cmdId);
        return response;
      } catch (error) {
        return reply.status(503).send({ error: (error as Error).message });
      }
    }
  );

  // PUT /v1/projects/mcp - Update project-level MCP config
  app.put<{ Querystring: { repo_root: string }; Body: unknown }>(
    '/v1/projects/mcp',
    async (request, reply) => {
      if (!request.user || !hasRole(request.user, 'operator')) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const { repo_root: repoRoot } = request.query;

      if (!repoRoot) {
        return reply.status(400).send({ error: 'repo_root query parameter required' });
      }

      const bodyResult = UpdateMCPConfigRequestSchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({ error: 'Invalid request body', details: bodyResult.error });
      }

      // Find a session with this repo_root to determine the host
      const sessions = await db.getSessionsByRepoRoot(repoRoot);
      const session = sessions[0];

      if (!session) {
        return reply.status(404).send({ error: 'No session found for this repo_root' });
      }

      const cmdId = ulid();
      const message = {
        v: 1,
        type: 'mcp.update_project_config',
        ts: new Date().toISOString(),
        cmd_id: cmdId,
        payload: {
          cmd_id: cmdId,
          repo_root: repoRoot,
          enablement: bodyResult.data.enablement,
        },
      };

      try {
        const response = await sendToAgentAndWait(session.host_id, message, cmdId);

        // Log audit
        await db.createAuditLog('mcp.update_project_config', 'project', repoRoot, {
          cmd_id: cmdId,
          enablement: bodyResult.data.enablement,
        }, request.user.id);

        return response;
      } catch (error) {
        return reply.status(503).send({ error: (error as Error).message });
      }
    }
  );
}
