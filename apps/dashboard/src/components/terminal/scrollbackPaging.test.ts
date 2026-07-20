import { describe, expect, it } from 'vitest';
import { initialScrollbackRange, olderScrollbackRange } from './scrollbackPaging';

describe('scrollback range paging', () => {
  it('requests contiguous older ranges without touching the live xterm buffer', () => {
    const initial = initialScrollbackRange();
    const older = olderScrollbackRange(initial);

    expect(initial).toEqual({ startLine: -500, endLine: -1 });
    expect(older).toEqual({ startLine: -1000, endLine: -501 });
    expect(older.endLine + 1).toBe(initial.startLine);
  });
});
