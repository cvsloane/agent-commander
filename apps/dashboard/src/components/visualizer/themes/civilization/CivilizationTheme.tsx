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
  HexMapSkeleton,
  MetricsSkeleton,
  PanelSkeleton,
  TerritoryListSkeleton,
} from '@/components/visualizer/shared/Skeletons';
import { CivTopBar } from './CivTopBar';
import { CivMapScene } from './CivMapScene';
import { CivTerritoryList } from './CivTerritoryList';
import { CivAdvisorPanel } from './CivAdvisorPanel';
import { CivNotificationStack } from './CivNotificationStack';
import { CivMinimap } from './CivMinimap';

/**
 * CivilizationTheme - "Empire View"
 *
 * A strategic map-style visualization with territories representing sessions.
 * Gold/bronze aesthetic inspired by Civilization VI.
 */
export function CivilizationTheme() {
  const sessions = useWorkshopSessions();
  const { selectedSessionId, setSelectedSessionId } = useVisualizerStateStore();
  const sessionUsage = useUsageStore((state) => state.sessionUsage);
  const [isLoading, setIsLoading] = useState(true);
  const [events, setEvents] = useState<WorkshopEvent[]>([]);
  const [toolsUsed, setToolsUsed] = useState(0);

  const usageMap = useMemo(
    () => new Map(Object.entries(sessionUsage)),
    [sessionUsage]
  );

  // Handle incoming events
  const handleEvent = useCallback((event: WorkshopEvent) => {
    setEvents((prev) => [...prev.slice(-50), event]); // Keep last 50 events

    // Track tool usage
    if (event.type === 'post_tool_use') {
      setToolsUsed((prev) => prev + 1);
    }
  }, []);

  // Subscribe to event stream
  useWorkshopEventStream(handleEvent);

  // Get selected session
  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId]
  );

  // Get latest event for selected session
  const latestEvent = useMemo(() => {
    if (!selectedSessionId) return null;
    return events.filter((e) => e.sessionId === selectedSessionId).pop() ?? null;
  }, [events, selectedSessionId]);

  // Initial loading
  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 300);
    return () => clearTimeout(timer);
  }, []);

  if (isLoading) {
    return (
      <div className="civ-theme-root">
        <div className="civ-top-bar">
          <MetricsSkeleton count={4} />
        </div>
        <div className="civ-main-area">
          <div className="civ-map-container">
            <HexMapSkeleton />
          </div>
          <div className="civ-sidebar">
            <TerritoryListSkeleton />
          </div>
        </div>
        <div className="civ-advisor-panel">
          <PanelSkeleton lines={3} />
        </div>
      </div>
    );
  }

  return (
    <div className="civ-theme-root">
      {/* Top bar - resource counters */}
      <CivTopBar sessions={sessions} usage={usageMap} toolsUsed={toolsUsed} />

      {/* Main content area */}
      <div className="civ-main-area">
        {/* Map container */}
        <div className="civ-map-container">
          <CivMapScene
            sessions={sessions}
            selectedSessionId={selectedSessionId}
            onSelectSession={setSelectedSessionId}
          />

          {/* Notification stack (overlaid on map) */}
          <CivNotificationStack events={events} maxNotifications={3} autoHideMs={5000} />

          {/* Minimap (corner overlay) */}
          <CivMinimap
            sessions={sessions}
            selectedSessionId={selectedSessionId}
            onSelectSession={setSelectedSessionId}
          />
        </div>

        {/* Sidebar - territory list */}
        <CivTerritoryList
          sessions={sessions}
          selectedSessionId={selectedSessionId}
          onSelectSession={setSelectedSessionId}
        />
      </div>

      {/* Advisor panel */}
      <CivAdvisorPanel session={selectedSession} latestEvent={latestEvent} />

      {/* Command bar */}
      <VisualizerCommandBar
        sessions={sessions}
        selectedSessionId={selectedSessionId}
        className="civ-command-bar"
      />

      {/* Approvals */}
      <VisualizerApprovals sessions={sessions} />
    </div>
  );
}
