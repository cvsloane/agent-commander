import { describe, expect, it } from 'vitest';
import { formatTranscriptEntries } from './transcriptFormatter';

describe('Claude transcript formatter', () => {
  it('renders user, assistant, and tool lines while skipping non-chat entries', () => {
    expect(
      formatTranscriptEntries([
        { type: 'system', message: { content: 'system prompt' } },
        { type: 'user', message: { role: 'user', content: 'Deploy now' } },
        {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'private chain' },
              { type: 'text', text: 'Working.\nDone.' },
              {
                type: 'tool_use',
                name: 'Bash',
                input: { command: 'pnpm test --runInBand' },
              },
            ],
          },
        },
        { type: 'progress', message: { content: '50%' } },
        {
          type: 'user',
          message: { content: [{ type: 'tool_result', content: 'tool output' }] },
        },
      ])
    ).toEqual([
      { text: '❯ Deploy now', dim: false },
      { text: 'Working.', dim: false },
      { text: 'Done.', dim: false },
      { text: '⏺ Bash pnpm test --runInBand', dim: true },
    ]);
  });

  it('caps primary tool input at 80 characters and wraps to the requested width', () => {
    const command = `run ${'x'.repeat(100)}`;
    const lines = formatTranscriptEntries(
      [
        {
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', name: 'Bash', input: { command } }],
          },
        },
      ],
      24
    );

    expect(lines.every((line) => Array.from(line.text).length <= 24)).toBe(true);
    expect(lines.map((line) => line.text).join('')).toBe(`⏺ Bash ${command.slice(0, 80)}`);
    expect(lines.every((line) => line.dim)).toBe(true);
  });

  it('wraps ordinary transcript text at word boundaries while preserving exact content', () => {
    const text = 'The pane alerts were benign and completed cleanly.';
    const lines = formatTranscriptEntries(
      [{ type: 'assistant', message: { role: 'assistant', content: text } }],
      18
    );

    expect(lines).toEqual([
      { text: 'The pane alerts ', dim: false },
      { text: 'were benign and ', dim: false },
      { text: 'completed cleanly.', dim: false },
    ]);
    expect(lines.map((line) => line.text).join('')).toBe(text);
  });
});
