import { test, expect } from '@playwright/test';

const BASE_PATH = '/sessions';
const accessCode = process.env.PLAYWRIGHT_ACCESS_CODE;
const targetSession = process.env.PLAYWRIGHT_SESSION_NAME;

async function ensureSignedIn(page) {
  await page.goto(BASE_PATH);
  if (!page.url().includes('/signin')) {
    return;
  }

  if (!accessCode) {
    throw new Error('PLAYWRIGHT_ACCESS_CODE is required for credentials login.');
  }

  await page.getByLabel('Access code').fill(accessCode);
  await page.getByRole('button', { name: /sign in with access code/i }).click();
  await page.waitForURL('**/');
}

async function runScenario(page, context, suffix, query) {
  await page.goto(`${BASE_PATH}${query}`);
  const grid = page.locator('[data-session-card]');
  await expect(grid.first()).toBeVisible({ timeout: 30_000 });

  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  await page.waitForTimeout(4000);

  const target = targetSession
    ? grid.filter({ hasText: targetSession }).first()
    : grid.first();

  await target.scrollIntoViewIfNeeded();
  await target.click();
  await page.waitForTimeout(4000);

  await context.tracing.stop({ path: `artifacts/sessions-perf-${suffix}.zip` });
}

test('sessions perf baseline', async ({ page, context }) => {
  await ensureSignedIn(page);
  await runScenario(page, context, 'baseline', '?perf=1');
});

test('sessions perf no snapshot', async ({ page, context }) => {
  await ensureSignedIn(page);
  await runScenario(page, context, 'nosnapshot', '?perf=1&nosnapshot=1');
});

test('sessions perf no websocket', async ({ page, context }) => {
  await ensureSignedIn(page);
  await runScenario(page, context, 'nowebsocket', '?perf=1&nowebsocket=1');
});
