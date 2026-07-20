import { beforeEach, describe, expect, it } from 'vitest';
import type { AutomationRun } from '@agent-command/schema';
import { useOrchestratorStore } from './orchestrator';

describe('unified orchestrator store', () => {
  beforeEach(() => {
    useOrchestratorStore.setState({
      items: [],
      sessionsById: {},
      runsById: {},
      lastHashBySession: {},
      lastDetectedAt: {},
      idledSessionsById: {},
    });
  });

  it('preserves a dismissed failed run across polling refreshes', () => {
    const run = {
      id: 'run-1',
      status: 'failed',
      objective: 'Verify the deployment',
      session_id: null,
      started_at: '2026-07-19T12:00:00.000Z',
      ended_at: '2026-07-19T12:05:00.000Z',
      result_summary: 'Smoke test failed',
    } as unknown as AutomationRun;

    const store = useOrchestratorStore.getState();
    store.ingestAutomationRuns([run]);
    store.dismissItem('run-run-1');
    store.ingestAutomationRuns([run]);

    expect(useOrchestratorStore.getState().items[0]?.dismissedAt).toEqual(expect.any(Number));
  });

  it('uses structured attention metadata and resets dismissal for a new capture', () => {
    const store = useOrchestratorStore.getState();
    store.ingestAttention('session-1', {
      attentionReason: 'yes_no',
      question: 'Deploy now?',
      confidence: 0.9,
      captureHash: 'capture-a',
    });

    let item = useOrchestratorStore.getState().items[0];
    expect(item?.action).toMatchObject({
      type: 'yes_no',
      question: 'Deploy now?',
      confidence: 0.9,
    });
    useOrchestratorStore.getState().dismissItem(item!.id);

    useOrchestratorStore.getState().ingestAttention('session-1', {
      attentionReason: 'yes_no',
      question: 'Deploy now?',
      confidence: 0.9,
      captureHash: 'capture-a',
    });
    expect(useOrchestratorStore.getState().items[0]?.dismissedAt).toEqual(expect.any(Number));

    useOrchestratorStore.getState().ingestAttention('session-1', {
      attentionReason: 'error',
      question: 'Deployment failed',
      confidence: 1,
      captureHash: 'capture-b',
    });
    item = useOrchestratorStore.getState().items[0];
    expect(item?.action).toMatchObject({ type: 'error', question: 'Deployment failed' });
    expect(item?.dismissedAt).toBeUndefined();
  });
});
