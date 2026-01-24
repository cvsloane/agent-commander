'use client';

import { useState, useCallback } from 'react';
import { Bell, RefreshCw, Moon, ChevronDown, ChevronRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { ServerToUIMessage, Session, Approval } from '@agent-command/schema';
import { Button } from '@/components/ui/button';
import { getSessions, getApprovals } from '@/lib/api';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useSessionIdle } from '@/hooks/useSessionIdle';
import { useOrchestratorStore } from '@/stores/orchestrator';
import { OrchestratorItem } from '@/components/orchestrator/OrchestratorItem';
import { useOrchestratorSummaries } from '@/hooks/useOrchestratorSummaries';

export default function OrchestratorPageClient() {
  const attentionStatusFilter = 'WAITING_FOR_INPUT,WAITING_FOR_APPROVAL,ERROR';
  const [idleExpanded, setIdleExpanded] = useState(false);
  const {
    ingestSessions,
    ingestSnapshot,
    ingestApproval,
    removeApprovalItem,
    pruneApprovals,
    dismissItem,
    getActiveItems,
    getIdledItems,
  } = useOrchestratorStore();
  const { setSessionIdle } = useSessionIdle();

  const handleIdle = useCallback(
    async (sessionId: string) => {
      try {
        await setSessionIdle(sessionId, true);
      } catch (error) {
        console.error('Failed to idle session:', error);
      }
    },
    [setSessionIdle]
  );

  const handleUnidle = useCallback(
    async (sessionId: string) => {
      try {
        await setSessionIdle(sessionId, false);
      } catch (error) {
        console.error('Failed to wake session:', error);
      }
    },
    [setSessionIdle]
  );

  const activeItems = getActiveItems();
  const idledItems = getIdledItems();

  // Fetch initial sessions
  const { refetch: refetchSessions } = useQuery({
    queryKey: ['orchestrator', 'sessions'],
    queryFn: async () => {
      const data = await getSessions({ include_archived: false, status: attentionStatusFilter });
      // Filter to sessions that might need attention
      ingestSessions(data.sessions as any, { fullSync: true });
      return data;
    },
    refetchInterval: 10000, // Refetch every 10s
  });

  // Fetch pending approvals
  const { refetch: refetchApprovals } = useQuery({
    queryKey: ['orchestrator', 'approvals'],
    queryFn: async () => {
      const data = await getApprovals({ status: 'pending' });
      for (const approval of data.approvals) {
        ingestApproval(approval);
      }
      pruneApprovals(data.approvals.map((approval) => approval.id));
      return data;
    },
  });

  const { summariesEnabled } = useOrchestratorSummaries(activeItems, true);

  // WebSocket subscriptions
  const handleWebSocketMessage = useCallback(
    (message: ServerToUIMessage) => {
      switch (message.type) {
        case 'sessions.changed': {
          const payload = message.payload as { sessions: Session[] };
          // Filter to attention-worthy sessions
          if (payload.sessions.length > 0) {
            ingestSessions(payload.sessions as any);
          }
          break;
        }

        case 'snapshots.updated': {
          const payload = message.payload as {
            session_id: string;
            capture_text: string;
            capture_hash?: string;
          };
          ingestSnapshot(payload.session_id, payload.capture_text, payload.capture_hash);
          break;
        }

        case 'approvals.created': {
          const payload = message.payload as {
            approval_id: string;
            session_id: string;
            provider: string;
            requested_payload: Record<string, unknown>;
          };
          const approval: Approval = {
            id: payload.approval_id,
            session_id: payload.session_id,
            provider: payload.provider as Approval['provider'],
            ts_requested: new Date().toISOString(),
            requested_payload: payload.requested_payload,
            decision: null,
            ts_decided: null,
          };
          ingestApproval(approval);
          break;
        }

        case 'approvals.updated': {
          const payload = message.payload as { approval_id: string };
          removeApprovalItem(payload.approval_id);
          break;
        }
      }
    },
    [ingestSessions, ingestSnapshot, ingestApproval, removeApprovalItem]
  );

  useWebSocket(
    [
      { type: 'sessions', filter: { status: attentionStatusFilter } },
      { type: 'snapshots' },
      { type: 'approvals', filter: { status: 'pending' } },
    ],
    handleWebSocketMessage
  );

  const handleRefresh = useCallback(() => {
    refetchSessions();
    refetchApprovals();
  }, [refetchSessions, refetchApprovals]);

  return (
    <div className="container mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Bell className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Orchestrator</h1>
          {activeItems.length > 0 && (
            <span className="text-sm bg-orange-500 text-white px-2 py-0.5 rounded-full">
              {activeItems.length} active
            </span>
          )}
        </div>
        <Button variant="outline" onClick={handleRefresh} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Empty state */}
      {activeItems.length === 0 && idledItems.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Bell className="h-16 w-16 mx-auto mb-4 opacity-30" />
          <p className="text-lg">No sessions need your attention</p>
          <p className="text-sm mt-2">
            Items will appear when sessions require input or approval
          </p>
        </div>
      )}

      {/* Active items grid */}
      {activeItems.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-4">
            Active Items ({activeItems.length})
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {activeItems.map((item) => (
              <OrchestratorItem
                key={item.id}
                item={item}
                onDismiss={dismissItem}
                onIdle={handleIdle}
                onUnidle={handleUnidle}
                onResponseSent={handleRefresh}
                summariesEnabled={summariesEnabled}
              />
            ))}
          </div>
        </section>
      )}

      {/* All items idled message */}
      {activeItems.length === 0 && idledItems.length > 0 && (
        <div className="text-center py-8 text-muted-foreground mb-4">
          <p className="text-sm">All items are idled</p>
        </div>
      )}

      {/* Idle items (collapsible) */}
      {idledItems.length > 0 && (
        <section className="border-t pt-6">
          <button
            onClick={() => setIdleExpanded(!idleExpanded)}
            className="flex items-center gap-2 text-lg font-semibold text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            {idleExpanded ? (
              <ChevronDown className="h-5 w-5" />
            ) : (
              <ChevronRight className="h-5 w-5" />
            )}
            <Moon className="h-5 w-5" />
            <span>Idle ({idledItems.length})</span>
          </button>
          {idleExpanded && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {idledItems.map((item) => (
                <OrchestratorItem
                  key={item.id}
                  item={item}
                  onDismiss={dismissItem}
                  onIdle={handleIdle}
                  onUnidle={handleUnidle}
                  onResponseSent={handleRefresh}
                  summariesEnabled={summariesEnabled}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
