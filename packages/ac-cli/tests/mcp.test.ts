import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import { AgentCommandClient } from '../src/operations.js';
import { createMcpServer, createMcpTools } from '../src/mcp.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function resultJson(result: Awaited<ReturnType<ReturnType<typeof createMcpTools>[keyof ReturnType<typeof createMcpTools>]['execute']>>): unknown {
  const content = result.content[0];
  if (!content || content.type !== 'text') throw new Error('Expected text tool result');
  return JSON.parse(content.text) as unknown;
}

describe('ac MCP tools', () => {
  it('spawn_worker uses the shared local HTTP operation', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      expect(String(input)).toBe('http://127.0.0.1:7777/v1/agent/spawn');
      expect(JSON.parse(String(init?.body))).toEqual({
        provider: 'codex',
        cwd: '/repo',
        prompt: 'Fix tests',
        placement: 'window',
      });
      return jsonResponse({ session_id: 'worker', tmux_target: 'repo:worker', pane_id: '%9' }, 201);
    });
    const client = new AgentCommandClient({
      agentdUrl: 'http://127.0.0.1:7777',
      sessionId: 'root',
    }, fetch);
    const tools = createMcpTools(client);

    const result = await tools.spawn_worker.execute({
      provider: 'codex',
      cwd: '/repo',
      prompt: 'Fix tests',
      placement: 'window',
    });

    expect(result.isError).not.toBe(true);
    expect(resultJson(result)).toEqual({
      session_id: 'worker',
      tmux_target: 'repo:worker',
      pane_id: '%9',
    });
  });

  it('list_sessions returns the local session tree data', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => jsonResponse({
      sessions: [{
        session_id: 'worker',
        provider: 'codex',
        status: 'running',
        child_session_ids: [],
      }],
    }));
    const tools = createMcpTools(new AgentCommandClient({
      agentdUrl: 'http://127.0.0.1:7777',
      sessionId: 'root',
    }, fetch));

    const result = await tools.list_sessions.execute({});

    expect(resultJson(result)).toMatchObject({
      sessions: [{ session_id: 'worker' }],
    });
  });

  it('send_input forwards input to agentd', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        session_id: 'worker',
        input: 'continue',
        enter: true,
      });
      return jsonResponse({ ok: true });
    });
    const tools = createMcpTools(new AgentCommandClient({
      agentdUrl: 'http://127.0.0.1:7777',
      sessionId: 'root',
    }, fetch));

    const result = await tools.send_input.execute({
      session_id: 'worker',
      input: 'continue',
    });

    expect(resultJson(result)).toEqual({ ok: true });
  });

  it('kill_session can cascade through a local worker tree', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({ session_id: 'root', tree: true });
      return jsonResponse({ killed_session_ids: ['worker', 'root'] });
    });
    const tools = createMcpTools(new AgentCommandClient({
      agentdUrl: 'http://127.0.0.1:7777',
      sessionId: 'root',
    }, fetch));

    const result = await tools.kill_session.execute({ session_id: 'root', tree: true });

    expect(resultJson(result)).toEqual({ killed_session_ids: ['worker', 'root'] });
  });

  it('wait_for blocks until the requested local state', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        session_id: 'worker',
        until: 'waiting',
        timeout_ms: 5000,
      });
      return jsonResponse({
        session: {
          session_id: 'worker',
          provider: 'codex',
          status: 'WAITING_FOR_INPUT',
          child_session_ids: [],
        },
      });
    });
    const tools = createMcpTools(new AgentCommandClient({
      agentdUrl: 'http://127.0.0.1:7777',
      sessionId: 'root',
    }, fetch));

    const result = await tools.wait_for.execute({
      session_id: 'worker',
      until: 'waiting',
      timeout_ms: 5000,
    });

    expect(resultJson(result)).toMatchObject({
      session: { status: 'WAITING_FOR_INPUT' },
    });
  });

  it('report_result submits a structured caller result', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        outcome: 'succeeded',
        summary: 'Complete',
      });
      return jsonResponse({ ok: true }, 202);
    });
    const tools = createMcpTools(new AgentCommandClient({
      agentdUrl: 'http://127.0.0.1:7777',
      sessionId: 'root',
    }, fetch));

    const result = await tools.report_result.execute({
      outcome: 'succeeded',
      summary: 'Complete',
    });

    expect(resultJson(result)).toEqual({ ok: true });
  });

  it('claim_work_item claims the next session-scoped item', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({ repo_id: 'repo-1' });
      return jsonResponse({ work_item: { id: 'item-1', title: 'Task', status: 'in_progress' } });
    });
    const tools = createMcpTools(new AgentCommandClient({
      agentdUrl: 'http://127.0.0.1:7777',
      sessionId: 'root',
      controlPlaneUrl: 'https://ac.example',
      controlPlaneToken: 'token',
    }, fetch));

    const result = await tools.claim_work_item.execute({ repo_id: 'repo-1' });

    expect(resultJson(result)).toMatchObject({ work_item: { id: 'item-1' } });
  });

  it('complete_work_item records a terminal work-item status', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        status: 'blocked',
        result: { reason: 'credential unavailable' },
      });
      return jsonResponse({ work_item: { id: 'item-1', title: 'Task', status: 'blocked' } });
    });
    const tools = createMcpTools(new AgentCommandClient({
      agentdUrl: 'http://127.0.0.1:7777',
      sessionId: 'root',
      controlPlaneUrl: 'https://ac.example',
      controlPlaneToken: 'token',
    }, fetch));

    const result = await tools.complete_work_item.execute({
      work_item_id: 'item-1',
      status: 'blocked',
      result: { reason: 'credential unavailable' },
    });

    expect(resultJson(result)).toMatchObject({
      work_item: { id: 'item-1', status: 'blocked' },
    });
  });

  it('memory_search retrieves scoped memories', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      expect(String(input)).toBe(
        'https://ac.example/v1/orchestrator/memory/search?q=queues&scope_type=repo&limit=2',
      );
      return jsonResponse({ results: [{ id: 'memory-1', summary: 'Queue lesson' }] });
    });
    const tools = createMcpTools(new AgentCommandClient({
      agentdUrl: 'http://127.0.0.1:7777',
      sessionId: 'root',
      controlPlaneUrl: 'https://ac.example',
      controlPlaneToken: 'token',
    }, fetch));

    const result = await tools.memory_search.execute({
      q: 'queues',
      scope_type: 'repo',
      limit: 2,
    });

    expect(resultJson(result)).toMatchObject({ results: [{ id: 'memory-1' }] });
  });

  it('memory_write persists caller-attributed memory', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        scope_type: 'global',
        tier: 'semantic',
        summary: 'A lesson',
        content: 'The durable details.',
      });
      return jsonResponse({ entry: { id: 'memory-1', summary: 'A lesson' } });
    });
    const tools = createMcpTools(new AgentCommandClient({
      agentdUrl: 'http://127.0.0.1:7777',
      sessionId: 'root',
      controlPlaneUrl: 'https://ac.example',
      controlPlaneToken: 'token',
    }, fetch));

    const result = await tools.memory_write.execute({
      scope_type: 'global',
      tier: 'semantic',
      summary: 'A lesson',
      content: 'The durable details.',
    });

    expect(resultJson(result)).toMatchObject({ entry: { id: 'memory-1' } });
  });

  it('get_roster returns control-plane tmux sessions', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      expect(String(input)).toBe('https://ac.example/v1/orchestrator/children');
      return jsonResponse({ children: [
        { id: 'session-1', host_id: 'host-1' },
        { id: 'session-2', host_id: 'host-2' },
      ] });
    });
    const tools = createMcpTools(new AgentCommandClient({
      agentdUrl: 'http://127.0.0.1:7777',
      sessionId: 'root',
      controlPlaneUrl: 'https://ac.example',
      controlPlaneToken: 'token',
    }, fetch));

    const result = await tools.get_roster.execute({ host_id: 'host-1' });

    expect(resultJson(result)).toMatchObject({ total: 1 });
  });

  it('registers all tools on a real MCP transport', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => jsonResponse({
      sessions: [],
      total: 0,
    }));
    const server = createMcpServer(new AgentCommandClient({
      agentdUrl: 'http://127.0.0.1:7777',
      controlPlaneUrl: 'https://ac.example',
      controlPlaneToken: 'token',
    }, fetch));
    const client = new Client({ name: 'test-client', version: '0.1.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((entry) => entry.name).sort()).toEqual([
        'claim_work_item',
        'complete_work_item',
        'get_roster',
        'kill_session',
        'list_sessions',
        'memory_search',
        'memory_write',
        'report_result',
        'send_input',
        'spawn_worker',
        'wait_for',
      ]);

      const called = await client.callTool({ name: 'get_roster', arguments: {} });
      expect(resultJson(called)).toEqual({ sessions: [], total: 0 });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
