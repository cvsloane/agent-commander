import { describe, expect, it } from 'vitest';
import type { Host } from '@agent-command/schema';
import { buildSplitPaneCommand } from './paneActions';

const baseHost = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'builder',
  capabilities: { tmux: true },
  created_at: '2026-07-20T12:00:00.000Z',
  updated_at: '2026-07-20T12:00:00.000Z',
} as Host;

describe('tmux pane actions', () => {
  it('includes a percent split only when the host reports tmux 3.1 or newer', () => {
    const modern = {
      ...baseHost,
      capabilities: { ...baseHost.capabilities, tmux_version: 'tmux 3.4' },
    } as Host;
    const old = {
      ...baseHost,
      capabilities: { ...baseHost.capabilities, tmux_version: 'tmux 3.0a' },
    } as Host;

    expect(buildSplitPaneCommand(modern, 'horizontal', '/work/repo')).toEqual({
      type: 'split_pane',
      payload: { direction: 'horizontal', percent: 50, cwd: '/work/repo' },
    });
    expect(buildSplitPaneCommand(old, 'vertical', '/work/repo')).toEqual({
      type: 'split_pane',
      payload: { direction: 'vertical', cwd: '/work/repo' },
    });
    expect(buildSplitPaneCommand({ ...baseHost, agent_version: 'unknown' }, 'vertical')).toEqual({
      type: 'split_pane',
      payload: { direction: 'vertical' },
    });
    expect(buildSplitPaneCommand({ ...baseHost, agent_version: '3.1.2' }, 'vertical')).toEqual({
      type: 'split_pane',
      payload: { direction: 'vertical' },
    });
  });
});
