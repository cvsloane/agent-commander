'use client';

import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ServerToUIMessage, Session, SessionWithSnapshot, Host } from '@agent-command/schema';
import { getGroups, getHosts, getSessions, getSessionsTotal } from '@/lib/api';
import { useSessionStore } from '@/stores/session';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useSessionUsageStream } from '@/hooks/useSessionUsageStream';
import { markSessionListRender } from '@/lib/sessionsPerf';
import { SessionCard } from './SessionCard';
import { DraggableSessionCard } from './DraggableSessionCard';
import { Button } from '@/components/ui/button';

interface SessionListProps {
  filters?: {
    host_id?: string;
    status?: string;
    provider?: string;
    needs_attention?: boolean;
    q?: string;
    group_id?: string;
    ungrouped?: boolean;
    include_archived?: boolean;
    archived_only?: boolean;
  };
  workflowView?: boolean;
  selectionMode?: boolean;
  selectedIds?: Set<string>;
  onSelectSession?: (id: string, selected: boolean) => void;
  dragEnabled?: boolean;
  perfEnabled?: boolean;
  disableRealtime?: boolean;
  showSnapshotPreview?: boolean;
  page?: number;
  pageSize?: number;
  onTotalChange?: (total: number) => void;
}

type SessionMetadata = NonNullable<SessionWithSnapshot['metadata']>;
type GitStatus = SessionMetadata['git_status'];

const isGitStatusEqual = (a?: GitStatus, b?: GitStatus) => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    (a.ahead ?? 0) === (b.ahead ?? 0) &&
    (a.behind ?? 0) === (b.behind ?? 0) &&
    (a.staged ?? 0) === (b.staged ?? 0) &&
    (a.unstaged ?? 0) === (b.unstaged ?? 0) &&
    (a.untracked ?? 0) === (b.untracked ?? 0) &&
    (a.unmerged ?? 0) === (b.unmerged ?? 0) &&
    (a.upstream ?? '') === (b.upstream ?? '')
  );
};

const isMetadataEquivalent = (
  a?: SessionMetadata | null,
  b?: SessionMetadata | null
) => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    (a.status_detail ?? '') === (b.status_detail ?? '') &&
    (a.approval?.summary ?? '') === (b.approval?.summary ?? '') &&
    (a.approval?.reason ?? '') === (b.approval?.reason ?? '') &&
    (a.approval?.tool ?? '') === (b.approval?.tool ?? '') &&
    (a.tmux?.session_name ?? '') === (b.tmux?.session_name ?? '') &&
    (a.tmux?.window_name ?? '') === (b.tmux?.window_name ?? '') &&
    isGitStatusEqual(a.git_status, b.git_status)
  );
};

const getActivityBucket = (session: Session): string => {
  const activity = session.last_activity_at || session.updated_at;
  if (!activity) return 'none';
  const ts = new Date(activity).getTime();
  if (Number.isNaN(ts)) return 'none';
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return 'now';
  if (diffSec < 3600) return `m:${Math.floor(diffSec / 60)}`;
  if (diffSec < 86400) return `h:${Math.floor(diffSec / 3600)}`;
  return `d:${Math.floor(diffSec / 86400)}`;
};

export function SessionList({
  filters,
  workflowView = false,
  selectionMode = false,
  selectedIds = new Set(),
  onSelectSession,
  dragEnabled = false,
  perfEnabled = false,
  disableRealtime = false,
  showSnapshotPreview = true,
  page = 1,
  pageSize,
  onTotalChange,
}: SessionListProps) {
  markSessionListRender();
  const sessions = useSessionStore((state) => state.sessions);
  const setSessions = useSessionStore((state) => state.setSessions);
  const updateSessions = useSessionStore((state) => state.updateSessions);
  const perfCounters = useRef({ messages: 0, updated: 0, deleted: 0 });
  const pageSessionIdsRef = useRef<Set<string>>(new Set());
  const sessionsByIdRef = useRef<Map<string, SessionWithSnapshot>>(new Map());
  const pendingUpdatesRef = useRef<Map<string, Session>>(new Map());
  const pendingDeletesRef = useRef<Set<string>>(new Set());
  const flushTimerRef = useRef<number | null>(null);
  const flushDueAtRef = useRef<number | null>(null);
  const lastMetadataUpdateAtRef = useRef<Map<string, number>>(new Map());
  const totalRef = useRef<number | null>(null);
  const [hasNewSessions, setHasNewSessions] = useState(false);
  const paginated = typeof pageSize === 'number';
  const sessionIds = useMemo(() => sessions.map((session) => session.id), [sessions]);
  const sessionIdsKey = useMemo(() => sessionIds.join(','), [sessionIds]);

  const { data: groupsData } = useQuery({
    queryKey: ['groups'],
    queryFn: getGroups,
  });
  const groupNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of groupsData?.flat || []) {
      map.set(group.id, group.name);
    }
    return map;
  }, [groupsData]);

  const { data: hostsData } = useQuery({
    queryKey: ['hosts'],
    queryFn: getHosts,
  });
  const hostById = useMemo(() => {
    const map = new Map<string, Host>();
    for (const host of hostsData?.hosts || []) {
      map.set(host.id, host);
    }
    return map;
  }, [hostsData]);

  // Initial fetch
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['sessions', filters, page, pageSize],
    queryFn: () =>
      getSessions({
        ...filters,
        limit: pageSize,
        offset: pageSize ? (page - 1) * pageSize : undefined,
      }),
    refetchOnWindowFocus: false,
    refetchInterval: false,
  });
  const dataKey = useMemo(() => {
    if (!data?.sessions) return '';
    return `${data.sessions.length}|${data.sessions
      .map((session) => [
        session.id,
        session.status,
        session.updated_at || '',
        session.last_activity_at || '',
        session.archived_at || '',
        session.latest_snapshot?.created_at || '',
      ].join(':'))
      .join('|')}`;
  }, [data?.sessions]);
  const lastDataKeyRef = useRef<string>('');

  // Store fetched sessions
  useEffect(() => {
    if (data?.sessions) {
      if (dataKey && dataKey !== lastDataKeyRef.current) {
        lastDataKeyRef.current = dataKey;
        setSessions(data.sessions);
      }
      if (typeof data.total === 'number') {
        onTotalChange?.(data.total);
        totalRef.current = data.total;
      } else if (pageSize) {
        onTotalChange?.(data.sessions.length);
        totalRef.current = data.sessions.length;
      }
      setHasNewSessions(false);
    }
  }, [data, dataKey, onTotalChange, pageSize, setSessions]);

  useEffect(() => {
    if (!paginated) return;
    setHasNewSessions(false);
  }, [filters, page, pageSize, paginated]);

  useEffect(() => {
    pageSessionIdsRef.current = new Set(sessions.map((session) => session.id));
    sessionsByIdRef.current = new Map(sessions.map((session) => [session.id, session]));
  }, [sessions]);

  useEffect(() => {
    if (!paginated) return;
    let cancelled = false;
    const intervalId = window.setInterval(() => {
      getSessionsTotal(filters)
        .then((probe) => {
          if (cancelled) return;
          if (totalRef.current == null) {
            totalRef.current = probe.total;
            return;
          }
          if (probe.total > totalRef.current) {
            setHasNewSessions(true);
          }
        })
        .catch(() => {});
    }, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [paginated, filters]);

  const isActivityOnlyUpdate = useCallback((existing: SessionWithSnapshot | undefined, update: Session) => {
    if (!existing) return false;
    return (
      existing.id === update.id &&
      existing.host_id === update.host_id &&
      existing.kind === update.kind &&
      existing.provider === update.provider &&
      existing.status === update.status &&
      existing.title === update.title &&
      existing.cwd === update.cwd &&
      existing.repo_root === update.repo_root &&
      existing.git_remote === update.git_remote &&
      existing.git_branch === update.git_branch &&
      existing.tmux_pane_id === update.tmux_pane_id &&
      existing.tmux_target === update.tmux_target &&
      existing.created_at === update.created_at &&
      existing.idled_at === update.idled_at &&
      existing.group_id === update.group_id &&
      existing.forked_from === update.forked_from &&
      existing.fork_depth === update.fork_depth &&
      existing.archived_at === update.archived_at &&
      isMetadataEquivalent(existing.metadata ?? null, update.metadata ?? null)
    );
  }, []);

  const isMetadataOnlyUpdate = useCallback((existing: SessionWithSnapshot | undefined, update: Session) => {
    if (!existing) return false;
    return (
      existing.id === update.id &&
      existing.host_id === update.host_id &&
      existing.kind === update.kind &&
      existing.provider === update.provider &&
      existing.status === update.status &&
      existing.title === update.title &&
      existing.cwd === update.cwd &&
      existing.repo_root === update.repo_root &&
      existing.git_remote === update.git_remote &&
      existing.git_branch === update.git_branch &&
      existing.tmux_pane_id === update.tmux_pane_id &&
      existing.tmux_target === update.tmux_target &&
      existing.created_at === update.created_at &&
      existing.idled_at === update.idled_at &&
      existing.group_id === update.group_id &&
      existing.forked_from === update.forked_from &&
      existing.fork_depth === update.fork_depth &&
      existing.archived_at === update.archived_at &&
      // activity is allowed to change here
      !isMetadataEquivalent(existing.metadata ?? null, update.metadata ?? null)
    );
  }, []);

  const flushPendingUpdates = useCallback(() => {
    flushTimerRef.current = null;
    flushDueAtRef.current = null;
    if (pendingUpdatesRef.current.size === 0 && pendingDeletesRef.current.size === 0) return;
    const updates = Array.from(pendingUpdatesRef.current.values());
    const deleted = pendingDeletesRef.current.size > 0 ? Array.from(pendingDeletesRef.current) : undefined;
    pendingUpdatesRef.current.clear();
    pendingDeletesRef.current.clear();
    updateSessions(updates, deleted);
  }, [updateSessions]);

  const scheduleFlush = useCallback((delayMs: number) => {
    const dueAt = Date.now() + delayMs;
    if (flushTimerRef.current && flushDueAtRef.current && flushDueAtRef.current <= dueAt) {
      return;
    }
    if (flushTimerRef.current) {
      window.clearTimeout(flushTimerRef.current);
    }
    flushDueAtRef.current = dueAt;
    flushTimerRef.current = window.setTimeout(flushPendingUpdates, delayMs);
  }, [flushPendingUpdates]);

  const queueSessionUpdates = useCallback((updates: Session[], deleted?: string[]) => {
    let activityOnly = true;
    const currentIds = paginated ? pageSessionIdsRef.current : null;
    const now = Date.now();

    for (const update of updates) {
      if (currentIds && !currentIds.has(update.id)) continue;
      const existing = sessionsByIdRef.current.get(update.id);
      const isActivity = isActivityOnlyUpdate(existing, update);
      if (existing && isActivity) {
        const existingBucket = getActivityBucket(existing);
        const merged = { ...existing, ...update } as Session;
        const updateBucket = getActivityBucket(merged);
        if (existingBucket === updateBucket) {
          continue;
        }
      } else if (!isActivity) {
        activityOnly = false;
      }
      if (existing && isMetadataOnlyUpdate(existing, update)) {
        const lastMetadataUpdateAt = lastMetadataUpdateAtRef.current.get(update.id) ?? 0;
        if (now - lastMetadataUpdateAt < 10000) {
          continue;
        }
        lastMetadataUpdateAtRef.current.set(update.id, now);
      }
      pendingUpdatesRef.current.set(update.id, update);
    }

    if (deleted && deleted.length > 0) {
      activityOnly = false;
      for (const id of deleted) {
        if (currentIds && !currentIds.has(id)) continue;
        pendingDeletesRef.current.add(id);
        pendingUpdatesRef.current.delete(id);
        lastMetadataUpdateAtRef.current.delete(id);
      }
    }

    if (pendingUpdatesRef.current.size === 0 && pendingDeletesRef.current.size === 0) return;
    scheduleFlush(activityOnly ? 5000 : 200);
  }, [isActivityOnlyUpdate, isMetadataOnlyUpdate, paginated, scheduleFlush]);

  useEffect(() => {
    return () => {
      if (flushTimerRef.current) {
        window.clearTimeout(flushTimerRef.current);
      }
    };
  }, []);

  // Handle WebSocket messages
  const handleMessage = useCallback((message: ServerToUIMessage) => {
    if (message.type === 'sessions.changed') {
      const payload = message.payload as { sessions: Session[]; deleted?: string[] };
      let updates = payload.sessions;
      let deleted = payload.deleted;

      if (paginated) {
        const currentIds = pageSessionIdsRef.current;
        updates = updates.filter((session) => currentIds.has(session.id));
        if (deleted && deleted.length > 0) {
          deleted = deleted.filter((id) => currentIds.has(id));
        }
      }

      if (updates.length === 0 && (!deleted || deleted.length === 0)) {
        return;
      }

      if (perfEnabled) {
        perfCounters.current.messages += 1;
        perfCounters.current.updated += updates.length;
        perfCounters.current.deleted += deleted?.length || 0;
        let payloadBytes = 0;
        try {
          payloadBytes = JSON.stringify(updates).length;
        } catch {
          payloadBytes = 0;
        }
        let snapshotBytes = 0;
        let snapshotCount = 0;
        for (const session of updates) {
          const captureText = (session as SessionWithSnapshot).latest_snapshot?.capture_text;
          if (captureText) {
            snapshotCount += 1;
            snapshotBytes += captureText.length;
          }
        }
        console.log('[perf] sessions.payload', {
          updated: updates.length,
          payloadBytes,
          snapshotCount,
          snapshotBytes,
        });
      }

      queueSessionUpdates(updates, deleted);
    }
  }, [paginated, perfEnabled, queueSessionUpdates]);

  // Subscribe to session updates
  const wsTopics = useMemo(() => {
    if (paginated) {
      if (!sessionIdsKey) return [];
      return [{ type: 'sessions', filter: { session_ids: sessionIds } }];
    }
    return [{ type: 'sessions', filter: filters }];
  }, [filters, paginated, sessionIds, sessionIdsKey]);

  useWebSocket(
    wsTopics,
    handleMessage,
    !disableRealtime && wsTopics.length > 0
  );

  useEffect(() => {
    if (!perfEnabled) return;
    const id = window.setInterval(() => {
      const { messages, updated, deleted } = perfCounters.current;
      if (messages > 0) {
        console.log('[perf] sessions.ws', {
          messages,
          updated,
          deleted,
          totalSessions: sessions.length,
        });
      }
      perfCounters.current = { messages: 0, updated: 0, deleted: 0 };
    }, 5000);
    return () => window.clearInterval(id);
  }, [perfEnabled, sessions.length]);

  const filteredSessions = useMemo(() => {
    if (!filters || Object.keys(filters).length === 0) {
      return sessions;
    }

    const statusList = filters.status
      ? filters.status.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    return sessions.filter((session) => {
      if (filters.host_id && filters.host_id !== session.host_id) return false;
      if (statusList.length > 0 && !statusList.includes(session.status)) return false;
      if (filters.provider && filters.provider !== session.provider) return false;

      if (filters.group_id !== undefined) {
        if (session.group_id !== filters.group_id) return false;
      }
      if (filters.ungrouped) {
        if (session.group_id) return false;
      }

      if (filters.archived_only) {
        if (!session.archived_at) return false;
      } else if (!filters.include_archived) {
        if (session.archived_at) return false;
      }

      if (filters.needs_attention) {
        const needs = ['WAITING_FOR_INPUT', 'WAITING_FOR_APPROVAL', 'ERROR'].includes(
          session.status
        );
        if (!needs) return false;
      }

      if (filters.q) {
        const q = filters.q.toLowerCase();
        const hay = [
          session.title,
          session.cwd,
          session.repo_root,
          session.git_branch,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [sessions, filters]);

  const visibleSessionIds = useMemo(
    () => filteredSessions.map((session) => session.id),
    [filteredSessions]
  );

  useSessionUsageStream({
    sessionIds: visibleSessionIds,
    enabled: !disableRealtime,
    cooldownMs: 5000,
  });

  // Track previous values to detect changes for perf logging
  const prevSessionsRef = useRef(sessions);
  const prevFiltersRef = useRef(filters);

  // Log filter perf when sessions or filters change (but don't cause re-filter)
  useEffect(() => {
    if (!perfEnabled) return;
    if (prevSessionsRef.current !== sessions || prevFiltersRef.current !== filters) {
      // Sessions or filters changed, useMemo will re-run - measure next frame
      const start = performance.now();
      requestAnimationFrame(() => {
        const duration = performance.now() - start;
        if (duration > 8) {
          console.log('[perf] sessions.filter', {
            duration: Math.round(duration),
            total: sessions.length,
            result: filteredSessions.length,
          });
        }
      });
      prevSessionsRef.current = sessions;
      prevFiltersRef.current = filters;
    }
  }, [perfEnabled, sessions, filters, filteredSessions.length]);

  // Allow manual retry when errors occur

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return (
      <div className="text-center py-12">
        <p className="text-destructive mb-2">Failed to load sessions</p>
        <p className="text-xs text-muted-foreground mb-4">{errorMessage}</p>
        <Button onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  if (filteredSessions.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>No sessions found</p>
        {filters && Object.keys(filters).length > 0 && (
          <p className="text-sm mt-2">Try adjusting your filters</p>
        )}
      </div>
    );
  }

  const SessionCardComponent = dragEnabled ? DraggableSessionCard : SessionCard;

  const renderGrid = (sessionsToRender: SessionWithSnapshot[]) => (
    <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
      {sessionsToRender.map((session) => (
        <SessionCardComponent
          key={session.id}
          session={session}
          groupName={session.group_id ? groupNameById.get(session.group_id) : undefined}
          host={hostById.get(session.host_id)}
          selectionMode={selectionMode}
          isSelected={selectedIds.has(session.id)}
          onSelect={selectionMode ? onSelectSession : undefined}
          showSnapshotPreview={showSnapshotPreview}
        />
      ))}
    </div>
  );

  if (workflowView) {
    const isManualIdle = (session: SessionWithSnapshot) => !!session.idled_at;
    const isIdle = (session: SessionWithSnapshot) =>
      isManualIdle(session) || session.status === 'IDLE';
    const needsAttention = filteredSessions.filter(
      (session) =>
        !isIdle(session) &&
        ['WAITING_FOR_INPUT', 'WAITING_FOR_APPROVAL', 'ERROR'].includes(session.status)
    );
    const active = filteredSessions.filter(
      (session) =>
        !isIdle(session) && ['RUNNING', 'STARTING'].includes(session.status)
    );
    const idle = filteredSessions.filter((session) => isIdle(session));

    return (
      <div className="space-y-6">
        {hasNewSessions && (
          <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm">
            <span>New sessions available.</span>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Refresh
            </Button>
          </div>
        )}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Active</h3>
            <span className="text-xs text-muted-foreground">{active.length}</span>
          </div>
          {active.length > 0 ? (
            renderGrid(active)
          ) : (
            <div className="text-xs text-muted-foreground py-4">No active sessions</div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Needs Attention</h3>
            <span className="text-xs text-muted-foreground">{needsAttention.length}</span>
          </div>
          {needsAttention.length > 0 ? (
            renderGrid(needsAttention)
          ) : (
            <div className="text-xs text-muted-foreground py-4">No sessions need attention</div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Idle</h3>
            <span className="text-xs text-muted-foreground">{idle.length}</span>
          </div>
          {idle.length > 0 ? (
            renderGrid(idle)
          ) : (
            <div className="text-xs text-muted-foreground py-4">No idle sessions</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {hasNewSessions && (
        <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm mb-4">
          <span>New sessions available.</span>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Refresh
          </Button>
        </div>
      )}
      {renderGrid(filteredSessions)}
    </>
  );
}
