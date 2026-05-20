import { expect, test, type Page, type Route } from '@playwright/test';

const accessCode = process.env.PLAYWRIGHT_ACCESS_CODE || 'playwright-access';

const emptySessionResponse = { sessions: [], total: 0, limit: 200, offset: 0 };
const tmuxHost = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'heavisidelinux',
  tailscale_name: 'heavisidelinux',
  tailscale_ip: '100.64.0.10',
  capabilities: {
    tmux: true,
    spawn: true,
    kill: true,
    console_stream: true,
    terminal: true,
    claude_hooks: true,
    codex_exec_json: true,
    list_directory: true,
    list_directory_roots: ['/home/cvsloane/dev'],
    list_directory_show_hidden: false,
    providers: { claude_code: true, codex: true, shell: true },
  },
  agent_version: 'test',
  last_seen_at: '2026-05-19T18:00:00.000Z',
  last_acked_seq: 10,
  created_at: '2026-05-19T17:00:00.000Z',
  updated_at: '2026-05-19T18:00:00.000Z',
};

const tmuxSessions = [
  {
    id: '22222222-2222-4222-8222-222222222222',
    host_id: tmuxHost.id,
    user_id: null,
    repo_id: null,
    kind: 'tmux_pane',
    provider: 'codex',
    status: 'RUNNING',
    title: 'Codex implementation',
    cwd: '/home/cvsloane/dev/agent-command',
    repo_root: '/home/cvsloane/dev/agent-command',
    git_remote: 'git@github.com:cvsloane/agent-commander.git',
    git_branch: 'refactor/tmux-command-center',
    tmux_pane_id: '%1',
    tmux_target: 'agents:0.0',
    metadata: {
      tmux: {
        session_name: 'agents',
        window_name: 'agent-command',
        window_index: 0,
        pane_index: 0,
      },
    },
    created_at: '2026-05-19T17:00:00.000Z',
    updated_at: '2026-05-19T18:00:00.000Z',
    last_activity_at: '2026-05-19T18:00:00.000Z',
    idled_at: null,
    group_id: null,
    forked_from: null,
    fork_depth: 0,
    archived_at: null,
    latest_snapshot: {
      created_at: '2026-05-19T18:00:00.000Z',
      capture_text: 'pnpm test:ci',
    },
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    host_id: tmuxHost.id,
    user_id: null,
    repo_id: null,
    kind: 'tmux_pane',
    provider: 'claude_code',
    status: 'WAITING_FOR_INPUT',
    title: 'Mobile UX review',
    cwd: '/home/cvsloane/dev/agent-command',
    repo_root: '/home/cvsloane/dev/agent-command',
    git_remote: 'git@github.com:cvsloane/agent-commander.git',
    git_branch: 'mobile-tmux',
    tmux_pane_id: '%2',
    tmux_target: 'agents:0.1',
    metadata: {
      tmux: {
        session_name: 'agents',
        window_name: 'agent-command',
        window_index: 0,
        pane_index: 1,
      },
    },
    created_at: '2026-05-19T17:05:00.000Z',
    updated_at: '2026-05-19T17:55:00.000Z',
    last_activity_at: '2026-05-19T17:55:00.000Z',
    idled_at: null,
    group_id: null,
    forked_from: null,
    fork_depth: 0,
    archived_at: null,
    latest_snapshot: {
      created_at: '2026-05-19T17:55:00.000Z',
      capture_text: 'Need input',
    },
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    host_id: tmuxHost.id,
    user_id: null,
    repo_id: null,
    kind: 'tmux_pane',
    provider: 'shell',
    status: 'IDLE',
    title: 'Deploy logs',
    cwd: '/home/cvsloane/dev/heaviside',
    repo_root: '/home/cvsloane/dev/heaviside',
    git_remote: null,
    git_branch: 'main',
    tmux_pane_id: '%3',
    tmux_target: 'ops:2.0',
    metadata: {
      unmanaged: true,
      tmux: {
        session_name: 'ops',
        window_name: 'deploy',
        window_index: 2,
        pane_index: 0,
      },
    },
    created_at: '2026-05-19T16:00:00.000Z',
    updated_at: '2026-05-19T17:00:00.000Z',
    last_activity_at: '2026-05-19T17:00:00.000Z',
    idled_at: '2026-05-19T17:00:00.000Z',
    group_id: null,
    forked_from: null,
    fork_depth: 0,
    archived_at: null,
    latest_snapshot: {
      created_at: '2026-05-19T17:00:00.000Z',
      capture_text: 'tail -f logs',
    },
  },
];

function sessionDetail(id: string): unknown {
  const session = tmuxSessions.find((candidate) => candidate.id === id);
  if (!session) return {};
  return {
    session,
    snapshot: session.latest_snapshot,
    events: [],
    approvals: [],
  };
}

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
  if (pathname === '/v1/sessions') {
    return {
      sessions: tmuxSessions,
      total: tmuxSessions.length,
      limit: 200,
      offset: 0,
    };
  }
  if (pathname === '/v1/tmux/roster') {
    return {
      sessions: tmuxSessions,
      total: tmuxSessions.length,
    };
  }
  if (pathname === '/v1/launch/targets') {
    return {
      targets: [
        {
          host_id: tmuxHost.id,
          alias: 'heavisidelinux',
          display_name: 'heavisidelinux',
          online: true,
          supports_terminal: true,
          supports_spawn: true,
          supports_directory_listing: true,
          providers: { codex: true, claude_code: true },
          roots: ['/home/cvsloane/dev'],
          recent_projects: [
            {
              id: '55555555-5555-4555-8555-555555555555',
              path: '/home/cvsloane/dev/agent-command',
              display_name: 'agent-command',
              last_used_at: '2026-05-19T18:00:00.000Z',
            },
          ],
          recent_tmux: tmuxSessions.slice(0, 2).map((session) => ({
            session_id: session.id,
            title: session.title,
            tmux_target: session.tmux_target,
            pane_id: session.tmux_pane_id,
            cwd: session.cwd,
            provider: session.provider,
            status: session.status,
          })),
          recent_launches: [
            {
              id: '66666666-6666-4666-8666-666666666666',
              host_id: tmuxHost.id,
              provider: 'codex',
              working_directory: '/home/cvsloane/dev/agent-command',
              tmux_target: 'agents',
              title: 'Codex in agent-command',
              launch_count: 2,
              last_launched_at: '2026-05-19T18:00:00.000Z',
            },
          ],
        },
      ],
    };
  }
  if (/^\/v1\/sessions\/[^/]+\/analytics$/.test(pathname)) {
    const [, , , id] = pathname.split('/');
    return {
      session_id: id,
      tokens_in: 0,
      tokens_out: 0,
      tokens_cache_read: 0,
      tokens_cache_write: 0,
      tool_calls: 0,
      approvals_requested: 0,
      approvals_granted: 0,
      approvals_denied: 0,
      first_event_at: null,
      last_event_at: null,
      estimated_cost_cents: 0,
    };
  }
  if (/^\/v1\/sessions\/[^/]+\/analytics\/timeseries$/.test(pathname)) {
    return { data: [] };
  }
  if (/^\/v1\/sessions\/[^/]+\/events$/.test(pathname)) return { events: [] };
  if (/^\/v1\/sessions\/[^/]+\/tool-events$/.test(pathname)) return { events: [] };
  if (/^\/v1\/sessions\/[^/]+\/tool-stats$/.test(pathname)) return { stats: [] };
  if (pathname.startsWith('/v1/sessions/')) {
    const [, , , id] = pathname.split('/');
    return sessionDetail(id || '');
  }
  if (pathname === '/v1/groups') return { groups: [], flat: [] };
  if (pathname === '/v1/hosts') return { hosts: [tmuxHost] };
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
    if (route.request().method() === 'POST' && url.pathname === '/v1/launch') {
      await fulfillJson(route, {
        session_id: tmuxSessions[0].id,
        cmd_id: '01JLAUNCHSMOKE0000000000000',
        status: 'ready',
        href: `/tmux?host_id=${tmuxHost.id}&session_id=${tmuxSessions[0].id}&mode=terminal&attach=1`,
        session: tmuxSessions[0],
        terminal: {
          openable: true,
          pane_id: tmuxSessions[0].tmux_pane_id,
        },
      });
      return;
    }
    if (route.request().method() === 'POST' && url.pathname === '/v1/tmux/open') {
      await fulfillJson(route, {
        session_id: tmuxSessions[1].id,
        href: `/tmux?host_id=${tmuxHost.id}&session_id=${tmuxSessions[1].id}&mode=terminal&attach=1`,
        session: tmuxSessions[1],
        adopted: false,
        terminal: {
          openable: true,
          pane_id: tmuxSessions[1].tmux_pane_id,
        },
      });
      return;
    }
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

test('renders tmux roster with windows and panes, supports selection and filtering', async ({ page }) => {
  await signIn(page);

  await page.goto('/tmux');

  await expect(page.getByRole('heading', { name: 'tmux', exact: true })).toBeVisible();
  await expect(page.getByText('2 sessions · 3 panes')).toBeVisible();
  await expect(page.getByText('agents')).toBeVisible();
  await expect(page.getByText('ops')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Waiting', exact: true })).toBeVisible();

  await page.getByText('agents').click();
  await expect(page.getByText('0 · agent-command')).toBeVisible();
  await expect(page.getByText('Codex implementation')).toBeVisible();
  await expect(page.getByText('Mobile UX review')).toBeVisible();

  await page.getByText('Mobile UX review').click();
  await expect(page).toHaveURL(/session_id=33333333-3333-4333-8333-333333333333/);
  await expect(page.getByRole('heading', { name: 'Mobile UX review' })).toBeVisible();

  await page.getByRole('button', { name: 'Waiting', exact: true }).click();
  await expect(page).toHaveURL(/filter=waiting/);
  await expect(page.getByText('1 sessions · 1 panes')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mobile UX review' })).toBeVisible();

  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.getByPlaceholder('Filter by tmux session, cwd, branch, repo, provider...').fill('deploy');
  await expect(page.getByText('1 sessions · 1 panes')).toBeVisible();
  await expect(page.getByText('ops')).toBeVisible();
});

test('keeps the tmux roster usable on mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);

  await page.goto('/tmux');

  await expect(page.getByRole('heading', { name: 'tmux', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Roster', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Terminal', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Actions', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Untracked', exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('Filter by tmux session, cwd, branch, repo, provider...')).toBeVisible();
  await expect(page.getByText('2 sessions · 3 panes')).toBeVisible();
  await expect(page.getByText('agents')).toBeVisible();

  await page.getByText('agents').click();
  await expect(page.getByText('Codex implementation')).toBeVisible();

  await page.getByText('Mobile UX review').click();
  await expect(page).toHaveURL(/session_id=33333333-3333-4333-8333-333333333333/);
  await expect(page.getByText('agents:0.1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Actions', exact: true })).toBeEnabled();

  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Pane actions');
  await expect(dialog).toContainText('Mobile UX review');
  await expect(dialog.getByRole('button', { name: 'Attach', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Detach' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Take Control' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Copy selection' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Copy last 50' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Copy all' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Paste' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Terminate pane session' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close actions' })).toBeVisible();
});

test('opens mobile launch sheet and launches a coding agent from a recent project', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);

  await page.goto('/tmux');

  await page.getByRole('button', { name: 'Launch agent' }).click();
  const dialog = page.getByRole('dialog', { name: 'Launch agent' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'heavisidelinux' })).toBeVisible();
  await expect(dialog.getByText('/home/cvsloane/dev/agent-command').first()).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Codex', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Claude', exact: true })).toBeVisible();

  await dialog.getByPlaceholder('Optional first instruction').fill('Check the failing mobile launch test.');
  await dialog.getByRole('button', { name: 'Launch Codex' }).click();

  await expect(page).toHaveURL(/session_id=22222222-2222-4222-8222-222222222222/);
  await expect(page).toHaveURL(/mode=terminal/);
  await expect(page.getByText('Codex implementation').first()).toBeVisible();
});

test('offers repeat-last launch on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.evaluate(() => {
    window.localStorage.setItem('agent-command:last-launch', JSON.stringify({
      host_id: '11111111-1111-4111-8111-111111111111',
      provider: 'codex',
      working_directory: '/home/cvsloane/dev/agent-command',
      tmux_target: 'agents',
    }));
  });

  await page.goto('/tmux');

  await page.getByRole('button', { name: 'Launch agent' }).click();
  const dialog = page.getByRole('dialog', { name: 'Launch agent' });
  await expect(dialog.getByRole('button', { name: /Repeat Codex in agent-command/ })).toBeVisible();

  await dialog.getByRole('button', { name: /Repeat Codex in agent-command/ }).click();
  await expect(page).toHaveURL(/session_id=22222222-2222-4222-8222-222222222222/);
  await expect(page).toHaveURL(/mode=terminal/);
});

test('opens an existing tmux target from the mobile launch sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);

  await page.goto('/tmux');

  await page.getByRole('button', { name: 'Launch agent' }).click();
  const dialog = page.getByRole('dialog', { name: 'Launch agent' });
  await dialog.getByRole('button', { name: 'Existing' }).click();
  await expect(dialog.getByRole('button', { name: /Mobile UX review/ })).toBeVisible();

  await dialog.getByPlaceholder('agents:0.0 or %1').fill('agents:0.1');
  await dialog.getByRole('button', { name: 'Open' }).click();

  await expect(page).toHaveURL(/session_id=33333333-3333-4333-8333-333333333333/);
  await expect(page).toHaveURL(/mode=terminal/);
});
