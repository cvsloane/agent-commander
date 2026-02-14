'use client';

import { useEffect, useCallback } from 'react';
import { Bell } from 'lucide-react';
import type { ServerToUIMessage, Session, Approval } from '@agent-command/schema';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getSessions, getApprovals } from '@/lib/api';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useOrchestratorStore } from '@/stores/orchestrator';

/**
 * Orchestrator button for the header - shows badge and opens modal.
 * Also handles background session monitoring via WebSocket.
 */
export function OrchestratorButton() {
  const attentionStatusFilter = 'WAITING_FOR_INPUT,WAITING_FOR_APPROVAL,ERROR';
  const toggle = useOrchestratorStore((s) => s.toggle);
  const isOpen = useOrchestratorStore((s) => s.isOpen);
  const itemCount = useOrchestratorStore((s) => s.getItemCount());
  const ingestSessions = useOrchestratorStore((s) => s.ingestSessions);
  const ingestSnapshot = useOrchestratorStore((s) => s.ingestSnapshot);
  const ingestApproval = useOrchestratorStore((s) => s.ingestApproval);
  const removeApprovalItem = useOrchestratorStore((s) => s.removeApprovalItem);
  const pruneApprovals = useOrchestratorStore((s) => s.pruneApprovals);

  // Seed initial counts (sessions + approvals)
  useEffect(() => {
    let cancelled = false;

    const seed = async () => {
      try {
        const data = await getSessions({ include_archived: false, status: attentionStatusFilter });
        if (cancelled) return;
        ingestSessions(data.sessions as any, { analyzeSnapshots: false, fullSync: true });
      } catch {
        // ignore seed errors
      }

      try {
        const data = await getApprovals({ status: 'pending' });
        if (cancelled) return;
        for (const approval of data.approvals) {
          ingestApproval(approval);
        }
        pruneApprovals(data.approvals.map((approval) => approval.id));
      } catch {
        // ignore seed errors
      }
    };

    seed();
    return () => {
      cancelled = true;
    };
  }, [ingestSessions, ingestApproval, pruneApprovals]);

  // Background WebSocket monitoring (always active for badge)
  const handleWebSocketMessage = useCallback(
    (message: ServerToUIMessage) => {
      switch (message.type) {
        case 'sessions.changed': {
          const payload = message.payload as { sessions: Session[] };
          // Only track status changes for badge (no snapshot analysis when modal closed)
          if (payload.sessions.length > 0) {
            ingestSessions(payload.sessions as any, { analyzeSnapshots: false });
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

  // Always subscribe to sessions, snapshots, and approvals for badge count
  useWebSocket(
    [
      // Subscribe broadly so we can clear items when sessions leave attention statuses
      // (server-side filtering only emits sessions that currently match the filter).
      { type: 'sessions', filter: { include_archived: true } },
      { type: 'snapshots' },
      { type: 'approvals', filter: { status: 'pending' } },
    ],
    handleWebSocketMessage,
    // Modal has its own subscriptions; disable this to avoid duplicate ingestion while open.
    !isOpen
  );

  // Shift+O keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in an input
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return;
      }

      // Shift+O to toggle orchestrator
      if (e.key === 'O' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        toggle();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [toggle]);

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        'relative h-9 w-9',
        isOpen && 'bg-accent'
      )}
      onClick={toggle}
      title="Orchestrator (Shift+O)"
      aria-label={`Orchestrator - ${itemCount} items need attention`}
    >
      <Bell className="h-5 w-5" />
      {itemCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-medium text-white">
          {itemCount > 9 ? '9+' : itemCount}
        </span>
      )}
    </Button>
  );
}
