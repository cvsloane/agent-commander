import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@/stores/settings';
import { recallPromptHistory, sendPromptToSession } from './PromptComposer';

describe('prompt composer', () => {
  beforeEach(() => useSettingsStore.setState({ promptHistoryBySession: {} }));

  it('dispatches prompt text with exactly one trailing newline', async () => {
    const send = vi.fn().mockResolvedValue({ cmd_id: 'cmd-1' });

    await sendPromptToSession(
      '00000000-0000-4000-8000-000000000001',
      '  Review this diff.\n\n',
      send
    );

    expect(send).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      {
        type: 'send_input',
        payload: { text: 'Review this diff.\n', enter: false },
      }
    );
  });

  it('recalls persisted recents from newest to oldest without wrapping', () => {
    const history = ['third prompt', 'second prompt', 'first prompt'];

    expect(recallPromptHistory(history, -1)).toEqual({ value: 'third prompt', index: 0 });
    expect(recallPromptHistory(history, 0)).toEqual({ value: 'second prompt', index: 1 });
    expect(recallPromptHistory(history, 2)).toEqual({ value: 'first prompt', index: 2 });
  });

  it('stores deduplicated per-session recents in newest-first order', () => {
    const sessionId = '00000000-0000-4000-8000-000000000001';
    const { addPromptHistory } = useSettingsStore.getState();

    addPromptHistory(sessionId, 'First');
    addPromptHistory(sessionId, 'Second');
    addPromptHistory(sessionId, 'First');

    expect(useSettingsStore.getState().promptHistoryBySession[sessionId]).toEqual([
      'First',
      'Second',
    ]);
  });
});
