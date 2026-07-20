import { describe, expect, it } from 'vitest';
import {
  AutomationRunReportRequestSchema,
  GovernanceApprovalDecisionRequestSchema,
  OrchestratorMemoryWriteRequestSchema,
  OrchestratorSpawnWorkerRequestSchema,
} from '../src/index.js';

describe('orchestrator API contracts', () => {
  it('accepts a cross-host worker spawn and defaults no unsafe fields', () => {
    expect(OrchestratorSpawnWorkerRequestSchema.parse({
      host_id: '11111111-1111-4111-8111-111111111111',
      provider: 'codex',
      working_directory: '/workspace/repo',
      prompt: 'Implement the scoped task',
    })).toMatchObject({ provider: 'codex', prompt: 'Implement the scoped task' });
  });

  it('normalizes a minimal structured completion report', () => {
    expect(AutomationRunReportRequestSchema.parse({
      outcome: 'succeeded',
      summary: '  All checks pass  ',
    })).toEqual({
      outcome: 'succeeded',
      summary: 'All checks pass',
      evidence_refs: [],
      suggested_followups: [],
      candidate_memory_promotions: [],
    });
  });

  it('accepts governance budget grace and host pin overrides', () => {
    expect(GovernanceApprovalDecisionRequestSchema.parse({
      decision: 'approved',
      decision_payload: {
        budget_grace_cents: 500,
        host_id: '22222222-2222-4222-8222-222222222222',
      },
    }).decision_payload).toMatchObject({
      budget_grace_cents: 500,
      host_id: '22222222-2222-4222-8222-222222222222',
    });
  });

  it('requires the route to supply memory session and repo scope', () => {
    const parsed = OrchestratorMemoryWriteRequestSchema.parse({
      scope_type: 'working',
      tier: 'working',
      summary: 'Current task state',
      content: 'Tests are running.',
    });
    expect(parsed).not.toHaveProperty('session_id');
    expect(parsed).not.toHaveProperty('repo_id');
  });
});
