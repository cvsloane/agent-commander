import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { AgentCommandClient } from './operations.js';

export interface McpTool<Schema extends z.ZodObject> {
  description: string;
  inputSchema: Schema;
  execute(input: z.input<Schema>): Promise<CallToolResult>;
}

function success(value: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
  };
}

function failure(error: unknown): CallToolResult {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
    }],
    isError: true,
  };
}

function tool<Schema extends z.ZodObject>(
  description: string,
  inputSchema: Schema,
  operation: (input: z.output<Schema>) => Promise<unknown>,
): McpTool<Schema> {
  return {
    description,
    inputSchema,
    async execute(input) {
      try {
        return success(await operation(inputSchema.parse(input)));
      } catch (error) {
        return failure(error);
      }
    },
  };
}

const SpawnWorkerInputSchema = z.object({
  provider: z.string().min(1),
  cwd: z.string().min(1),
  prompt: z.string().optional(),
  placement: z.enum(['window', 'split']).default('window'),
  split_target: z.string().optional(),
  name: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  flags: z.array(z.string()).optional(),
  host_id: z.string().optional(),
  host_alias: z.string().optional(),
});

const ListSessionsInputSchema = z.object({
  remote: z.boolean().default(false),
  host_id: z.string().optional(),
});

const SendInputSchema = z.object({
  session_id: z.string().min(1),
  input: z.string(),
  enter: z.boolean().default(true),
  remote: z.boolean().default(false),
});

const KillSessionInputSchema = z.object({
  session_id: z.string().min(1),
  tree: z.boolean().default(false),
  remote: z.boolean().default(false),
});

const WaitForInputSchema = z.object({
  session_id: z.string().min(1),
  until: z.enum(['done', 'waiting', 'any-change']).default('done'),
  timeout_ms: z.number().int().min(1).max(600000).default(60000),
  remote: z.boolean().default(false),
});

const ReportResultInputSchema = z.object({
  outcome: z.enum(['succeeded', 'failed', 'blocked']),
  summary: z.string().min(1),
  detail: z.string().optional(),
  run_id: z.string().optional(),
});

const ClaimWorkItemInputSchema = z.object({
  work_item_id: z.string().optional(),
  repo_id: z.string().optional(),
});

const CompleteWorkItemInputSchema = z.object({
  work_item_id: z.string().min(1),
  status: z.enum(['done', 'blocked', 'cancelled']).default('done'),
  result: z.record(z.string(), z.unknown()).optional(),
});

const MemorySearchInputSchema = z.object({
  q: z.string().min(1),
  scope_type: z.enum(['global', 'repo', 'working']).optional(),
  repo_id: z.string().optional(),
  tier: z.enum(['working', 'episodic', 'semantic', 'procedural']).optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

const MemoryWriteInputSchema = z.object({
  scope_type: z.enum(['global', 'repo', 'working']),
  repo_id: z.string().optional(),
  session_id: z.string().optional(),
  tier: z.enum(['working', 'episodic', 'semantic', 'procedural']),
  summary: z.string().min(1),
  content: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  expires_at: z.string().optional(),
});

const GetRosterInputSchema = z.object({
  host_id: z.string().optional(),
});

export function createMcpTools(client: AgentCommandClient) {
  return {
    spawn_worker: tool(
      'Spawn a worker session locally, or on a control-plane host when host_id/host_alias is set.',
      SpawnWorkerInputSchema,
      (input) => client.spawnWorker(input),
    ),
    list_sessions: tool(
      'List sessions with parent/child lineage. Uses local agentd unless remote or host_id is set.',
      ListSessionsInputSchema,
      (input) => client.listSessions(input),
    ),
    send_input: tool(
      'Send text to a session, pressing enter by default.',
      SendInputSchema,
      (input) => client.sendInput(input),
    ),
    kill_session: tool(
      'Kill one session or its descendant tree. Set remote for a control-plane session.',
      KillSessionInputSchema,
      (input) => client.killSession(input),
    ),
    wait_for: tool(
      'Wait until a session is done, waiting, or changes state.',
      WaitForInputSchema,
      (input) => client.waitFor(input),
    ),
    report_result: tool(
      'Report a structured session outcome, optionally to a control-plane automation run.',
      ReportResultInputSchema,
      (input) => client.reportResult(input),
    ),
    claim_work_item: tool(
      'Claim a specific work item or the next available item for this session.',
      ClaimWorkItemInputSchema,
      (input) => client.claimWorkItem(input),
    ),
    complete_work_item: tool(
      'Complete, block, or cancel a work item claimed by this session.',
      CompleteWorkItemInputSchema,
      (input) => client.completeWorkItem(input.work_item_id, input.status, input.result),
    ),
    memory_search: tool(
      'Search durable memory by query, scope, repository, and tier.',
      MemorySearchInputSchema,
      (input) => client.searchMemory(input),
    ),
    memory_write: tool(
      'Write a durable memory entry attributed to the caller session by default.',
      MemoryWriteInputSchema,
      (input) => client.writeMemory(input),
    ),
    get_roster: tool(
      'Get the control-plane tmux roster, optionally filtered by host.',
      GetRosterInputSchema,
      (input) => client.getRoster(input.host_id),
    ),
  };
}

function register<Schema extends z.ZodObject>(
  server: McpServer,
  name: string,
  definition: McpTool<Schema>,
): void {
  const inputSchema = definition.inputSchema.shape;
  server.registerTool(name, {
    description: definition.description,
    inputSchema,
  }, (input) => definition.execute(input as z.input<Schema>));
}

export function createMcpServer(client: AgentCommandClient): McpServer {
  const server = new McpServer({ name: 'agent-command', version: '0.1.0' });
  const tools = createMcpTools(client);
  register(server, 'spawn_worker', tools.spawn_worker);
  register(server, 'list_sessions', tools.list_sessions);
  register(server, 'send_input', tools.send_input);
  register(server, 'kill_session', tools.kill_session);
  register(server, 'wait_for', tools.wait_for);
  register(server, 'report_result', tools.report_result);
  register(server, 'claim_work_item', tools.claim_work_item);
  register(server, 'complete_work_item', tools.complete_work_item);
  register(server, 'memory_search', tools.memory_search);
  register(server, 'memory_write', tools.memory_write);
  register(server, 'get_roster', tools.get_roster);
  return server;
}

export async function startMcpServer(
  client: AgentCommandClient,
  transport: Transport = new StdioServerTransport(),
): Promise<void> {
  await createMcpServer(client).connect(transport);
}
