import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CreateGroupRequestSchema,
  UpdateGroupRequestSchema,
  AssignSessionGroupRequestSchema,
  type SessionGroupWithCount,
} from '@agent-command/schema';
import * as db from '../db/index.js';
import { hasRole } from '../auth/rbac.js';
import { pubsub } from '../services/pubsub.js';

// Extended type with children for tree structure
interface GroupWithChildren extends SessionGroupWithCount {
  children: GroupWithChildren[];
}

function buildGroupTree(groups: SessionGroupWithCount[]): GroupWithChildren[] {
  const groupMap = new Map<string, GroupWithChildren>();
  const roots: GroupWithChildren[] = [];

  // First pass: create all nodes
  for (const group of groups) {
    groupMap.set(group.id, {
      ...group,
      children: [],
    } as GroupWithChildren);
  }

  // Second pass: build tree
  for (const group of groups) {
    const node = groupMap.get(group.id)!;
    if (group.parent_id && groupMap.has(group.parent_id)) {
      groupMap.get(group.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort children at each level
  const sortChildren = (nodes: GroupWithChildren[]): void => {
    nodes.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    for (const node of nodes) {
      sortChildren(node.children);
    }
  };
  sortChildren(roots);

  return roots;
}

export function registerGroupRoutes(app: FastifyInstance): void {
  // GET /v1/groups - List all groups (tree structure)
  app.get('/v1/groups', async (_request, _reply) => {
    const groups = await db.getGroups();
    const tree = buildGroupTree(groups);
    return { groups: tree, flat: groups };
  });

  // POST /v1/groups - Create a new group
  app.post<{ Body: unknown }>('/v1/groups', async (request, reply) => {
    if (!request.user || !hasRole(request.user, 'operator')) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const bodyResult = CreateGroupRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: bodyResult.error });
    }

    try {
      const group = await db.createGroup(bodyResult.data);

      // Audit log
      await db.createAuditLog('group.create', 'session_group', group.id, { group }, request.user.id);

      return { group };
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('unique')) {
        return reply.status(409).send({ error: 'Group name already exists' });
      }
      throw error;
    }
  });

  // POST /v1/groups/ensure - Create or return existing group (idempotent)
  app.post<{ Body: unknown }>('/v1/groups/ensure', async (request, reply) => {
    if (!request.user || !hasRole(request.user, 'operator')) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const bodyResult = CreateGroupRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: bodyResult.error });
    }

    const { name, parent_id } = bodyResult.data;

    const existing = await db.getGroupByName(name, parent_id ?? null);
    if (existing) {
      return { group: existing, created: false };
    }

    try {
      const group = await db.createGroup(bodyResult.data);

      // Audit log
      await db.createAuditLog('group.create', 'session_group', group.id, { group }, request.user.id);

      return { group, created: true };
    } catch (error: unknown) {
      const pgError = error as { code?: string };
      if (pgError.code === '23505') {
        const retry = await db.getGroupByName(name, parent_id ?? null);
        if (retry) {
          return { group: retry, created: false };
        }
      }
      throw error;
    }
  });

  // GET /v1/groups/:id - Get single group
  app.get<{ Params: { id: string } }>('/v1/groups/:id', async (request, reply) => {
    const { id } = request.params;

    if (!z.string().uuid().safeParse(id).success) {
      return reply.status(400).send({ error: 'Invalid group ID' });
    }

    const group = await db.getGroupById(id);
    if (!group) {
      return reply.status(404).send({ error: 'Group not found' });
    }

    return { group };
  });

  // PATCH /v1/groups/:id - Update group
  app.patch<{ Params: { id: string }; Body: unknown }>('/v1/groups/:id', async (request, reply) => {
    if (!request.user || !hasRole(request.user, 'operator')) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { id } = request.params;

    if (!z.string().uuid().safeParse(id).success) {
      return reply.status(400).send({ error: 'Invalid group ID' });
    }

    const bodyResult = UpdateGroupRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: bodyResult.error });
    }

    try {
      const group = await db.updateGroup(id, bodyResult.data);
      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }

      // Audit log
      await db.createAuditLog('group.update', 'session_group', id, { updates: bodyResult.data }, request.user.id);

      return { group };
    } catch (error: unknown) {
      if (error instanceof Error) {
        if (error.message.includes('cycle')) {
          return reply.status(400).send({ error: error.message });
        }
        if (error.message.includes('unique')) {
          return reply.status(409).send({ error: 'Group name already exists' });
        }
      }
      throw error;
    }
  });

  // DELETE /v1/groups/:id - Delete group
  app.delete<{ Params: { id: string } }>('/v1/groups/:id', async (request, reply) => {
    if (!request.user || !hasRole(request.user, 'operator')) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { id } = request.params;

    if (!z.string().uuid().safeParse(id).success) {
      return reply.status(400).send({ error: 'Invalid group ID' });
    }

    const group = await db.getGroupById(id);
    if (!group) {
      return reply.status(404).send({ error: 'Group not found' });
    }

    await db.deleteGroup(id);

    // Audit log
    await db.createAuditLog('group.delete', 'session_group', id, { group }, request.user.id);

    return { success: true };
  });

  // POST /v1/sessions/:id/group - Assign session to group
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/v1/sessions/:id/group',
    async (request, reply) => {
      if (!request.user || !hasRole(request.user, 'operator')) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const { id: sessionId } = request.params;

      if (!z.string().uuid().safeParse(sessionId).success) {
        return reply.status(400).send({ error: 'Invalid session ID' });
      }

      const bodyResult = AssignSessionGroupRequestSchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({ error: 'Invalid request body', details: bodyResult.error });
      }

      // Validate group exists if group_id is provided
      if (bodyResult.data.group_id) {
        const group = await db.getGroupById(bodyResult.data.group_id);
        if (!group) {
          return reply.status(404).send({ error: 'Group not found' });
        }
      }

      const session = await db.assignSessionGroup(sessionId, bodyResult.data.group_id);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      // Publish session update
      pubsub.publishSessionsChanged([session]);

      // Audit log
      await db.createAuditLog('session.group_assign', 'session', sessionId, {
        group_id: bodyResult.data.group_id,
      }, request.user.id);

      return { session };
    }
  );
}
