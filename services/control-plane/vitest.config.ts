import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup.ts'],
    // The integration tier needs a real Postgres and runs separately under
    // vitest.integration.config.ts (`pnpm test:integration`).
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/integration/**'],
  },
});
