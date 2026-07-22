import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from '@agent-command/schema';
import {
  TerminalAttentionOverlayCard,
  shouldShowTerminalAttention,
} from '@/components/orchestrator/TerminalAttentionOverlay';
import { type OrchestratorItem, useOrchestratorStore } from '@/stores/orchestrator';
import { PromptComposer } from './PromptComposer';

const terminalSession: Session = {
  id: '00000000-0000-4000-8000-000000000001',
  host_id: '11111111-1111-4111-8111-111111111111',
  user_id: null,
  repo_id: null,
  kind: 'tmux_pane',
  provider: 'codex',
  status: 'WAITING_FOR_INPUT',
  role: 'standalone',
  title: 'Read-only builder',
  cwd: '/repo',
  repo_root: '/repo',
  git_remote: null,
  git_branch: 'main',
  tmux_pane_id: '%1',
  tmux_target: 'agents:0.0',
  metadata: {},
  created_at: '2026-07-20T12:00:00.000Z',
  updated_at: '2026-07-20T12:00:00.000Z',
  last_activity_at: '2026-07-20T12:00:00.000Z',
  idled_at: null,
  group_id: null,
  forked_from: null,
  fork_depth: 0,
  archived_at: null,
};

const approvalItem: OrchestratorItem = {
  id: 'approval-1',
  sessionId: terminalSession.id,
  sessionTitle: terminalSession.title ?? null,
  sessionCwd: terminalSession.cwd ?? null,
  sessionProvider: terminalSession.provider,
  sessionHostId: terminalSession.host_id,
  sessionStatus: 'WAITING_FOR_APPROVAL',
  source: 'approval',
  action: {
    type: 'yes_no',
    question: 'Allow the verification command?',
    options: [
      { value: 'allow', label: 'Approve' },
      { value: 'deny', label: 'Deny' },
    ],
    context: '',
    confidence: 1,
  },
  approval: {
    id: '00000000-0000-4000-8000-000000000002',
    session_id: terminalSession.id,
    provider: 'codex',
    ts_requested: '2026-07-20T12:00:00.000Z',
    requested_payload: { tool: 'Bash', command: 'pnpm test:ci' },
    decision: null,
    ts_decided: null,
  },
  approvalType: 'binary',
  createdAt: Date.parse('2026-07-20T12:00:00.000Z'),
};

const staleWaitingErrorItem: OrchestratorItem = {
  ...approvalItem,
  id: 'error-1',
  source: 'status',
  sessionStatus: 'WAITING_FOR_INPUT',
  attentionReason: 'waiting_input',
  approval: undefined,
  approvalType: undefined,
  action: {
    type: 'error',
    question: 'Deployment failed',
    options: [],
    context: '',
    confidence: 1,
  },
};

function buttonMarkup(markup: string, label: string): string {
  return (markup.match(/<button[\s\S]*?<\/button>/g) ?? [])
    .find((button) => button.includes(label)) ?? '';
}

describe('read-only terminal input surfaces', () => {
  afterEach(() => useOrchestratorStore.setState({ items: [] }));

  it('disables the collapsed prompt composer with a take-control hint', () => {
    const markup = renderToStaticMarkup(createElement(PromptComposer, {
      session: terminalSession,
      readOnly: true,
    }));

    expect(markup).toContain('disabled=""');
    expect(markup).toContain('Read-only — take control to type');
  });

  it('disables overlay Respond while leaving approval decisions enabled', () => {
    const markup = renderToStaticMarkup(createElement(TerminalAttentionOverlayCard, {
      item: approvalItem,
      onDismiss: () => undefined,
      readOnly: true,
    }));

    expect(buttonMarkup(markup, 'Respond')).toContain(' disabled=""');
    expect(buttonMarkup(markup, 'Approve')).not.toContain(' disabled=""');
    expect(buttonMarkup(markup, 'Deny')).not.toContain(' disabled=""');
    expect(markup).toContain('Read-only — take control to type');
  });

  it('keeps explicit errors visible when waiting-input metadata is stale', () => {
    expect(shouldShowTerminalAttention(
      staleWaitingErrorItem,
      terminalSession.id
    )).toBe(true);
  });
});
