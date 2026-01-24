'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Bell, RefreshCw, Moon, ChevronDown, ChevronRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { ServerToUIMessage, Session, Approval } from '@agent-command/schema';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getSessions, getApprovals } from '@/lib/api';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useSessionIdle } from '@/hooks/useSessionIdle';
import { useOrchestratorStore } from '@/stores/orchestrator';
import { useOrchestratorSummaries } from '@/hooks/useOrchestratorSummaries';
import { OrchestratorItem } from './OrchestratorItem';

interface OrchestratorModalProps {
  className?: string;
}

export function OrchestratorModal({ className }: OrchestratorModalProps) {
  const attentionStatusFilter = 'WAITING_FOR_INPUT,WAITING_FOR_APPROVAL,ERROR';
  const modalRef = useRef<HTMLDivElement>(null);
  const [idleExpanded, setIdleExpanded] = useState(false);
  const {
    isOpen,
    close,
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
  const idledCount = idledItems.length;

  // Fetch initial sessions when modal opens
  const { refetch: refetchSessions } = useQuery({
    queryKey: ['orchestrator', 'sessions'],
    queryFn: async () => {
      const data = await getSessions({ include_archived: false, status: attentionStatusFilter });
      ingestSessions(data.sessions as any, { fullSync: true });
      return data;
    },
    enabled: isOpen,
    refetchInterval: isOpen ? 10000 : false, // Refetch every 10s when open
  });

  // Fetch pending approvals when modal opens
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
    enabled: isOpen,
  });

  const { summariesEnabled } = useOrchestratorSummaries(activeItems, isOpen);

  // WebSocket subscriptions when modal is open
  const handleWebSocketMessage = useCallback(
    (message: ServerToUIMessage) => {
      if (!isOpen) return;

      switch (message.type) {
        case 'sessions.changed': {
          const payload = message.payload as { sessions: Session[] };
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
    [isOpen, ingestSessions, ingestSnapshot, ingestApproval, removeApprovalItem]
  );

  useWebSocket(
    isOpen
      ? [
          { type: 'sessions', filter: { status: attentionStatusFilter } },
          { type: 'snapshots' },
          { type: 'approvals', filter: { status: 'pending' } },
        ]
      : [],
    handleWebSocketMessage
  );

  // Handle escape key and focus trap
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, close]);

  // Focus trap
  useEffect(() => {
    if (!isOpen || !modalRef.current) return;

    const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement?.focus();
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement?.focus();
      }
    };

    document.addEventListener('keydown', handleTabKey);

    // Focus first element on open
    setTimeout(() => firstElement?.focus(), 0);

    return () => document.removeEventListener('keydown', handleTabKey);
  }, [isOpen]);

  const handleRefresh = useCallback(() => {
    refetchSessions();
    refetchApprovals();
  }, [refetchSessions, refetchApprovals]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/50 transition-opacity"
        onClick={close}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="orchestrator-title"
        className={cn(
          'fixed right-4 top-16 z-50 w-full max-w-md',
          'bg-background rounded-lg border shadow-xl',
          'animate-in slide-in-from-top-2 fade-in-0 duration-200',
          className
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            <h2 id="orchestrator-title" className="font-semibold">
              Orchestrator
            </h2>
            {activeItems.length > 0 && (
              <span className="text-xs bg-orange-500 text-white px-1.5 py-0.5 rounded-full">
                {activeItems.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleRefresh}
              title="Refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={close}
              title="Close (Esc)"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="max-h-[60vh] overflow-y-auto p-3 space-y-2">
          {activeItems.length === 0 && idledItems.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Bell className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No sessions need your attention</p>
              <p className="text-xs mt-1">
                Items will appear when sessions require input or approval
              </p>
            </div>
          ) : (
            <>
              {activeItems.length === 0 && idledItems.length > 0 && (
                <div className="text-center py-4 text-muted-foreground">
                  <p className="text-sm">All items are idled</p>
                </div>
              )}
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

              {/* Idle section */}
              {idledItems.length > 0 && (
                <div className="border-t mt-3 pt-3">
                  <button
                    onClick={() => setIdleExpanded(!idleExpanded)}
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full"
                  >
                    {idleExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    <Moon className="h-4 w-4" />
                    <span>Idle ({idledCount})</span>
                  </button>
                  {idleExpanded && (
                    <div className="mt-2 space-y-2">
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
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t text-xs text-muted-foreground text-center">
          Press <kbd className="px-1.5 py-0.5 bg-muted rounded">Shift+O</kbd> to toggle
        </div>
      </div>
    </>
  );
}
