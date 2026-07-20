import { afterEach, describe, expect, it } from 'vitest';
import type { SessionWithSnapshot } from '@agent-command/schema';
import {
  buildCanonicalTmuxHref,
  matchesFleetRosterFilter,
} from './useTmuxRosterData';
import { useSettingsStore } from '@/stores/settings';

const session: SessionWithSnapshot = {
  id: '00000000-0000-4000-8000-000000000001',
  host_id: '11111111-1111-4111-8111-111111111111',
  kind: 'tmux_pane',
  provider: 'codex',
  status: 'RUNNING',
  role: 'standalone',
  title: 'Builder',
  cwd: '/repo',
  tmux_pane_id: '%1',
  tmux_target: 'agents:0.0',
  metadata: {},
  created_at: '2026-07-20T12:00:00.000Z',
  updated_at: '2026-07-20T12:00:00.000Z',
  last_activity_at: '2026-07-20T13:50:00.000Z',
  fork_depth: 0,
  latest_snapshot: null,
};

describe('buildCanonicalTmuxHref', () => {
  it('targets the root command center while preserving legacy redirect query state', () => {
    const legacyUrl = new URL(
      'https://command.example/tmux?host_id=host-1&session_id=session-1&mode=terminal&attach=1'
    );

    expect(buildCanonicalTmuxHref(legacyUrl.searchParams.toString())).toBe(
      '/?host_id=host-1&session_id=session-1&mode=terminal&attach=1'
    );
  });

  it('uses the bare root when no tmux state is active', () => {
    expect(buildCanonicalTmuxHref('')).toBe('/');
  });
});

describe('saved fleet roster filters', () => {
  afterEach(() => useSettingsStore.setState({
    tmuxRosterFilter: 'all',
    tmuxThisHostId: null,
  }));

  it('matches this-host and recent sessions against explicit filter context', () => {
    expect(matchesFleetRosterFilter(session, 'this_host', {
      thisHostId: session.host_id,
      now: Date.parse('2026-07-20T14:00:00.000Z'),
    })).toBe(true);
    expect(matchesFleetRosterFilter(session, 'this_host', {
      thisHostId: '22222222-2222-4222-8222-222222222222',
      now: Date.parse('2026-07-20T14:00:00.000Z'),
    })).toBe(false);
    expect(matchesFleetRosterFilter(session, 'recent', {
      thisHostId: null,
      now: Date.parse('2026-07-20T14:00:00.000Z'),
    })).toBe(true);
    expect(matchesFleetRosterFilter(session, 'recent', {
      thisHostId: null,
      now: Date.parse('2026-07-20T15:00:00.000Z'),
    })).toBe(false);
  });

  it('persists the last filter and this-host target in the settings store', () => {
    const settings = useSettingsStore.getState();
    settings.setTmuxRosterFilter('recent');
    settings.setTmuxThisHostId(session.host_id);

    expect(useSettingsStore.getState()).toMatchObject({
      tmuxRosterFilter: 'recent',
      tmuxThisHostId: session.host_id,
    });
  });
});
