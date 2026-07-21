import { describe, expect, it } from 'vitest';
import { getMobileFocusNavigation } from './mobileFocus';

describe('mobile pane focus state machine', () => {
  it('zooms a newly attached multi-pane target when auto focus is enabled', () => {
    expect(getMobileFocusNavigation({
      autoFocusPane: true,
      connected: true,
      paneCount: 2,
      targetKey: 'agents:0:%1',
      previousTargetKey: null,
      terminalVisible: true,
      zoomed: false,
    })).toEqual({ type: 'navigate', op: 'zoom', on: true });
  });

  it('reasserts zoom after switching targets while focused', () => {
    expect(getMobileFocusNavigation({
      autoFocusPane: true,
      connected: true,
      paneCount: 2,
      targetKey: 'agents:0:%2',
      previousTargetKey: 'agents:0:%1',
      terminalVisible: true,
      zoomed: true,
    })).toEqual({ type: 'navigate', op: 'zoom', on: true });
  });

  it('uses topology truth and does not emit once the current target is zoomed', () => {
    expect(getMobileFocusNavigation({
      autoFocusPane: true,
      connected: true,
      paneCount: 2,
      targetKey: 'agents:0:%1',
      previousTargetKey: 'agents:0:%1',
      terminalVisible: true,
      zoomed: true,
    })).toBeNull();
  });

  it('unzooms when focus is disabled or the terminal is left', () => {
    const base = {
      connected: true,
      paneCount: 2,
      targetKey: 'agents:0:%1',
      previousTargetKey: 'agents:0:%1',
      zoomed: true,
    };

    expect(getMobileFocusNavigation({
      ...base,
      autoFocusPane: false,
      terminalVisible: true,
    })).toEqual({ type: 'navigate', op: 'zoom', on: false });
    expect(getMobileFocusNavigation({
      ...base,
      autoFocusPane: true,
      terminalVisible: false,
    })).toEqual({ type: 'navigate', op: 'zoom', on: false });
    expect(getMobileFocusNavigation({
      ...base,
      autoFocusPane: true,
      focusRequested: true,
      terminalVisible: false,
      zoomed: false,
    })).toEqual({ type: 'navigate', op: 'zoom', on: false });
  });

  it('does not auto-zoom single-pane, disconnected, or desktop-owned views', () => {
    const base = {
      autoFocusPane: true,
      paneCount: 2,
      targetKey: 'agents:0:%1',
      previousTargetKey: null,
      terminalVisible: true,
      zoomed: false,
    };

    expect(getMobileFocusNavigation({ ...base, connected: false })).toBeNull();
    expect(getMobileFocusNavigation({ ...base, connected: true, paneCount: 1 })).toBeNull();
  });
});
