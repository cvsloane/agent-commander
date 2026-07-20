import { describe, expect, it } from 'vitest';
import { buildTerminalHello, buildTerminalWebSocketUrl, decodeTerminalFrame } from './protocol';

describe('browser terminal protocol', () => {
  it('negotiates binary mode and writes ArrayBuffer frames as bytes', () => {
    expect(buildTerminalHello()).toEqual({ type: 'hello', binary: true });

    const source = Uint8Array.from([0, 27, 91, 51, 49, 109, 255]);
    const frame = decodeTerminalFrame(source.buffer);

    expect(frame).toMatchObject({ type: 'output' });
    if (frame.type !== 'output') throw new Error('expected terminal output');
    expect(frame.data).toBeInstanceOf(Uint8Array);
    expect(Array.from(frame.data as Uint8Array)).toEqual(Array.from(source));
  });

  it('carries a one-time ticket, fitted dimensions, and the prior viewer resume token', () => {
    const url = buildTerminalWebSocketUrl(
      'wss://control.example/v1/ui/terminal/session-id?ticket=one-time-ticket',
      { cols: 118, rows: 37 },
      'resume/token+1'
    );
    const parsed = new URL(url);

    expect(parsed.searchParams.get('ticket')).toBe('one-time-ticket');
    expect(parsed.searchParams.get('cols')).toBe('118');
    expect(parsed.searchParams.get('rows')).toBe('37');
    expect(parsed.searchParams.get('resume_token')).toBe('resume/token+1');
  });

  it('parses legacy base64 output and typed status messages', () => {
    const legacy = decodeTerminalFrame(
      JSON.stringify({
        type: 'output',
        encoding: 'base64',
        data: btoa('legacy output'),
      })
    );
    expect(legacy.type).toBe('output');
    if (legacy.type !== 'output') throw new Error('expected terminal output');
    expect(new TextDecoder().decode(legacy.data as Uint8Array)).toBe('legacy output');

    expect(
      decodeTerminalFrame(
        JSON.stringify({
          type: 'attached',
          resume_token: 'next-token',
          resumed: true,
          readonly: true,
        })
      )
    ).toMatchObject({ type: 'attached', resume_token: 'next-token', resumed: true });
    expect(decodeTerminalFrame(JSON.stringify({ type: 'idle_timeout' }))).toEqual({
      type: 'idle_timeout',
    });
    expect(
      decodeTerminalFrame(
        JSON.stringify({
          type: 'lag',
          message: 'Dropped output',
          dropped: 2,
        })
      )
    ).toMatchObject({ type: 'lag', dropped: 2 });
  });
});
