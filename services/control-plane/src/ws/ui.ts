import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { UISubscribeMessageSchema } from '@agent-command/schema';
import { pubsub } from '../services/pubsub.js';
import { verifyTokenString } from '../auth/verify.js';
import { installWebSocketHeartbeat } from '../services/webSocketHeartbeat.js';
import { uiStreamResume } from '../services/uiStreamResume.js';

export function registerUIWebSocket(app: FastifyInstance): void {
  app.get(
    '/v1/ui/stream',
    { websocket: true },
    async (socket: WebSocket, request: FastifyRequest) => {
      const heartbeat = installWebSocketHeartbeat(socket, {
        onStale: () => app.log.warn('Terminating stale UI WebSocket'),
      });
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

      let hasSubscribed = false;
      let subscriptionQueue = Promise.resolve();

      socket.on('message', (data: Buffer) => {
        heartbeat.markAlive();
        subscriptionQueue = subscriptionQueue.then(async () => {
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

                const messages = [];
                if (parseResult.data.payload.since !== undefined) {
                  messages.push(...await uiStreamResume.replay(
                    user.id,
                    topics,
                    parseResult.data.payload.since
                  ));
                }
                if (!hasSubscribed) {
                  messages.push(...await uiStreamResume.initialSnapshot(user.id, topics));
                  hasSubscribed = true;
                }
                for (const message of messages) {
                  socket.send(JSON.stringify(message));
                }
              }
            }
          } catch (error) {
            app.log.warn({ error }, 'Invalid UI message');
          }
        });
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
