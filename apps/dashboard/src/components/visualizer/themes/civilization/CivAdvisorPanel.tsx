'use client';

import { useMemo } from 'react';
import type { SessionWithSnapshot } from '@agent-command/schema';
import type { WorkshopEvent } from '@/lib/workshop/types';

interface CivAdvisorPanelProps {
  session: SessionWithSnapshot | null;
  latestEvent?: WorkshopEvent | null;
  onSelectSession?: () => void;
}

const ADVISOR_MESSAGES: Record<string, string[]> = {
  idle: [
    'Your agents await your command, leader.',
    'The empire is at peace. What shall we pursue?',
    'All territories report stable conditions.',
  ],
  working: [
    'Our agents are hard at work on your behalf.',
    'Progress is being made across the empire.',
    'The wheels of production turn steadily.',
  ],
  waiting: [
    'Your attention is required, leader.',
    'A decision awaits your wise counsel.',
    'The council seeks your guidance.',
  ],
  error: [
    'We have encountered difficulties, leader.',
    'A setback has occurred. Review recommended.',
    'Our agents report an obstacle.',
  ],
  no_session: [
    'Welcome, leader! Select a territory to begin.',
    'Your empire awaits. Choose a session to view.',
    'The map shows all your domains. Select one.',
  ],
};

export function CivAdvisorPanel({ session, latestEvent, onSelectSession }: CivAdvisorPanelProps) {
  const status = getAdvisorStatus(session);
  const message = useMemo(
    () => getAdvisorMessage(status, latestEvent),
    [status, latestEvent]
  );
  const portrait = getAdvisorPortrait(session?.provider);
  const advisorName = getAdvisorName(session?.provider);

  return (
    <div className="civ-advisor-panel">
      <div className="civ-advisor-header">
        <div className="civ-advisor-portrait">{portrait}</div>
        <div className="civ-advisor-title">
          <div className="civ-advisor-name">{advisorName}</div>
          <div className="civ-advisor-role">
            {session ? getAdvisorRole(session.status) : 'Science Advisor'}
          </div>
        </div>
      </div>
      <div className="civ-advisor-body">
        <p>{message}</p>
        {session && (
          <div className="civ-advisor-session-info">
            <div className="civ-advisor-session-name">
              {session.title || session.cwd?.split('/').pop() || 'Unknown Territory'}
            </div>
            {session.metadata?.git_status?.branch && (
              <div className="civ-advisor-git-info">
                <span className="civ-advisor-branch-icon">⎇</span>
                <span>{session.metadata.git_status.branch}</span>
              </div>
            )}
          </div>
        )}
        {!session && onSelectSession && (
          <button
            type="button"
            className="civ-advisor-action"
            onClick={onSelectSession}
          >
            View Empire Map
          </button>
        )}
      </div>
    </div>
  );
}

function getAdvisorStatus(session: SessionWithSnapshot | null): keyof typeof ADVISOR_MESSAGES {
  if (!session) return 'no_session';
  if (session.status === 'RUNNING' || session.status === 'STARTING') return 'working';
  if (session.status === 'WAITING_FOR_INPUT' || session.status === 'WAITING_FOR_APPROVAL') return 'waiting';
  if (session.status === 'ERROR') return 'error';
  return 'idle';
}

function getAdvisorMessage(status: keyof typeof ADVISOR_MESSAGES, event?: WorkshopEvent | null): string {
  // If there's a recent event, generate a contextual message
  if (event) {
    if (event.type === 'pre_tool_use') {
      return `Our agents are now using ${event.tool}...`;
    }
    if (event.type === 'post_tool_use') {
      return event.success
        ? `${event.tool} completed successfully.`
        : `${event.tool} encountered an issue.`;
    }
    if (event.type === 'user_prompt_submit') {
      return 'Your command has been received, leader.';
    }
  }

  // Otherwise, use a random message for the status
  const messages = ADVISOR_MESSAGES[status];
  return messages[Math.floor(Math.random() * messages.length)];
}

function getAdvisorPortrait(provider?: string | null): string {
  switch (provider) {
    case 'claude':
      return '🤖';
    case 'codex':
      return '🧠';
    case 'gemini':
      return '💎';
    default:
      return '📜';
  }
}

function getAdvisorName(provider?: string | null): string {
  switch (provider) {
    case 'claude':
      return 'Claude';
    case 'codex':
      return 'Codex';
    case 'gemini':
      return 'Gemini';
    default:
      return 'Advisor';
  }
}

function getAdvisorRole(status: string): string {
  switch (status) {
    case 'RUNNING':
    case 'STARTING':
      return 'Working';
    case 'WAITING_FOR_INPUT':
      return 'Awaiting Input';
    case 'WAITING_FOR_APPROVAL':
      return 'Needs Approval';
    case 'ERROR':
      return 'Error State';
    case 'IDLE':
      return 'Standing By';
    default:
      return 'Science Advisor';
  }
}
