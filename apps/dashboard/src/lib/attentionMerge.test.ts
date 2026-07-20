import { describe, expect, it } from 'vitest';
import {
  assignAttentionToOrchestrators,
  mergeAttentionItems,
  type MergeableAttentionItem,
} from './attentionMerge';

function item(
  value: Partial<MergeableAttentionItem> & Pick<MergeableAttentionItem, 'id' | 'source'>
): MergeableAttentionItem {
  return {
    sessionId: null,
    sessionStatus: 'RUNNING',
    createdAt: 1,
    action: { type: 'needs_attention' },
    ...value,
  };
}

describe('attention merge logic', () => {
  it('builds one de-duplicated queue while preserving unrelated urgent work', () => {
    const queue = mergeAttentionItems([
      item({ id: 'status-a', source: 'status', sessionId: 'session-a' }),
      item({ id: 'snapshot-a', source: 'snapshot', sessionId: 'session-a' }),
      item({ id: 'approval-a', source: 'approval', sessionId: 'session-a' }),
      item({
        id: 'approval-a-2',
        source: 'approval',
        sessionId: 'session-a',
        createdAt: 2,
      }),
      item({
        id: 'server-b',
        source: 'status',
        sessionId: 'session-b',
        attentionReason: 'Waiting for operator input',
      }),
      item({ id: 'snapshot-b', source: 'snapshot', sessionId: 'session-b' }),
      item({
        id: 'blocked-run',
        source: 'run',
        automationRunId: 'run-1',
        sessionStatus: 'BLOCKED',
      }),
      item({
        id: 'governance',
        source: 'governance',
        governanceRunId: 'run-1',
        sessionStatus: 'WAITING_FOR_APPROVAL',
      }),
      item({
        id: 'failed-run',
        source: 'run',
        automationRunId: 'run-2',
        sessionStatus: 'ERROR',
        action: { type: 'error' },
      }),
    ], 60_001);

    expect(queue.map((entry) => entry.id)).toEqual([
      'governance',
      'approval-a',
      'approval-a-2',
      'failed-run',
      'server-b',
    ]);
  });

  it('assigns child-session and run-only attention to the owning orchestrator', () => {
    const childApproval = item({
      id: 'child-approval',
      source: 'approval',
      sessionId: 'worker-1',
    });
    const blockedRun = item({
      id: 'blocked-run',
      source: 'governance',
      governanceRunId: 'run-1',
    });
    const unrelated = item({ id: 'unrelated', source: 'status', sessionId: 'standalone' });

    const assigned = assignAttentionToOrchestrators(
      [childApproval, blockedRun, unrelated],
      [{ orchestratorId: 'orch-1', sessionIds: ['worker-1'] }],
      { 'run-1': 'worker-1' }
    );

    expect(assigned['orch-1']?.map((entry) => entry.id)).toEqual([
      'child-approval',
      'blocked-run',
    ]);
  });
});
