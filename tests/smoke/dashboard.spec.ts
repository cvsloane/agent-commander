import { expect, test, type Page, type Route } from '@playwright/test';

const accessCode = process.env.PLAYWRIGHT_ACCESS_CODE || 'playwright-access';

const emptySessionResponse = { sessions: [], total: 0, limit: 200, offset: 0 };

function apiBody(pathname: string): unknown {
  if (pathname === '/health') {
    return {
      status: 'ok',
      timestamp: new Date(0).toISOString(),
      connections: { uiClients: 0, agents: 0 },
    };
  }
  if (pathname === '/v1/sessions/total') return { total: 0 };
  if (pathname === '/v1/sessions/usage-latest') return { usage: [] };
  if (pathname === '/v1/sessions') return emptySessionResponse;
  if (pathname === '/v1/groups') return { groups: [], flat: [] };
  if (pathname === '/v1/hosts') return { hosts: [] };
  if (pathname === '/v1/projects') return { projects: [] };
  if (pathname === '/v1/repos') return { repos: [] };
  if (pathname === '/v1/settings') return { settings: null };
  if (pathname === '/v1/approvals') return { approvals: [] };
  if (pathname === '/v1/automation-agents') return { agents: [] };
  if (pathname === '/v1/automation-runs') return { runs: [] };
  if (pathname === '/v1/automation-wakeups') return { wakeups: [] };
  if (pathname === '/v1/governance-approvals') return { approvals: [] };
  if (pathname === '/v1/work-items') return { work_items: [] };
  if (pathname === '/v1/memory/search') return { results: [] };
  if (pathname === '/v1/analytics/provider-usage') return { usage: [] };
  if (pathname === '/v1/analytics/usage/weekly') {
    return {
      week_start: '2026-05-11',
      total_tokens: 0,
      total_cost_cents: 0,
      daily: [],
      by_provider: {},
    };
  }
  return {};
}

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function mockControlPlane(page: Page): Promise<void> {
  await page.route('**/api/control-plane-token', async (route) => {
    await fulfillJson(route, {
      token: 'dashboard-smoke-token',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
  });

  await page.route('**/{v1,health}{,/**}', async (route) => {
    const url = new URL(route.request().url());
    await fulfillJson(route, apiBody(url.pathname));
  });
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/signin');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Access code').fill(accessCode);
  await page.getByRole('button', { name: /sign in with access code/i }).click();
  await page.waitForURL('**/');
}

test.beforeEach(async ({ page }) => {
  await mockControlPlane(page);
});

test('protects operator routes behind credentials sign-in', async ({ page }) => {
  await page.goto('/memory');

  await expect(page).toHaveURL(/\/signin/);

  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});

test('renders key operator pages with mocked control-plane data', async ({ page }) => {
  await signIn(page);

  const pages = [
    ['/', 'Dashboard'],
    ['/sessions', 'Sessions'],
    ['/automation', 'Automation'],
    ['/memory', 'Memory'],
    ['/tmux', 'tmux'],
    ['/hosts', 'Hosts'],
    ['/settings', 'Settings'],
  ] as const;

  for (const [path, text] of pages) {
    await page.goto(path);
    await expect(page.locator('body')).toContainText(text);
  }
});
