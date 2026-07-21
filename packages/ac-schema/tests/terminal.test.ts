import { describe, expect, it } from 'vitest';
import {
  BrowserTerminalClientMessageSchema,
  BrowserTerminalServerMessageSchema,
  TerminalAuditMessageSchema,
  TerminalAttachMessageSchema,
  TerminalStatusMessageSchema,
} from '../src/index.js';

describe('terminal protocol', () => {
  it('accepts only complete viewer navigation operations from browsers', () => {
    expect(BrowserTerminalClientMessageSchema.parse({
      type: 'navigate',
      op: 'select_window',
      window_index: 2,
    })).toMatchObject({ op: 'select_window', window_index: 2 });
    expect(BrowserTerminalClientMessageSchema.parse({
      type: 'navigate',
      op: 'select_pane',
      pane_id: '%7',
    })).toMatchObject({ op: 'select_pane', pane_id: '%7' });
    expect(BrowserTerminalClientMessageSchema.parse({
      type: 'navigate',
      op: 'zoom',
      on: true,
    })).toMatchObject({ op: 'zoom', on: true });

    expect(BrowserTerminalClientMessageSchema.safeParse({
      type: 'navigate',
      op: 'select_window',
    }).success).toBe(false);
    expect(BrowserTerminalClientMessageSchema.safeParse({
      type: 'navigate',
      op: 'zoom',
    }).success).toBe(false);
  });

  it('accepts the additive binary, resume, sizing, idle, and lag messages', () => {
    expect(BrowserTerminalClientMessageSchema.parse({ type: 'hello', binary: true })).toEqual({
      type: 'hello',
      binary: true,
    });
    expect(BrowserTerminalServerMessageSchema.parse({ type: 'idle_timeout' })).toEqual({
      type: 'idle_timeout',
    });
    expect(
      BrowserTerminalServerMessageSchema.parse({
        type: 'lag',
        message: 'Dropped 3 terminal output chunks',
      })
    ).toMatchObject({ type: 'lag' });

    const attach = TerminalAttachMessageSchema.parse({
      v: 1,
      type: 'terminal.attach',
      ts: '2026-07-19T16:00:00.000Z',
      payload: {
        channel_id: '11111111-1111-4111-8111-111111111111',
        pane_id: '%1',
        session_id: '22222222-2222-4222-8222-222222222222',
        cols: 120,
        rows: 36,
        resume_token: 'resume-token',
        letterbox: true,
      },
    });
    expect(attach.payload).toMatchObject({
      cols: 120,
      rows: 36,
      resume_token: 'resume-token',
      letterbox: true,
    });

    const status = TerminalStatusMessageSchema.parse({
      v: 1,
      seq: 1,
      type: 'terminal.attached',
      ts: '2026-07-19T16:00:00.000Z',
      payload: {
        channel_id: '11111111-1111-4111-8111-111111111111',
        resume_token: 'resume-token',
        resumed: true,
        readonly: false,
      },
    });
    expect(status.payload).toMatchObject({ resume_token: 'resume-token', resumed: true });
  });

  it('accepts durable terminal audit messages from agentd', () => {
    const audit = TerminalAuditMessageSchema.parse({
      v: 1,
      seq: 2,
      type: 'terminal.audit',
      ts: '2026-07-19T16:00:00.000Z',
      payload: {
        event_type: 'terminal.audit',
        action: 'control_transfer',
        channel_id: '11111111-1111-4111-8111-111111111111',
        session_id: '22222222-2222-4222-8222-222222222222',
        pane_id: '%1',
        previous_controller_channel_id: '33333333-3333-4333-8333-333333333333',
      },
    });

    expect(audit.payload).toMatchObject({
      event_type: 'terminal.audit',
      action: 'control_transfer',
      pane_id: '%1',
    });
  });
});
