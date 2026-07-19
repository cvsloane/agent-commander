import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { UISubscribeMessageSchema } from '@agent-command/schema';
import { pubsub } from '../services/pubsub.js';
import { verifyTokenString } from '../auth/verify.js';

export function registerUIWebSocket(app: FastifyInstance): void {
  app.get(
    '/v1/ui/stream',
    { websocket: true },
    async (socket: WebSocket, request: FastifyRequest) => {
      const url = new URL(request.url, 'http://localhost');
      const token = url.searchParams.get('token');
      if (!token) {
        socket.close(4001, 'Missing auth token');
        return;
      }

      const user = await verifyTokenString(token);
      if (!user) {
        socket.close(4003, 'Invalid auth token');
        return;
      }

      const clientId = crypto.randomUUID();
      pubsub.addUIClient(clientId, socket);

      app.log.info({ clientId }, 'UI client connected');

      socket.on('message', (data: Buffer) => {
        try {
          const raw = JSON.parse(data.toString());

          if (raw.type === 'ui.subscribe') {
            const parseResult = UISubscribeMessageSchema.safeParse(raw);
            if (parseResult.success) {
              const topics = parseResult.data.payload.topics.map((t) => ({
                type: t.type,
                filter: t.filter,
              }));
              pubsub.setUISubscriptions(clientId, topics);
              app.log.info({ clientId, topics: topics.map(t => t.type) }, 'UI subscriptions updated');
            }
          }
        } catch (error) {
          app.log.warn({ error }, 'Invalid UI message');
        }
      });

      socket.on('close', () => {
        pubsub.removeUIClient(clientId);
        app.log.info({ clientId }, 'UI client disconnected');
      });

      socket.on('error', (error: unknown) => {
        app.log.error({ error, clientId }, 'UI WebSocket error');
      });
    }
  );
}
