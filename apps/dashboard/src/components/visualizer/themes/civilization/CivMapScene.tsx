'use client';

import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import type { SessionWithSnapshot } from '@agent-command/schema';

interface CivMapSceneProps {
  sessions: SessionWithSnapshot[];
  selectedSessionId: string | null;
  onSelectSession: (id: string) => void;
}

// Hex dimensions
const HEX_SIZE = 40;
const HEX_WIDTH = HEX_SIZE * 2;
const HEX_HEIGHT = Math.sqrt(3) * HEX_SIZE;
const GRID_COLS = 12;
const GRID_ROWS = 8;

// Hex coordinates helpers (axial system with odd-q offset)
interface HexCoord {
  q: number;
  r: number;
}

function getOffsetR(q: number, r: number): number {
  return r + (q % 2 === 1 ? 0.5 : 0);
}

function hexToPixel(hex: HexCoord): { x: number; y: number } {
  const x = HEX_SIZE * (3 / 2) * hex.q;
  const y = HEX_SIZE * (Math.sqrt(3) / 2 * hex.q + Math.sqrt(3) * hex.r);
  return { x, y };
}

function getHexCorners(center: { x: number; y: number }, size: number): string {
  const corners: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    const x = center.x + size * Math.cos(angle);
    const y = center.y + size * Math.sin(angle);
    corners.push(`${x},${y}`);
  }
  return corners.join(' ');
}

export function CivMapScene({ sessions, selectedSessionId, onSelectSession }: CivMapSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, width: 800, height: 600 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [focusedSessionIndex, setFocusedSessionIndex] = useState<number>(-1);

  const orderedSessions = useMemo(
    () => [...sessions].sort((a, b) => a.id.localeCompare(b.id)),
    [sessions]
  );

  // Generate hex grid
  const hexGrid = useMemo(() => {
    const hexes: Array<HexCoord & { terrain: string }> = [];
    for (let q = 0; q < GRID_COLS; q++) {
      for (let r = 0; r < GRID_ROWS; r++) {
        // Offset for odd columns
        hexes.push({
          q,
          r: getOffsetR(q, r),
          terrain: getTerrainType(q, r),
        });
      }
    }
    return hexes;
  }, []);

  const orderedHexes = useMemo(() => {
    if (hexGrid.length === 0) return [] as HexCoord[];
    const centerQ = Math.floor(GRID_COLS / 2);
    const centerR = getOffsetR(centerQ, Math.floor(GRID_ROWS / 2));
    const center = { q: centerQ, r: centerR };
    return hexGrid
      .map(({ q, r }) => ({ q, r }))
      .sort((a, b) => {
        const distA = hexDistance(a, center);
        const distB = hexDistance(b, center);
        if (distA !== distB) return distA - distB;
        const angleA = Math.atan2(a.r - center.r, a.q - center.q);
        const angleB = Math.atan2(b.r - center.r, b.q - center.q);
        return angleA - angleB;
      });
  }, [hexGrid]);

  // Assign sessions to hex positions deterministically
  const sessionHexes = useMemo(() => {
    const assigned: Map<string, HexCoord> = new Map();
    if (orderedHexes.length === 0) return assigned;
    orderedSessions.forEach((session, index) => {
      const coord = orderedHexes[index % orderedHexes.length];
      assigned.set(session.id, coord);
    });
    return assigned;
  }, [orderedSessions, orderedHexes]);

  // Pan handling
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    setViewBox((prev) => ({
      ...prev,
      x: prev.x - dx,
      y: prev.y - dy,
    }));
    setDragStart({ x: e.clientX, y: e.clientY });
  }, [isDragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Update viewBox on resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      const { width, height } = container.getBoundingClientRect();
      setViewBox((prev) => ({ ...prev, width, height }));
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Keyboard navigation for territories
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (orderedSessions.length === 0) return;

    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        setFocusedSessionIndex((prev) => {
          const next = prev + 1 >= orderedSessions.length ? 0 : prev + 1;
          return next;
        });
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        setFocusedSessionIndex((prev) => {
          const next = prev - 1 < 0 ? orderedSessions.length - 1 : prev - 1;
          return next;
        });
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (focusedSessionIndex >= 0 && focusedSessionIndex < orderedSessions.length) {
          onSelectSession(orderedSessions[focusedSessionIndex].id);
        }
        break;
      case 'Home':
        e.preventDefault();
        setFocusedSessionIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setFocusedSessionIndex(orderedSessions.length - 1);
        break;
    }
  }, [orderedSessions, focusedSessionIndex, onSelectSession]);

  useEffect(() => {
    if (!selectedSessionId) return;
    const idx = orderedSessions.findIndex((session) => session.id === selectedSessionId);
    if (idx !== -1) {
      setFocusedSessionIndex(idx);
    }
  }, [selectedSessionId, orderedSessions]);

  useEffect(() => {
    if (orderedSessions.length === 0) {
      if (focusedSessionIndex !== -1) {
        setFocusedSessionIndex(-1);
      }
      return;
    }

    if (focusedSessionIndex === -1) {
      setFocusedSessionIndex(0);
    } else if (focusedSessionIndex >= orderedSessions.length) {
      setFocusedSessionIndex(orderedSessions.length - 1);
    }
  }, [orderedSessions.length, focusedSessionIndex]);

  // Calculate SVG viewBox
  const svgViewBox = `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`;

  return (
    <div
      ref={containerRef}
      className="civ-map-scene"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onKeyDown={handleKeyDown}
      onFocus={() => {
        if (orderedSessions.length === 0) return;
        if (focusedSessionIndex === -1) {
          const idx = selectedSessionId
            ? orderedSessions.findIndex((session) => session.id === selectedSessionId)
            : 0;
          setFocusedSessionIndex(idx >= 0 ? idx : 0);
        }
      }}
      tabIndex={0}
      role="listbox"
      aria-label="Territory map. Use arrow keys to navigate between territories, Enter to select."
      aria-activedescendant={
        focusedSessionIndex >= 0 && orderedSessions[focusedSessionIndex]
          ? `civ-territory-${orderedSessions[focusedSessionIndex].id}`
          : undefined
      }
    >
      <svg
        viewBox={svgViewBox}
        preserveAspectRatio="xMidYMid meet"
        className="civ-map-svg"
        role="img"
        aria-label="Hex grid map showing session territories"
      >
        <defs>
          {/* Terrain gradients */}
          <linearGradient id="civ-terrain-plains" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="var(--viz-bg-tertiary)" />
            <stop offset="100%" stopColor="var(--viz-bg-secondary)" />
          </linearGradient>
          <linearGradient id="civ-terrain-forest" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#1a2a1a" />
            <stop offset="100%" stopColor="#0f1a0f" />
          </linearGradient>
          <linearGradient id="civ-terrain-hills" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#2a251a" />
            <stop offset="100%" stopColor="#1a1810" />
          </linearGradient>
          {/* Territory glow */}
          <filter id="civ-territory-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Background hex grid */}
        <g className="civ-hex-grid">
          {hexGrid.map((hex) => {
            const pixel = hexToPixel(hex);
            const corners = getHexCorners(pixel, HEX_SIZE - 1);
            return (
              <polygon
                key={`${hex.q}-${hex.r}`}
                points={corners}
                className={`civ-hex-terrain civ-hex-terrain--${hex.terrain}`}
                fill={`url(#civ-terrain-${hex.terrain})`}
              />
            );
          })}
        </g>

        {/* Session territories */}
        <g className="civ-territories" role="group" aria-label="Session territories">
          {orderedSessions.map((session, index) => {
            const hexCoord = sessionHexes.get(session.id);
            if (!hexCoord) return null;

            const pixel = hexToPixel(hexCoord);
            const corners = getHexCorners(pixel, HEX_SIZE - 2);
            const isSelected = session.id === selectedSessionId;
            const isFocused = focusedSessionIndex === index;
            const statusClass = getStatusClass(session.status);
            const statusLabel = getStatusLabel(session.status);
            const sessionName = session.title || session.cwd?.split('/').pop() || 'Session';

            return (
              <g
                key={session.id}
                id={`civ-territory-${session.id}`}
                className={`civ-territory ${isSelected ? 'civ-territory--selected' : ''} ${isFocused ? 'civ-territory--focused' : ''} civ-territory--${statusClass}`}
                onClick={() => onSelectSession(session.id)}
                style={{ cursor: 'pointer' }}
                role="option"
                aria-label={`${sessionName}, status: ${statusLabel}${isSelected ? ', selected' : ''}`}
                aria-selected={isSelected}
                tabIndex={-1}
              >
                {/* Territory hex */}
                <polygon
                  points={corners}
                  className="civ-territory-hex"
                  filter={isSelected ? 'url(#civ-territory-glow)' : undefined}
                />
                {/* Territory icon */}
                <text
                  x={pixel.x}
                  y={pixel.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="civ-territory-icon"
                >
                  {getTerritoryIcon(session.provider)}
                </text>
                {/* Status indicator */}
                <circle
                  cx={pixel.x + HEX_SIZE * 0.5}
                  cy={pixel.y - HEX_SIZE * 0.5}
                  r={6}
                  className={`civ-territory-status-indicator civ-territory-status-indicator--${statusClass}`}
                />
                {/* Territory name (on hover/selection) */}
                {isSelected && (
                  <text
                    x={pixel.x}
                    y={pixel.y + HEX_SIZE * 0.7}
                    textAnchor="middle"
                    className="civ-territory-label"
                  >
                    {truncate(session.title || session.cwd?.split('/').pop() || 'Session', 12)}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Map controls */}
      <div className="civ-map-controls">
        <button
          type="button"
          className="civ-map-control-btn"
          onClick={() => setViewBox((prev) => ({ ...prev, x: 0, y: 0 }))}
          title="Center map"
        >
          ⌘
        </button>
      </div>
    </div>
  );
}

function getTerrainType(q: number, r: number): string {
  // Simple deterministic terrain based on coordinates
  const hash = (q * 7 + r * 13) % 10;
  if (hash < 5) return 'plains';
  if (hash < 8) return 'forest';
  return 'hills';
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

function getStatusLabel(status: string): string {
  switch (status) {
    case 'RUNNING':
      return 'active';
    case 'STARTING':
      return 'starting';
    case 'WAITING_FOR_INPUT':
      return 'waiting for input';
    case 'WAITING_FOR_APPROVAL':
      return 'waiting for approval';
    case 'ERROR':
      return 'error';
    case 'IDLE':
    case 'DONE':
      return 'idle';
    default:
      return 'idle';
  }
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

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen - 1)}…`;
}

function hexDistance(a: HexCoord, b: HexCoord): number {
  const ax = a.q;
  const az = a.r;
  const ay = -ax - az;
  const bx = b.q;
  const bz = b.r;
  const by = -bx - bz;
  return (Math.abs(ax - bx) + Math.abs(ay - by) + Math.abs(az - bz)) / 2;
}
