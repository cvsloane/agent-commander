import { describe, expect, it, vi } from 'vitest';
import {
  buildTerminalHello,
  buildTerminalWebSocketUrl,
  decodeTerminalFrame,
  sendTerminalNavigation,
} from './protocol';

describe('browser terminal protocol', () => {
  it('emits typed navigation frames only on an open terminal socket', () => {
    const send = vi.fn();
    const socket = { readyState: 1, send } as unknown as WebSocket;
    expect(sendTerminalNavigation(socket, {
      type: 'navigate',
      op: 'select_pane',
      pane_id: '%7',
    })).toBe(true);
    expect(send).toHaveBeenCalledWith(JSON.stringify({
      type: 'navigate',
      op: 'select_pane',
      pane_id: '%7',
    }));

    expect(sendTerminalNavigation({ readyState: 3, send } as unknown as WebSocket, {
      type: 'navigate',
      op: 'zoom',
      on: true,
    })).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

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
      'resume/token+1',
      true
    );
    const parsed = new URL(url);

    expect(parsed.searchParams.get('ticket')).toBe('one-time-ticket');
    expect(parsed.searchParams.get('cols')).toBe('118');
    expect(parsed.searchParams.get('rows')).toBe('37');
    expect(parsed.searchParams.get('resume_token')).toBe('resume/token+1');
    expect(parsed.searchParams.get('letterbox')).toBe('1');
  });

  it('decodes legacy JSON output (pre-hello race tolerance) and parses typed status messages', () => {
    const legacy = decodeTerminalFrame(JSON.stringify({
      type: 'output',
      encoding: 'base64',
      data: btoa('legacy output'),
    }));
    expect(legacy).toMatchObject({ type: 'output' });
    expect(new TextDecoder().decode((legacy as { data: Uint8Array }).data)).toBe('legacy output');

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
