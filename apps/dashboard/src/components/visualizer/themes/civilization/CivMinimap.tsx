'use client';

import { useMemo } from 'react';
import type { SessionWithSnapshot } from '@agent-command/schema';

interface CivMinimapProps {
  sessions: SessionWithSnapshot[];
  selectedSessionId: string | null;
  onSelectSession: (id: string) => void;
}

export function CivMinimap({ sessions, selectedSessionId, onSelectSession }: CivMinimapProps) {
  const orderedSessions = useMemo(
    () => [...sessions].sort((a, b) => a.id.localeCompare(b.id)),
    [sessions]
  );
  // Generate positions for sessions in a grid pattern
  const positions = generatePositions(orderedSessions.length);

  return (
    <div className="civ-minimap">
      <svg viewBox="0 0 200 150" preserveAspectRatio="xMidYMid meet">
        {/* Background grid pattern */}
        <defs>
          <pattern id="civ-minimap-grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path
              d="M 20 0 L 0 0 0 20"
              fill="none"
              stroke="var(--viz-border-subtle)"
              strokeWidth="0.5"
            />
          </pattern>
        </defs>
        <rect width="200" height="150" fill="url(#civ-minimap-grid)" />

        {/* Session dots */}
        {orderedSessions.map((session, index) => {
          const pos = positions[index];
          const isSelected = session.id === selectedSessionId;
          const status = getStatusClass(session.status);

          return (
            <g
              key={session.id}
              className="civ-minimap-session"
              onClick={() => onSelectSession(session.id)}
              style={{ cursor: 'pointer' }}
            >
              {/* Selection ring */}
              {isSelected && (
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={12}
                  fill="none"
                  stroke="var(--viz-accent-primary)"
                  strokeWidth="2"
                  className="civ-minimap-selection"
                />
              )}
              {/* Session marker */}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={8}
                fill={`var(--viz-status-${status})`}
                className={`civ-minimap-marker ${status === 'working' ? 'civ-minimap-marker--pulse' : ''}`}
              />
              {/* Territory border hint */}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={16}
                fill="none"
                stroke="var(--viz-border-subtle)"
                strokeWidth="1"
                strokeDasharray="4 2"
              />
            </g>
          );
        })}

        {/* Viewport indicator (could track actual map view) */}
        <rect
          x="60"
          y="40"
          width="80"
          height="70"
          fill="none"
          stroke="var(--viz-accent-primary)"
          strokeWidth="1"
          className="civ-minimap-viewport"
        />
      </svg>
    </div>
  );
}

function generatePositions(count: number): Array<{ x: number; y: number }> {
  const positions: Array<{ x: number; y: number }> = [];
  if (count <= 0) return positions;
  const cols = Math.ceil(Math.sqrt(count));
  const cellWidth = 200 / (cols + 1);
  const cellHeight = 150 / (Math.ceil(count / cols) + 1);

  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    positions.push({
      x: cellWidth * (col + 1),
      y: cellHeight * (row + 1),
    });
  }

  return positions;
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
