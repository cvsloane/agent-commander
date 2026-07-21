import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TERMINAL_WARM_TIMEOUT_MINUTES,
  normalizeTerminalWarmTimeoutMinutes,
  useSettingsStore,
} from './settings';

describe('terminal warm timeout settings', () => {
  it('defaults to thirty minutes and clamps configurable values', () => {
    expect(DEFAULT_TERMINAL_WARM_TIMEOUT_MINUTES).toBe(30);
    expect(normalizeTerminalWarmTimeoutMinutes(45)).toBe(45);
    expect(normalizeTerminalWarmTimeoutMinutes(0)).toBe(1);
    expect(normalizeTerminalWarmTimeoutMinutes(999)).toBe(120);
    expect(normalizeTerminalWarmTimeoutMinutes(Number.NaN)).toBe(30);
  });
});

describe('mobile pane focus settings', () => {
  it('defaults automatic pane focus on and remains toggleable', () => {
    const settings = useSettingsStore.getState();

    expect(settings.autoFocusPane).toBe(true);
    settings.setAutoFocusPane(false);
    expect(useSettingsStore.getState().autoFocusPane).toBe(false);

    settings.setAutoFocusPane(true);
  });
});
