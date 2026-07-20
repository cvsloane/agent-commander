import type { Host } from '@agent-command/schema';
import { getControlPlaneToken } from '@/lib/wsToken';
import { getRuntimeConfig, type RuntimeConfig } from '@/lib/runtimeConfig';

interface HostApiEnvironment {
  NEXT_PUBLIC_CONTROL_PLANE_URL?: string;
  NEXT_PUBLIC_CONTROL_PLANE_BASE_URL?: string;
}

interface BrowserLocation {
  origin: string;
}

interface HostEnrollmentDependencies {
  apiBase?: string;
  fetchImpl?: typeof fetch;
  getToken?: () => Promise<string | null>;
}

export interface CreateHostEnrollmentInput {
  name: string;
  tailscaleName?: string;
}

export interface HostEnrollmentResult {
  host: Host;
  token: string;
}

export class HostEnrollmentError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'HostEnrollmentError';
  }
}

export function resolveHostApiBase(
  runtime: RuntimeConfig = getRuntimeConfig(),
  env: HostApiEnvironment = process.env as HostApiEnvironment,
  location: BrowserLocation | null = typeof window === 'undefined' ? null : window.location
): string {
  const configured =
    runtime.controlPlaneUrl ||
    env.NEXT_PUBLIC_CONTROL_PLANE_URL ||
    env.NEXT_PUBLIC_CONTROL_PLANE_BASE_URL ||
    '';

  if (configured) {
    const trimmed = configured.replace(/\/+$/, '');
    try {
      const url = new URL(trimmed);
      const internalHost =
        url.hostname === 'control-plane' ||
        (!url.hostname.includes('.') &&
          url.hostname !== 'localhost' &&
          url.hostname !== '127.0.0.1');
      if (location && internalHost) return location.origin;
    } catch {
      // Let fetch surface invalid external configuration consistently with the main API client.
    }
    return trimmed.endsWith('/v1') ? trimmed.slice(0, -3) : trimmed;
  }

  return location?.origin || 'http://localhost:8080';
}

export async function createHostEnrollment(
  input: CreateHostEnrollmentInput,
  dependencies: HostEnrollmentDependencies = {}
): Promise<HostEnrollmentResult> {
  const fetchImpl = dependencies.fetchImpl || fetch;
  const token = await (dependencies.getToken || getControlPlaneToken)();
  const apiBase = dependencies.apiBase || resolveHostApiBase();
  const response = await fetchImpl(`${apiBase}/v1/hosts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      name: input.name.trim(),
      ...(input.tailscaleName?.trim() ? { tailscale_name: input.tailscaleName.trim() } : {}),
    }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new HostEnrollmentError(payload?.error || `HTTP ${response.status}`, response.status);
  }

  return (await response.json()) as HostEnrollmentResult;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

export function enrollmentWebSocketUrl(apiBase: string): string {
  const url = new URL(apiBase);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol === 'https:') url.protocol = 'wss:';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/v1/agent/connect`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function buildAgentdConfig(input: {
  hostId: string;
  hostName: string;
  token: string;
  apiBase: string;
}): string {
  return [
    'host:',
    `  id: ${yamlString(input.hostId)}`,
    `  name: ${yamlString(input.hostName)}`,
    '',
    'control_plane:',
    `  ws_url: ${yamlString(enrollmentWebSocketUrl(input.apiBase))}`,
    `  token: ${yamlString(input.token)}`,
    '  reconnect_backoff_ms: [250, 500, 1000, 2000, 5000]',
  ].join('\n');
}

export function isForbiddenEnrollmentError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'status' in error && error.status === 403);
}
