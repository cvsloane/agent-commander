export const SCROLLBACK_PAGE_LINES = 500;

export interface ScrollbackRange {
  startLine: number;
  endLine: number;
}

export interface NumberedScrollbackLine {
  lineNumber: number;
  text: string;
}

export interface ScrollbackLineSelection {
  anchorLine: number;
  extentLine: number;
  awaitingExtent: boolean;
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

export function numberScrollbackLines(
  range: ScrollbackRange,
  lines: string[]
): NumberedScrollbackLine[] {
  const firstLine = range.endLine - lines.length + 1;
  return lines.map((text, index) => ({
    lineNumber: firstLine + index,
    text,
  }));
}

export function advanceScrollbackSelection(
  current: ScrollbackLineSelection | null,
  lineNumber: number
): ScrollbackLineSelection {
  if (!current || !current.awaitingExtent) {
    return { anchorLine: lineNumber, extentLine: lineNumber, awaitingExtent: true };
  }
  return { ...current, extentLine: lineNumber, awaitingExtent: false };
}

export function selectedScrollbackLines(
  lines: NumberedScrollbackLine[],
  selection: ScrollbackLineSelection | null
): NumberedScrollbackLine[] {
  if (!selection) return [];
  const start = Math.min(selection.anchorLine, selection.extentLine);
  const end = Math.max(selection.anchorLine, selection.extentLine);
  return lines.filter((line) => line.lineNumber >= start && line.lineNumber <= end);
}
