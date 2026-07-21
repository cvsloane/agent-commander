import type { Page, Route, WebSocketRoute } from '@playwright/test';

export const accessCode = process.env.PLAYWRIGHT_ACCESS_CODE || 'playwright-access';

export const host = {
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
  agent_version: 'journey-test',
  last_seen_at: new Date().toISOString(),
  last_acked_seq: 10,
  created_at: '2026-07-20T12:00:00.000Z',
  updated_at: '2026-07-20T14:00:00.000Z',
};

const baseSession = {
  host_id: host.id,
  user_id: null,
  repo_id: null,
  kind: 'tmux_pane',
  provider: 'codex',
  cwd: '/home/cvsloane/dev/agent-command',
  repo_root: '/home/cvsloane/dev/agent-command',
  git_remote: 'git@github.com:cvsloane/agent-command.git',
  git_branch: 'refactor/frontend-command-center',
  created_at: '2026-07-20T12:00:00.000Z',
  updated_at: '2026-07-20T14:00:00.000Z',
  last_activity_at: '2026-07-20T14:00:00.000Z',
  idled_at: null,
  group_id: null,
  forked_from: null,
  fork_depth: 0,
  archived_at: null,
};

export const interactiveSession = {
  ...baseSession,
  id: '22222222-2222-4222-8222-222222222222',
  status: 'RUNNING',
  title: 'Interactive shell',
  tmux_pane_id: '%1',
  tmux_target: 'agents:0.0',
  metadata: {
    tmux: {
      session_name: 'agents',
      window_name: 'command-center',
      window_index: 0,
      pane_index: 0,
    },
  },
  latest_snapshot: {
    created_at: '2026-07-20T14:00:00.000Z',
    capture_text: 'ready for input',
    capture_hash: 'interactive-shell-capture',
  },
};

export const approvalSession = {
  ...baseSession,
  id: '33333333-3333-4333-8333-333333333333',
  status: 'WAITING_FOR_APPROVAL',
  title: 'Release approval',
  tmux_pane_id: '%2',
  tmux_target: 'agents:0.1',
  metadata: {
    tmux: {
      session_name: 'agents',
      window_name: 'command-center',
      window_index: 0,
      pane_index: 1,
    },
  },
  latest_snapshot: {
    created_at: '2026-07-20T14:00:00.000Z',
    capture_text: 'Approve the release verification command?',
    capture_hash: 'release-approval-capture',
  },
};

export const windowSession = {
  ...baseSession,
  id: '44444444-4444-4444-8444-444444444444',
  status: 'RUNNING',
  title: 'Window two shell',
  tmux_pane_id: '%4',
  tmux_target: 'agents:1.0',
  metadata: {
    tmux: {
      session_name: 'agents',
      window_name: 'verification',
      window_index: 1,
      pane_index: 0,
    },
  },
  latest_snapshot: {
    created_at: '2026-07-20T14:00:00.000Z',
    capture_text: 'verification ready',
    capture_hash: 'window-two-shell-capture',
  },
};

const sessions = [interactiveSession, approvalSession];

export const pendingApproval = {
  id: '99999999-9999-4999-8999-999999999999',
  session_id: approvalSession.id,
  provider: 'codex',
  ts_requested: '2026-07-20T14:00:00.000Z',
  requested_payload: {
    reason: 'Run release verification?',
    approval_type: 'binary',
    input_schema: {
      type: 'binary',
      allow_label: 'Approve',
      deny_label: 'Deny',
    },
    command: 'pnpm test:ci',
  },
  decision: null,
  ts_decided: null,
};

function topologyMessage(
  secondWindowName: string | null,
  secondWindowHasTrackedPane: boolean,
  zoomedWindowIndex: number | null = null
) {
  const windows = [
    {
      window_index: 0,
      window_name: 'command-center',
      active: true,
      zoomed: zoomedWindowIndex === 0,
      layout: '8f5a,160x50,0,0,1',
      bell: false,
      activity: false,
      panes: [
        {
          pane_id: interactiveSession.tmux_pane_id,
          pane_index: 0,
          active: true,
          width: 94,
          height: 40,
          title: interactiveSession.title,
          current_command: 'bash',
          current_path: interactiveSession.cwd,
        },
        {
          pane_id: approvalSession.tmux_pane_id,
          pane_index: 1,
          active: false,
          width: 94,
          height: 40,
          title: approvalSession.title,
          current_command: 'codex',
          current_path: approvalSession.cwd,
        },
      ],
    },
  ];
  if (secondWindowName) {
    windows.push({
      window_index: 1,
      window_name: secondWindowName,
      active: false,
      zoomed: zoomedWindowIndex === 1,
      layout: 'even-horizontal',
      bell: false,
      activity: false,
      panes: secondWindowHasTrackedPane ? [
        {
          pane_id: windowSession.tmux_pane_id,
          pane_index: 0,
          active: true,
          width: 94,
          height: 40,
          title: windowSession.title,
          current_command: 'bash',
          current_path: windowSession.cwd,
        },
      ] : [],
    });
  }

  return {
    v: 1,
    type: 'tmux.topology',
    ts: new Date().toISOString(),
    payload: {
      host_id: host.id,
      reason: 'hook:after-select-pane',
      tmux_sessions: [
        {
          session_name: 'agents',
          attached: true,
          attached_clients: 1,
          windows,
        },
      ],
    },
  };
}

export interface JourneyRecorder {
  approvalDecisions: unknown[];
  commandRequests: unknown[];
  launchRequests: unknown[];
  scrollbackRequests: unknown[];
  scrollbackSessionIds: string[];
  terminalMessages: Array<{
    type?: string;
    data?: string;
    op?: string;
    on?: boolean;
    pane_id?: string;
    window_index?: number;
  }>;
  terminalSessionIds: string[];
  terminalWebSocketUrls: string[];
}

interface MockOptions {
  terminalReadOnly?: boolean;
  terminalOutput?: string;
  multiWindow?: boolean;
}

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function sessionDetail(id: string, availableSessions = sessions): unknown {
  const session = availableSessions.find((candidate) => candidate.id === id);
  if (!session) return {};
  return {
    session,
    snapshot: session.latest_snapshot,
    events: [],
    approvals: session.id === approvalSession.id ? [pendingApproval] : [],
  };
}

function apiBody(pathname: string, availableSessions = sessions): unknown {
  if (pathname === '/health') {
    return {
      status: 'ok',
      timestamp: new Date(0).toISOString(),
      connections: { uiClients: 0, agents: 0 },
    };
  }
  if (pathname === '/v1/sessions/total') return { total: availableSessions.length };
  if (pathname === '/v1/sessions/usage-latest') return { usage: [] };
  if (pathname === '/v1/sessions') {
    return { sessions: availableSessions, total: availableSessions.length, limit: 200, offset: 0 };
  }
  if (pathname === '/v1/tmux/roster') {
    return { sessions: availableSessions, total: availableSessions.length, groups: [] };
  }
  if (pathname === '/v1/orchestrator/fleet') return { orchestrators: [] };
  if (pathname === '/v1/launch/targets') {
    return {
      targets: [
        {
          host_id: host.id,
          alias: host.name,
          display_name: host.name,
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
              last_used_at: '2026-07-20T14:00:00.000Z',
            },
          ],
          recent_tmux: availableSessions.map((session) => ({
            session_id: session.id,
            title: session.title,
            tmux_target: session.tmux_target,
            pane_id: session.tmux_pane_id,
            cwd: session.cwd,
            provider: session.provider,
            status: session.status,
          })),
          recent_launches: [],
        },
      ],
    };
  }
  if (/^\/v1\/sessions\/[^/]+\/analytics$/.test(pathname)) {
    const [, , , sessionId] = pathname.split('/');
    return {
      session_id: sessionId,
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
  if (/^\/v1\/sessions\/[^/]+\/analytics\/timeseries$/.test(pathname)) return { data: [] };
  if (/^\/v1\/sessions\/[^/]+\/(events|tool-events)$/.test(pathname)) return { events: [] };
  if (/^\/v1\/sessions\/[^/]+\/tool-stats$/.test(pathname)) return { stats: [] };
  if (/^\/v1\/sessions\/[^/]+\/(graph|agent-tasks)$/.test(pathname)) {
    const [, , , sessionId] = pathname.split('/');
    return pathname.endsWith('/graph')
      ? {
          session_id: sessionId,
          edges: [],
          rollup: {
            session_id: sessionId,
            child_sessions: { total: 0, by_status: {} },
            agent_tasks: { total: 0, running: 0, completed: 0, failed: 0 },
          },
        }
      : { session_id: sessionId, agent_tasks: [] };
  }
  if (pathname.startsWith('/v1/sessions/')) {
    const [, , , sessionId] = pathname.split('/');
    return sessionDetail(sessionId || '', availableSessions);
  }
  if (pathname === '/v1/groups') return { groups: [], flat: [] };
  if (pathname === '/v1/hosts') return { hosts: [host] };
  if (pathname === '/v1/projects') return { projects: [] };
  if (pathname === '/v1/repos') return { repos: [] };
  if (pathname === '/v1/settings') return { settings: null };
  if (pathname === '/v1/approvals') return { approvals: [pendingApproval] };
  if (pathname === '/v1/automation-agents') return { agents: [] };
  if (pathname === '/v1/automation-runs') return { runs: [] };
  if (pathname === '/v1/automation-wakeups') return { wakeups: [] };
  if (pathname === '/v1/governance-approvals') return { approvals: [] };
  if (pathname === '/v1/work-items') return { work_items: [] };
  if (pathname === '/v1/memory/search') return { results: [] };
  if (pathname === '/v1/analytics/provider-usage') return { usage: [] };
  if (pathname === '/v1/analytics/usage/weekly') {
    return {
      week_start: '2026-07-20',
      total_tokens: 0,
      total_cost_cents: 0,
      daily: [],
      by_provider: {},
    };
  }
  return undefined;
}

function historyContent(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`).join('\n') + '\n';
}

export async function mockControlPlane(
  page: Page,
  options: MockOptions = {}
): Promise<JourneyRecorder> {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = 'nextjs-portal { pointer-events: none !important; }';
      document.head.appendChild(style);
    });
  });
  const recorder: JourneyRecorder = {
    approvalDecisions: [],
    commandRequests: [],
    launchRequests: [],
    scrollbackRequests: [],
    scrollbackSessionIds: [],
    terminalMessages: [],
    terminalSessionIds: [],
    terminalWebSocketUrls: [],
  };
  const availableSessions = options.multiWindow ? [...sessions, windowSession] : sessions;
  let selectedWindowIndex = 0;
  let zoomedWindowIndex: number | null = null;
  let secondWindowName = options.multiWindow ? 'verification' : null;
  let secondWindowHasTrackedPane = options.multiWindow ?? false;
  const topologySockets = new Set<WebSocketRoute>();
  const sendTopology = () => {
    const message = JSON.stringify(topologyMessage(
      secondWindowName,
      secondWindowHasTrackedPane,
      zoomedWindowIndex
    ));
    for (const socket of topologySockets) socket.send(message);
  };

  await page.routeWebSocket(/\/v1\/ui\/stream\?ticket=/, (socket) => {
    topologySockets.add(socket);
    let topologySent = false;
    socket.onMessage(() => {
      if (topologySent) return;
      topologySent = true;
      sendTopology();
    });
  });
  await page.routeWebSocket(/\/v1\/ui\/terminal\//, (socket) => {
    recorder.terminalWebSocketUrls.push(socket.url());
    const sessionId = socket.url().match(/\/v1\/ui\/terminal\/([^?]+)/)?.[1];
    if (sessionId) recorder.terminalSessionIds.push(decodeURIComponent(sessionId));
    socket.onMessage((message) => {
      if (typeof message !== 'string') return;
      const parsed = JSON.parse(message) as JourneyRecorder['terminalMessages'][number];
      recorder.terminalMessages.push(parsed);
      if (parsed.type === 'hello') {
        socket.send(
          JSON.stringify({
            type: 'attached',
            readonly: options.terminalReadOnly ?? false,
            resumed: false,
            resume_token: 'dashboard-journey-terminal-resume',
          })
        );
        if (options.terminalOutput) {
          socket.send(JSON.stringify({
            type: 'output',
            data: options.terminalOutput,
            encoding: 'utf8',
          }));
        }
      }
      if (parsed.type === 'control') {
        socket.send(JSON.stringify({ type: 'control' }));
      }
      if (parsed.type === 'navigate' && parsed.op === 'select_window' && parsed.window_index !== undefined) {
        selectedWindowIndex = parsed.window_index;
        zoomedWindowIndex = null;
        sendTopology();
      }
      if (parsed.type === 'navigate' && parsed.op === 'select_pane' && parsed.pane_id) {
        selectedWindowIndex = parsed.pane_id === windowSession.tmux_pane_id ? 1 : 0;
        zoomedWindowIndex = null;
        sendTopology();
      }
      if (parsed.type === 'navigate' && parsed.op === 'zoom' && parsed.on !== undefined) {
        zoomedWindowIndex = parsed.on ? selectedWindowIndex : null;
        sendTopology();
      }
    });
  });

  await page.route('**/api/control-plane-token', async (route) => {
    await fulfillJson(route, {
      token: 'dashboard-journey-token',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
  });

  await page.route('**/{v1,health}{,/**}', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'POST' && url.pathname === '/v1/auth/ws-ticket') {
      await fulfillJson(route, {
        ticket: 'dashboard-journey-ws-ticket',
        expires_at: new Date(Date.now() + 30_000).toISOString(),
      });
      return;
    }
    if (request.method() === 'POST' && url.pathname === '/v1/launch') {
      recorder.launchRequests.push(request.postDataJSON());
      await fulfillJson(route, {
        session_id: interactiveSession.id,
        cmd_id: '01JJOURNEYLAUNCH00000000000',
        status: 'ready',
        href: `/?host_id=${host.id}&session_id=${interactiveSession.id}&mode=terminal&attach=1`,
        session: interactiveSession,
        terminal: { openable: true, pane_id: interactiveSession.tmux_pane_id },
      });
      return;
    }
    if (request.method() === 'POST' && /^\/v1\/sessions\/[^/]+\/commands$/.test(url.pathname)) {
      const command = request.postDataJSON() as {
        type?: string;
        payload?: { name?: string; window_index?: number };
      };
      recorder.commandRequests.push(command);
      if (command.type === 'new_window') {
        secondWindowName = 'new';
        secondWindowHasTrackedPane = false;
        sendTopology();
      } else if (command.type === 'rename_window' && command.payload?.window_index === 1) {
        secondWindowName = command.payload.name ?? secondWindowName;
        sendTopology();
      } else if (command.type === 'kill_window' && command.payload?.window_index === 1) {
        secondWindowName = null;
        secondWindowHasTrackedPane = false;
        zoomedWindowIndex = null;
        sendTopology();
      }
      await fulfillJson(route, { cmd_id: '01JJOURNEYCOMMAND0000000000' });
      return;
    }
    if (request.method() === 'POST' && /^\/v1\/sessions\/[^/]+\/scrollback$/.test(url.pathname)) {
      const body = request.postDataJSON() as { start_line?: number };
      recorder.scrollbackRequests.push(body);
      recorder.scrollbackSessionIds.push(url.pathname.split('/')[3] || '');
      const initialPage = body.start_line === -500;
      await fulfillJson(route, {
        cmd_id: '01JJOURNEYHISTORY0000000000',
        ok: true,
        result: {
          content: historyContent(
            initialPage ? 'recent line' : 'older line',
            initialPage ? 500 : 12
          ),
          line_count: initialPage ? 500 : 12,
          capture_mode: 'range',
        },
      });
      return;
    }
    if (request.method() === 'POST' && /^\/v1\/approvals\/[^/]+\/decide$/.test(url.pathname)) {
      const body = request.postDataJSON();
      recorder.approvalDecisions.push(body);
      await fulfillJson(route, {
        approval: {
          ...pendingApproval,
          decision: 'allow',
          ts_decided: new Date().toISOString(),
        },
      });
      return;
    }
    if (request.method() === 'PUT' && url.pathname === '/v1/settings') {
      await fulfillJson(route, { settings: request.postDataJSON() ?? {} });
      return;
    }
    if (request.method() === 'GET') {
      const body = apiBody(url.pathname, availableSessions);
      if (body !== undefined) {
        await fulfillJson(route, body);
        return;
      }
    }
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        error: `Unhandled journey API request: ${request.method()} ${url.pathname}`,
      }),
    });
  });

  return recorder;
}

export async function signIn(page: Page): Promise<void> {
  await page.goto('/signin');
  await page.getByLabel('Access code').fill(accessCode);
  await page.getByRole('button', { name: /sign in with access code/i }).click();
  await page.waitForURL('**/');
}
