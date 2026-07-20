import type { SessionWithSnapshot } from '@agent-command/schema';
import type { RecentSession } from '@/stores/ui';

const MAX_QUICK_SWITCH_PANES = 5;

export function getRecentTmuxPanes(
  recentSessions: RecentSession[],
  liveSessions: SessionWithSnapshot[],
  selectedSessionId: string
): SessionWithSnapshot[] {
  const liveById = new Map(
    liveSessions
      .filter((session) => Boolean(session.tmux_pane_id))
      .map((session) => [session.id, session])
  );
  const orderedIds = [
    ...(selectedSessionId ? [selectedSessionId] : []),
    ...recentSessions.map((session) => session.id),
    ...liveSessions.map((session) => session.id),
  ];
  const seen = new Set<string>();
  const panes: SessionWithSnapshot[] = [];

  for (const sessionId of orderedIds) {
    if (seen.has(sessionId)) continue;
    seen.add(sessionId);
    const session = liveById.get(sessionId);
    if (!session) continue;
    panes.push(session);
    if (panes.length === MAX_QUICK_SWITCH_PANES) break;
  }
  return panes;
}
