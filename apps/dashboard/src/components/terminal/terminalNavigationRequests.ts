import type {
  BrowserTerminalNavigateMessage,
  BrowserTerminalNavigationResultMessage,
} from '@agent-command/schema';

type NavigationSend = (message: BrowserTerminalNavigateMessage) => boolean;

export function createTerminalNavigationRequests(send: NavigationSend, timeoutMs = 5_000) {
  const pending = new Map<
    string,
    {
      complete: (result: BrowserTerminalNavigationResultMessage) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();

  return {
    viewerState(): Promise<BrowserTerminalNavigationResultMessage> {
      const requestId = globalThis.crypto.randomUUID();
      const message: BrowserTerminalNavigateMessage = {
        type: 'navigate',
        op: 'viewer_state',
        request_id: requestId,
      };
      return new Promise((resolve) => {
        const timeout = globalThis.setTimeout(() => {
          pending.delete(requestId);
          resolve({
            type: 'navigation_result',
            request_id: requestId,
            ok: false,
            message: 'Viewer state request timed out.',
          });
        }, timeoutMs);
        pending.set(requestId, { complete: resolve, timeout });
        if (send(message)) return;
        globalThis.clearTimeout(timeout);
        pending.delete(requestId);
        resolve({
          type: 'navigation_result',
          request_id: requestId,
          ok: false,
          message: 'Terminal is not connected.',
        });
      });
    },
    focusPane(paneId: string, zoom: boolean): Promise<BrowserTerminalNavigationResultMessage> {
      const requestId = globalThis.crypto.randomUUID();
      const message: BrowserTerminalNavigateMessage = {
        type: 'navigate',
        op: 'focus_pane',
        request_id: requestId,
        pane_id: paneId,
        zoom,
      };
      return new Promise((resolve) => {
        const timeout = globalThis.setTimeout(() => {
          pending.delete(requestId);
          const stateRequestId = globalThis.crypto.randomUUID();
          const stateTimeout = globalThis.setTimeout(() => {
            pending.delete(stateRequestId);
            resolve({
              type: 'navigation_result',
              request_id: requestId,
              ok: false,
              message: 'Pane switch timed out and viewer state could not be confirmed.',
            });
          }, timeoutMs);
          pending.set(stateRequestId, {
            timeout: stateTimeout,
            complete: (state) => {
              if (
                state.ok
                && state.pane_id === paneId
                && state.zoomed === zoom
              ) {
                resolve(state);
                return;
              }
              resolve({
                type: 'navigation_result',
                request_id: requestId,
                ok: false,
                message: state.ok
                  ? `Pane switch timed out; viewer is on ${state.pane_id}.`
                  : `Pane switch timed out; ${state.message}`,
                ...(state.pane_id ? { pane_id: state.pane_id } : {}),
                ...(state.window_index !== undefined ? { window_index: state.window_index } : {}),
                ...(state.zoomed !== undefined ? { zoomed: state.zoomed } : {}),
              });
            },
          });
          if (send({
            type: 'navigate',
            op: 'viewer_state',
            request_id: stateRequestId,
          })) return;
          globalThis.clearTimeout(stateTimeout);
          pending.delete(stateRequestId);
          resolve({
            type: 'navigation_result',
            request_id: requestId,
            ok: false,
            message: 'Pane switch timed out and terminal is not connected.',
          });
        }, timeoutMs);
        pending.set(requestId, { complete: resolve, timeout });
        if (send(message)) return;
        globalThis.clearTimeout(timeout);
        pending.delete(requestId);
        resolve({
          type: 'navigation_result',
          request_id: requestId,
          ok: false,
          message: 'Terminal is not connected.',
        });
      });
    },
    resolve(result: BrowserTerminalNavigationResultMessage): boolean {
      const request = pending.get(result.request_id);
      if (!request) return false;
      globalThis.clearTimeout(request.timeout);
      pending.delete(result.request_id);
      request.complete(result);
      return true;
    },
    cancelAll(message = 'Terminal connection closed.'): void {
      for (const [requestId, request] of pending) {
        globalThis.clearTimeout(request.timeout);
        request.complete({
          type: 'navigation_result',
          request_id: requestId,
          ok: false,
          message,
        });
      }
      pending.clear();
    },
  };
}
