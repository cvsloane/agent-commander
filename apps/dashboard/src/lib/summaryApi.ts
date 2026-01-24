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
      // ignore invalid URLs
    }
    return trimmed.endsWith('/v1') ? trimmed.slice(0, -3) : trimmed;
  }

  if (typeof window !== 'undefined') {
    return window.location.origin;
  }

  return 'http://localhost:8080';
}

export interface GenerateSummaryRequest {
  session_id: string;
  capture_hash: string;
  action_type: string;
  context: string;
  question: string;
}

export interface GenerateSummaryResponse {
  summary: string;
  cached: boolean;
}

export interface SummaryStatusResponse {
  available: boolean;
}

/**
 * Check if the summary service is available
 */
export async function getSummaryStatus(): Promise<SummaryStatusResponse> {
  const token = await getControlPlaneToken();
  const apiBase = resolveApiBase();

  const res = await fetch(`${apiBase}/v1/summaries/status`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to get summary status: ${res.status}`);
  }

  return res.json();
}

/**
 * Generate an AI summary for an orchestrator item
 */
export async function generateSummary(
  request: GenerateSummaryRequest
): Promise<GenerateSummaryResponse> {
  const token = await getControlPlaneToken();
  const apiBase = resolveApiBase();

  const res = await fetch(`${apiBase}/v1/summaries/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(request),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  return res.json();
}
