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
  last_seen_at: new Date().toISOString(),
  last_acked_seq: 10,
  created_at: '2026-05-19T17:00:00.000Z',
  updated_at: '2026-05-19T18:00:00.000Z',
};

const secondTmuxHost = {
  ...tmuxHost,
  id: '12121212-1212-4121-8121-121212121212',
  name: 'homelinux',
  tailscale_name: 'homelinux',
  tailscale_ip: '100.64.0.11',
};

const enrolledHost = {
  ...tmuxHost,
  id: '15151515-1515-4151-8151-151515151515',
  name: 'buildbox',
  tailscale_name: 'buildbox.tailnet-name.ts.net',
  tailscale_ip: null,
  last_seen_at: null,
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
      capture_hash: 'capture-codex-implementation',
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
      capture_hash: 'capture-mobile-ux-review',
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
      capture_hash: 'capture-deploy-logs',
    },
  },
];

const orchestratorSessions = [
  {
    ...tmuxSessions[0],
    id: '77777777-7777-4777-8777-777777777777',
    role: 'orchestrator',
    title: 'Release orchestrator',
    status: 'WAITING_FOR_APPROVAL',
    tmux_pane_id: '%7',
    tmux_target: 'orchestrators:0.0',
    metadata: {
      tmux: {
        session_name: 'orchestrators',
        window_name: 'release-lead',
        window_index: 0,
        pane_index: 0,
      },
    },
    latest_snapshot: {
      created_at: '2026-05-19T18:00:00.000Z',
      capture_text: 'Approve the production verification command?',
      capture_hash: 'capture-release-orchestrator',
    },
  },
  {
    ...tmuxSessions[1],
    id: '88888888-8888-4888-8888-888888888888',
    role: 'worker',
    title: 'Verification worker',
    status: 'RUNNING',
    tmux_pane_id: '%8',
    tmux_target: 'workers:4.0',
    metadata: {
      tmux: {
        session_name: 'workers',
        window_name: 'verification',
        window_index: 4,
        pane_index: 0,
      },
    },
  },
];

const remoteTmuxSession = {
  ...tmuxSessions[2],
  id: '13131313-1313-4131-8131-131313131313',
  host_id: secondTmuxHost.id,
  title: 'Remote deploy watch',
  status: 'WAITING_FOR_INPUT',
  tmux_pane_id: '%13',
  tmux_target: 'remote:0.0',
  metadata: {
    tmux: {
      session_name: 'remote',
      window_name: 'deploy-watch',
      window_index: 0,
      pane_index: 0,
    },
  },
};

const pendingApproval = {
  id: '99999999-9999-4999-8999-999999999999',
  session_id: orchestratorSessions[0].id,
  provider: 'codex',
  ts_requested: '2026-05-19T18:00:00.000Z',
  requested_payload: {
    reason: 'Run production verification?',
    command: 'pnpm test:smoke:dashboard',
  },
  decision: null,
  ts_decided: null,
};

const structuredRun = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  automation_agent_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  wakeup_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  repo_id: null,
  session_id: orchestratorSessions[0].id,
  status: 'succeeded',
  objective: 'Verify the release',
  memory_snapshot_json: {},
  pending_followups_json: [],
  result_summary: 'Release checks passed.',
  usage_json: { estimated_cost_cents: 42 },
  worker_report_json: {
    summary: 'All release checks passed on both machines.',
    evidence_refs: [],
    suggested_followups: [],
    candidate_memory_promotions: [],
  },
  log_ref_json: {},
  started_at: '2026-05-19T17:30:00.000Z',
  ended_at: '2026-05-19T17:45:00.000Z',
};

const automationAgent = {
  id: structuredRun.automation_agent_id,
  user_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  role: 'orchestrator',
  name: 'Release automation',
  slug: 'release-automation',
  status: 'active',
  reports_to_automation_agent_id: null,
  provider: 'codex',
  default_cwd: '/home/cvsloane/dev/agent-command',
  fixed_host_id: tmuxHost.id,
  wake_policy_json: { interval_minutes: 60, scheduler_mode: 'native' },
  memory_policy_json: {},
  budget_policy_json: { daily_limit_cents: 1000, warn_percent: 80 },
  worker_pool_json: {},
  max_parallel_runs: 1,
  runtime_state: {
    id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    automation_agent_id: structuredRun.automation_agent_id,
    repo_id: null,
    active_session_id: orchestratorSessions[0].id,
    active_host_id: tmuxHost.id,
    last_session_id: orchestratorSessions[0].id,
    last_run_id: structuredRun.id,
    runtime_status: 'attached',
    state_json: {},
    usage_rollup_json: structuredRun.usage_json,
  },
  preflight: { status: 'ok', issues: [] },
};

function sessionDetail(id: string): unknown {
  const session = [...tmuxSessions, ...orchestratorSessions].find((candidate) => candidate.id === id);
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
      sessions: [...tmuxSessions, ...orchestratorSessions],
      total: tmuxSessions.length + orchestratorSessions.length,
      limit: 200,
      offset: 0,
    };
  }
  if (pathname === '/v1/tmux/roster') {
    return {
      sessions: tmuxSessions,
      total: tmuxSessions.length,
      groups: [],
    };
  }
  if (pathname === '/v1/orchestrator/fleet') {
    return {
      orchestrators: [{
        session: orchestratorSessions[0],
        children: [orchestratorSessions[1]],
        edges: [{
          parent_session_id: orchestratorSessions[0].id,
          child_session_id: orchestratorSessions[1].id,
          edge_type: 'orchestrates',
          created_at: '2026-05-19T17:00:00.000Z',
        }],
        agent_tasks: [{
          id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          session_id: orchestratorSessions[0].id,
          tool_use_id: 'task-smoke',
          description: 'Audit mobile release flow',
          status: 'running',
          started_at: '2026-05-19T17:50:00.000Z',
          ended_at: null,
          metadata: {},
        }],
        rollup: {
          session_id: orchestratorSessions[0].id,
          child_sessions: { total: 1, by_status: { RUNNING: 1 } },
          agent_tasks: { total: 1, running: 1, completed: 0, failed: 0 },
        },
        work_item_counts: {
          total: 0,
          by_status: { queued: 0, in_progress: 0, blocked: 0, done: 0, cancelled: 0 },
        },
        automation_agent: automationAgent,
        latest_run: structuredRun,
        latest_report: {
          run_id: structuredRun.id,
          status: structuredRun.status,
          summary: 'All release checks passed on both machines.',
          reported_at: structuredRun.ended_at,
        },
        budget_policy: automationAgent.budget_policy_json,
        budget_usage: { daily_cents: 42, monthly_cents: 42 },
        usage_rollup: structuredRun.usage_json,
      }],
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
  if (/^\/v1\/sessions\/[^/]+\/graph$/.test(pathname)) {
    const [, , , id] = pathname.split('/');
    return {
      session_id: id,
      edges: id === orchestratorSessions[0].id ? [
        {
          parent_session_id: orchestratorSessions[0].id,
          child_session_id: orchestratorSessions[1].id,
          edge_type: 'orchestrates',
          created_at: '2026-05-19T17:00:00.000Z',
        },
      ] : [],
      rollup: {
        session_id: id,
        child_sessions: { total: id === orchestratorSessions[0].id ? 1 : 0, by_status: { RUNNING: 1 } },
        agent_tasks: { total: 1, running: 1, completed: 0, failed: 0 },
      },
    };
  }
  if (/^\/v1\/sessions\/[^/]+\/agent-tasks$/.test(pathname)) {
    const [, , , id] = pathname.split('/');
    return {
      session_id: id,
      agent_tasks: id === orchestratorSessions[0].id ? [
        {
          id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          session_id: id,
          tool_use_id: 'task-smoke',
          description: 'Audit mobile release flow',
          status: 'running',
          started_at: '2026-05-19T17:50:00.000Z',
          ended_at: null,
          metadata: {},
        },
      ] : [],
    };
  }
  if (pathname.startsWith('/v1/sessions/')) {
    const [, , , id] = pathname.split('/');
    return sessionDetail(id || '');
  }
  if (pathname === '/v1/groups') return { groups: [], flat: [] };
  if (pathname === '/v1/hosts') return { hosts: [tmuxHost, secondTmuxHost] };
  if (pathname === '/v1/projects') return { projects: [] };
  if (pathname === '/v1/repos') return { repos: [] };
  if (pathname === '/v1/settings') return { settings: null };
  if (pathname === '/v1/approvals') return { approvals: [pendingApproval] };
  if (pathname === '/v1/automation-agents') return { agents: [automationAgent] };
  if (pathname === '/v1/automation-runs') return { runs: [structuredRun] };
  if (/^\/v1\/automation-runs\/[^/]+\/events$/.test(pathname)) return { events: [] };
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
  return undefined;
}

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function mockControlPlane(
  page: Page,
  options: { terminalReadOnly?: boolean } = {}
): Promise<void> {
  await page.routeWebSocket(/\/v1\/ui\/stream\?ticket=/, () => {
    // Keep the mocked event stream open; REST fixtures drive these smoke tests.
  });
  await page.routeWebSocket(/\/v1\/ui\/terminal\/[^?]+\?/, (socket) => {
    socket.onMessage((message) => {
      if (typeof message !== 'string') return;
      const parsed = JSON.parse(message) as { type?: string };
      if (parsed.type === 'hello') {
        socket.send(JSON.stringify({
          type: 'attached',
          readonly: options.terminalReadOnly ?? false,
          resumed: false,
          resume_token: 'dashboard-smoke-terminal-resume',
        }));
      }
      if (parsed.type === 'control') {
        socket.send(JSON.stringify({ type: 'control' }));
      }
    });
  });

  await page.route('**/api/control-plane-token', async (route) => {
    await fulfillJson(route, {
      token: 'dashboard-smoke-token',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
  });

  await page.route('**/{v1,health}{,/**}', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'POST' && url.pathname === '/v1/auth/ws-ticket') {
      await fulfillJson(route, {
        ticket: 'dashboard-smoke-ws-ticket',
        expires_at: new Date(Date.now() + 30_000).toISOString(),
      });
      return;
    }
    if (route.request().method() === 'POST' && url.pathname === '/v1/hosts') {
      await fulfillJson(route, { host: enrolledHost, token: 'ac_agent_created_once' });
      return;
    }
    if (
      route.request().method() === 'POST'
      && /^\/v1\/hosts\/[^/]+\/token$/.test(url.pathname)
    ) {
      await fulfillJson(route, { token: 'ac_agent_rotated_once' });
      return;
    }
    if (route.request().method() === 'GET' && url.pathname === '/v1/tmux/roster') {
      const sessions = url.searchParams.get('host_id') === secondTmuxHost.id
        ? [remoteTmuxSession]
        : tmuxSessions;
      await fulfillJson(route, { sessions, total: sessions.length, groups: [] });
      return;
    }
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
    if (
      route.request().method() === 'POST'
      && /^\/v1\/sessions\/[^/]+\/commands$/.test(url.pathname)
    ) {
      await fulfillJson(route, { cmd_id: '01JCOMMANDSMOKE000000000000' });
      return;
    }
    if (
      route.request().method() === 'POST'
      && /^\/v1\/sessions\/[^/]+\/scrollback$/.test(url.pathname)
    ) {
      await fulfillJson(route, {
        cmd_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        ok: true,
        result: {
          content: 'older terminal line\npnpm test:ci passed\nwaiting for next command\n',
          line_count: 3,
          capture_mode: 'range',
        },
      });
      return;
    }
    if (
      route.request().method() === 'POST'
      && /^\/v1\/approvals\/[^/]+\/decide$/.test(url.pathname)
    ) {
      await fulfillJson(route, { approval: { ...pendingApproval, status: 'decided' } });
      return;
    }
    if (
      route.request().method() === 'POST'
      && /^\/v1\/automation-agents\/[^/]+\/message$/.test(url.pathname)
    ) {
      await fulfillJson(route, {
        automation_agent_id: automationAgent.id,
        session_id: automationAgent.runtime_state?.active_session_id,
        cmd_id: '01JNUDGESMOKE00000000000000',
      });
      return;
    }
    if (
      route.request().method() === 'POST'
      && /^\/v1\/automation-agents\/[^/]+\/wake$/.test(url.pathname)
    ) {
      await fulfillJson(route, { wakeup: { id: 'mock-wakeup', status: 'queued' } });
      return;
    }
    if (route.request().method() === 'POST' && url.pathname === '/v1/automation-agents') {
      await fulfillJson(route, { agent: automationAgent });
      return;
    }
    if (
      route.request().method() === 'PATCH'
      && /^\/v1\/automation-agents\/[^/]+$/.test(url.pathname)
    ) {
      await fulfillJson(route, { agent: automationAgent });
      return;
    }
    if (
      route.request().method() === 'POST'
      && /^\/v1\/governance-approvals\/[^/]+\/decide$/.test(url.pathname)
    ) {
      await fulfillJson(route, { approval: { id: 'mock-governance-approval', status: 'approved' } });
      return;
    }
    if (route.request().method() === 'POST' && url.pathname === '/v1/work-items') {
      await fulfillJson(route, { work_item: { id: 'mock-work-item', status: 'queued' } });
      return;
    }
    if (
      route.request().method() === 'PATCH'
      && /^\/v1\/work-items\/[^/]+$/.test(url.pathname)
    ) {
      await fulfillJson(route, { work_item: { id: 'mock-work-item', status: 'done' } });
      return;
    }
    if (route.request().method() === 'GET') {
      const body = apiBody(url.pathname);
      if (body !== undefined) {
        await fulfillJson(route, body);
        return;
      }
    }
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        error: `Unhandled smoke API request: ${route.request().method()} ${url.pathname}`,
      }),
    });
  });
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/signin');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Access code').fill(accessCode);
  await page.getByRole('button', { name: /sign in with access code/i }).click();
  await page.waitForURL('**/');
}

function tmuxRosterPane(page: Page, title: string) {
  return page.getByRole('treeitem').filter({ hasText: title }).last();
}

test.beforeEach(async ({ page }, testInfo) => {
  await mockControlPlane(page, {
    terminalReadOnly: testInfo.title.includes('gates terminal input while read-only'),
  });
});

test('protects operator routes behind credentials sign-in', async ({ page }) => {
  await page.goto('/memory');

  await expect(page).toHaveURL(/\/signin/);

  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Command Center' })).toBeVisible();
});

test('renders key operator pages with mocked control-plane data', async ({ page }, testInfo) => {
  await signIn(page);

  const pages = [
    ['/', 'Command Center'],
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
    if (
      process.env.PLAYWRIGHT_CAPTURE_UI === '1'
      && ['/sessions', '/automation', '/memory', '/hosts', '/settings'].includes(path)
    ) {
      await page.screenshot({
        path: testInfo.outputPath(`${path.slice(1)}-desktop.png`),
        fullPage: true,
      });
    }
  }
});

test('opens the global command palette and navigates to a fuzzy session result', async ({ page }) => {
  await signIn(page);
  await page.goto('/sessions');

  const searchButton = page
    .getByTestId('sessions-desktop-toolbar')
    .getByRole('button', { name: /Search/ });
  await expect(searchButton).toBeVisible();
  await searchButton.click();
  await expect(page.getByRole('dialog', { name: 'Command Center' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  let palette = page.getByRole('dialog', { name: 'Command Center' });
  await expect(palette).toBeVisible();
  await page.keyboard.press('Escape');

  const editableTarget = page.getByLabel('Terminal shortcut target');
  await page.evaluate(() => {
    const textarea = document.createElement('textarea');
    textarea.setAttribute('aria-label', 'Terminal shortcut target');
    document.body.appendChild(textarea);
    textarea.focus();
  });
  await editableTarget.dispatchEvent('keydown', {
    key: 'k',
    code: 'KeyK',
    ctrlKey: true,
    bubbles: true,
  });
  await expect(page.getByRole('dialog', { name: 'Command Center' })).not.toBeVisible();
  await editableTarget.dispatchEvent('keydown', {
    key: 'k',
    code: 'KeyK',
    metaKey: true,
    bubbles: true,
  });
  palette = page.getByRole('dialog', { name: 'Command Center' });
  await expect(palette).toBeVisible();
  const input = palette.getByRole('combobox');
  await expect(input).toBeFocused();
  await input.fill('Mobile UX heaviside');
  await expect(palette.getByRole('option', { name: /Mobile UX review/ })).toBeVisible();
  await input.press('Enter');

  await expect(page).toHaveURL(new RegExp(`/sessions/${tmuxSessions[1].id}$`));
});

test('keeps primary session actions usable at 390x844 and opens overflow plus long-press search', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto('/sessions');

  const toolbar = page.getByTestId('sessions-mobile-toolbar');
  await expect(toolbar).toBeVisible();
  for (const name of ['Select', 'Search sessions', 'New', 'More session actions']) {
    await expect(toolbar.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByTestId('sessions-desktop-toolbar')).toBeHidden();
  const targetSizes = await toolbar.getByRole('button').evaluateAll((targets) => (
    targets.map((target) => {
      const { width, height } = target.getBoundingClientRect();
      return { width, height };
    })
  ));
  expect(targetSizes.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);

  if (process.env.PLAYWRIGHT_CAPTURE_UI === '1') {
    await page.screenshot({ path: testInfo.outputPath('sessions-mobile-toolbar.png'), fullPage: true });
  }

  await toolbar.getByRole('button', { name: 'More session actions' }).click();
  const overflow = page.getByRole('dialog', { name: 'Session actions' });
  await expect(overflow).toBeVisible();
  await expect(overflow.getByRole('link', { name: 'Workflow' })).toBeVisible();
  await expect(overflow.getByRole('button', { name: 'Import orphan panes' })).toBeVisible();
  await page.keyboard.press('Escape');

  const search = toolbar.getByRole('button', { name: 'Search sessions' });
  await search.dispatchEvent('pointerdown', { pointerType: 'touch' });
  await page.waitForTimeout(550);
  await expect(page.getByRole('dialog', { name: 'Command Center' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  if (process.env.PLAYWRIGHT_CAPTURE_UI === '1') {
    await page.screenshot({ path: testInfo.outputPath('sessions-mobile-command-palette.png'), fullPage: true });
  }
});

test('enrolls a host and rotates its token with one-time installation guidance', async ({ page }) => {
  await signIn(page);
  await page.goto('/hosts');

  await page.getByRole('button', { name: 'Add host' }).click();
  const addDialog = page.getByRole('dialog', { name: 'Add host' });
  await addDialog.getByLabel('Name', { exact: true }).fill('buildbox');
  await addDialog.getByLabel('Tailscale name (optional)').fill('buildbox.tailnet-name.ts.net');
  const createRequest = page.waitForRequest((request) => (
    request.method() === 'POST' && new URL(request.url()).pathname === '/v1/hosts'
  ));
  await addDialog.getByRole('button', { name: 'Create host' }).click();
  expect((await createRequest).postDataJSON()).toEqual({
    name: 'buildbox',
    tailscale_name: 'buildbox.tailnet-name.ts.net',
  });

  const created = page.getByRole('dialog', { name: 'Host created' });
  await expect(created.getByText(enrolledHost.id, { exact: true })).toBeVisible();
  await expect(created.getByText('ac_agent_created_once', { exact: true })).toBeVisible();
  await expect(created).toContainText('Copy the token now.');
  await expect(created).toContainText('deploy/install-agentd.sh');
  await expect(created).toContainText('~/.config/agentd/config.yaml');
  await expect(created).toContainText('/v1/agent/connect');
  await expect(created).toContainText('systemctl --user enable --now agentd.service');
  await created.getByRole('button', { name: 'I saved the token' }).click();
  await expect(created).not.toBeVisible();
  await expect(page.getByText('ac_agent_created_once', { exact: true })).toHaveCount(0);

  const rotateRequest = page.waitForRequest((request) => (
    request.method() === 'POST'
    && new URL(request.url()).pathname === `/v1/hosts/${tmuxHost.id}/token`
  ));
  await page.getByRole('button', { name: 'Rotate agent token' }).first().click();
  await rotateRequest;
  const rotated = page.getByRole('dialog', { name: 'Agent token rotated' });
  await expect(rotated.getByText(tmuxHost.id, { exact: true })).toBeVisible();
  await expect(rotated.getByText('ac_agent_rotated_once', { exact: true })).toBeVisible();
  await rotated.getByRole('button', { name: 'I saved the token' }).click();
  await expect(rotated).not.toBeVisible();
  await expect(page.getByText('ac_agent_rotated_once', { exact: true })).toHaveCount(0);
});

test('hides host enrollment actions when the control plane rejects admin access', async ({ page }) => {
  await page.route('**/v1/hosts', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Forbidden' }),
      });
      return;
    }
    await route.fallback();
  });
  await signIn(page);
  await page.goto('/hosts');

  await page.getByRole('button', { name: 'Add host' }).click();
  const addDialog = page.getByRole('dialog', { name: 'Add host' });
  await addDialog.getByLabel('Name', { exact: true }).fill('viewer-host');
  await addDialog.getByRole('button', { name: 'Create host' }).click();

  await expect(addDialog.getByRole('alert')).toContainText('administrators only');
  await expect(page.getByRole('button', { name: 'Add host' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Rotate agent token' })).toHaveCount(0);
});

test('renders Command Center at mobile and desktop widths and redirects legacy tmux links', async ({ page }, testInfo) => {
  await signIn(page);

  for (const viewport of [
    { name: 'mobile', width: 390, height: 844 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1280, height: 720 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Command Center' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'tmux', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Launch' })).toBeVisible();
    await expect(page.getByText('New in v0.2.0')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open menu' })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    if (viewport.name === 'mobile') {
      const mobileTargets = page.getByRole('navigation', { name: 'Primary mobile navigation' }).locator('a, button');
      await expect(mobileTargets).toHaveCount(4);
      const targetSizes = await mobileTargets.evaluateAll((targets) => (
        targets.map((target) => {
          const { width, height } = target.getBoundingClientRect();
          return { width, height };
        })
      ));
      expect(targetSizes.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);
    }

    if (process.env.PLAYWRIGHT_CAPTURE_UI === '1') {
      await page.screenshot({ path: testInfo.outputPath(`command-center-${viewport.name}.png`), fullPage: true });
    }
  }

  await page.goto('/tmux?filter=waiting&host_id=all');
  await expect(page).toHaveURL(/\/\?filter=waiting&host_id=all$/);
  await expect(page.getByRole('heading', { name: 'Command Center' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Waiting', exact: true })).toBeVisible();
});

test('opens the single launch sheet from Command Center and Sessions rails', async ({ page }) => {
  await signIn(page);

  const commandCenterRail = page.getByRole('region', { name: 'Launch' });
  await commandCenterRail.getByRole('button', { name: 'New', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Launch agent' })).toBeVisible();
  await page.getByRole('button', { name: 'Close launch sheet' }).click();

  await commandCenterRail.getByRole('button', { name: 'Recent', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Recent launches' })).toBeVisible();
  await page.getByRole('button', { name: 'Close launch sheet' }).click();

  await commandCenterRail.getByRole('button', { name: /Open existing/ }).click();
  await expect(page.getByRole('dialog', { name: 'Open existing' })).toBeVisible();
  await expect(page.getByPlaceholder('agents:0.0 or %1')).toBeVisible();
  await page.getByRole('button', { name: 'Close launch sheet' }).click();

  await page.goto('/sessions');
  await expect(page.getByRole('region', { name: 'Launch' })).toBeVisible();
});

test('uses the same attention surface for the mobile bell, tab, and desktop sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);

  await page.getByRole('button', { name: /^Attention -/ }).click();
  await expect(page).toHaveURL(/\/orchestrator\?tab=attention/);
  await expect(page.getByTestId('attention-surface')).toHaveAttribute('data-presentation', 'page');
  await expect(page.getByRole('tab', { name: /Attention/ })).toHaveAttribute('data-state', 'active');

  await page.goto('/');
  const mobileNav = page.getByRole('navigation', { name: 'Primary mobile navigation' });
  await mobileNav.getByRole('link', { name: 'Attention' }).click();
  await expect(page).toHaveURL(/\/orchestrator\?tab=attention/);
  await expect(page.getByTestId('attention-surface')).toHaveAttribute('data-presentation', 'page');

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  const desktopBell = page.getByRole('button', { name: /^Attention -/ });
  await desktopBell.click();
  const sheet = page.getByRole('dialog', { name: 'Attention' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('attention-surface')).toHaveAttribute('data-presentation', 'sheet');
  await page.keyboard.press('Escape');
  await expect(sheet).not.toBeVisible();
  await expect(desktopBell).toBeFocused();
});

test('renders tmux roster with windows and panes, supports selection and filtering', async ({ page }, testInfo) => {
  await signIn(page);

  await page.goto('/tmux');

  await expect(page.getByRole('heading', { name: 'tmux', exact: true })).toBeVisible();
  await expect(page.getByText('2 sessions · 3 panes')).toBeVisible();
  await expect(page.getByText('agents', { exact: true })).toBeVisible();
  await expect(page.getByText('ops', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Waiting', exact: true })).toBeVisible();
  let duplicateRosterRequests = 0;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/v1/tmux/roster') {
      duplicateRosterRequests += 1;
    }
  });

  await page.getByText('agents', { exact: true }).click();
  await expect(page.getByText('0 · agent-command')).toBeVisible();
  await expect(tmuxRosterPane(page, 'Codex implementation')).toBeVisible();
  await expect(tmuxRosterPane(page, 'Mobile UX review')).toBeVisible();

  await tmuxRosterPane(page, 'Mobile UX review').click();
  await expect(page).toHaveURL(/session_id=33333333-3333-4333-8333-333333333333/);
  await expect(page.getByRole('heading', { name: 'Mobile UX review' })).toBeVisible();
  await expect(page.getByTestId('tmux-window-strip')).toBeVisible();
  await expect(page.getByLabel('Secondary terminal')).toBeVisible();
  await expect.poll(() => duplicateRosterRequests).toBe(0);
  if (process.env.PLAYWRIGHT_CAPTURE_UI === '1') {
    await page.screenshot({ path: testInfo.outputPath('tmux-terminal-desktop.png'), fullPage: true });
  }

  await page.getByRole('button', { name: 'Waiting', exact: true }).click();
  await expect(page).toHaveURL(/filter=waiting/);
  await expect(page.getByText('1 sessions · 1 panes')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mobile UX review' })).toBeVisible();

  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.getByPlaceholder('Filter by tmux session, cwd, branch, repo, provider...').fill('deploy');
  await expect(page.getByText('1 sessions · 1 panes')).toBeVisible();
  await expect(page.getByText('ops', { exact: true })).toBeVisible();
});

test('opens the terminal composer from attention and submits one newline-safe prompt', async ({ page }, testInfo) => {
  await signIn(page);
  await page.goto('/tmux');
  await page.getByText('agents', { exact: true }).click();
  await tmuxRosterPane(page, 'Mobile UX review').click();

  const overlay = page.getByTestId('terminal-attention-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('Needs attention');
  await overlay.getByRole('button', { name: 'Respond' }).click();

  const composer = page.getByTestId('prompt-composer');
  const input = composer.getByLabel('Prompt Mobile UX review');
  await expect(composer).toBeVisible();
  await expect(input).toBeFocused();
  await input.fill('Inspect the mobile terminal state.');

  const commandRequest = page.waitForRequest((request) => (
    request.method() === 'POST'
    && request.url().includes(`/v1/sessions/${tmuxSessions[1].id}/commands`)
  ));
  await input.press('Control+Enter');
  expect((await commandRequest).postDataJSON()).toEqual({
    type: 'send_input',
    payload: { text: 'Inspect the mobile terminal state.\n', enter: false },
  });
  await expect(composer.getByRole('status')).toHaveText('Prompt sent.');

  const workspaceBox = await page.getByTestId('tmux-terminal-workspace').boundingBox();
  const composerBox = await composer.boundingBox();
  expect(workspaceBox).not.toBeNull();
  expect(composerBox).not.toBeNull();
  expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(
    workspaceBox!.y + workspaceBox!.height + 1
  );

  if (process.env.PLAYWRIGHT_CAPTURE_UI === '1') {
    await page.screenshot({ path: testInfo.outputPath('terminal-attention-composer-desktop.png') });
  }
});

test('gates terminal input while read-only until the viewer takes control', async ({ page }, testInfo) => {
  await signIn(page);
  await page.goto('/tmux');
  await page.getByText('agents', { exact: true }).click();
  await tmuxRosterPane(page, 'Mobile UX review').click();

  await expect(page.getByRole('button', { name: 'Detach', exact: true })).toBeVisible();
  await expect(page.getByText('Read-only', { exact: true })).toBeVisible();
  const overlay = page.getByTestId('terminal-attention-overlay');
  await expect(overlay.getByRole('button', { name: 'Respond' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Send a prompt', exact: true })).toBeDisabled();
  await expect(page.getByText('Read-only — take control to type')).toHaveCount(2);

  if (process.env.PLAYWRIGHT_CAPTURE_UI === '1') {
    await page.screenshot({ path: testInfo.outputPath('terminal-readonly-desktop.png') });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileSegments = page.getByRole('button', { name: 'Roster', exact: true }).locator('..');
  await mobileSegments.getByRole('button', { name: 'Terminal', exact: true }).click();
  await expect(page.getByText('Read-only — take control to type')).toHaveCount(2);
  for (const name of ['Take Control', 'Focus']) {
    const box = await page.getByRole('button', { name, exact: true }).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  }
  if (process.env.PLAYWRIGHT_CAPTURE_UI === '1') {
    await page.getByTestId('tmux-terminal-workspace').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('terminal-readonly-mobile.png') });
  }
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.getByRole('button', { name: 'Take Control', exact: true }).click();
  await expect(overlay.getByRole('button', { name: 'Respond' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Send a prompt', exact: true })).toBeEnabled();
});

test('keeps the tmux roster usable on mobile viewport', async ({ page }, testInfo) => {
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
  await expect(page.getByText('agents', { exact: true })).toBeVisible();

  await page.getByText('agents', { exact: true }).click();
  await expect(tmuxRosterPane(page, 'Codex implementation')).toBeVisible();

  await tmuxRosterPane(page, 'Mobile UX review').click();
  await expect(page).toHaveURL(/session_id=33333333-3333-4333-8333-333333333333/);
  await expect.poll(() => new URL(page.url()).pathname).toBe('/');
  const mobileSegments = page.getByRole('button', { name: 'Roster', exact: true }).locator('..');
  const terminalSegment = mobileSegments.getByRole('button', { name: 'Terminal', exact: true });
  await expect(terminalSegment).toBeEnabled();
  await terminalSegment.click();
  await expect(page.getByText('agents:0.1').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Actions', exact: true })).toBeEnabled();

  const overlay = page.getByTestId('terminal-attention-overlay');
  await expect(overlay).toBeVisible();
  await overlay.getByRole('button', { name: 'Respond' }).click();
  const composer = page.getByTestId('prompt-composer');
  await expect(composer).toBeVisible();
  await expect(composer.getByLabel('Prompt Mobile UX review')).toBeFocused();
  if (process.env.PLAYWRIGHT_CAPTURE_UI === '1') {
    await page.screenshot({ path: testInfo.outputPath('terminal-attention-composer-mobile.png') });
  }
  await composer.getByRole('button', { name: 'Collapse prompt composer' }).click();

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
  await expect(dialog.getByRole('button', { name: 'Kill pane', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close actions' })).toBeVisible();
});

test('renders the tmux window strip and opens range-paged history on mobile', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);

  await page.goto('/tmux');
  await page.getByText('agents', { exact: true }).click();
  await tmuxRosterPane(page, 'Mobile UX review').click();

  const windowStrip = page.getByTestId('tmux-window-strip').first();
  await expect(windowStrip).toBeVisible();
  await expect(windowStrip.getByRole('tab', { name: 'Window 0: agent-command' })).toBeVisible();

  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  const actions = page.getByRole('dialog').filter({ hasText: 'Pane actions' });
  const historyRequest = page.waitForRequest((request) => (
    request.method() === 'POST'
    && request.url().includes(`/v1/sessions/${tmuxSessions[1].id}/scrollback`)
  ));
  await actions.getByRole('button', { name: 'View history' }).click();

  expect((await historyRequest).postDataJSON()).toEqual({
    mode: 'range',
    start_line: -500,
    end_line: -1,
    strip_ansi: true,
  });
  const pager = page.getByRole('dialog', { name: 'Terminal history' });
  await expect(pager).toBeVisible();
  await expect(pager.getByText('pnpm test:ci passed')).toBeVisible();
  await pager.getByPlaceholder('Filter captured history…').fill('passed');
  await expect(pager.getByText('1 matches')).toBeVisible();

  if (process.env.PLAYWRIGHT_CAPTURE_UI === '1') {
    await page.screenshot({ path: testInfo.outputPath('tmux-history-mobile.png') });
  }
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

test('uses unified bottom navigation to steer an orchestrator card on mobile', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);

  const mobileNav = page.getByRole('navigation', { name: 'Primary mobile navigation' });
  await expect(mobileNav.getByRole('link', { name: 'Command Center' })).toBeVisible();
  await expect(mobileNav.getByRole('link', { name: 'Attention' })).toBeVisible();
  await expect(mobileNav.getByRole('link', { name: 'Sessions' })).toBeVisible();
  await expect(mobileNav.getByRole('button', { name: 'More' })).toBeVisible();

  await mobileNav.getByRole('link', { name: 'Attention' }).click();
  await expect(page).toHaveURL(/\/orchestrator\?tab=attention/);
  await expect(page.getByRole('tab', { name: /Attention/ })).toHaveAttribute('data-state', 'active');
  await page.getByRole('tab', { name: /Fleet/ }).click();
  const card = page.getByTestId('orchestrator-card');
  await expect(card).toContainText('Release orchestrator');
  await expect(card).toContainText('Verification worker');
  await expect(card).toContainText('Audit mobile release flow');
  await expect(card).toContainText('All release checks passed on both machines.');
  await expect(card.getByRole('button', { name: 'Approve' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Deny' })).toBeVisible();
  await expect(card.getByRole('link', { name: 'Open terminal' })).toBeVisible();

  const approvalRequest = page.waitForRequest((request) => (
    request.method() === 'POST'
    && request.url().includes(`/v1/approvals/${pendingApproval.id}/decide`)
  ));
  await card.getByRole('button', { name: 'Approve' }).click();
  expect((await approvalRequest).postDataJSON()).toEqual({ decision: 'allow', mode: 'both' });

  const commandRequest = page.waitForRequest((request) => (
    request.method() === 'POST'
    && request.url().includes(`/v1/sessions/${orchestratorSessions[0].id}/commands`)
  ));
  await card.getByPlaceholder('Steer this orchestrator without opening its terminal…').fill('Summarize remaining release risk.');
  await card.getByRole('button', { name: 'Send prompt' }).click();
  const request = await commandRequest;
  expect(request.postDataJSON()).toMatchObject({
    type: 'send_input',
    payload: { text: 'Summarize remaining release risk.', enter: true },
  });
  await expect(card).toContainText('Prompt sent to orchestrator.');

  if (process.env.PLAYWRIGHT_CAPTURE_UI === '1') {
    await page.getByRole('main').evaluate((element) => { element.scrollTop = 0; });
    await page.screenshot({ path: testInfo.outputPath('orchestrator-mobile-top.png') });
    await card.getByPlaceholder('Steer this orchestrator without opening its terminal…').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('orchestrator-mobile.png'), fullPage: true });
  }

  const moreButton = mobileNav.getByRole('button', { name: 'More' });
  await moreButton.click();
  await expect(page.getByRole('dialog', { name: 'Navigation' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Navigation' })).not.toBeVisible();
  await expect(moreButton).toBeFocused();
});

test('aggregates every online tmux machine and sorts waiting work first', async ({ page }, testInfo) => {
  await signIn(page);
  await page.goto('/tmux');

  await page.getByRole('button', { name: /All machines 2 online/ }).click();
  await expect(page).toHaveURL(/host_id=all/);
  await expect(page.getByText('Every online tmux machine · waiting work first')).toBeVisible();
  await expect(page.getByText('Remote deploy watch')).not.toBeVisible();
  await page.getByText('remote').click();
  await expect(page.getByText('Remote deploy watch')).toBeVisible();
  await expect(page.getByText('homelinux').last()).toBeVisible();
  if (process.env.PLAYWRIGHT_CAPTURE_UI === '1') {
    await page.screenshot({ path: testInfo.outputPath('tmux-all-machines-desktop.png'), fullPage: true });
  }
});

test('keeps URL tabs, sheets, and budget context usable at tablet width', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await signIn(page);
  await page.goto(`/automation?run=${structuredRun.id}`);

  await expect(page.getByRole('tab', { name: 'Runs' })).toHaveAttribute('data-state', 'active');
  await expect(page.getByRole('button', { name: 'Hide timeline' })).toBeVisible();
  await page.getByRole('tab', { name: 'Agents' }).click();
  await expect(page).toHaveURL(/\/automation$/);
  await expect(page.getByRole('progressbar', { name: 'Release automation daily budget' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nudge' })).toBeEnabled();

  const nudgeRequest = page.waitForRequest((request) => (
    request.method() === 'POST'
    && request.url().includes(`/v1/automation-agents/${automationAgent.slug}/message`)
  ));
  await page.getByRole('button', { name: 'Nudge' }).click();
  const nudgeSheet = page.getByRole('dialog', { name: `Nudge ${automationAgent.name}` });
  await nudgeSheet.getByLabel('Message').fill('Summarize the release queue.');
  await nudgeSheet.getByRole('button', { name: 'Send nudge' }).click();
  expect((await nudgeRequest).postDataJSON()).toEqual({
    message: 'Summarize the release queue.',
    enter: true,
  });
  await expect(nudgeSheet).not.toBeVisible();

  await page.getByRole('button', { name: 'New agent' }).click();
  const sheet = page.getByRole('dialog', { name: 'New automation agent' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel('Name')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Create agent' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.PLAYWRIGHT_CAPTURE_UI === '1') {
    await page.screenshot({ path: testInfo.outputPath('automation-tablet-sheet.png'), fullPage: true });
  }
  await sheet.getByRole('button', { name: 'Close New automation agent' }).click();
});
