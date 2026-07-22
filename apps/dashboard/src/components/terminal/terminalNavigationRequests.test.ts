import { describe, expect, it, vi } from 'vitest';
import type { BrowserTerminalNavigateMessage } from '@agent-command/schema';
import { createTerminalNavigationRequests } from './terminalNavigationRequests';

describe('terminal navigation requests', () => {
  it('resolves pane focus only after the matching verified result arrives', async () => {
    const sent: BrowserTerminalNavigateMessage[] = [];
    const send = (message: BrowserTerminalNavigateMessage) => {
      sent.push(message);
      return true;
    };
    const requests = createTerminalNavigationRequests(send);
    const pending = requests.focusPane('%7', true);
    const message = sent[0];
    if (message?.op !== 'focus_pane') throw new Error('focus request was not sent');

    expect(message).toMatchObject({ type: 'navigate', op: 'focus_pane', pane_id: '%7', zoom: true });
    expect(requests.resolve({
      type: 'navigation_result',
      request_id: '55555555-5555-4555-8555-555555555555',
      ok: true,
      pane_id: '%9',
      window_index: 1,
      zoomed: true,
    })).toBe(false);

    expect(requests.resolve({
      type: 'navigation_result',
      request_id: message.request_id,
      ok: true,
      pane_id: '%7',
      window_index: 2,
      zoomed: true,
    })).toBe(true);
    await expect(pending).resolves.toMatchObject({ ok: true, pane_id: '%7', zoomed: true });
  });

  it('queries viewer state so a resumed connection can reconcile its selected pane', async () => {
    const sent: BrowserTerminalNavigateMessage[] = [];
    const requests = createTerminalNavigationRequests((message) => {
      sent.push(message);
      return true;
    });

    const pending = requests.viewerState();
    const message = sent[0];
    expect(message).toMatchObject({ type: 'navigate', op: 'viewer_state' });
    if (message?.op !== 'viewer_state') throw new Error('viewer state request was not sent');

    requests.resolve({
      type: 'navigation_result',
      request_id: message.request_id,
      ok: true,
      pane_id: '%3',
      window_index: 1,
      zoomed: true,
    });

    await expect(pending).resolves.toMatchObject({ ok: true, pane_id: '%3', zoomed: true });
  });

  it('reconciles the actual viewer state when the focus acknowledgement times out', async () => {
    vi.useFakeTimers();
    const sent: BrowserTerminalNavigateMessage[] = [];
    const requests = createTerminalNavigationRequests((message) => {
      sent.push(message);
      return true;
    }, 5_000);
    const pending = requests.focusPane('%7', true);

    await vi.advanceTimersByTimeAsync(5_000);
    const stateRequest = sent[1];
    expect(stateRequest).toMatchObject({ type: 'navigate', op: 'viewer_state' });
    if (stateRequest?.op !== 'viewer_state') throw new Error('viewer state request was not sent');
    requests.resolve({
      type: 'navigation_result',
      request_id: stateRequest.request_id,
      ok: true,
      pane_id: '%7',
      window_index: 2,
      zoomed: true,
    });

    await expect(pending).resolves.toMatchObject({ ok: true, pane_id: '%7', zoomed: true });
    vi.useRealTimers();
  });

  it('reports the reconciled viewer when a timed-out switch did not land', async () => {
    vi.useFakeTimers();
    const sent: BrowserTerminalNavigateMessage[] = [];
    const requests = createTerminalNavigationRequests((message) => {
      sent.push(message);
      return true;
    }, 5_000);
    const pending = requests.focusPane('%7', true);

    await vi.advanceTimersByTimeAsync(5_000);
    const stateRequest = sent[1];
    if (stateRequest?.op !== 'viewer_state') throw new Error('viewer state request was not sent');
    requests.resolve({
      type: 'navigation_result',
      request_id: stateRequest.request_id,
      ok: true,
      pane_id: '%1',
      window_index: 0,
      zoomed: false,
    });

    await expect(pending).resolves.toMatchObject({
      ok: false,
      pane_id: '%1',
      zoomed: false,
      message: 'Pane switch timed out; viewer is on %1.',
    });
    vi.useRealTimers();
  });
});
