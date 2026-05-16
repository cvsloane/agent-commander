import { defineConfig, devices } from '@playwright/test';

const port = Number.parseInt(process.env.PLAYWRIGHT_DASHBOARD_PORT || '3210', 10);
const host = '127.0.0.1';
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://${host}:${port}`;
const accessCode = process.env.PLAYWRIGHT_ACCESS_CODE || 'playwright-access';

export default defineConfig({
  testDir: './tests/smoke',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    trace: 'retain-on-failure',
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `pnpm --filter @agent-command/dashboard dev --hostname ${host} --port ${port}`,
        url: `${baseURL}/signin`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          ACCESS_SECRET: accessCode,
          ADMIN_EMAILS: 'admin@local.test',
          AUTH_SESSION_DAYS: '1',
          CONTROL_PLANE_JWT_SECRET: 'dashboard-smoke-control-plane-secret',
          NEXTAUTH_SECRET: 'dashboard-smoke-nextauth-secret',
          NEXTAUTH_URL: baseURL,
          NEXT_PUBLIC_CONTROL_PLANE_URL: baseURL,
          NEXT_PUBLIC_CONTROL_PLANE_WS_URL: `ws://${host}:${port}/v1/ui/stream`,
        },
      },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
