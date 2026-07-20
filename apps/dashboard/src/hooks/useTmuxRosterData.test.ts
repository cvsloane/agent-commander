import { describe, expect, it } from 'vitest';
import { buildCanonicalTmuxHref } from './useTmuxRosterData';

describe('buildCanonicalTmuxHref', () => {
  it('targets the root command center while preserving legacy redirect query state', () => {
    const legacyUrl = new URL(
      'https://command.example/tmux?host_id=host-1&session_id=session-1&mode=terminal&attach=1'
    );

    expect(buildCanonicalTmuxHref(legacyUrl.searchParams.toString())).toBe(
      '/?host_id=host-1&session_id=session-1&mode=terminal&attach=1'
    );
  });

  it('uses the bare root when no tmux state is active', () => {
    expect(buildCanonicalTmuxHref('')).toBe('/');
  });
});
