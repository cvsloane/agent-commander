import type { SessionWithSnapshot } from '@agent-command/schema';
import type { RecentSession } from '@/stores/ui';

const MAX_THUMBNAIL_PANES = 12;

function isWaiting(session: SessionWithSnapshot): boolean {
  return session.status === 'WAITING_FOR_INPUT' || session.status === 'WAITING_FOR_APPROVAL';
}

function tmuxSessionKey(session: SessionWithSnapshot): string | null {
  const sessionName = session.tmux_session_name
    || session.metadata?.tmux?.session_name
    || session.tmux_target?.split(':')[0];
  return session.host_id && sessionName ? `${session.host_id}\u0000${sessionName}` : null;
}

function paneOrder(session: SessionWithSnapshot): number {
  const indexes = session.tmux_target?.match(/:(\d+)(?:\.(\d+))?$/);
  const windowIndex = session.tmux_window_index
    ?? session.metadata?.tmux?.window_index
    ?? Number(indexes?.[1] ?? 0);
  const paneIndex = session.tmux_pane_index
    ?? session.metadata?.tmux?.pane_index
    ?? Number(indexes?.[2] ?? 0);
  return windowIndex * 10_000 + paneIndex;
}

export function getPaneSwitcherGroup(session: SessionWithSnapshot): { key: string; label: string } {
  const indexes = session.tmux_target?.match(/:(\d+)(?:\.(\d+))?$/);
  const sessionName = session.tmux_session_name
    || session.metadata?.tmux?.session_name
    || session.tmux_target?.split(':')[0]
    || 'tmux';
  const windowIndex = session.tmux_window_index
    ?? session.metadata?.tmux?.window_index
    ?? Number(indexes?.[1] ?? 0);
  const windowName = session.metadata?.tmux?.window_name;
  return {
    key: `${session.host_id || 'host'}\u0000${sessionName}\u0000${windowIndex}`,
    label: `${sessionName} · ${windowIndex}${windowName ? ` ${windowName}` : ''}`,
  };
}

export function filterThumbnailPanes(
  panes: SessionWithSnapshot[],
  query: string
): SessionWithSnapshot[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return panes;
  return panes.filter((session) => [
    session.title,
    session.provider,
    session.tmux_target,
    session.tmux_pane_id,
    session.cwd,
    session.repo_root,
    session.git_branch,
    session.latest_snapshot?.capture_text,
  ].some((value) => value?.toLocaleLowerCase().includes(normalized)));
}

export function getPaneSnapshotFreshness(
  createdAt: string | null | undefined,
  now = Date.now()
): { label: string; stale: boolean } {
  const timestamp = createdAt ? Date.parse(createdAt) : Number.NaN;
  if (!Number.isFinite(timestamp)) return { label: 'No capture', stale: true };
  const ageSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (ageSeconds <= 30) return { label: 'Fresh', stale: false };
  if (ageSeconds < 60) return { label: `${ageSeconds}s old`, stale: false };
  const ageMinutes = Math.floor(ageSeconds / 60);
  if (ageMinutes < 60) return { label: `${ageMinutes}m old`, stale: true };
  const ageHours = Math.floor(ageMinutes / 60);
  return { label: `${ageHours}h old`, stale: true };
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
  const selectedSession = liveById.get(selectedSessionId);
  const selectedTmuxKey = selectedSession ? tmuxSessionKey(selectedSession) : null;
  const currentTmuxPanes = selectedTmuxKey
    ? [...liveById.values()]
        .filter((session) => tmuxSessionKey(session) === selectedTmuxKey)
        .sort((left, right) => paneOrder(left) - paneOrder(right))
    : [];
  const orderedIds = [
    ...(selectedSessionId ? [selectedSessionId] : []),
    ...currentTmuxPanes.map((session) => session.id),
    ...liveSessions.filter(isWaiting).map((session) => session.id),
    ...recentSessions.map((session) => session.id),
    ...liveSessions.map((session) => session.id),
  ];
  const seen = new Set<string>();
  const panes: SessionWithSnapshot[] = [];
  const paneLimit = Math.max(MAX_THUMBNAIL_PANES, currentTmuxPanes.length);
  for (const sessionId of orderedIds) {
    if (seen.has(sessionId)) continue;
    seen.add(sessionId);
    const session = liveById.get(sessionId);
    if (!session) continue;
    panes.push(session);
    if (panes.length === paneLimit) break;
  }
  return panes;
}

export function getPaneSnapshotPreview(captureText: string | null | undefined): string {
  if (!captureText) return '';
  const clean = captureText.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
  const lines = clean.split('\n');
  return lines.slice(-6).join('\n').trimEnd();
}
