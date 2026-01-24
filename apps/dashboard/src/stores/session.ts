import { create } from 'zustand';
import type { Session, SessionWithSnapshot } from '@agent-command/schema';

interface SessionStore {
  sessions: SessionWithSnapshot[];
  setSessions: (sessions: SessionWithSnapshot[]) => void;
  updateSessions: (updates: Session[], deleted?: string[]) => void;
}

const MAX_SNAPSHOT_CHARS = 4000;

const hasOwn = (obj: object, key: string) =>
  Object.prototype.hasOwnProperty.call(obj, key);

const trimSnapshot = (session: SessionWithSnapshot): SessionWithSnapshot => {
  const snapshot = session.latest_snapshot;
  if (!snapshot?.capture_text) return session;
  if (snapshot.capture_text.length <= MAX_SNAPSHOT_CHARS) return session;
  return {
    ...session,
    latest_snapshot: {
      ...snapshot,
      capture_text: snapshot.capture_text.slice(-MAX_SNAPSHOT_CHARS),
    },
  };
};

const mergeSession = (existing: SessionWithSnapshot, update: Session): SessionWithSnapshot => {
  const merged: SessionWithSnapshot = {
    ...existing,
    ...update,
    created_at: update.created_at || existing.created_at,
    updated_at: update.updated_at || existing.updated_at,
    last_activity_at: update.last_activity_at || existing.last_activity_at,
  } as SessionWithSnapshot;

  if (hasOwn(update as SessionWithSnapshot, 'latest_snapshot')) {
    merged.latest_snapshot = (update as SessionWithSnapshot).latest_snapshot ?? null;
  } else if (existing.latest_snapshot !== undefined) {
    merged.latest_snapshot = existing.latest_snapshot;
  }
  if (hasOwn(update as SessionWithSnapshot, 'idled_at')) {
    merged.idled_at = (update as SessionWithSnapshot).idled_at ?? null;
  } else if (hasOwn(existing as SessionWithSnapshot, 'idled_at')) {
    merged.idled_at = existing.idled_at ?? null;
  }

  return trimSnapshot(merged);
};

const getActivityKey = (session: SessionWithSnapshot): string | null => {
  return session.last_activity_at || session.updated_at || null;
};

const sessionsEqual = (a: SessionWithSnapshot, b: SessionWithSnapshot): boolean => {
  const activityA = getActivityKey(a);
  const activityB = getActivityKey(b);
  return (
    a.status === b.status &&
    a.title === b.title &&
    a.cwd === b.cwd &&
    a.repo_root === b.repo_root &&
    a.git_branch === b.git_branch &&
    a.provider === b.provider &&
    a.host_id === b.host_id &&
    a.group_id === b.group_id &&
    a.archived_at === b.archived_at &&
    a.tmux_target === b.tmux_target &&
    a.tmux_pane_id === b.tmux_pane_id &&
    a.idled_at === b.idled_at &&
    activityA === activityB &&
    a.latest_snapshot?.created_at === b.latest_snapshot?.created_at &&
    a.latest_snapshot?.capture_text === b.latest_snapshot?.capture_text
  );
};

export const useSessionStore = create<SessionStore>((set) => ({
  sessions: [],

  setSessions: (sessions) =>
    set((state) => {
      if (state.sessions.length === 0) {
        return { sessions: sessions.map((session) => trimSnapshot(session as SessionWithSnapshot)) };
      }

      const incomingById = new Map(sessions.map((s) => [s.id, s]));
      const next: SessionWithSnapshot[] = [];

      for (const existing of state.sessions) {
        const update = incomingById.get(existing.id);
        if (!update) continue;
        const merged = mergeSession(existing, update);
        next.push(sessionsEqual(existing, merged) ? existing : merged);
        incomingById.delete(existing.id);
      }

      // Append new sessions in incoming order to keep UI stable
      for (const session of sessions) {
        if (!incomingById.has(session.id)) continue;
        next.unshift(trimSnapshot(session as SessionWithSnapshot));
        incomingById.delete(session.id);
      }

      if (
        next.length === state.sessions.length &&
        next.every((session, index) => session === state.sessions[index])
      ) {
        return state;
      }

      return { sessions: next };
    }),

  updateSessions: (updates, deleted) =>
    set((state) => {
      let changed = false;
      let newSessions: SessionWithSnapshot[] | null = null;

      // Remove deleted sessions (only copy array if needed)
      if (deleted && deleted.length > 0) {
        const deletedSet = new Set(deleted);
        const filtered = state.sessions.filter((s) => !deletedSet.has(s.id));
        if (filtered.length !== state.sessions.length) {
          newSessions = filtered;
          changed = true;
        }
      }

      // Apply updates (preserve existing order, only copy when needed)
      for (const update of updates) {
        const sessions = newSessions ?? state.sessions;
        const index = sessions.findIndex((s) => s.id === update.id);
        if (index >= 0) {
          // Update existing session
          const existing = sessions[index];
          const merged = mergeSession(existing, update);
          if (!sessionsEqual(existing, merged)) {
            // Lazily copy the array only when we have an actual change
            if (!newSessions) {
              newSessions = [...state.sessions];
            }
            newSessions[index] = merged;
            changed = true;
          }
        } else {
          // Add new session - lazily copy array if needed
          if (!newSessions) {
            newSessions = [...state.sessions];
          }
          newSessions.unshift(trimSnapshot({
            ...update,
            created_at: update.created_at || new Date().toISOString(),
            updated_at: update.updated_at || new Date().toISOString(),
            latest_snapshot: (update as SessionWithSnapshot).latest_snapshot ?? null,
          } as SessionWithSnapshot));
          changed = true;
        }
      }

      if (!changed || !newSessions) {
        return state;
      }

      return { sessions: newSessions };
    }),

}));
