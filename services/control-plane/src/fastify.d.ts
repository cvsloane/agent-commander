import 'fastify';
import type { AuthUser } from './auth/types.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}
