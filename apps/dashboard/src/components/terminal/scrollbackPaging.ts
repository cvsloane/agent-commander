export const SCROLLBACK_PAGE_LINES = 500;
export const HISTORY_OVERSCROLL_DISMISS_PX = 48;
export const SCROLLBACK_TOP_THRESHOLD_LINES = 6;

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

export interface ScrollbackVirtualWindow {
  startIndex: number;
  endIndex: number;
}

export function contentScrollbackLines(content: unknown): string[] {
  if (typeof content !== 'string' || content.length === 0) return [];
  const lines = content.split('\n');
  if (content.endsWith('\n')) lines.pop();
  return lines;
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

export function compensateScrollbackPrepend(
  previousScrollTop: number,
  previousScrollHeight: number,
  nextScrollHeight: number
): number {
  return previousScrollTop + Math.max(0, nextScrollHeight - previousScrollHeight);
}

export function isNearScrollbackTop(
  scrollTop: number,
  lineHeight: number,
  thresholdLines = SCROLLBACK_TOP_THRESHOLD_LINES
): boolean {
  return scrollTop <= Math.max(1, lineHeight) * thresholdLines;
}

export function resolveScrollbackVirtualWindow({
  lineCount,
  scrollTop,
  viewportHeight,
  lineHeight,
  overscan,
}: {
  lineCount: number;
  scrollTop: number;
  viewportHeight: number;
  lineHeight: number;
  overscan: number;
}): ScrollbackVirtualWindow {
  const safeLineHeight = Math.max(1, lineHeight);
  const safeOverscan = Math.max(0, Math.floor(overscan));
  const startIndex = Math.max(0, Math.floor(scrollTop / safeLineHeight) - safeOverscan);
  const visibleCount = Math.ceil(Math.max(0, viewportHeight) / safeLineHeight);
  return {
    startIndex,
    endIndex: Math.min(lineCount, startIndex + visibleCount + safeOverscan * 2),
  };
}

export function shouldDismissHistoryOverscroll(
  startedAtBottom: boolean,
  touchDeltaY: number,
  threshold = HISTORY_OVERSCROLL_DISMISS_PX
): boolean {
  return startedAtBottom && touchDeltaY <= -Math.max(1, threshold);
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
