import { describe, expect, it } from 'vitest';
import { buildAppliedSessionParams, parseSessionRouteState } from './useSessionFilters';
import { shouldAssignSessionGroup } from './useSessionDragAndDrop';
import { toggleAllSelectedIds, toggleSelectedId } from './useSessionSelection';

describe('sessions page hooks', () => {
  it('normalizes invalid pagination and preserves supported filters', () => {
    const state = parseSessionRouteState(
      new URLSearchParams('status=ERROR&page=-2&page_size=999&archived_only=true')
    );
    expect(state).toMatchObject({ status: 'ERROR', page: 1, pageSize: 20, archivedOnly: true });
    expect(buildAppliedSessionParams(state, 'deploy').toString()).toContain('q=deploy');
  });

  it('selects, deselects, and toggles all session ids without mutating the input', () => {
    const initial = new Set(['one']);
    const selected = toggleSelectedId(initial, 'two', true);
    expect([...initial]).toEqual(['one']);
    expect([...selected]).toEqual(['one', 'two']);
    expect(toggleAllSelectedIds(selected, ['one', 'two']).size).toBe(0);
  });

  it('only assigns a session when the target group changes', () => {
    expect(shouldAssignSessionGroup(null, null)).toBe(false);
    expect(shouldAssignSessionGroup('group-one', 'group-one')).toBe(false);
    expect(shouldAssignSessionGroup('group-one', 'group-two')).toBe(true);
  });
});
