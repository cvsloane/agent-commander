export interface TerminalCell {
  column: number;
  row: number;
}

export interface TerminalCellGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
  cols: number;
  rows: number;
  viewportY: number;
}

export interface TerminalCellRange {
  start: TerminalCell;
  end: TerminalCell;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function pointToTerminalCell(
  geometry: TerminalCellGeometry,
  point: { x: number; y: number }
): TerminalCell {
  const cellWidth = geometry.width / Math.max(1, geometry.cols);
  const cellHeight = geometry.height / Math.max(1, geometry.rows);
  return {
    column: clamp(Math.floor((point.x - geometry.left) / cellWidth), 0, geometry.cols - 1),
    row:
      geometry.viewportY
      + clamp(Math.floor((point.y - geometry.top) / cellHeight), 0, geometry.rows - 1),
  };
}

export function terminalCellHandlePosition(
  geometry: TerminalCellGeometry,
  cell: TerminalCell,
  edge: 'start' | 'end'
): { x: number; y: number } {
  const cellWidth = geometry.width / Math.max(1, geometry.cols);
  const cellHeight = geometry.height / Math.max(1, geometry.rows);
  return {
    x: (cell.column + (edge === 'end' ? 1 : 0)) * cellWidth,
    y: (cell.row - geometry.viewportY + 1) * cellHeight,
  };
}

export function orderTerminalCellRange(
  first: TerminalCell,
  second: TerminalCell,
  cols: number
): TerminalCellRange {
  const firstOffset = first.row * cols + first.column;
  const secondOffset = second.row * cols + second.column;
  return firstOffset <= secondOffset
    ? { start: first, end: second }
    : { start: second, end: first };
}

export function terminalCellRangeLength(range: TerminalCellRange, cols: number): number {
  return (
    (range.end.row - range.start.row) * cols
    + range.end.column
    - range.start.column
    + 1
  );
}

const WORD_CHARACTER = /[A-Za-z0-9_./:@~-]/;

export function terminalWordRange(
  line: string,
  column: number,
  row: number
): TerminalCellRange | null {
  if (!line.length) return null;
  const selectedColumn = clamp(column, 0, line.length - 1);
  if (!WORD_CHARACTER.test(line[selectedColumn] ?? '')) return null;
  let start = selectedColumn;
  let end = selectedColumn;
  while (start > 0 && WORD_CHARACTER.test(line[start - 1] ?? '')) start -= 1;
  while (end + 1 < line.length && WORD_CHARACTER.test(line[end + 1] ?? '')) end += 1;
  return {
    start: { column: start, row },
    end: { column: end, row },
  };
}
