import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { OrchestratorItem } from '@/stores/orchestrator';
import { AttentionItemActions } from './AttentionItemActions';

function item(overrides: Partial<OrchestratorItem> = {}): OrchestratorItem {
  return {
    id: 'status-1',
    sessionId: '00000000-0000-4000-8000-000000000001',
    sessionTitle: 'Builder',
    sessionCwd: '/repo',
    sessionProvider: 'codex',
    sessionStatus: 'WAITING_FOR_INPUT',
    source: 'status',
    action: {
      type: 'text_input',
      question: 'What next?',
      placeholder: 'Describe the next step',
      context: '',
      confidence: 1,
    },
    createdAt: Date.parse('2026-07-20T12:00:00.000Z'),
    ...overrides,
  };
}

const baseProps = {
  mode: 'action' as const,
  loading: false,
  success: false,
  onRespond: vi.fn().mockResolvedValue(true),
};

describe('attention item action renderers', () => {
  it('routes text, governance, and run items to their dedicated controls', () => {
    const textMarkup = renderToStaticMarkup(
      createElement(AttentionItemActions, { ...baseProps, item: item() })
    );
    const governanceMarkup = renderToStaticMarkup(
      createElement(AttentionItemActions, {
        ...baseProps,
        item: item({
          source: 'governance',
          governanceApproval: {
            id: '00000000-0000-4000-8000-000000000002',
            user_id: '00000000-0000-4000-8000-000000000005',
            automation_run_id: '00000000-0000-4000-8000-000000000003',
            automation_agent_id: '00000000-0000-4000-8000-000000000004',
            type: 'budget_override',
            status: 'pending',
            request_payload: {},
            requested_at: '2026-07-20T12:00:00.000Z',
            decided_at: null,
            decided_by_user_id: null,
            decision_payload: null,
          },
        }),
      })
    );
    const runMarkup = renderToStaticMarkup(
      createElement(AttentionItemActions, {
        ...baseProps,
        item: item({ source: 'run', sessionId: null, automationRunId: 'run-1' }),
      })
    );

    expect(textMarkup).toContain('Describe the next step');
    expect(governanceMarkup).toContain('Approve');
    expect(governanceMarkup).toContain('Deny');
    expect(runMarkup).toContain('Open automation');
  });
});
