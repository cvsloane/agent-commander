import { describe, expect, it } from 'vitest';
import {
  initialReconnectState,
  shouldReconnectTerminal,
  transitionReconnect,
} from './reconnect';

describe('transitionReconnect', () => {
  it('keeps scheduling retries without a maximum attempt count', () => {
    let state = initialReconnectState;

    for (let attempt = 1; attempt <= 100; attempt += 1) {
      const closed = transitionReconnect(state, { type: 'closed' }, () => 0.5);

      expect(closed.effect.type).toBe('schedule');
      expect(closed.state.attempt).toBe(attempt);

      const timer = transitionReconnect(closed.state, { type: 'timer' });
      expect(timer.effect).toEqual({ type: 'reconnect' });
      state = timer.state;
    }
  });

  it('uses full-jitter exponential backoff capped at 30 seconds', () => {
    let state = initialReconnectState;
    const delays: number[] = [];

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const closed = transitionReconnect(state, { type: 'closed' }, () => 1);
      if (closed.effect.type === 'schedule') {
        delays.push(closed.effect.delayMs);
      }
      state = transitionReconnect(closed.state, { type: 'timer' }).state;
    }

    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);

    const jittered = transitionReconnect(initialReconnectState, { type: 'closed' }, () => 0.25);
    expect(jittered.effect).toEqual({ type: 'schedule', delayMs: 250 });
  });

  it.each(['visibility', 'online', 'pageshow'] as const)(
    'retries immediately when a %s signal says the connection may be available',
    (type) => {
      const waiting = transitionReconnect(initialReconnectState, { type: 'closed' }, () => 0.5);
      const signaled = transitionReconnect(waiting.state, { type });

      expect(signaled.state).toEqual({ attempt: 1, phase: 'connecting' });
      expect(signaled.effect).toEqual({ type: 'reconnect' });
    }
  );

  it('resets the backoff after a successful connection', () => {
    const failed = transitionReconnect(initialReconnectState, { type: 'closed' }, () => 1);
    const opened = transitionReconnect(failed.state, { type: 'opened' });
    const nextFailure = transitionReconnect(opened.state, { type: 'closed' }, () => 1);

    expect(opened.state).toEqual(initialReconnectState);
    expect(opened.effect).toEqual({ type: 'cancel' });
    expect(nextFailure.effect).toEqual({ type: 'schedule', delayMs: 1_000 });
  });
});

describe('shouldReconnectTerminal', () => {
  it.each([4006, 4007])('retries transient control-plane close code %s', (code) => {
    expect(shouldReconnectTerminal({ code })).toBe(true);
  });

  it.each([4001, 4002, 4003, 4004, 4005, 4008, 4009])(
    'does not retry permanent control-plane close code %s',
    (code) => {
      expect(shouldReconnectTerminal({ code })).toBe(false);
    }
  );

  it.each([1001, 1005, 1006, 1011, 1012, 1013, 1014])(
    'retries transient WebSocket close code %s',
    (code) => {
      expect(shouldReconnectTerminal({ code })).toBe(true);
    }
  );

  it('does not retry a normal, deliberate, or idle-timeout close', () => {
    expect(shouldReconnectTerminal({ code: 1000 })).toBe(false);
    expect(shouldReconnectTerminal({ code: 1006, deliberate: true })).toBe(false);
    expect(shouldReconnectTerminal({ code: 1006, idleTimedOut: true })).toBe(false);
  });
});
