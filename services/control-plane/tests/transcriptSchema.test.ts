import { describe, expect, it } from 'vitest';
import { TranscriptRequestSchema, TranscriptResponseSchema } from '@agent-command/schema';

describe('transcript route schemas', () => {
  it('defaults bounded requests and validates raw transcript page results', () => {
    expect(TranscriptRequestSchema.parse({})).toEqual({ page_size: 200 });
    expect(
      TranscriptResponseSchema.parse({
        cmd_id: '11111111-1111-4111-8111-111111111111',
        ok: true,
        result: {
          entries: [{ type: 'user', message: { content: 'Ship it' } }],
          first_entry: 7,
          total_entries: 8,
          source: 'hook',
        },
      })
    ).toMatchObject({
      ok: true,
      result: { first_entry: 7, total_entries: 8, source: 'hook' },
    });
    expect(
      TranscriptResponseSchema.safeParse({
        cmd_id: '11111111-1111-4111-8111-111111111111',
        ok: true,
        result: {
          entries: [],
          first_entry: -1,
          total_entries: 0,
          source: 'outside-root',
        },
      }).success
    ).toBe(false);
    expect(
      TranscriptResponseSchema.safeParse({
        cmd_id: '11111111-1111-4111-8111-111111111111',
        ok: true,
      }).success
    ).toBe(false);
  });
});
