import { describe, expect, it } from 'vitest';
import { fuzzyScore, getCommandPaletteKeyboardAction } from './CommandPalette';

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

describe('command palette keyboard activation', () => {
  const textarea = { tagName: 'TEXTAREA', isContentEditable: false } as unknown as EventTarget;

  it('ignores Ctrl+K from an editable terminal textarea', () => {
    expect(
      getCommandPaletteKeyboardAction({
        key: 'k',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        target: textarea,
      })
    ).toBeNull();
  });

  it('keeps Command+K global when an editable target is focused', () => {
    expect(
      getCommandPaletteKeyboardAction({
        key: 'k',
        ctrlKey: false,
        metaKey: true,
        altKey: false,
        target: textarea,
      })
    ).toBe('toggle');
  });
});
