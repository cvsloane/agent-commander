import { describe, expect, it } from 'vitest';
import {
  advanceScrollbackSelection,
  initialScrollbackRange,
  numberScrollbackLines,
  olderScrollbackRange,
  selectedScrollbackLines,
} from './scrollbackPaging';

describe('scrollback range paging', () => {
  it('requests contiguous older ranges without touching the live xterm buffer', () => {
    const initial = initialScrollbackRange();
    const older = olderScrollbackRange(initial);

    expect(initial).toEqual({ startLine: -500, endLine: -1 });
    expect(older).toEqual({ startLine: -1000, endLine: -501 });
    expect(older.endLine + 1).toBe(initial.startLine);
  });
});

describe('exact scrollback line selection', () => {
  it('numbers short captures against the requested range end', () => {
    expect(numberScrollbackLines({ startLine: -500, endLine: -1 }, ['a', 'b', 'c'])).toEqual([
      { lineNumber: -3, text: 'a' },
      { lineNumber: -2, text: 'b' },
      { lineNumber: -1, text: 'c' },
    ]);
  });

  it('anchors on the first tap, extends on the second, then starts a new range', () => {
    const anchor = advanceScrollbackSelection(null, -2);
    const extended = advanceScrollbackSelection(anchor, -4);
    expect(anchor).toEqual({ anchorLine: -2, extentLine: -2, awaitingExtent: true });
    expect(extended).toEqual({ anchorLine: -2, extentLine: -4, awaitingExtent: false });
    expect(advanceScrollbackSelection(extended, -8)).toEqual({
      anchorLine: -8,
      extentLine: -8,
      awaitingExtent: true,
    });
  });

  it('copies the contiguous numbered range regardless of selection direction', () => {
    const lines = numberScrollbackLines({ startLine: -4, endLine: -1 }, ['a', 'b', 'c', 'd']);
    expect(selectedScrollbackLines(lines, {
      anchorLine: -1,
      extentLine: -3,
      awaitingExtent: false,
    }).map((line) => line.text)).toEqual(['b', 'c', 'd']);
  });
});
