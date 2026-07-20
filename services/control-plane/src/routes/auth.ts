import type { FastifyInstance } from 'fastify';
import { webSocketTickets } from '../security/webSocketAuth.js';

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post('/v1/auth/ws-ticket', async (request, reply) => {
    if (!request.user || request.user.auth_type !== 'jwt') {
      return reply.status(403).send({ error: 'WebSocket tickets require JWT authentication' });
    }
    return reply.status(201).send(webSocketTickets.mint(request.user));
  });
}
