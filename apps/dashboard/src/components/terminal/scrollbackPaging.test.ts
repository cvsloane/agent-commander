import { describe, expect, it } from 'vitest';
import {
  advanceScrollbackSelection,
  compensateScrollbackPrepend,
  contentScrollbackLines,
  initialScrollbackRange,
  isNearScrollbackTop,
  numberScrollbackLines,
  olderScrollbackRange,
  resolveScrollbackVirtualWindow,
  selectedScrollbackLines,
  shouldDismissHistoryOverscroll,
} from './scrollbackPaging';

describe('scrollback range paging', () => {
  it('requests contiguous older ranges without touching the live xterm buffer', () => {
    const initial = initialScrollbackRange();
    const older = olderScrollbackRange(initial);

    expect(initial).toEqual({ startLine: -500, endLine: -1 });
    expect(older).toEqual({ startLine: -1000, endLine: -501 });
    expect(older.endLine + 1).toBe(initial.startLine);
  });

  it('parses capture text without inventing a trailing blank line', () => {
    expect(contentScrollbackLines('one\ntwo\n')).toEqual(['one', 'two']);
    expect(contentScrollbackLines('one\n\ntwo')).toEqual(['one', '', 'two']);
    expect(contentScrollbackLines(null)).toEqual([]);
  });

  it('keeps the visible transcript stable when an older page is prepended', () => {
    expect(compensateScrollbackPrepend(180, 8_000, 16_000)).toBe(8_180);
    expect(compensateScrollbackPrepend(180, 8_000, 7_500)).toBe(180);
  });

  it('loads older pages only inside the terminal-density top threshold', () => {
    expect(isNearScrollbackTop(95, 16)).toBe(true);
    expect(isNearScrollbackTop(97, 16)).toBe(false);
  });

  it('virtualizes enough terminal-density rows for the viewport and overscan', () => {
    expect(resolveScrollbackVirtualWindow({
      lineCount: 500,
      scrollTop: 1_600,
      viewportHeight: 320,
      lineHeight: 16,
      overscan: 8,
    })).toEqual({ startIndex: 92, endIndex: 128 });
  });
});

describe('inline history dismissal', () => {
  it('dismisses only a deliberate upward over-scroll from the bottom edge', () => {
    expect(shouldDismissHistoryOverscroll(true, -48)).toBe(true);
    expect(shouldDismissHistoryOverscroll(true, -47)).toBe(false);
    expect(shouldDismissHistoryOverscroll(true, 80)).toBe(false);
    expect(shouldDismissHistoryOverscroll(false, -80)).toBe(false);
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
