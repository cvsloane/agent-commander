export const TERMINAL_HISTORY_NON_EMPTY_LINE_THRESHOLD = 40;

export type TerminalScrollMode = 'history' | 'chat' | 'app-scroll';

export function countNonEmptyScrollbackLines(content: unknown): number {
  if (typeof content !== 'string' || !content) return 0;
  return content.split('\n').filter((line) => line.trim().length > 0).length;
}

export function classifyTerminalScrollMode(content: unknown): TerminalScrollMode {
  return countNonEmptyScrollbackLines(content) >= TERMINAL_HISTORY_NON_EMPTY_LINE_THRESHOLD
    ? 'history'
    : 'app-scroll';
}
