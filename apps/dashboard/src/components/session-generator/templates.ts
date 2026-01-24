import type { SpawnProvider, SessionLinkType } from '@/lib/api';

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
