import type {
  Session,
  SessionWithSnapshot,
  Approval,
  Host,
  Event,
  CommandRequest,
  ApprovalDecideRequest,
  SessionGroup,
  CreateGroupRequest,
  UpdateGroupRequest,
  SessionUsageSummary,
  BulkOperationType,
  Project,
  UserSettings,
} from '@agent-command/schema';
import { getControlPlaneToken } from '@/lib/wsToken';
import { getRuntimeConfig } from '@/lib/runtimeConfig';

function resolveApiBase(): string {
  const runtime = typeof window !== 'undefined' ? getRuntimeConfig() : {};
  const configured =
    runtime.controlPlaneUrl ||
    process.env.NEXT_PUBLIC_CONTROL_PLANE_URL ||
    process.env.NEXT_PUBLIC_CONTROL_PLANE_BASE_URL ||
    '';

  if (configured) {
    const trimmed = configured.replace(/\/+$/, '');
    try {
      const url = new URL(trimmed);
      const host = url.hostname;
      if (
        typeof window !== 'undefined' &&
        (host === 'control-plane' || (!host.includes('.') && host !== 'localhost' && host !== '127.0.0.1'))
      ) {
        return window.location.origin;
      }
    } catch {
      // ignore invalid URLs and fall back below
    }
    return trimmed.endsWith('/v1') ? trimmed.slice(0, -3) : trimmed;
  }

  if (typeof window !== 'undefined') {
    return window.location.origin;
  }

  return 'http://localhost:8080';
}

async function fetchAPI<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await getControlPlaneToken();
  const apiBase = resolveApiBase();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let res: Response;
  try {
    res = await fetch(`${apiBase}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options?.headers,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  return res.json();
}

// Sessions API
export async function getSessions(filters?: {
  host_id?: string;
  status?: string;
  provider?: string;
  needs_attention?: boolean;
  q?: string;
  group_id?: string | null;
  ungrouped?: boolean;
  include_archived?: boolean;
  archived_only?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ sessions: SessionWithSnapshot[]; total?: number; limit?: number; offset?: number }> {
  const params = new URLSearchParams();
  if (filters?.host_id) params.set('host_id', filters.host_id);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.provider) params.set('provider', filters.provider);
  if (filters?.needs_attention) params.set('needs_attention', 'true');
  if (filters?.q) params.set('q', filters.q);
  if (filters?.group_id) params.set('group_id', filters.group_id);
  if (filters?.ungrouped) params.set('ungrouped', 'true');
  if (filters?.include_archived) params.set('include_archived', 'true');
  if (filters?.archived_only) params.set('archived_only', 'true');
  if (typeof filters?.limit === 'number') params.set('limit', String(filters.limit));
  if (typeof filters?.offset === 'number') params.set('offset', String(filters.offset));

  const query = params.toString();
  return fetchAPI(`/v1/sessions${query ? `?${query}` : ''}`);
}

export interface BulkOperationResult {
  operation: BulkOperationType;
  success_count: number;
  error_count: number;
  errors?: Array<{ session_id: string; error: string }>;
}

export async function bulkOperateSessions(
  operation: BulkOperationType,
  sessionIds: string[],
  groupId?: string | null
): Promise<BulkOperationResult> {
  return fetchAPI('/v1/sessions/bulk', {
    method: 'POST',
    body: JSON.stringify({
      operation,
      session_ids: sessionIds,
      group_id: groupId,
    }),
  });
}

export async function getSession(id: string): Promise<{
  session: Session;
  snapshot: { created_at: string; capture_text: string } | null;
  events: Event[];
  approvals: Approval[];
}> {
  return fetchAPI(`/v1/sessions/${id}`);
}

export async function getSessionEvents(
  id: string,
  cursor?: number
): Promise<{ events: Event[]; next_cursor?: number }> {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor.toString());

  const query = params.toString();
  return fetchAPI(`/v1/sessions/${id}/events${query ? `?${query}` : ''}`);
}

// Session usage (latest per session)
export async function getSessionUsageLatest(sessionIds?: string[]): Promise<{ usage: SessionUsageSummary[] }> {
  const params = new URLSearchParams();
  if (sessionIds && sessionIds.length > 0) {
    params.set('session_ids', sessionIds.join(','));
  }
  const query = params.toString();
  return fetchAPI(`/v1/sessions/usage-latest${query ? `?${query}` : ''}`);
}

export async function sendCommand(
  sessionId: string,
  command: CommandRequest
): Promise<{ cmd_id: string }> {
  return fetchAPI(`/v1/sessions/${sessionId}/commands`, {
    method: 'POST',
    body: JSON.stringify(command),
  });
}

export async function deleteSession(id: string): Promise<{ success: boolean }> {
  return fetchAPI(`/v1/sessions/${id}`, { method: 'DELETE' });
}

export async function updateSession(
  id: string,
  updates: { title?: string; idle?: boolean }
): Promise<{ session: Session }> {
  return fetchAPI(`/v1/sessions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

// Approvals API
export async function getApprovals(filters?: {
  status?: 'pending' | 'decided';
  session_id?: string;
}): Promise<{ approvals: Approval[] }> {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.session_id) params.set('session_id', filters.session_id);

  const query = params.toString();
  return fetchAPI(`/v1/approvals${query ? `?${query}` : ''}`);
}

export async function decideApproval(
  id: string,
  decision: ApprovalDecideRequest
): Promise<{ approval: Approval }> {
  return fetchAPI(`/v1/approvals/${id}/decide`, {
    method: 'POST',
    body: JSON.stringify(decision),
  });
}

// Hosts API
export async function getHosts(): Promise<{ hosts: Host[] }> {
  return fetchAPI('/v1/hosts');
}

export async function updateHostCapabilities(
  hostId: string,
  capabilities: Record<string, unknown>
): Promise<{ host: Host }> {
  return fetchAPI(`/v1/hosts/${hostId}`, {
    method: 'PATCH',
    body: JSON.stringify({ capabilities }),
  });
}

// User Settings API
export async function getUserSettings(): Promise<{ settings: UserSettings | null }> {
  return fetchAPI('/v1/settings');
}

export async function updateUserSettings(
  settings: UserSettings
): Promise<{ settings: UserSettings }> {
  return fetchAPI('/v1/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}

export async function sendTestNotification(
  payload: { channel?: string }
): Promise<{ success: boolean }> {
  return fetchAPI('/v1/notifications/test', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// Projects API
export async function getProjects(filters?: {
  host_id?: string;
  q?: string;
  limit?: number;
}): Promise<{ projects: Project[] }> {
  const params = new URLSearchParams();
  if (filters?.host_id) params.set('host_id', filters.host_id);
  if (filters?.q) params.set('q', filters.q);
  if (filters?.limit) params.set('limit', filters.limit.toString());
  const query = params.toString();
  return fetchAPI(`/v1/projects${query ? `?${query}` : ''}`);
}

export async function getHost(id: string): Promise<{ host: Host }> {
  return fetchAPI(`/v1/hosts/${id}`);
}

export async function generateHostToken(id: string): Promise<{ token: string }> {
  return fetchAPI(`/v1/hosts/${id}/token`, { method: 'POST' });
}

// Orphan panes (session import)
export interface OrphanPane {
  id: string;
  host_id: string;
  kind: string;
  provider: string;
  status: string;
  cwd: string | null;
  repo_root: string | null;
  git_branch: string | null;
  tmux_pane_id: string | null;
  tmux_target: string | null;
  metadata: {
    tmux?: {
      pane_pid?: number;
      current_command?: string;
      session_name?: string;
      window_index?: number;
      pane_index?: number;
    };
    unmanaged?: boolean;
  } | null;
  created_at: string;
  updated_at: string;
  last_activity_at: string | null;
  latest_snapshot?: {
    created_at: string;
    capture_text: string;
  } | null;
}

export async function getOrphanPanes(hostId: string): Promise<{ orphan_panes: OrphanPane[] }> {
  return fetchAPI(`/v1/hosts/${hostId}/orphan-panes`);
}

export async function adoptOrphanPanes(
  hostId: string,
  sessionIds: string[],
  title?: string
): Promise<{
  adopted_count: number;
  error_count: number;
  adopted: string[];
  errors?: Array<{ session_id: string; error: string }>;
}> {
  return fetchAPI(`/v1/hosts/${hostId}/adopt-panes`, {
    method: 'POST',
    body: JSON.stringify({ session_ids: sessionIds, title }),
  });
}

// Health check
export async function getHealth(): Promise<{
  status: string;
  timestamp: string;
  connections: { uiClients: number; agents: number };
}> {
  return fetchAPI('/health');
}

// Groups API
interface GroupWithChildren extends SessionGroup {
  children: GroupWithChildren[];
  session_count: number;
}

export async function getGroups(): Promise<{
  groups: GroupWithChildren[];
  flat: SessionGroup[];
}> {
  return fetchAPI('/v1/groups');
}

export async function getGroup(id: string): Promise<{ group: SessionGroup }> {
  return fetchAPI(`/v1/groups/${id}`);
}

export async function createGroup(
  data: CreateGroupRequest
): Promise<{ group: SessionGroup }> {
  return fetchAPI('/v1/groups', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function ensureGroup(
  data: CreateGroupRequest
): Promise<{ group: SessionGroup; created: boolean }> {
  return fetchAPI('/v1/groups/ensure', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateGroup(
  id: string,
  data: UpdateGroupRequest
): Promise<{ group: SessionGroup }> {
  return fetchAPI(`/v1/groups/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteGroup(id: string): Promise<{ success: boolean }> {
  return fetchAPI(`/v1/groups/${id}`, { method: 'DELETE' });
}

export async function assignSessionGroup(
  sessionId: string,
  groupId: string | null
): Promise<{ session: Session }> {
  return fetchAPI(`/v1/sessions/${sessionId}/group`, {
    method: 'POST',
    body: JSON.stringify({ group_id: groupId }),
  });
}

// Fork API
export async function forkSession(
  sessionId: string,
  options?: {
    branch?: string;
    cwd?: string;
    provider?: 'claude_code' | 'codex' | 'shell';
    note?: string;
    group_id?: string;
  }
): Promise<{ cmd_id: string }> {
  return fetchAPI(`/v1/sessions/${sessionId}/fork`, {
    method: 'POST',
    body: JSON.stringify(options || {}),
  });
}

// Copy to session API
export type CaptureMode = 'visible' | 'last_n' | 'range' | 'full';

export interface CopyToSessionRequest {
  target_session_id: string;
  mode?: CaptureMode;
  line_start?: number;
  line_end?: number;
  last_n_lines?: number;
  prepend_text?: string;
  append_text?: string;
  strip_ansi?: boolean;
}

export async function copyToSession(
  sourceSessionId: string,
  options: CopyToSessionRequest
): Promise<{ cmd_id: string; cross_host: boolean }> {
  return fetchAPI(`/v1/sessions/${sourceSessionId}/copy-to`, {
    method: 'POST',
    body: JSON.stringify(options),
  });
}

// Session Links API
export type SessionLinkType = 'complement' | 'review' | 'implement' | 'research';

export interface SessionLinkWithSession {
  id: string;
  source_session_id: string;
  target_session_id: string;
  link_type: SessionLinkType;
  created_at: string;
  linked_session_id: string;
  linked_session_title: string | null;
  linked_session_provider: string;
  linked_session_status: string;
  linked_session_cwd: string | null;
  direction: 'outgoing' | 'incoming';
}

export async function getSessionLinks(
  sessionId: string
): Promise<{ links: SessionLinkWithSession[] }> {
  return fetchAPI(`/v1/sessions/${sessionId}/links`);
}

export async function createSessionLink(
  sourceSessionId: string,
  targetSessionId: string,
  linkType: SessionLinkType
): Promise<{ link: SessionLinkWithSession }> {
  return fetchAPI(`/v1/sessions/${sourceSessionId}/links`, {
    method: 'POST',
    body: JSON.stringify({ target_session_id: targetSessionId, link_type: linkType }),
  });
}

export async function deleteSessionLink(
  sessionId: string,
  linkId: string
): Promise<{ success: boolean }> {
  return fetchAPI(`/v1/sessions/${sessionId}/links/${linkId}`, {
    method: 'DELETE',
  });
}

// Search API
export interface SearchResult {
  type: 'session' | 'event' | 'snapshot';
  id: string;
  session_id?: string;
  score: number;
  highlight: string;
  title?: string;
  cwd?: string;
}

// MCP API
export interface MCPServer {
  name: string;
  display_name?: string;
  description?: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  has_secrets: boolean;
  poolable: boolean;
}

export interface MCPEnablement {
  enabled: boolean;
  scope: 'session' | 'project' | 'global';
}

export interface SessionMCPConfig {
  session_id: string;
  servers: MCPServer[];
  enablement: Record<string, MCPEnablement>;
  restart_required: boolean;
}

export async function getMCPServers(hostId: string): Promise<{
  servers: MCPServer[];
  pool_config?: { enabled: boolean; pool_all: boolean; exclude_mcps?: string[] };
}> {
  return fetchAPI(`/v1/hosts/${hostId}/mcp/servers`);
}

export async function getSessionMCPConfig(sessionId: string): Promise<SessionMCPConfig> {
  return fetchAPI(`/v1/sessions/${sessionId}/mcp`);
}

export async function updateSessionMCPConfig(
  sessionId: string,
  enablement: Record<string, { enabled: boolean; scope?: 'session' | 'project' | 'global' }>
): Promise<{ success: boolean; restart_required: boolean; error?: string }> {
  return fetchAPI(`/v1/sessions/${sessionId}/mcp`, {
    method: 'PUT',
    body: JSON.stringify({ enablement }),
  });
}

export async function getProjectMCPConfig(repoRoot: string): Promise<{
  enablement: Record<string, MCPEnablement>;
}> {
  return fetchAPI(`/v1/projects/mcp?repo_root=${encodeURIComponent(repoRoot)}`);
}

export async function updateProjectMCPConfig(
  repoRoot: string,
  enablement: Record<string, { enabled: boolean; scope?: 'session' | 'project' | 'global' }>
): Promise<{ success: boolean; error?: string }> {
  return fetchAPI(`/v1/projects/mcp?repo_root=${encodeURIComponent(repoRoot)}`, {
    method: 'PUT',
    body: JSON.stringify({ enablement }),
  });
}

export async function search(
  query: string,
  options?: {
    type?: Array<'sessions' | 'events' | 'snapshots'>;
    limit?: number;
    offset?: number;
  }
): Promise<{
  query: string;
  results: SearchResult[];
  total: number;
  limit: number;
  offset: number;
}> {
  const params = new URLSearchParams();
  params.set('q', query);
  if (options?.type) params.set('type', options.type.join(','));
  if (options?.limit) params.set('limit', options.limit.toString());
  if (options?.offset) params.set('offset', options.offset.toString());

  return fetchAPI(`/v1/search?${params.toString()}`);
}

// Weekly Usage API
export interface WeeklyUsageDay {
  date: string;
  tokens: number;
  tokens_in: number;
  tokens_out: number;
  cost_cents: number;
}

export interface WeeklyUsage {
  week_start: string;
  total_tokens: number;
  total_cost_cents: number;
  daily: WeeklyUsageDay[];
  by_provider: Record<string, number>;
}

export async function getWeeklyUsage(): Promise<WeeklyUsage> {
  return fetchAPI('/v1/analytics/usage/weekly');
}

// Analytics API
export interface SessionMetrics {
  session_id: string;
  tokens_in: number;
  tokens_out: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  tool_calls: number;
  approvals_requested: number;
  approvals_granted: number;
  approvals_denied: number;
  first_event_at: string | null;
  last_event_at: string | null;
  estimated_cost_cents: number;
}

export interface AnalyticsSummary {
  total_sessions: number;
  total_tokens_in: number;
  total_tokens_out: number;
  total_tool_calls: number;
  total_estimated_cost_cents: number;
  sessions_by_provider: Record<string, number>;
  sessions_by_status: Record<string, number>;
}

export interface ProviderUsage {
  provider: string;
  host_id: string | null;
  session_id: string | null;
  scope: 'account' | 'session';
  reported_at: string;
  raw_text: string | null;
  raw_json: Record<string, unknown> | null;
  remaining_tokens: number | null;
  remaining_requests: number | null;
  weekly_limit_tokens: number | null;
  weekly_remaining_tokens: number | null;
  weekly_remaining_cost_cents: number | null;
  reset_at: string | null;
  // Utilization percentages (0-100)
  five_hour_utilization: number | null;
  five_hour_reset_at: string | null;
  weekly_utilization: number | null;
  weekly_reset_at: string | null;
  weekly_opus_utilization: number | null;
  weekly_opus_reset_at: string | null;
  weekly_sonnet_utilization: number | null;
  weekly_sonnet_reset_at: string | null;
  daily_utilization: number | null;
  daily_reset_at: string | null;
}

export interface TimeSeriesPoint {
  timestamp: string;
  tokens_in: number;
  tokens_out: number;
  tool_calls: number;
}

export async function getAnalyticsSummary(filters?: {
  host_id?: string;
  provider?: string;
  since?: string;
}): Promise<AnalyticsSummary> {
  const params = new URLSearchParams();
  if (filters?.host_id) params.set('host_id', filters.host_id);
  if (filters?.provider) params.set('provider', filters.provider);
  if (filters?.since) params.set('since', filters.since);

  const query = params.toString();
  return fetchAPI(`/v1/analytics/summary${query ? `?${query}` : ''}`);
}

export async function getProviderUsage(filters?: {
  provider?: string;
  host_id?: string;
  session_id?: string;
  scope?: 'account' | 'session';
}): Promise<{ usage: ProviderUsage[] }> {
  const params = new URLSearchParams();
  if (filters?.provider) params.set('provider', filters.provider);
  if (filters?.host_id) params.set('host_id', filters.host_id);
  if (filters?.session_id) params.set('session_id', filters.session_id);
  if (filters?.scope) params.set('scope', filters.scope);

  const query = params.toString();
  return fetchAPI(`/v1/analytics/provider-usage${query ? `?${query}` : ''}`);
}

export async function getSessionAnalytics(sessionId: string): Promise<SessionMetrics> {
  return fetchAPI(`/v1/sessions/${sessionId}/analytics`);
}

export async function getSessionTimeSeries(
  sessionId: string,
  limit?: number
): Promise<{ data: TimeSeriesPoint[] }> {
  const params = new URLSearchParams();
  if (limit) params.set('limit', limit.toString());

  const query = params.toString();
  return fetchAPI(`/v1/sessions/${sessionId}/analytics/timeseries${query ? `?${query}` : ''}`);
}

// Tool Events API
export interface ToolEvent {
  id: string;
  session_id: string;
  provider: string;
  tool_name: string;
  tool_input?: Record<string, unknown>;
  tool_output?: Record<string, unknown>;
  started_at: string;
  completed_at?: string;
  success?: boolean;
  duration_ms?: number;
  created_at: string;
}

export interface ToolStat {
  tool_name: string;
  total_calls: number;
  avg_duration?: number;
  success_count: number;
}

export async function getToolEvents(
  sessionId: string,
  cursor?: string,
  limit?: number
): Promise<{ events: ToolEvent[]; next_cursor?: string }> {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  if (limit) params.set('limit', limit.toString());

  const query = params.toString();
  return fetchAPI(`/v1/sessions/${sessionId}/tool-events${query ? `?${query}` : ''}`);
}

export async function getToolStats(sessionId: string): Promise<{ stats: ToolStat[] }> {
  return fetchAPI(`/v1/sessions/${sessionId}/tool-stats`);
}

// Spawn Session API
export type SpawnProvider = 'claude_code' | 'codex' | 'gemini_cli' | 'opencode' | 'aider' | 'shell';

export interface SpawnSessionRequest {
  host_id: string;
  provider: SpawnProvider;
  working_directory: string;
  title?: string;
  flags?: string[];
  group_id?: string;
}

export async function spawnSession(
  request: SpawnSessionRequest
): Promise<{ session: Session; cmd_id: string }> {
  return fetchAPI('/v1/sessions/spawn', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

// Directory Listing API
export interface DirectoryEntry {
  name: string;
  path: string;
  is_directory: boolean;
  is_git_repo: boolean;
  git_branch?: string;
  last_modified?: number | string | null;
}

export async function listDirectory(
  hostId: string,
  path: string,
  showHidden?: boolean
): Promise<{ entries: DirectoryEntry[]; current_path: string }> {
  const params = new URLSearchParams();
  params.set('path', path);
  if (showHidden) params.set('show_hidden', 'true');

  return fetchAPI(`/v1/hosts/${hostId}/directories?${params.toString()}`);
}
