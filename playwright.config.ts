import { defineConfig } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'https://agentcommander.example';
const storageState = process.env.PLAYWRIGHT_STORAGE_STATE;

export default defineConfig({
  testDir: './scripts/perf',
  timeout: 120_000,
  use: {
    baseURL,
    storageState: storageState || undefined,
  },
});
