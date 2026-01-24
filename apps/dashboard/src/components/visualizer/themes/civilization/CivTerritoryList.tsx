'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SessionWithSnapshot } from '@agent-command/schema';
import { NoTerritoriesState } from '@/components/visualizer/shared/EmptyState';

interface CivTerritoryListProps {
  sessions: SessionWithSnapshot[];
  selectedSessionId: string | null;
  onSelectSession: (id: string) => void;
}

export function CivTerritoryList({
  sessions,
  selectedSessionId,
  onSelectSession,
}: CivTerritoryListProps) {
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);

  const { working, waiting, idle, error, allSessions } = useMemo(() => {
    const workingSessions = sessions.filter(
      (s) => s.status === 'RUNNING' || s.status === 'STARTING'
    );
    const waitingSessions = sessions.filter(
      (s) => s.status === 'WAITING_FOR_INPUT' || s.status === 'WAITING_FOR_APPROVAL'
    );
    const idleSessions = sessions.filter(
      (s) => s.status === 'IDLE' || s.status === 'DONE'
    );
    const errorSessions = sessions.filter((s) => s.status === 'ERROR');

    return {
      working: workingSessions,
      waiting: waitingSessions,
      idle: idleSessions,
      error: errorSessions,
      allSessions: [...errorSessions, ...waitingSessions, ...workingSessions, ...idleSessions],
    };
  }, [sessions]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (allSessions.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex((prev) => Math.min(prev + 1, allSessions.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(prev - 1, 0));
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < allSessions.length) {
          onSelectSession(allSessions[focusedIndex].id);
        }
        break;
      case 'Home':
        e.preventDefault();
        setFocusedIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setFocusedIndex(allSessions.length - 1);
        break;
    }
  }, [allSessions, focusedIndex, onSelectSession]);

  useEffect(() => {
    if (!selectedSessionId) return;
    const idx = allSessions.findIndex((session) => session.id === selectedSessionId);
    if (idx !== -1) {
      setFocusedIndex(idx);
    }
  }, [selectedSessionId, allSessions]);

  useEffect(() => {
    if (allSessions.length === 0) {
      if (focusedIndex !== -1) {
        setFocusedIndex(-1);
      }
      return;
    }

    if (focusedIndex === -1) {
      setFocusedIndex(0);
    } else if (focusedIndex >= allSessions.length) {
      setFocusedIndex(allSessions.length - 1);
    }
  }, [allSessions.length, focusedIndex]);

  if (sessions.length === 0) {
    return (
      <aside className="civ-sidebar" aria-label="Territory list">
        <div className="civ-sidebar-header">
          <h3 id="territory-heading">Territories</h3>
        </div>
        <div className="civ-territory-list" role="status">
          <NoTerritoriesState />
        </div>
      </aside>
    );
  }

  const focusedSessionId = focusedIndex >= 0 ? allSessions[focusedIndex]?.id : null;

  return (
    <aside className="civ-sidebar" aria-label="Territory list">
      <div className="civ-sidebar-header">
        <h3 id="territory-heading">Territories</h3>
        <span className="civ-territory-count" aria-label={`${sessions.length} territories`}>{sessions.length}</span>
      </div>
      <div
        className="civ-territory-list"
        role="listbox"
        aria-labelledby="territory-heading"
        aria-activedescendant={focusedSessionId ? `territory-${focusedSessionId}` : undefined}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (allSessions.length === 0) return;
          if (focusedIndex === -1) {
            const idx = selectedSessionId
              ? allSessions.findIndex((session) => session.id === selectedSessionId)
              : 0;
            setFocusedIndex(idx >= 0 ? idx : 0);
          }
        }}
      >
        {error.length > 0 && (
          <TerritoryGroup
            title="Needs Attention"
            sessions={error}
            selectedSessionId={selectedSessionId}
            onSelectSession={onSelectSession}
            focusedSessionId={focusedSessionId}
          />
        )}
        {waiting.length > 0 && (
          <TerritoryGroup
            title="Awaiting Orders"
            sessions={waiting}
            selectedSessionId={selectedSessionId}
            onSelectSession={onSelectSession}
            focusedSessionId={focusedSessionId}
          />
        )}
        {working.length > 0 && (
          <TerritoryGroup
            title="Active"
            sessions={working}
            selectedSessionId={selectedSessionId}
            onSelectSession={onSelectSession}
            focusedSessionId={focusedSessionId}
          />
        )}
        {idle.length > 0 && (
          <TerritoryGroup
            title="Standing By"
            sessions={idle}
            selectedSessionId={selectedSessionId}
            onSelectSession={onSelectSession}
            focusedSessionId={focusedSessionId}
          />
        )}
      </div>
    </aside>
  );
}

interface TerritoryGroupProps {
  title: string;
  sessions: SessionWithSnapshot[];
  selectedSessionId: string | null;
  onSelectSession: (id: string) => void;
  focusedSessionId: string | null;
}

function TerritoryGroup({
  title,
  sessions,
  selectedSessionId,
  onSelectSession,
  focusedSessionId,
}: TerritoryGroupProps) {
  return (
    <div className="civ-territory-group" role="group" aria-label={title}>
      <div className="civ-territory-group-title" aria-hidden="true">{title}</div>
      {sessions.map((session) => {
        const sessionName = session.title || session.cwd?.split('/').pop() || 'Unknown Territory';
        const isSelected = selectedSessionId === session.id;
        const isFocused = focusedSessionId === session.id;
        const statusLabel = formatStatus(session.status);

        return (
          <button
            key={session.id}
            id={`territory-${session.id}`}
            className={`civ-territory-card ${isSelected ? 'selected' : ''} ${isFocused ? 'focused' : ''}`}
            onClick={() => onSelectSession(session.id)}
            role="option"
            aria-selected={isSelected}
            aria-label={`${sessionName}, status: ${statusLabel}${session.metadata?.approval ? ', approval needed' : ''}`}
            tabIndex={-1}
          >
            <div className="civ-territory-icon" aria-hidden="true">{getTerritoryIcon(session.provider)}</div>
            <div className="civ-territory-info">
              <div className="civ-territory-name">
                {sessionName}
              </div>
              <div className="civ-territory-status">
                <span
                  className={`civ-territory-status-dot ${getStatusClass(session.status)}`}
                  aria-hidden="true"
                />
                <span>{statusLabel}</span>
              </div>
            </div>
            {session.metadata?.approval && (
              <div className="civ-territory-approval-flag" aria-label="Approval needed">
                🚩
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

function getTerritoryIcon(provider?: string | null): string {
  switch (provider) {
    case 'claude':
      return '🏰';
    case 'codex':
      return '🗼';
    case 'gemini':
      return '💎';
    default:
      return '🏛️';
  }
}

function getStatusClass(status: string): string {
  switch (status) {
    case 'RUNNING':
    case 'STARTING':
      return 'working';
    case 'WAITING_FOR_INPUT':
    case 'WAITING_FOR_APPROVAL':
      return 'waiting';
    case 'ERROR':
      return 'error';
    default:
      return 'idle';
  }
}

function formatStatus(status: string): string {
  return status.toLowerCase().replace(/_/g, ' ');
}
