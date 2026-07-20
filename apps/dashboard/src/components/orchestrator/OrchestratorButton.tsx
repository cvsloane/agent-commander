'use client';

import { useEffect, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';
import type {
  Approval,
  AutomationRun,
  GovernanceApproval,
  ServerToUIMessage,
  Session,
} from '@agent-command/schema';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  getApprovals,
  getAttentionAutomationRuns,
  getGovernanceApprovals,
  getSessions,
} from '@/lib/api';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useOrchestratorStore } from '@/stores/orchestrator';

/**
 * Orchestrator button for the header - shows badge and opens modal.
 * Also handles background session monitoring via WebSocket.
 */
export function OrchestratorButton() {
  const router = useRouter();
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const attentionStatusFilter = 'RUNNING,STARTING,WAITING_FOR_INPUT,WAITING_FOR_APPROVAL,ERROR,IDLE';
  const toggle = useOrchestratorStore((s) => s.toggle);
  const close = useOrchestratorStore((s) => s.close);
  const isOpen = useOrchestratorStore((s) => s.isOpen);
  const itemCount = useOrchestratorStore((s) => s.getItemCount());
  const ingestSessions = useOrchestratorStore((s) => s.ingestSessions);
  const ingestSnapshot = useOrchestratorStore((s) => s.ingestSnapshot);
  const ingestApproval = useOrchestratorStore((s) => s.ingestApproval);
  const removeApprovalItem = useOrchestratorStore((s) => s.removeApprovalItem);
  const pruneApprovals = useOrchestratorStore((s) => s.pruneApprovals);
  const ingestAttention = useOrchestratorStore((s) => s.ingestAttention);
  const ingestAutomationRuns = useOrchestratorStore((s) => s.ingestAutomationRuns);
  const ingestGovernanceApprovals = useOrchestratorStore((s) => s.ingestGovernanceApprovals);

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

      try {
        const data = await getAttentionAutomationRuns();
        if (cancelled) return;
        ingestAutomationRuns(data.runs, { fullSync: true });
      } catch {
        // Older control planes may not expose automation attention yet.
      }

      try {
        const data = await getGovernanceApprovals({ status: 'pending' });
        if (cancelled) return;
        ingestGovernanceApprovals(data.approvals, { fullSync: true });
      } catch {
        // Keep session attention available when governance is unavailable.
      }
    };

    seed();
    return () => {
      cancelled = true;
    };
  }, [
    ingestApproval,
    ingestAutomationRuns,
    ingestGovernanceApprovals,
    ingestSessions,
    pruneApprovals,
  ]);

  // Background WebSocket monitoring (always active for badge)
  const handleWebSocketMessage = useCallback(
    (message: ServerToUIMessage) => {
      const rawMessage = message as unknown as { type: string; payload: unknown };
      if (rawMessage.type === 'attention.changed') {
        const payload = rawMessage.payload as {
          session_id: string;
          attention_reason?: string | null;
          reason?: string | null;
          question?: string;
          confidence?: number;
          capture_hash?: string;
        };
        if (typeof payload.session_id !== 'string') return;
        ingestAttention(payload.session_id, {
          attentionReason: payload.attention_reason ?? payload.reason ?? null,
          question: payload.question,
          confidence: payload.confidence,
          captureHash: payload.capture_hash,
        });
        return;
      }

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

        case 'automation.run.updated':
          ingestAutomationRuns([message.payload as AutomationRun]);
          break;

        case 'governance_approval.updated':
          ingestGovernanceApprovals([message.payload as GovernanceApproval]);
          break;
      }
    },
    [
      ingestApproval,
      ingestAttention,
      ingestAutomationRuns,
      ingestGovernanceApprovals,
      ingestSessions,
      ingestSnapshot,
      removeApprovalItem,
    ]
  );

  // Always subscribe to sessions, snapshots, and approvals for badge count
  useWebSocket(
    [
      // Subscribe broadly so we can clear items when sessions leave attention statuses
      // (server-side filtering only emits sessions that currently match the filter).
      { type: 'sessions', filter: { include_archived: true } },
      { type: 'snapshots' },
      { type: 'approvals', filter: { status: 'pending' } },
      // Receive resolution/recovery transitions too, otherwise the badge can
      // keep counting stale governance and run items while the modal is closed.
      { type: 'governance_approvals' },
      { type: 'automation_runs' },
    ],
    handleWebSocketMessage,
    // Modal has its own subscriptions; disable this to avoid duplicate ingestion while open.
    !isOpen
  );
  useWebSocket(
    [{ type: 'attention' }],
    handleWebSocketMessage,
    !isOpen,
    'attention'
  );

  const openAttention = useCallback(() => {
    if (isMobile || pathname.startsWith('/orchestrator')) {
      close();
      router.push('/orchestrator?tab=attention');
      return;
    }
    toggle();
  }, [close, isMobile, pathname, router, toggle]);

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
        openAttention();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [openAttention]);

  return (
    <Button
      id="attention-bell"
      variant="ghost"
      size="icon"
      className={cn(
        'relative h-11 w-11',
        isOpen && 'bg-accent'
      )}
      onClick={openAttention}
      title="Attention (Shift+O)"
      aria-label={`Attention - ${itemCount} items need attention`}
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
