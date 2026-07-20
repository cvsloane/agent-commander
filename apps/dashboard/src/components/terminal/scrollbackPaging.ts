export const SCROLLBACK_PAGE_LINES = 500;

export interface ScrollbackRange {
  startLine: number;
  endLine: number;
}

export function initialScrollbackRange(): ScrollbackRange {
  return {
    startLine: -SCROLLBACK_PAGE_LINES,
    endLine: -1,
  };
}

export function olderScrollbackRange(range: ScrollbackRange): ScrollbackRange {
  const endLine = range.startLine - 1;
  return {
    startLine: endLine - SCROLLBACK_PAGE_LINES + 1,
    endLine,
  };
}
