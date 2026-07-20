export interface ReconnectState {
  attempt: number;
  phase: 'idle' | 'waiting' | 'connecting';
}

export type ReconnectEvent =
  | { type: 'closed' }
  | { type: 'timer' }
  | { type: 'visibility' }
  | { type: 'online' }
  | { type: 'pageshow' }
  | { type: 'opened' };

export type ReconnectEffect =
  | { type: 'schedule'; delayMs: number }
  | { type: 'reconnect' }
  | { type: 'cancel' };

export interface ReconnectTransition {
  state: ReconnectState;
  effect: ReconnectEffect;
}

export const initialReconnectState: ReconnectState = {
  attempt: 0,
  phase: 'idle',
};

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
const TRANSIENT_TERMINAL_CLOSE_CODES = new Set([
  1001, // Endpoint going away.
  1005, // Browser observed a close without a status code.
  1006, // Abnormal close, commonly a dropped network connection.
  1011, // Unexpected server condition.
  1012, // Service restart.
  1013, // Temporary overload / try again later.
  1014, // Bad gateway.
  4006, // Host agent is not connected.
  4007, // Attach command could not be dispatched.
]);

export function shouldReconnectTerminal({
  code,
  deliberate = false,
  idleTimedOut = false,
}: {
  code: number;
  deliberate?: boolean;
  idleTimedOut?: boolean;
}): boolean {
  if (deliberate || idleTimedOut) return false;
  return TRANSIENT_TERMINAL_CLOSE_CODES.has(code);
}

export function transitionReconnect(
  state: ReconnectState,
  event: ReconnectEvent,
  random: () => number = Math.random
): ReconnectTransition {
  if (event.type === 'opened') {
    return {
      state: initialReconnectState,
      effect: { type: 'cancel' },
    };
  }

  if (
    event.type === 'timer' ||
    event.type === 'visibility' ||
    event.type === 'online' ||
    event.type === 'pageshow'
  ) {
    return {
      state: { ...state, phase: 'connecting' },
      effect: { type: 'reconnect' },
    };
  }

  const backoffCeiling = Math.min(
    MAX_DELAY_MS,
    BASE_DELAY_MS * 2 ** Math.min(state.attempt, 31)
  );
  const delayMs = Math.floor(Math.min(Math.max(random(), 0), 1) * backoffCeiling);

  return {
    state: { attempt: state.attempt + 1, phase: 'waiting' },
    effect: { type: 'schedule', delayMs },
  };
}
