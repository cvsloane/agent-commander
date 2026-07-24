/**
 * Integration-tier setup: these tests run real SQL against a real Postgres.
 *
 * Unlike the unit tier (which mocks `db` entirely), nothing here is stubbed --
 * the point is to catch query typos, column drift, constraint violations, and
 * migrations that do not apply from scratch. CI provides the database; locally
 * you can start one with:
 *
 *   docker run -d --name ac-test-pg -p 55432:5432 \
 *     -e POSTGRES_USER=agent -e POSTGRES_PASSWORD=test \
 *     -e POSTGRES_DB=agent_command_test postgres:16-alpine
 *   export INTEGRATION_DATABASE_URL=postgres://agent:test@localhost:55432/agent_command_test
 */
process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-at-least-32-characters';

const integrationUrl = process.env.INTEGRATION_DATABASE_URL;
if (!integrationUrl) {
  throw new Error(
    'INTEGRATION_DATABASE_URL is required for the integration tier. '
      + 'See services/control-plane/tests/integration/setup.ts for a local Postgres one-liner.'
  );
}

// db/index.ts builds its pool from config.DATABASE_URL at import time.
process.env.DATABASE_URL = integrationUrl;
