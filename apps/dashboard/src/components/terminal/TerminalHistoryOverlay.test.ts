import { describe, expect, it } from 'vitest';
import { mergeLatestChatPage, type ChatPage } from './TerminalHistoryOverlay';

function page(firstEntry: number, messages: string[], totalEntries: number): ChatPage {
  return {
    type: 'chat',
    firstEntry,
    totalEntries,
    entries: messages.map((content) => ({ message: { role: 'assistant', content } })),
  };
}

describe('live Claude chat pages', () => {
  it('replaces the overlapping tail while preserving older pages exactly once', () => {
    const older = page(0, ['old 0', 'old 1'], 4);
    const previousTail = page(2, ['old 2', 'old 3'], 4);
    const latestTail = page(2, ['old 2', 'old 3', 'new 4'], 5);

    expect(mergeLatestChatPage([older, previousTail], latestTail)).toEqual([
      page(0, ['old 0', 'old 1'], 5),
      latestTail,
    ]);
  });

  it('trims an overlapping older page before appending the refreshed tail', () => {
    const overlap = page(0, ['old 0', 'old 1', 'old 2'], 3);
    const latestTail = page(2, ['old 2', 'new 3'], 4);

    expect(mergeLatestChatPage([overlap], latestTail)).toEqual([
      page(0, ['old 0', 'old 1'], 4),
      latestTail,
    ]);
  });
});
