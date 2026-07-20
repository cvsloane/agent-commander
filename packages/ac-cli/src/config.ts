import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

export type Environment = Record<string, string | undefined>;
export type ControlPlaneAuthMode = 'session' | 'operator';

export interface RuntimeConfig {
  agentdUrl: string;
  sessionId?: string;
  controlPlaneUrl?: string;
  controlPlaneToken?: string;
  controlPlaneAuthMode?: ControlPlaneAuthMode;
}

interface ConfigFile {
  agentd_url?: string;
  agentdUrl?: string;
  control_plane_url?: string;
  controlPlaneUrl?: string;
  control_plane_token?: string;
  controlPlaneToken?: string;
  control_plane_auth_mode?: ControlPlaneAuthMode;
  controlPlaneAuthMode?: ControlPlaneAuthMode;
  token?: string;
}

export interface ConfigDependencies {
  env?: Environment;
  readFile?: (path: string, encoding: BufferEncoding) => Promise<string>;
  homeDirectory?: string;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function optional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function configuredAuthMode(value: string | undefined): ControlPlaneAuthMode | undefined {
  const normalized = optional(value);
  if (!normalized) return undefined;
  if (normalized === 'session' || normalized === 'operator') return normalized;
  throw new Error('AC_CONTROL_PLANE_AUTH_MODE must be session or operator');
}

function isSessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const payload = token.split('.')[1];
  if (!payload) return false;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown;
    return Boolean(
      claims
      && typeof claims === 'object'
      && (claims as Record<string, unknown>).token_use === 'orchestrator_session',
    );
  } catch {
    return false;
  }
}

export function resolveControlPlaneAuthMode(
  config: Pick<RuntimeConfig, 'controlPlaneAuthMode' | 'controlPlaneToken' | 'sessionId'>,
): ControlPlaneAuthMode {
  // A signed session token must never be routed to global operator endpoints, even if
  // a stale config file labels it as an operator credential.
  if (isSessionToken(config.controlPlaneToken)) return 'session';
  return config.controlPlaneAuthMode ?? (config.sessionId ? 'session' : 'operator');
}

export async function loadRuntimeConfig(
  dependencies: ConfigDependencies = {},
): Promise<RuntimeConfig> {
  const env = dependencies.env ?? process.env;
  const configPath = resolve(
    env.AC_CONFIG_FILE
      ?? dependencies.homeDirectory
      ?? homedir(),
    env.AC_CONFIG_FILE ? '' : '.config/agent-command/cli.json',
  );
  let file: ConfigFile = {};

  try {
    file = JSON.parse(await (dependencies.readFile ?? readFile)(configPath, 'utf8')) as ConfigFile;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw new Error(`Unable to read CLI config at ${configPath}: ${(error as Error).message}`, {
        cause: error,
      });
    }
  }

  const controlPlaneUrl = optional(env.AC_CONTROL_PLANE_URL)
    ?? optional(file.control_plane_url)
    ?? optional(file.controlPlaneUrl);
  const sessionId = optional(env.AC_SESSION_ID);
  const controlPlaneToken = optional(env.AC_CONTROL_PLANE_TOKEN)
    ?? optional(file.control_plane_token)
    ?? optional(file.controlPlaneToken)
    ?? optional(file.token);
  const requestedAuthMode = configuredAuthMode(
    env.AC_CONTROL_PLANE_AUTH_MODE
      ?? file.control_plane_auth_mode
      ?? file.controlPlaneAuthMode,
  );

  const config: RuntimeConfig = {
    agentdUrl: trimTrailingSlash(
      optional(env.AC_AGENTD_URL)
        ?? optional(file.agentd_url)
        ?? optional(file.agentdUrl)
        ?? 'http://127.0.0.1:7777',
    ),
    sessionId,
    controlPlaneUrl: controlPlaneUrl ? trimTrailingSlash(controlPlaneUrl) : undefined,
    controlPlaneToken,
    controlPlaneAuthMode: requestedAuthMode,
  };
  config.controlPlaneAuthMode = resolveControlPlaneAuthMode(config);
  return config;
}
