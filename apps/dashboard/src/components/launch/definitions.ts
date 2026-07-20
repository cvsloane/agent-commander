import type { MobileLaunchProvider } from '@agent-command/schema';
import type { SessionLinkType, SpawnProvider } from '@/lib/api';

export interface LaunchProviderDefinition {
  id: SpawnProvider;
  name: string;
  shortName: string;
  mobile: boolean;
}

export const LAUNCH_PROVIDERS = [
  { id: 'claude_code', name: 'Claude Code', shortName: 'Claude', mobile: true },
  { id: 'codex', name: 'Codex', shortName: 'Codex', mobile: true },
  { id: 'gemini_cli', name: 'Gemini CLI', shortName: 'Gemini', mobile: false },
  { id: 'opencode', name: 'OpenCode', shortName: 'OpenCode', mobile: false },
  { id: 'aider', name: 'Aider', shortName: 'Aider', mobile: false },
  { id: 'shell', name: 'Shell', shortName: 'Shell', mobile: false },
] as const satisfies readonly LaunchProviderDefinition[];

export const MOBILE_LAUNCH_PROVIDERS = LAUNCH_PROVIDERS.filter(
  (provider): provider is (typeof LAUNCH_PROVIDERS)[number] & { id: MobileLaunchProvider } =>
    provider.mobile
);

export function getLaunchProvider(providerId: SpawnProvider) {
  return LAUNCH_PROVIDERS.find((provider) => provider.id === providerId);
}

export interface SessionTemplateSession {
  provider: SpawnProvider;
  titleSuffix?: string;
}

export interface SessionTemplate {
  id: string;
  name: string;
  description: string;
  sessions: SessionTemplateSession[];
  autoLink: boolean;
  linkType?: SessionLinkType;
}

export const SESSION_TEMPLATES: Record<string, SessionTemplate> = {
  single: {
    id: 'single',
    name: 'Single Session',
    description: 'Start one session with your chosen provider',
    sessions: [{ provider: 'claude_code' }],
    autoLink: false,
  },
  claude_codex: {
    id: 'claude_codex',
    name: 'Claude + Codex',
    description: 'Two complementary AI sessions for parallel problem solving',
    sessions: [
      { provider: 'claude_code', titleSuffix: 'claude' },
      { provider: 'codex', titleSuffix: 'codex' },
    ],
    autoLink: true,
    linkType: 'complement',
  },
  full_dev: {
    id: 'full_dev',
    name: 'Full Dev Setup',
    description: 'Claude + Codex + Shell for complete development workflow',
    sessions: [
      { provider: 'claude_code', titleSuffix: 'claude' },
      { provider: 'codex', titleSuffix: 'codex' },
      { provider: 'shell', titleSuffix: 'shell' },
    ],
    autoLink: true,
    linkType: 'complement',
  },
};

export const TEMPLATE_OPTIONS = Object.values(SESSION_TEMPLATES);

export function getTemplate(id: string): SessionTemplate | undefined {
  return SESSION_TEMPLATES[id];
}
