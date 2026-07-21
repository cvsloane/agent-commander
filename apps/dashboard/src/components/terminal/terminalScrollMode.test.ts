import { describe, expect, it } from 'vitest';
import {
  TERMINAL_HISTORY_NON_EMPTY_LINE_THRESHOLD,
  classifyTerminalScrollMode,
  countNonEmptyScrollbackLines,
} from './terminalScrollMode';

describe('terminal scroll mode classification', () => {
  it('counts only non-empty lines, including around blank and whitespace-only lines', () => {
    expect(countNonEmptyScrollbackLines('first\n\n   \nsecond\n\t\nthird\n')).toBe(3);
    expect(countNonEmptyScrollbackLines(undefined)).toBe(0);
    expect(countNonEmptyScrollbackLines({ content: 'not a capture string' })).toBe(0);
  });

  it('classifies below the named threshold as app scroll', () => {
    const content = [
      ...Array.from(
        { length: TERMINAL_HISTORY_NON_EMPTY_LINE_THRESHOLD - 1 },
        (_, index) => `line ${index + 1}`
      ),
      '',
      '   ',
    ].join('\n');

    expect(countNonEmptyScrollbackLines(content)).toBe(39);
    expect(classifyTerminalScrollMode(content)).toBe('app-scroll');
  });

  it('classifies the threshold and denser captures as history despite blank lines', () => {
    const thresholdContent = Array.from(
      { length: TERMINAL_HISTORY_NON_EMPTY_LINE_THRESHOLD },
      (_, index) => (index === 20 ? `line ${index + 1}\n\n  ` : `line ${index + 1}`)
    ).join('\n');
    const denseContent = `${thresholdContent}\none more`;

    expect(countNonEmptyScrollbackLines(thresholdContent)).toBe(40);
    expect(classifyTerminalScrollMode(thresholdContent)).toBe('history');
    expect(classifyTerminalScrollMode(denseContent)).toBe('history');
  });
});
