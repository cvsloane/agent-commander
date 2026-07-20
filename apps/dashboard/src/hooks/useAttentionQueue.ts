'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  Approval,
  AutomationRun,
  GovernanceApproval,
  ServerToUIMessage,
  Session,
} from '@agent-command/schema';
import {
  getApprovals,
  getAttentionAutomationRuns,
  getGovernanceApprovals,
  getSessions,
} from '@/lib/api';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useSessionIdle } from '@/hooks/useSessionIdle';
import { useOrchestratorSummaries } from '@/hooks/useOrchestratorSummaries';
import { useOrchestratorStore } from '@/stores/orchestrator';
import { mergeAttentionItems } from '@/lib/attentionMerge';

const WORKFLOW_STATUSES = 'RUNNING,STARTING,WAITING_FOR_INPUT,WAITING_FOR_APPROVAL,ERROR,IDLE';

type AttentionChangedPayload = {
  session_id: string;
  attention_reason?: string | null;
  reason?: string | null;
  question?: string;
  confidence?: number;
  capture_hash?: string;
  session?: Session & { attention_reason?: string | null };
};

export function useAttentionQueue() {
  const rawItems = useOrchestratorStore((state) => state.items);
  const ingestSessions = useOrchestratorStore((state) => state.ingestSessions);
  const ingestSnapshot = useOrchestratorStore((state) => state.ingestSnapshot);
  const ingestApproval = useOrchestratorStore((state) => state.ingestApproval);
  const ingestAttention = useOrchestratorStore((state) => state.ingestAttention);
  const ingestAutomationRuns = useOrchestratorStore((state) => state.ingestAutomationRuns);
  const ingestGovernanceApprovals = useOrchestratorStore(
    (state) => state.ingestGovernanceApprovals
  );
  const removeApprovalItem = useOrchestratorStore((state) => state.removeApprovalItem);
  const pruneApprovals = useOrchestratorStore((state) => state.pruneApprovals);
  const dismissItem = useOrchestratorStore((state) => state.dismissItem);
  const { setSessionIdle } = useSessionIdle();

  const sessionsQuery = useQuery({
    queryKey: ['orchestrator', 'sessions'],
    queryFn: () => getSessions({ include_archived: false, status: WORKFLOW_STATUSES }),
    refetchInterval: 10_000,
  });
  const approvalsQuery = useQuery({
    queryKey: ['orchestrator', 'approvals'],
    queryFn: () => getApprovals({ status: 'pending' }),
    refetchInterval: 15_000,
  });
  const governanceQuery = useQuery({
    queryKey: ['orchestrator', 'governance-approvals'],
    queryFn: () => getGovernanceApprovals({ status: 'pending' }),
    refetchInterval: 15_000,
  });
  const runsQuery = useQuery({
    queryKey: ['orchestrator', 'attention-runs'],
    queryFn: getAttentionAutomationRuns,
    // The current API has no cursor, so fetch the complete two-status set at a
    // lower cadence. WebSocket transitions remain immediate.
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!sessionsQuery.data) return;
    ingestSessions(sessionsQuery.data.sessions, { fullSync: true });
  }, [ingestSessions, sessionsQuery.data]);

  useEffect(() => {
    if (!approvalsQuery.data) return;
    for (const approval of approvalsQuery.data.approvals) ingestApproval(approval);
    pruneApprovals(approvalsQuery.data.approvals.map((approval) => approval.id));
  }, [approvalsQuery.data, ingestApproval, pruneApprovals]);

  useEffect(() => {
    if (!runsQuery.data) return;
    ingestAutomationRuns(runsQuery.data.runs, { fullSync: true });
  }, [ingestAutomationRuns, runsQuery.data]);

  useEffect(() => {
    if (!governanceQuery.data) return;
    ingestGovernanceApprovals(governanceQuery.data.approvals, { fullSync: true });
  }, [governanceQuery.data, ingestGovernanceApprovals]);

  const handleWebSocketMessage = useCallback((message: ServerToUIMessage) => {
    const rawMessage = message as unknown as { type: string; payload: unknown };

    if (rawMessage.type === 'attention.changed') {
      const payload = rawMessage.payload as AttentionChangedPayload;
      if (typeof payload.session_id !== 'string') return;
      if (payload.session) ingestSessions([payload.session]);
      ingestAttention(payload.session_id, {
        attentionReason: payload.attention_reason ?? payload.reason ?? null,
        question: payload.question,
        confidence: payload.confidence,
        captureHash: payload.capture_hash,
      });
      return;
    }

    switch (message.type) {
      case 'sessions.changed':
        ingestSessions(
          (message.payload as { sessions: Array<Session & { attention_reason?: string | null }> }).sessions
        );
        break;
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
      case 'approvals.updated':
        removeApprovalItem((message.payload as { approval_id: string }).approval_id);
        break;
      case 'automation.run.updated':
        ingestAutomationRuns([message.payload as AutomationRun]);
        break;
      case 'governance_approval.updated':
        ingestGovernanceApprovals([message.payload as GovernanceApproval]);
        break;
    }
  }, [
    ingestApproval,
    ingestAttention,
    ingestAutomationRuns,
    ingestGovernanceApprovals,
    ingestSessions,
    ingestSnapshot,
    removeApprovalItem,
  ]);

  useWebSocket(
    [
      { type: 'sessions', filter: { status: WORKFLOW_STATUSES } },
      { type: 'snapshots' },
      { type: 'approvals', filter: { status: 'pending' } },
      // Subscribe to every transition so resolved approvals and recovered runs
      // are removed immediately instead of lingering until the next poll.
      { type: 'governance_approvals' },
      { type: 'automation_runs' },
    ],
    handleWebSocketMessage
  );
  // Keep the additive topic on its own connection. Older servers silently
  // reject an envelope containing an unknown topic, so isolation preserves
  // every established live subscription while still consuming Wave 3 events.
  useWebSocket([{ type: 'attention' }], handleWebSocketMessage, true, 'attention');

  const refresh = useCallback(async () => {
    await Promise.all([
      sessionsQuery.refetch(),
      approvalsQuery.refetch(),
      governanceQuery.refetch(),
      runsQuery.refetch(),
    ]);
  }, [approvalsQuery, governanceQuery, runsQuery, sessionsQuery]);

  const handleIdle = useCallback(async (sessionId: string) => {
    try {
      await setSessionIdle(sessionId, true);
    } catch (error) {
      console.error('Failed to idle session:', error);
    }
  }, [setSessionIdle]);
  const handleUnidle = useCallback(async (sessionId: string) => {
    try {
      await setSessionIdle(sessionId, false);
    } catch (error) {
      console.error('Failed to wake session:', error);
    }
  }, [setSessionIdle]);

  const items = useMemo(() => mergeAttentionItems(rawItems), [rawItems]);
  const idledItems = useMemo(
    () => rawItems
      .filter((item) => !item.dismissedAt && item.idledAt)
      .sort((left, right) => right.createdAt - left.createdAt),
    [rawItems]
  );
  const summaryState = useOrchestratorSummaries(items, true);
  const errors = [sessionsQuery.error, approvalsQuery.error, governanceQuery.error, runsQuery.error]
    .filter((error): error is Error => error instanceof Error);

  return {
    items,
    idledItems,
    errors,
    isLoading:
      items.length === 0 &&
      [sessionsQuery, approvalsQuery, governanceQuery, runsQuery].some((query) => query.isLoading),
    isRefreshing:
      sessionsQuery.isFetching ||
      approvalsQuery.isFetching ||
      governanceQuery.isFetching ||
      runsQuery.isFetching,
    refresh,
    dismissItem,
    handleIdle,
    handleUnidle,
    ...summaryState,
  };
}
