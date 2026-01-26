'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import type { ServerToUIMessage } from '@agent-command/schema';
import { GlobalSidebar } from './GlobalSidebar';
import { AttentionTitle } from './AttentionTitle';
import { GroupModal } from '@/components/groups/GroupModal';
import { NotificationContainer } from '@/components/notifications';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useSessionUsageStream } from '@/hooks/useSessionUsageStream';
import { useAttentionNotifications } from '@/hooks/useAttentionNotifications';
import { useAudioAlerts } from '@/hooks/useAudioAlerts';
import { useProviderUsageAlerts } from '@/hooks/useProviderUsageAlerts';
import { useNotifications } from '@/stores/notifications';
import { useUIStore } from '@/stores/ui';
import { useSettingsStore } from '@/stores/settings';
import { shouldTriggerAlertChannel } from '@/lib/alertPolicy';
import type { SessionGroup } from '@agent-command/schema';

interface GroupWithChildren extends SessionGroup {
  children: GroupWithChildren[];
  session_count: number;
}

interface LayoutShellProps {
  children: React.ReactNode;
}

export function LayoutShell({ children }: LayoutShellProps) {
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState<GroupWithChildren | null>(null);
  const notifications = useNotifications();
  const updateRecentSessionStatus = useUIStore((state) => state.updateRecentSessionStatus);
  const alertSettings = useSettingsStore((state) => state.alertSettings);
  const recentSessions = useUIStore((state) => state.recentSessions);
  const pathname = usePathname();
  const isSessionsRoute = pathname?.startsWith('/sessions');

  // Attention surface hooks - use orchestrator as source of truth
  useAttentionNotifications();
  useAudioAlerts();
  useProviderUsageAlerts();

  // Session usage stream (disabled on /sessions to avoid full firehose updates)
  useSessionUsageStream({
    enabled: !isSessionsRoute,
    subscribeAll: true,
    seed: true,
  });

  // WebSocket for real-time session updates (approvals now handled by Orchestrator)
  const recentSessionIds = useMemo(
    () => recentSessions.map((session) => session.id),
    [recentSessions]
  );
  const recentSessionIdSet = useMemo(
    () => new Set(recentSessionIds),
    [recentSessionIds]
  );

  const handleWebSocketMessage = useCallback((message: ServerToUIMessage) => {
    if (message.type === 'sessions.changed') {
      const payload = message.payload as {
        sessions: Array<{
          id: string;
          status: string;
          title?: string | null;
          cwd?: string | null;
        }>;
      };

      // Update recent session status + notify on errors
      for (const session of payload.sessions) {
        if (recentSessionIdSet.has(session.id)) {
          updateRecentSessionStatus(session.id, session.status);
        }
        if (session.status === 'ERROR') {
          const sessionName = session.title || session.cwd?.split('/').pop() || 'Session';
          const providerKey = (session as { provider?: string }).provider || 'unknown';
          const isFocused = typeof document !== 'undefined' ? document.hasFocus() : true;
          if (shouldTriggerAlertChannel(alertSettings, 'toast', 'error', providerKey, isFocused)) {
            notifications.error(
              'Session Error',
              `${sessionName} encountered an error`,
              { sessionId: session.id }
            );
          }
        }
      }
    }

  }, [alertSettings, notifications, recentSessionIdSet, updateRecentSessionStatus]);

  const wsTopics = useMemo(() => {
    const topics: Array<{ type: string; filter?: Record<string, unknown> }> = [
      { type: 'sessions', filter: { status: 'ERROR' } },
    ];
    if (recentSessionIds.length > 0) {
      topics.push({ type: 'sessions', filter: { session_ids: recentSessionIds } });
    }
    return topics;
  }, [recentSessionIds]);

  useWebSocket(
    wsTopics,
    handleWebSocketMessage
  );

  const handleCreateGroup = () => {
    setEditingGroup(null);
    setShowGroupModal(true);
  };

  const handleEditGroup = (group: GroupWithChildren) => {
    setEditingGroup(group);
    setShowGroupModal(true);
  };

  return (
    <div className="flex h-[calc(100vh-57px)]">
      {/* Attention surface: tab title with orchestrator count */}
      <AttentionTitle />

      {/* Desktop sidebar */}
      <GlobalSidebar
        onCreateGroup={handleCreateGroup}
        onEditGroup={handleEditGroup}
      />

      {/* Mobile sidebar overlay */}
      <GlobalSidebar
        onCreateGroup={handleCreateGroup}
        onEditGroup={handleEditGroup}
        isMobileOverlay
      />

      <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">{children}</main>

      {/* Group Modal - shared across all pages */}
      <GroupModal
        isOpen={showGroupModal}
        onClose={() => setShowGroupModal(false)}
        editGroup={editingGroup}
      />

      {/* Notification Toasts */}
      <NotificationContainer />
    </div>
  );
}
