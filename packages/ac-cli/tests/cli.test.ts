import { describe, expect, it, vi } from 'vitest';
import { runCli, type CliDependencies } from '../src/cli.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function dependencies(fetch: typeof globalThis.fetch): {
  dependencies: CliDependencies;
  stdout: string[];
  stderr: string[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    dependencies: {
      fetch,
      env: {
        AC_SESSION_ID: 'parent-session',
        AC_AGENTD_URL: 'http://127.0.0.1:7777',
      },
      writeOut: (value) => stdout.push(value),
      writeErr: (value) => stderr.push(value),
    },
    stdout,
    stderr,
  };
}

function controlDependencies(
  fetch: typeof globalThis.fetch,
  authMode: 'session' | 'operator' = 'session',
): ReturnType<typeof dependencies> {
  const fixture = dependencies(fetch);
  fixture.dependencies.env = {
    ...fixture.dependencies.env,
    AC_CONTROL_PLANE_URL: 'https://ac.example/',
    AC_CONTROL_PLANE_TOKEN: 'control-token',
    AC_CONTROL_PLANE_AUTH_MODE: authMode,
  };
  return fixture;
}

describe('ac CLI', () => {
  it('spawns a local worker with session auth and emits JSON', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      expect(String(input)).toBe('http://127.0.0.1:7777/v1/agent/spawn');
      expect(new Headers(init?.headers).get('X-AC-Session-Id')).toBe('parent-session');
      expect(JSON.parse(String(init?.body))).toEqual({
        provider: 'codex',
        cwd: '/repo',
        prompt: 'Fix the tests',
        placement: 'window',
        env: { TASK_MODE: 'strict' },
        flags: ['--full-auto'],
      });
      return jsonResponse({
        session_id: 'child-session',
        tmux_target: 'repo:worker',
        pane_id: '%7',
      }, 201);
    });
    const fixture = dependencies(fetch);

    const exitCode = await runCli([
      '--json',
      'spawn',
      'Fix the tests',
      '--provider',
      'codex',
      '--cwd',
      '/repo',
      '--env',
      'TASK_MODE=strict',
      '--flag',
      '--full-auto',
    ], fixture.dependencies);

    expect(exitCode).toBe(0);
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(fixture.stdout.join(''))).toEqual({
      session_id: 'child-session',
      tmux_target: 'repo:worker',
      pane_id: '%7',
    });
    expect(fixture.stderr).toEqual([]);
  });

  it('lists local sessions as a parent-child tree', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      expect(String(input)).toBe('http://127.0.0.1:7777/v1/agent/sessions');
      expect(init?.method).toBe('GET');
      return jsonResponse({
        sessions: [
          {
            session_id: 'worker',
            provider: 'codex',
            status: 'running',
            name: 'Worker',
            parent_session_id: 'root',
            child_session_ids: [],
          },
          {
            session_id: 'root',
            provider: 'claude_code',
            status: 'waiting',
            name: 'Root',
            child_session_ids: ['worker'],
          },
        ],
      });
    });
    const fixture = dependencies(fetch);

    const exitCode = await runCli(['ls'], fixture.dependencies);

    expect(exitCode).toBe(0);
    expect(fixture.stdout.join('')).toBe(
      'Root [waiting] (root)\n└─ Worker [running] (worker)\n',
    );
  });

  it('accepts the global JSON flag after a subcommand', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => jsonResponse({ sessions: [] }));
    const fixture = dependencies(fetch);

    const exitCode = await runCli(['ls', '--json'], fixture.dependencies);

    expect(exitCode).toBe(0);
    expect(JSON.parse(fixture.stdout.join(''))).toEqual({ sessions: [] });
  });

  it('sends input to a local session without pressing enter when requested', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      expect(String(input)).toBe('http://127.0.0.1:7777/v1/agent/send');
      expect(JSON.parse(String(init?.body))).toEqual({
        session_id: 'worker',
        input: 'status?',
        enter: false,
      });
      return jsonResponse({ ok: true });
    });
    const fixture = dependencies(fetch);

    const exitCode = await runCli(
      ['--json', 'send', 'worker', 'status?', '--no-enter'],
      fixture.dependencies,
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(fixture.stdout.join(''))).toEqual({ ok: true });
  });

  it('kills a local session tree', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      expect(String(input)).toBe('http://127.0.0.1:7777/v1/agent/kill');
      expect(JSON.parse(String(init?.body))).toEqual({ session_id: 'root', tree: true });
      return jsonResponse({ killed_session_ids: ['worker', 'root'] });
    });
    const fixture = dependencies(fetch);

    const exitCode = await runCli(
      ['--json', 'kill', 'root', '--tree'],
      fixture.dependencies,
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(fixture.stdout.join(''))).toEqual({
      killed_session_ids: ['worker', 'root'],
    });
  });

  it('waits for a local session state with a bounded timeout', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      expect(String(input)).toBe('http://127.0.0.1:7777/v1/agent/wait');
      expect(JSON.parse(String(init?.body))).toEqual({
        session_id: 'worker',
        until: 'done',
        timeout_ms: 120000,
      });
      return jsonResponse({
        session: {
          session_id: 'worker',
          provider: 'codex',
          status: 'done',
          child_session_ids: [],
        },
      });
    });
    const fixture = dependencies(fetch);

    const exitCode = await runCli(
      ['--json', 'wait', 'worker', '--until', 'done', '--timeout', '120000'],
      fixture.dependencies,
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(fixture.stdout.join(''))).toMatchObject({
      session: { session_id: 'worker', status: 'done' },
    });
  });

  it('reports a structured local result for the caller session', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      expect(String(input)).toBe('http://127.0.0.1:7777/v1/agent/report');
      expect(JSON.parse(String(init?.body))).toEqual({
        outcome: 'succeeded',
        summary: 'Tests are green',
        detail: '42 assertions passed',
      });
      return jsonResponse({ ok: true }, 202);
    });
    const fixture = dependencies(fetch);

    const exitCode = await runCli([
      '--json',
      'report',
      'succeeded',
      'Tests are green',
      '--detail',
      '42 assertions passed',
    ], fixture.dependencies);

    expect(exitCode).toBe(0);
    expect(JSON.parse(fixture.stdout.join(''))).toEqual({ ok: true });
  });

  it('lists filtered work items through the control plane', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      expect(String(input)).toBe(
        'https://ac.example/v1/orchestrator/work-items?status=queued&limit=5',
      );
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer control-token');
      return jsonResponse({ work_items: [{ id: 'item-1', title: 'Fix tests', status: 'queued' }] });
    });
    const fixture = controlDependencies(fetch);

    const exitCode = await runCli(
      ['--json', 'work', 'ls', '--status', 'queued', '--limit', '5'],
      fixture.dependencies,
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(fixture.stdout.join(''))).toMatchObject({
      work_items: [{ id: 'item-1', status: 'queued' }],
    });
  });

  it('claims a work item through the session-scoped orchestrator route', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      expect(String(input)).toBe('https://ac.example/v1/orchestrator/work-items/claim');
      expect(JSON.parse(String(init?.body))).toEqual({ work_item_id: 'item-1' });
      return jsonResponse({
        work_item: { id: 'item-1', title: 'Fix tests', status: 'in_progress' },
      });
    });
    const fixture = controlDependencies(fetch);

    const exitCode = await runCli(
      ['--json', 'work', 'claim', 'item-1'],
      fixture.dependencies,
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(fixture.stdout.join(''))).toMatchObject({
      work_item: { id: 'item-1', status: 'in_progress' },
    });
  });

  it('completes a claimed work item through the orchestrator route', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      expect(String(input)).toBe(
        'https://ac.example/v1/orchestrator/work-items/item-1/complete',
      );
      expect(JSON.parse(String(init?.body))).toEqual({
        status: 'done',
        result: { tests: 42, gate: 'green' },
      });
      return jsonResponse({
        work_item: { id: 'item-1', title: 'Fix tests', status: 'done' },
      });
    });
    const fixture = controlDependencies(fetch);

    const exitCode = await runCli(
      ['--json', 'work', 'done', 'item-1', '--result', '{"tests":42,"gate":"green"}'],
      fixture.dependencies,
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(fixture.stdout.join(''))).toMatchObject({
      work_item: { id: 'item-1', status: 'done' },
    });
  });

  it('reports a provisional control-plane 404 as a feature-unavailable JSON error', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => jsonResponse({
      statusCode: 404,
      error: 'Not Found',
      message: 'Route POST:/v1/orchestrator/work-items/claim not found',
    }, 404));
    const fixture = controlDependencies(fetch);

    const exitCode = await runCli(
      ['--json', 'work', 'claim', 'item-1'],
      fixture.dependencies,
    );

    expect(exitCode).toBe(1);
    expect(JSON.parse(fixture.stderr.join(''))).toMatchObject({
      error: {
        code: 'feature_unavailable',
        feature: 'session-scoped work-item claims',
        status: 404,
      },
    });
  });

  it('searches memory through the control plane', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      expect(String(input)).toBe(
        'https://ac.example/v1/orchestrator/memory/search?q=queue+retries&scope_type=repo&limit=3',
      );
      return jsonResponse({ results: [{ id: 'memory-1', summary: 'Retry queues safely' }] });
    });
    const fixture = controlDependencies(fetch);

    const exitCode = await runCli([
      '--json',
      'memory',
      'search',
      'queue retries',
      '--scope',
      'repo',
      '--limit',
      '3',
    ], fixture.dependencies);

    expect(exitCode).toBe(0);
    expect(JSON.parse(fixture.stdout.join(''))).toMatchObject({
      results: [{ id: 'memory-1' }],
    });
  });

  it('writes memory attributed to the caller session', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      expect(String(input)).toBe('https://ac.example/v1/orchestrator/memory');
      expect(JSON.parse(String(init?.body))).toEqual({
        scope_type: 'repo',
        tier: 'procedural',
        summary: 'Retry queues safely',
        content: 'Use durable ids and bounded backoff.',
        confidence: 0.9,
      });
      return jsonResponse({ entry: { id: 'memory-1', summary: 'Retry queues safely' } });
    });
    const fixture = controlDependencies(fetch);

    const exitCode = await runCli([
      '--json',
      'memory',
      'add',
      '--scope',
      'repo',
      '--tier',
      'procedural',
      '--summary',
      'Retry queues safely',
      '--content',
      'Use durable ids and bounded backoff.',
      '--confidence',
      '0.9',
    ], fixture.dependencies);

    expect(exitCode).toBe(0);
    expect(JSON.parse(fixture.stdout.join(''))).toMatchObject({
      entry: { id: 'memory-1' },
    });
  });

  it('gets the tmux roster for a control-plane host', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      expect(String(input)).toBe('https://ac.example/v1/orchestrator/children');
      return jsonResponse({
        children: [
          { id: 'session-1', host_id: 'host-1', tmux_target: 'ac:1.0' },
          { id: 'session-2', host_id: 'host-2', tmux_target: 'ac:2.0' },
        ],
      });
    });
    const fixture = controlDependencies(fetch);

    const exitCode = await runCli(
      ['--json', 'roster', '--host', 'host-1'],
      fixture.dependencies,
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(fixture.stdout.join(''))).toMatchObject({
      sessions: [{ id: 'session-1' }],
      total: 1,
    });
  });

  it('spawns a cross-host worker through the session-scoped route', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      expect(String(input)).toBe('https://ac.example/v1/orchestrator/spawn');
      expect(new Headers(init?.headers).get('X-AC-Session-Id')).toBe('parent-session');
      expect(JSON.parse(String(init?.body))).toEqual({
        host_id: '11111111-1111-4111-8111-111111111111',
        provider: 'codex',
        working_directory: '/repo',
        prompt: 'Fix remote tests',
      });
      return jsonResponse({
        session_id: '22222222-2222-4222-8222-222222222222',
        status: 'ready',
        terminal: { openable: true, pane_id: '%8' },
      });
    });
    const fixture = controlDependencies(fetch);

    const exitCode = await runCli([
      '--json',
      'spawn',
      'Fix remote tests',
      '--provider',
      'codex',
      '--cwd',
      '/repo',
      '--host',
      '11111111-1111-4111-8111-111111111111',
    ], fixture.dependencies);

    expect(exitCode).toBe(0);
    expect(JSON.parse(fixture.stdout.join(''))).toMatchObject({ status: 'ready' });
  });

  it('falls back to the operator launch route when a token is not session-scoped', async () => {
    let requestCount = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      requestCount += 1;
      if (requestCount === 1) {
        expect(String(input)).toBe('https://ac.example/v1/orchestrator/spawn');
        return jsonResponse({ error: 'Service or session authentication required' }, 403);
      }
      expect(String(input)).toBe('https://ac.example/v1/launch');
      expect(JSON.parse(String(init?.body))).toMatchObject({
        parent_session_id: 'parent-session',
        role: 'worker',
        wait: true,
      });
      return jsonResponse({ session_id: 'child', status: 'ready' });
    });
    const fixture = controlDependencies(fetch, 'operator');

    const exitCode = await runCli([
      '--json',
      'spawn',
      '--provider',
      'codex',
      '--cwd',
      '/repo',
      '--host',
      '11111111-1111-4111-8111-111111111111',
    ], fixture.dependencies);

    expect(exitCode).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('lists sessions on a remote control-plane host', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      expect(String(input)).toBe('https://ac.example/v1/orchestrator/children');
      return jsonResponse({
        session_id: 'parent-session',
        children: [
          {
            id: 'session-1',
            provider: 'codex',
            status: 'RUNNING',
            title: 'Remote worker',
            parent_session_id: 'parent-session',
            host_id: 'host-1',
          },
          {
            id: 'session-2',
            provider: 'codex',
            status: 'RUNNING',
            parent_session_id: 'parent-session',
            host_id: 'host-2',
          },
        ],
        rollup: { total: 2 },
        agent_tasks: [],
      });
    });
    const fixture = controlDependencies(fetch);

    const exitCode = await runCli(
      ['--json', 'ls', '--remote', '--host', 'host-1'],
      fixture.dependencies,
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(fixture.stdout.join(''))).toMatchObject({
      sessions: [{ id: 'session-1' }],
    });
    expect(JSON.parse(fixture.stdout.join(''))).not.toHaveProperty('rollup');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('lists the caller session children through the orchestrator route', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      expect(String(input)).toBe('https://ac.example/v1/orchestrator/children');
      return jsonResponse({
        session_id: 'parent-session',
        children: [{ id: 'child-1', provider: 'codex', status: 'RUNNING' }],
        rollup: { total: 1, running: 1 },
        agent_tasks: [],
      });
    });
    const fixture = controlDependencies(fetch);

    const exitCode = await runCli(
      ['--json', 'ls', '--remote'],
      fixture.dependencies,
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(fixture.stdout.join(''))).toMatchObject({
      sessions: [{ id: 'child-1' }],
      rollup: { total: 1 },
    });
  });

  it('sends input to a cross-host session through the command route', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      expect(String(input)).toBe(
        'https://ac.example/v1/orchestrator/children/22222222-2222-4222-8222-222222222222/input',
      );
      expect(JSON.parse(String(init?.body))).toEqual({
        input: 'status?',
        enter: true,
      });
      return jsonResponse({ cmd_id: 'command-1' });
    });
    const fixture = controlDependencies(fetch);

    const exitCode = await runCli([
      '--json',
      'send',
      '22222222-2222-4222-8222-222222222222',
      'status?',
      '--remote',
    ], fixture.dependencies);

    expect(exitCode).toBe(0);
    expect(JSON.parse(fixture.stdout.join(''))).toEqual({ cmd_id: 'command-1' });
  });

  it('kills a cross-host session tree child-first through the bulk route', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/sessions/root/graph')) {
        return jsonResponse({
          session_id: 'root',
          edges: [{ parent_session_id: 'root', child_session_id: 'child' }],
          rollup: {},
        });
      }
      if (url.endsWith('/sessions/child/graph')) {
        return jsonResponse({
          session_id: 'child',
          edges: [
            { parent_session_id: 'root', child_session_id: 'child' },
            { parent_session_id: 'child', child_session_id: 'grandchild' },
          ],
          rollup: {},
        });
      }
      if (url.endsWith('/sessions/grandchild/graph')) {
        return jsonResponse({
          session_id: 'grandchild',
          edges: [{ parent_session_id: 'child', child_session_id: 'grandchild' }],
          rollup: {},
        });
      }
      expect(url).toBe('https://ac.example/v1/sessions/bulk');
      expect(JSON.parse(String(init?.body))).toEqual({
        operation: 'terminate',
        session_ids: ['grandchild', 'child', 'root'],
      });
      return jsonResponse({ operation: 'terminate', success_count: 3, error_count: 0 });
    });
    const fixture = controlDependencies(fetch, 'operator');

    const exitCode = await runCli(
      ['--json', 'kill', 'root', '--tree', '--remote'],
      fixture.dependencies,
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(fixture.stdout.join(''))).toMatchObject({ success_count: 3 });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('does not route session credentials to the operator-only remote kill endpoint', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const fixture = controlDependencies(fetch);

    const exitCode = await runCli(
      ['--json', 'kill', 'child', '--remote'],
      fixture.dependencies,
    );

    expect(exitCode).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.parse(fixture.stderr.join(''))).toMatchObject({
      error: { code: 'operator_auth_required', operation: 'Cross-host kill' },
    });
  });

  it('rejects global work-item selectors for session-scoped credentials', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const fixture = controlDependencies(fetch);

    const exitCode = await runCli(
      ['--json', 'work', 'ls', '--repo', 'repo-1'],
      fixture.dependencies,
    );

    expect(exitCode).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.parse(fixture.stderr.join(''))).toMatchObject({
      error: { code: 'operator_auth_required' },
    });
  });

  it('supports repository and agent filters with an explicit operator credential', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      expect(String(input)).toBe(
        'https://ac.example/v1/work-items?limit=1&repo_id=repo-1&assigned_automation_agent_id=agent-2',
      );
      return jsonResponse({ work_items: [{
        id: 'item-2',
        title: 'Match',
        status: 'queued',
        repo_id: 'repo-1',
        assigned_automation_agent_id: 'agent-2',
      }] });
    });
    const fixture = controlDependencies(fetch, 'operator');

    const exitCode = await runCli(
      [
        '--json',
        'work',
        'ls',
        '--repo',
        'repo-1',
        '--agent',
        'agent-2',
        '--limit',
        '1',
      ],
      fixture.dependencies,
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(fixture.stdout.join(''))).toMatchObject({
      work_items: [{ id: 'item-2' }],
    });
  });

  it('rejects global memory selectors when using session-scoped credentials', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const fixture = controlDependencies(fetch);

    const exitCode = await runCli(
      ['--json', 'memory', 'search', 'queues', '--repo', 'repo-1'],
      fixture.dependencies,
    );

    expect(exitCode).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.parse(fixture.stderr.join(''))).toMatchObject({
      error: { code: 'operator_auth_required' },
    });
  });

  it('emits structured JSON for command-line usage errors', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const fixture = dependencies(fetch);

    const exitCode = await runCli(['--json', 'send'], fixture.dependencies);

    expect(exitCode).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.parse(fixture.stderr.join(''))).toMatchObject({
      error: { code: 'cli_usage_error' },
    });
  });

  it('emits structured JSON when configuration is invalid', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const fixture = dependencies(fetch);
    fixture.dependencies.env = {
      ...fixture.dependencies.env,
      AC_CONTROL_PLANE_AUTH_MODE: 'administrator',
    };

    const exitCode = await runCli(['--json', 'ls'], fixture.dependencies);

    expect(exitCode).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.parse(fixture.stderr.join(''))).toMatchObject({
      error: {
        code: 'cli_error',
        message: 'AC_CONTROL_PLANE_AUTH_MODE must be session or operator',
      },
    });
  });

  it('rejects invalid spawn placement instead of silently selecting a window', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const fixture = dependencies(fetch);

    const exitCode = await runCli([
      '--json',
      'spawn',
      '--provider',
      'codex',
      '--placement',
      'sideways',
    ], fixture.dependencies);

    expect(exitCode).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.parse(fixture.stderr.join(''))).toMatchObject({
      error: { code: 'cli_usage_error' },
    });
  });

  it('waits for an already-finished cross-host session', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      expect(String(input)).toBe(
        'https://ac.example/v1/orchestrator/children/22222222-2222-4222-8222-222222222222',
      );
      return jsonResponse({
        session: {
          id: '22222222-2222-4222-8222-222222222222',
          provider: 'codex',
          status: 'DONE',
        },
        snapshot: null,
      });
    });
    const fixture = controlDependencies(fetch);

    const exitCode = await runCli([
      '--json',
      'wait',
      '22222222-2222-4222-8222-222222222222',
      '--remote',
    ], fixture.dependencies);

    expect(exitCode).toBe(0);
    expect(JSON.parse(fixture.stdout.join(''))).toMatchObject({
      session: { status: 'DONE' },
    });
  });

  it('reports a structured automation-run result through the control plane', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      expect(String(input)).toBe('https://ac.example/v1/automation-runs/run-1/report');
      expect(JSON.parse(String(init?.body))).toEqual({
        outcome: 'blocked',
        summary: 'Needs credentials',
        detail: 'Secret is unavailable',
      });
      return jsonResponse({ run: { id: 'run-1', status: 'blocked' } });
    });
    const fixture = controlDependencies(fetch);

    const exitCode = await runCli([
      '--json',
      'report',
      'blocked',
      'Needs credentials',
      '--detail',
      'Secret is unavailable',
      '--run',
      'run-1',
    ], fixture.dependencies);

    expect(exitCode).toBe(0);
    expect(JSON.parse(fixture.stdout.join(''))).toMatchObject({
      run: { id: 'run-1', status: 'blocked' },
    });
  });

  it('starts the stdio MCP adapter from the mcp subcommand', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const fixture = dependencies(fetch);
    const startMcp = vi.fn(async () => undefined);
    fixture.dependencies.startMcp = startMcp;

    const exitCode = await runCli(['mcp'], fixture.dependencies);

    expect(exitCode).toBe(0);
    expect(startMcp).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });
});
