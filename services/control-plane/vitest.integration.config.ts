import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.integration.test.ts'],
    setupFiles: ['./tests/integration/setup.ts'],
    // Real database, shared tables: run serially so truncation between cases
    // cannot race across worker processes.
    fileParallelism: false,
    pool: 'forks',
    maxForks: 1,
    minForks: 1,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
