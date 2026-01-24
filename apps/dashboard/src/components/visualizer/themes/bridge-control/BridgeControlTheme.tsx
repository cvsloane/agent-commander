'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useVisualizerStateStore } from '@/stores/visualizerState';
import { useUsageStore } from '@/stores/usage';
import { useWorkshopSessions } from '@/components/botspace/hooks/useWorkshopSessions';
import { useWorkshopEventStream } from '@/components/botspace/hooks/useWorkshopEventStream';
import type { WorkshopEvent } from '@/lib/workshop/types';
import { VisualizerApprovals } from '@/components/visualizer/shared/VisualizerApprovals';
import { VisualizerCommandBar } from '@/components/visualizer/shared/VisualizerCommandBar';
import {
  ActivityFeedSkeleton,
  MetricsSkeleton,
  PanelSkeleton,
  SessionListSkeleton,
} from '@/components/visualizer/shared/Skeletons';
import { NoSessionsState } from '@/components/visualizer/shared/EmptyState';
import { LCARSActivityFeed } from './LCARSActivityFeed';
import { LCARSSessionDetail } from './LCARSSessionDetail';
import { LCARSMetricsBar } from './LCARSMetricsBar';

type ViewMode = 'sessions' | 'activity' | 'metrics';

/**
 * BridgeControlTheme - LCARS-style control panel
 *
 * A Star Trek LCARS-inspired interface with distinctive orange/purple/blue
 * color scheme and characteristic rounded shapes.
 */
export function BridgeControlTheme() {
  const sessions = useWorkshopSessions();
  const { selectedSessionId, setSelectedSessionId } = useVisualizerStateStore();
  const sessionUsage = useUsageStore((state) => state.sessionUsage);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('sessions');
  const [isLoading, setIsLoading] = useState(true);
  const [events, setEvents] = useState<WorkshopEvent[]>([]);
  const [toolsUsed, setToolsUsed] = useState(0);
  const [filesModified, setFilesModified] = useState(0);
  const [sessionToolCounts, setSessionToolCounts] = useState<Record<string, number>>({});
  const [sessionFileCounts, setSessionFileCounts] = useState<Record<string, number>>({});
  const [totalEvents, setTotalEvents] = useState(0);

  const usageMap = useMemo(
    () => new Map(Object.entries(sessionUsage)),
    [sessionUsage]
  );

  // Update time every second for LCARS-style readout
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 300);
    return () => clearTimeout(timer);
  }, []);

  // Handle incoming events
  const handleEvent = useCallback((event: WorkshopEvent) => {
    setEvents((prev) => [...prev.slice(-100), event]);
    setTotalEvents((prev) => prev + 1);

    // Track tool usage
    if (event.type === 'post_tool_use') {
      setToolsUsed((prev) => prev + 1);
      if (event.sessionId) {
        setSessionToolCounts((prev) => ({
          ...prev,
          [event.sessionId]: (prev[event.sessionId] || 0) + 1,
        }));
      }

      // Track file modifications
      const tool = event.tool;
      if (tool === 'Write' || tool === 'Edit' || tool === 'NotebookEdit') {
        setFilesModified((prev) => prev + 1);
        if (event.sessionId) {
          setSessionFileCounts((prev) => ({
            ...prev,
            [event.sessionId]: (prev[event.sessionId] || 0) + 1,
          }));
        }
      }
    }
  }, []);

  // Subscribe to event stream
  useWorkshopEventStream(handleEvent);

  // Prune counters for sessions that no longer exist
  useEffect(() => {
    const sessionIds = new Set(sessions.map((s) => s.id));

    setSessionToolCounts((prev) => {
      const next: Record<string, number> = {};
      for (const id of Object.keys(prev)) {
        if (sessionIds.has(id)) next[id] = prev[id];
      }
      return next;
    });

    setSessionFileCounts((prev) => {
      const next: Record<string, number> = {};
      for (const id of Object.keys(prev)) {
        if (sessionIds.has(id)) next[id] = prev[id];
      }
      return next;
    });
  }, [sessions]);

  // Get selected session
  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId]
  );

  // Get session-specific stats
  const sessionToolsUsed = useMemo(() => {
    if (!selectedSessionId) return 0;
    return sessionToolCounts[selectedSessionId] || 0;
  }, [selectedSessionId, sessionToolCounts]);

  const sessionFilesModified = useMemo(() => {
    if (!selectedSessionId) return 0;
    return sessionFileCounts[selectedSessionId] || 0;
  }, [selectedSessionId, sessionFileCounts]);

  const formatStardate = () => {
    const year = currentTime.getFullYear();
    const dayOfYear = Math.floor(
      (currentTime.getTime() - new Date(year, 0, 0).getTime()) / 86400000
    );
    return `${year - 1000}.${dayOfYear.toString().padStart(3, '0')}`;
  };

  const getStatusClass = (status: string): string => {
    switch (status) {
      case 'RUNNING':
      case 'STARTING':
        return 'working';
      case 'WAITING_FOR_INPUT':
      case 'WAITING_FOR_APPROVAL':
        return 'waiting';
      case 'ERROR':
        return 'error';
      default:
        return 'idle';
    }
  };

  const getStatusLabel = (status: string): string => {
    switch (status) {
      case 'RUNNING':
        return 'running';
      case 'STARTING':
        return 'starting';
      case 'WAITING_FOR_INPUT':
        return 'waiting for input';
      case 'WAITING_FOR_APPROVAL':
        return 'waiting for approval';
      case 'ERROR':
        return 'error';
      case 'IDLE':
        return 'idle';
      default:
        return 'idle';
    }
  };

  return (
    <div className="lcars-theme-root">
      {/* Header bar */}
      <div className="lcars-header">
        <div className="lcars-header-elbow" />
        <div className="lcars-header-bar">
          <div className="lcars-header-segment orange">AGENT COMMAND</div>
          <div className="lcars-header-segment purple">SYSTEMS</div>
          <div className="lcars-header-segment blue">BRIDGE CONTROL</div>
          <div className="lcars-header-segment peach">STARDATE {formatStardate()}</div>
        </div>
      </div>

      <div className="lcars-body">
        {/* Sidebar */}
        <nav className="lcars-sidebar" role="tablist" aria-label="View mode selection">
          <button
            className={`lcars-sidebar-button ${viewMode === 'sessions' ? 'active' : ''}`}
            onClick={() => setViewMode('sessions')}
            role="tab"
            aria-selected={viewMode === 'sessions'}
            aria-controls="lcars-content-panel"
            tabIndex={viewMode === 'sessions' ? 0 : -1}
          >
            SESSIONS
          </button>
          <button
            className={`lcars-sidebar-button purple ${viewMode === 'activity' ? 'active' : ''}`}
            onClick={() => setViewMode('activity')}
            role="tab"
            aria-selected={viewMode === 'activity'}
            aria-controls="lcars-content-panel"
            tabIndex={viewMode === 'activity' ? 0 : -1}
          >
            ACTIVITY
          </button>
          <button
            className={`lcars-sidebar-button blue ${viewMode === 'metrics' ? 'active' : ''}`}
            onClick={() => setViewMode('metrics')}
            role="tab"
            aria-selected={viewMode === 'metrics'}
            aria-controls="lcars-content-panel"
            tabIndex={viewMode === 'metrics' ? 0 : -1}
          >
            METRICS
          </button>
          <div className="lcars-sidebar-spacer" />
          <div className="lcars-sidebar-stats">
            <div className="lcars-sidebar-stat">
              <span className="lcars-sidebar-stat-value">{sessions.length}</span>
              <span className="lcars-sidebar-stat-label">SESSIONS</span>
            </div>
            <div className="lcars-sidebar-stat">
              <span className="lcars-sidebar-stat-value">{toolsUsed}</span>
              <span className="lcars-sidebar-stat-label">TOOLS</span>
            </div>
          </div>
        </nav>

        {/* Main content */}
        <div className="lcars-main-content">
          {/* Metrics bar */}
          {isLoading ? (
            <div className="lcars-metrics-bar">
              <MetricsSkeleton count={5} />
            </div>
          ) : (
            <LCARSMetricsBar sessions={sessions} usage={usageMap} toolsUsed={toolsUsed} />
          )}

          {/* Content area */}
          <div className="lcars-content-area" id="lcars-content-panel" role="tabpanel" aria-label={`${viewMode} panel`}>
            {/* Left panel - changes based on view mode */}
            <div className="lcars-left-panel">
              {viewMode === 'sessions' && (
                isLoading ? (
                  <PanelSkeleton lines={5} />
                ) : (
                  <LCARSSessionDetail
                    session={selectedSession}
                    usage={selectedSessionId ? usageMap.get(selectedSessionId) : undefined}
                    toolsUsed={sessionToolsUsed}
                    filesModified={sessionFilesModified}
                  />
                )
              )}
              {viewMode === 'activity' && (
                isLoading ? (
                  <ActivityFeedSkeleton />
                ) : (
                  <LCARSActivityFeed events={events} maxEvents={30} />
                )
              )}
              {viewMode === 'metrics' && (
                isLoading ? (
                  <MetricsSkeleton count={3} />
                ) : (
                  <div className="lcars-metrics-panel">
                    <div className="lcars-panel-header">SYSTEM METRICS</div>
                    <div className="lcars-metrics-content">
                      <div className="lcars-big-metric">
                        <div className="lcars-big-metric-value lcars-data-readout">
                          {toolsUsed}
                        </div>
                        <div className="lcars-big-metric-label">TOTAL TOOL INVOCATIONS</div>
                      </div>
                      <div className="lcars-big-metric">
                        <div className="lcars-big-metric-value lcars-data-readout">
                          {filesModified}
                        </div>
                        <div className="lcars-big-metric-label">FILES MODIFIED</div>
                      </div>
                      <div className="lcars-big-metric">
                        <div className="lcars-big-metric-value lcars-data-readout">
                          {totalEvents}
                        </div>
                        <div className="lcars-big-metric-label">EVENTS PROCESSED</div>
                      </div>
                    </div>
                  </div>
                )
              )}
            </div>

            {/* Session pills */}
            <aside className="lcars-session-panel" aria-label="Session roster">
              <div className="lcars-panel-header" id="session-roster-heading">SESSION ROSTER</div>
              <div
                className="lcars-session-list"
                role={!isLoading && sessions.length > 0 ? 'listbox' : 'status'}
                aria-labelledby={!isLoading && sessions.length > 0 ? 'session-roster-heading' : undefined}
                aria-activedescendant={
                  !isLoading && sessions.length > 0 && selectedSessionId
                    ? `session-${selectedSessionId}`
                    : undefined
                }
              >
                {isLoading ? (
                  <SessionListSkeleton />
                ) : sessions.length === 0 ? (
                  <NoSessionsState />
                ) : (
                  sessions.map((session) => {
                    const statusClass = getStatusClass(session.status);
                    const statusLabel = getStatusLabel(session.status);
                    const sessionName = session.title || session.cwd?.split('/').pop() || 'UNKNOWN';
                    return (
                      <button
                        key={session.id}
                        id={`session-${session.id}`}
                        className={`lcars-session-pill ${
                          selectedSessionId === session.id ? 'selected' : ''
                        } ${statusClass}`}
                        onClick={() => setSelectedSessionId(session.id)}
                        role="option"
                        aria-selected={selectedSessionId === session.id}
                        aria-label={`${sessionName}, status: ${statusLabel}${session.metadata?.approval ? ', requires approval' : ''}`}
                      >
                        <span
                          className={`lcars-status-light ${statusClass}`}
                          aria-hidden="true"
                        />
                        <span className="lcars-session-name">
                          {sessionName}
                        </span>
                        {session.metadata?.approval && (
                          <span className="lcars-approval-indicator" aria-label="Requires approval">!</span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </aside>
          </div>

          {/* Prompt area */}
          <VisualizerCommandBar
            sessions={sessions}
            selectedSessionId={selectedSessionId}
            className="lcars-command-bar"
          />
        </div>
      </div>

      {/* Approvals */}
      <VisualizerApprovals sessions={sessions} />
    </div>
  );
}
