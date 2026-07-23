import { describe, expect, it } from 'vitest';
import {
  BrowserTerminalClientMessageSchema,
  BrowserTerminalServerMessageSchema,
  TerminalAuditMessageSchema,
  TerminalAttachMessageSchema,
  TerminalNavigationResultMessageSchema,
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
    expect(BrowserTerminalClientMessageSchema.parse({
      type: 'navigate',
      op: 'scroll',
      lines: -120,
    })).toMatchObject({ op: 'scroll', lines: -120 });

    expect(BrowserTerminalClientMessageSchema.safeParse({
      type: 'navigate',
      op: 'select_window',
    }).success).toBe(false);
    expect(BrowserTerminalClientMessageSchema.safeParse({
      type: 'navigate',
      op: 'zoom',
    }).success).toBe(false);
    expect(BrowserTerminalClientMessageSchema.safeParse({
      type: 'navigate',
      op: 'scroll',
      lines: -121,
    }).success).toBe(false);
    expect(BrowserTerminalClientMessageSchema.safeParse({
      type: 'navigate',
      op: 'scroll',
      lines: 121,
    }).success).toBe(false);
  });

  it('round-trips an acknowledged pane focus request with verified viewer state', () => {
    const requestId = '44444444-4444-4444-8444-444444444444';
    expect(BrowserTerminalClientMessageSchema.parse({
      type: 'navigate',
      op: 'focus_pane',
      request_id: requestId,
      pane_id: '%7',
      zoom: true,
    })).toEqual({
      type: 'navigate',
      op: 'focus_pane',
      request_id: requestId,
      pane_id: '%7',
      zoom: true,
    });

    expect(BrowserTerminalServerMessageSchema.parse({
      type: 'navigation_result',
      request_id: requestId,
      ok: true,
      pane_id: '%7',
      window_index: 2,
      zoomed: true,
    })).toMatchObject({ ok: true, pane_id: '%7', window_index: 2, zoomed: true });

    const result = TerminalNavigationResultMessageSchema.parse({
      v: 1,
      type: 'terminal.navigation_result',
      ts: '2026-07-21T16:00:00.000Z',
      payload: {
        channel_id: '11111111-1111-4111-8111-111111111111',
        request_id: requestId,
        ok: true,
        pane_id: '%7',
        window_index: 2,
        zoomed: true,
      },
    });
    expect(result.payload).toMatchObject({ request_id: requestId, ok: true, pane_id: '%7' });
    expect(result).not.toHaveProperty('seq');
  });

  it('accepts a viewer-state reconciliation request after an uncertain focus result', () => {
    const requestId = '66666666-6666-4666-8666-666666666666';
    expect(BrowserTerminalClientMessageSchema.parse({
      type: 'navigate',
      op: 'viewer_state',
      request_id: requestId,
    })).toEqual({
      type: 'navigate',
      op: 'viewer_state',
      request_id: requestId,
    });
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
      type: 'terminal.attached',
      ts: '2026-07-19T16:00:00.000Z',
      payload: {
        channel_id: '11111111-1111-4111-8111-111111111111',
        pane_id: '%1',
        resume_token: 'resume-token',
        resumed: true,
        readonly: false,
      },
    });
    expect(status.payload).toMatchObject({
      pane_id: '%1',
      resume_token: 'resume-token',
      resumed: true,
    });
    expect(status).not.toHaveProperty('seq');
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
