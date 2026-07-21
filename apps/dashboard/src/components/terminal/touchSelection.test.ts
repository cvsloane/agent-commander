import { describe, expect, it } from 'vitest';
import {
  orderTerminalCellRange,
  pointToTerminalCell,
  terminalCellHandlePosition,
  terminalCellRangeLength,
  terminalWordRange,
} from './touchSelection';

const geometry = {
  left: 10,
  top: 20,
  width: 800,
  height: 400,
  cols: 80,
  rows: 20,
  viewportY: 120,
};

describe('touch selection geometry', () => {
  it('maps and clamps touch points to visible buffer cells', () => {
    expect(pointToTerminalCell(geometry, { x: 35, y: 75 })).toEqual({ column: 2, row: 122 });
    expect(pointToTerminalCell(geometry, { x: -100, y: 900 })).toEqual({ column: 0, row: 139 });
  });

  it('orders a reversed multi-line range and counts every selected cell', () => {
    const range = orderTerminalCellRange(
      { column: 2, row: 12 },
      { column: 78, row: 10 },
      80
    );
    expect(range).toEqual({
      start: { column: 78, row: 10 },
      end: { column: 2, row: 12 },
    });
    expect(terminalCellRangeLength(range, 80)).toBe(85);
  });

  it('selects terminal words and positions handles on exact cell edges', () => {
    expect(terminalWordRange('run pnpm:test now', 6, 14)).toEqual({
      start: { column: 4, row: 14 },
      end: { column: 12, row: 14 },
    });
    expect(terminalCellHandlePosition(geometry, { column: 2, row: 122 }, 'start')).toEqual({
      x: 20,
      y: 60,
    });
    expect(terminalCellHandlePosition(geometry, { column: 2, row: 122 }, 'end')).toEqual({
      x: 30,
      y: 60,
    });
  });
});
