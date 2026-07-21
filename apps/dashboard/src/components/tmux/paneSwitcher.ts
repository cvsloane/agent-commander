import type { SessionWithSnapshot } from '@agent-command/schema';
import type { RecentSession } from '@/stores/ui';

const MAX_THUMBNAIL_PANES = 12;

function isWaiting(session: SessionWithSnapshot): boolean {
  return session.status === 'WAITING_FOR_INPUT' || session.status === 'WAITING_FOR_APPROVAL';
}

export function getThumbnailSwitcherPanes(
  recentSessions: RecentSession[],
  liveSessions: SessionWithSnapshot[],
  selectedSessionId: string
): SessionWithSnapshot[] {
  const liveById = new Map(
    liveSessions
      .filter((session) => Boolean(session.tmux_pane_id) && !session.archived_at)
      .map((session) => [session.id, session])
  );
  const orderedIds = [
    ...(selectedSessionId ? [selectedSessionId] : []),
    ...liveSessions.filter(isWaiting).map((session) => session.id),
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
    if (panes.length === MAX_THUMBNAIL_PANES) break;
  }
  return panes;
}

export function getPaneSnapshotPreview(captureText: string | null | undefined): string {
  if (!captureText) return '';
  const clean = captureText.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
  const lines = clean.split('\n');
  return lines.slice(-6).join('\n').trimEnd();
}
