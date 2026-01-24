import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { config } from './config.js';
import { testConnection } from './db/index.js';
import { registerAgentWebSocket } from './ws/agent.js';
import { registerUIWebSocket } from './ws/ui.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerApprovalRoutes } from './routes/approvals.js';
import { registerHostRoutes } from './routes/hosts.js';
import { registerGroupRoutes } from './routes/groups.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerMCPRoutes } from './routes/mcp.js';
import { registerAnalyticsRoutes } from './routes/analytics.js';
import { registerLinkRoutes } from './routes/links.js';
import { registerContextRoutes } from './routes/context.js';
import { registerTerminalRoutes } from './routes/terminal.js';
import { registerVoiceRoutes } from './routes/voice.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerSummaryRoutes } from './routes/summaries.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerNotificationRoutes } from './routes/notifications.js';
import { pubsub } from './services/pubsub.js';
import { verifyRequestToken } from './auth/verify.js';

const app = Fastify({
  logger: {
    level: 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    },
  },
});

async function start(): Promise<void> {
  // Test database connection
  const dbConnected = await testConnection();
  if (!dbConnected) {
    app.log.error('Failed to connect to database');
    process.exit(1);
  }
  app.log.info('Database connected');

  // Register plugins
  await app.register(cors, {
    origin: true,
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type'],
  });

  await app.register(websocket);

  // Auth for REST (skip health + WS routes that handle their own auth)
  app.addHook('onRequest', async (request, reply) => {
    const url = request.url;
    if (url.startsWith('/health') || url.startsWith('/v1/agent/connect') || url.startsWith('/v1/ui/stream') || url.startsWith('/v1/ui/terminal') || url.startsWith('/v1/voice/transcribe')) {
      return;
    }

    const user = await verifyRequestToken(request);
    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    request.user = user;
  });

  // Register WebSocket handlers
  registerAgentWebSocket(app);
  registerUIWebSocket(app);

  // Register REST routes
  registerSessionRoutes(app);
  registerApprovalRoutes(app);
  registerHostRoutes(app);
  registerGroupRoutes(app);
  registerSearchRoutes(app);
  registerMCPRoutes(app);
  registerAnalyticsRoutes(app);
  registerLinkRoutes(app);
  registerContextRoutes(app);
  registerTerminalRoutes(app);
  registerVoiceRoutes(app);
  registerProjectRoutes(app);
  registerSummaryRoutes(app);
  registerSettingsRoutes(app);
  registerNotificationRoutes(app);

  // Health check endpoint
  app.get('/health', async () => {
    const stats = pubsub.getStats();
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      connections: stats,
    };
  });

  // Start server
  try {
    await app.listen({ host: config.HOST, port: config.PORT });
    app.log.info(`Control plane listening on ${config.HOST}:${config.PORT}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

// Graceful shutdown
const shutdown = async (): Promise<void> => {
  app.log.info('Shutting down...');
  await app.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
