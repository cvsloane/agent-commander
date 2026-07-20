import { describe, expect, it } from 'vitest';
import { fuzzyScore } from './CommandPalette';

describe('fuzzyScore', () => {
  it('prefers a direct title match to a sparse subsequence', () => {
    expect(fuzzyScore('agent', 'Agent Command dashboard')).toBeGreaterThan(
      fuzzyScore('agent', 'A general network terminal')
    );
  });

  it('matches a session by abbreviated host characters', () => {
    expect(fuzzyScore('macmini', 'Deploy API mac-studio-mini tailscale')).toBeGreaterThanOrEqual(0);
  });

  it('rejects unrelated candidates', () => {
    expect(fuzzyScore('frontend', 'database migration')).toBe(-1);
  });
});
