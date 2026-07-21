import { describe, expect, it } from 'vitest';
import {
  commandLabelFromTerminalLine,
  detectAgentTurnMarks,
  getAgentTurnLabel,
} from './commandMarks';

describe('terminal command marks', () => {
  it('detects agent prompts as approximate turn boundaries with buffer offsets', () => {
    expect(detectAgentTurnMarks('working\n\x1b[36m❯ Fix the tests\x1b[0m\noutput')).toEqual([
      { label: 'Fix the tests', lineOffset: -1 },
    ]);
    expect(getAgentTurnLabel('User: ship it')).toBe('ship it');
    expect(getAgentTurnLabel('$ pnpm test')).toBeNull();
  });

  it('extracts a concise command from an exact shell prompt line', () => {
    expect(commandLabelFromTerminalLine('chris@host:/work $ pnpm test')).toBe('pnpm test');
    expect(commandLabelFromTerminalLine('')).toBe('Shell command');
  });
});
