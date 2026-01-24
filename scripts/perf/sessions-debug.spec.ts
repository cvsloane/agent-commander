import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE_PATH = '/sessions';
const accessCode = process.env.PLAYWRIGHT_ACCESS_CODE;
const targetSession = process.env.PLAYWRIGHT_SESSION_NAME;
const artifactsDir = path.join(process.cwd(), 'artifacts');

function ensureArtifactsDir() {
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }
}

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

function attachPerfLogger(page, label: string) {
  const logs: Array<{ ts: number; text: string; data?: unknown }> = [];
  page.on('console', async (msg) => {
    if (msg.type() !== 'log') return;
    const text = msg.text();
    if (!text.includes('[perf]')) return;
    let data: unknown;
    const args = msg.args();
    if (args.length > 1) {
      try {
        data = await args[1].jsonValue();
      } catch {
        data = undefined;
      }
    }
    logs.push({ ts: Date.now(), text, data });
  });

  return {
    logs,
    flush() {
      ensureArtifactsDir();
      const file = path.join(artifactsDir, `sessions-perf-${label}.json`);
      fs.writeFileSync(file, JSON.stringify(logs, null, 2));
    },
  };
}

async function waitForCards(page) {
  const card = page.locator('[data-session-card]').first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  return card;
}

test('sessions ws scope idle', async ({ page, context }) => {
  await ensureSignedIn(page);
  const logger = attachPerfLogger(page, 'ws-scope');
  await page.goto(`${BASE_PATH}?perf=1&page_size=10`);
  await waitForCards(page);

  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  await page.waitForTimeout(8000);
  await context.tracing.stop({ path: path.join(artifactsDir, 'sessions-trace-ws-scope.zip') });

  logger.flush();
});

test('sessions ws vs nowebsocket', async ({ page, context }) => {
  await ensureSignedIn(page);

  const baselineLogger = attachPerfLogger(page, 'ws-baseline');
  await page.goto(`${BASE_PATH}?perf=1`);
  await waitForCards(page);
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  await page.waitForTimeout(6000);
  await context.tracing.stop({ path: path.join(artifactsDir, 'sessions-trace-ws-baseline.zip') });
  baselineLogger.flush();

  const noWsLogger = attachPerfLogger(page, 'ws-disabled');
  await page.goto(`${BASE_PATH}?perf=1&nowebsocket=1`);
  await waitForCards(page);
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  await page.waitForTimeout(6000);
  await context.tracing.stop({ path: path.join(artifactsDir, 'sessions-trace-ws-disabled.zip') });
  noWsLogger.flush();

  const hasWsLogs = baselineLogger.logs.some((log) => log.text.includes('[perf] sessions.ws'));
  const hasNoWsLogs = noWsLogger.logs.some((log) => log.text.includes('[perf] sessions.ws'));
  expect(hasWsLogs || baselineLogger.logs.length === 0).toBeTruthy();
  expect(hasNoWsLogs).toBeFalsy();
});

test('sessions card click navigation', async ({ page, context }) => {
  await ensureSignedIn(page);
  const logger = attachPerfLogger(page, 'click-nav');
  await page.goto(`${BASE_PATH}?perf=1`);
  const card = await waitForCards(page);

  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

  const target = targetSession
    ? page.locator('[data-session-card]').filter({ hasText: targetSession }).first()
    : card;

  await target.scrollIntoViewIfNeeded();
  await target.click();
  await page.waitForTimeout(2000);

  await context.tracing.stop({ path: path.join(artifactsDir, 'sessions-trace-click-nav.zip') });
  logger.flush();

  await expect(page).toHaveURL(/\/sessions\/[a-f0-9-]{20,}/i);
});
