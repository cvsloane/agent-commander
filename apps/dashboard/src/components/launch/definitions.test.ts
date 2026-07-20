import { describe, expect, it } from 'vitest';
import {
  LAUNCH_PROVIDERS,
  MOBILE_LAUNCH_PROVIDERS,
  SESSION_TEMPLATES,
} from './definitions';

describe('launch definitions', () => {
  it('keeps provider ids unique and exposes the mobile launch pair', () => {
    const providerIds = LAUNCH_PROVIDERS.map((provider) => provider.id);

    expect(new Set(providerIds).size).toBe(providerIds.length);
    expect(MOBILE_LAUNCH_PROVIDERS.map((provider) => provider.id)).toEqual([
      'claude_code',
      'codex',
    ]);
  });

  it('only references centralized providers from session templates', () => {
    const providerIds = new Set(LAUNCH_PROVIDERS.map((provider) => provider.id));
    const templateProviders = Object.values(SESSION_TEMPLATES)
      .flatMap((template) => template.sessions)
      .map((session) => session.provider);

    expect(templateProviders.every((provider) => providerIds.has(provider))).toBe(true);
    expect(Object.keys(SESSION_TEMPLATES)).toEqual(['single', 'claude_codex', 'full_dev']);
  });
});
