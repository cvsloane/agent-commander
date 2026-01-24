import type { FastifyInstance } from 'fastify';
import { hasRole } from '../auth/rbac.js';
import * as db from '../db/index.js';
import { clawdbotNotifier } from '../services/clawdbot.js';

interface ClawdbotConfig {
  enabled: boolean;
  baseUrl?: string;
  token?: string;
  channel?: string;
  recipient?: string;
  events: Record<string, boolean>;
  providers: Record<string, boolean>;
}

export function registerNotificationRoutes(app: FastifyInstance): void {
  // POST /v1/notifications/test - Send a test notification
  app.post<{ Body: { channel?: string } }>('/v1/notifications/test', async (request, reply) => {
    if (!request.user || !hasRole(request.user, 'viewer')) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const userId = request.user.sub;
    const { channel } = request.body || {};

    // Only clawdbot test is supported for now
    if (channel && channel !== 'clawdbot') {
      return reply.status(400).send({ error: 'Unsupported channel' });
    }

    // Get user settings
    const settings = await db.getUserSettings(userId);
    if (!settings) {
      return reply.status(400).send({ error: 'No settings found' });
    }

    const data = (settings as { data?: { alertSettings?: { clawdbot?: ClawdbotConfig } } }).data;
    const clawdbotConfig = data?.alertSettings?.clawdbot;

    if (!clawdbotConfig?.enabled) {
      return reply.status(400).send({ error: 'Clawdbot not enabled' });
    }

    if (!clawdbotConfig.baseUrl || !clawdbotConfig.token) {
      return reply.status(400).send({ error: 'Clawdbot URL or token not configured' });
    }

    const success = await clawdbotNotifier.sendTest(clawdbotConfig);

    if (success) {
      return { success: true };
    } else {
      return reply.status(500).send({ error: 'Failed to send test notification' });
    }
  });
}
