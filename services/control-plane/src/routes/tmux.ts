import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  TmuxOpenRequestSchema,
  TmuxOpenResponseSchema,
  TmuxRosterResponseSchema,
  type Host,
  type Session,
} from '@agent-command/schema';
import * as db from '../db/index.js';
import { hasRole } from '../auth/rbac.js';
import { pubsub } from '../services/pubsub.js';

const TmuxRosterQuerySchema = z.object({
  host_id: z.string().uuid().optional(),
});

async function resolveTmuxHost(hostId?: string, hostAlias?: string): Promise<Host | null> {
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

function isUnmanaged(session: Session): boolean {
  return session.metadata?.unmanaged === true;
}

function tmuxHref(hostId: string, sessionId: string): string {
  const params = new URLSearchParams({
    host_id: hostId,
    session_id: sessionId,
    mode: 'terminal',
    attach: '1',
  });
  return `/?${params.toString()}`;
}

export function registerTmuxRoutes(app: FastifyInstance): void {
  app.get('/v1/tmux/roster', async (request, reply) => {
    const query = TmuxRosterQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: 'Invalid query parameters' });
    }

    const groups = await db.getTmuxRosterGroups(query.data.host_id);
    const sessions = groups.flatMap((group) => group.sessions);

    return TmuxRosterResponseSchema.parse({
      groups,
      sessions,
      total: sessions.length,
    });
  });

  app.post<{ Body: unknown }>('/v1/tmux/open', async (request, reply) => {
    if (!request.user || !hasRole(request.user, 'operator')) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const body = TmuxOpenRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: body.error });
    }

    const host = await resolveTmuxHost(body.data.host_id, body.data.host_alias);
    if (!host) {
      return reply.status(404).send({ error: 'Host not found' });
    }

    const sessions = await db.getTmuxRosterSessions(host.id);
    const requestedTarget = body.data.tmux_target?.trim();
    const requestedPaneId = body.data.pane_id?.trim();
    let session = sessions.find((candidate) => (
      (requestedTarget && candidate.tmux_target === requestedTarget) ||
      (requestedPaneId && candidate.tmux_pane_id === requestedPaneId)
    )) ?? null;

    if (!session) {
      return reply.status(404).send({
        error: 'Tmux pane not found',
        details: requestedTarget
          ? `No tracked tmux pane found for target ${requestedTarget}`
          : `No tracked tmux pane found for pane ${requestedPaneId}`,
      });
    }

    let adopted = false;
    if (isUnmanaged(session)) {
      const result = await db.adoptOrphanPanes([session.id]);
      adopted = result.adopted.includes(session.id);
      const refreshed = await db.getSessionById(session.id);
      if (refreshed) {
        session = refreshed;
      }
      if (adopted) {
        await db.createAuditLog('tmux.open_adopt', 'session', session.id, {
          host_id: host.id,
          tmux_target: session.tmux_target,
          tmux_pane_id: session.tmux_pane_id,
        }, request.user.id);
        pubsub.publishSessionsChanged([session]);
      }
    }

    return TmuxOpenResponseSchema.parse({
      session_id: session.id,
      href: tmuxHref(host.id, session.id),
      session,
      adopted,
      terminal: {
        openable: Boolean(session.tmux_pane_id),
        pane_id: session.tmux_pane_id ?? null,
      },
    });
  });
}
