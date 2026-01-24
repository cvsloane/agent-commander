'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Approval, ServerToUIMessage, SessionWithSnapshot } from '@agent-command/schema';
import { decideApproval, getApprovals } from '@/lib/api';
import { useWebSocket } from '@/hooks/useWebSocket';

interface VisualizerApprovalsProps {
  sessions: SessionWithSnapshot[];
}

export function VisualizerApprovals({ sessions }: VisualizerApprovalsProps) {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(false);
  const dismissedKey = 'visualizer-dismissed-approvals';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(dismissedKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setDismissed(new Set(parsed.filter((id) => typeof id === 'string')));
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  const persistDismissed = useCallback((next: Set<string>) => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(dismissedKey, JSON.stringify(Array.from(next)));
    } catch {
      // ignore storage errors
    }
  }, []);

  const refreshApprovals = useCallback(() => {
    getApprovals({ status: 'pending' })
      .then(({ approvals: pending }) => {
        setApprovals(pending.filter((item) => !dismissed.has(item.id)));
      })
      .catch(() => {});
  }, [dismissed]);

  useEffect(() => {
    refreshApprovals();
  }, [refreshApprovals]);

  const handleMessage = useCallback(
    (message: ServerToUIMessage) => {
      if (message.type === 'approvals.created') {
        refreshApprovals();
        return;
      }
      if (message.type === 'approvals.updated') {
        const payload = message.payload as { approval_id: string };
        setApprovals((prev) => prev.filter((approval) => approval.id !== payload.approval_id));
        setDismissed((prev) => {
          if (!prev.has(payload.approval_id)) return prev;
          const next = new Set(prev);
          next.delete(payload.approval_id);
          persistDismissed(next);
          return next;
        });
      }
    },
    [persistDismissed, refreshApprovals]
  );

  useWebSocket([{ type: 'approvals' }], handleMessage);

  const pendingApprovals = approvals.filter((a) => !dismissed.has(a.id));

  const getSessionName = useCallback(
    (approval: Approval) => {
      const session = sessions.find((s) => s.id === approval.session_id);
      return session?.title || session?.cwd?.split('/').pop() || 'Session';
    },
    [sessions]
  );

  const handleDecision = useCallback(async (approvalId: string, decision: 'allow' | 'deny') => {
    try {
      await decideApproval(approvalId, { decision, mode: 'both' });
      setApprovals((prev) => prev.filter((item) => item.id !== approvalId));
    } catch {
      // Keep the approval in the list if the decision fails
    }
  }, []);

  const handleDismiss = useCallback(
    (approvalId: string) => {
      setApprovals((prev) => prev.filter((item) => item.id !== approvalId));
      setDismissed((prev) => {
        const next = new Set(prev);
        next.add(approvalId);
        persistDismissed(next);
        return next;
      });
    },
    [persistDismissed]
  );

  if (pendingApprovals.length === 0) return null;

  return (
    <div className="approval-indicator">
      <button
        type="button"
        className={`approval-badge ${expanded ? 'expanded' : ''}`}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="approval-badge-icon">⚠️</span>
        <span className="approval-badge-text">{pendingApprovals.length} pending</span>
        <span className="approval-badge-chevron">{expanded ? '▼' : '▲'}</span>
      </button>

      {expanded && (
        <div className="approval-panel">
          <div className="approval-panel-header">
            <span className="approval-panel-title">Pending Approvals</span>
            <button
              type="button"
              className="approval-panel-close"
              onClick={() => setExpanded(false)}
              aria-label="Close panel"
            >
              ×
            </button>
          </div>
          <div className="approval-panel-list">
            {pendingApprovals.map((approval) => (
              <ApprovalCard
                key={approval.id}
                approval={approval}
                sessionName={getSessionName(approval)}
                onAllow={() => handleDecision(approval.id, 'allow')}
                onDeny={() => handleDecision(approval.id, 'deny')}
                onDismiss={() => handleDismiss(approval.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ApprovalCard({
  approval,
  sessionName,
  onAllow,
  onDeny,
  onDismiss,
}: {
  approval: Approval;
  sessionName: string;
  onAllow: () => void;
  onDeny: () => void;
  onDismiss: () => void;
}) {
  const payload = approval.requested_payload as Record<string, unknown>;
  const reason = typeof payload.reason === 'string' ? payload.reason : '';
  const details = payload.details as Record<string, unknown> | undefined;
  const toolName =
    (typeof details?.tool === 'string' && details.tool) ||
    (typeof details?.tool_name === 'string' && details.tool_name) ||
    '';

  return (
    <div className="approval-card">
      <div className="approval-card-header">
        <span className="approval-card-session">{sessionName}</span>
        {toolName && <span className="approval-card-tool">{toolName}</span>}
      </div>
      {reason && <div className="approval-card-reason">{reason}</div>}
      <div className="approval-card-actions">
        <button type="button" className="approval-card-btn approval-card-btn--allow" onClick={onAllow}>
          Allow
        </button>
        <button type="button" className="approval-card-btn approval-card-btn--deny" onClick={onDeny}>
          Deny
        </button>
        <button
          type="button"
          className="approval-card-btn approval-card-btn--dismiss"
          onClick={onDismiss}
          title="Permanently hide this approval"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
