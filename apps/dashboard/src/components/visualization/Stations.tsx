'use client';

import { useState, useEffect } from 'react';
import { Text } from '@react-three/drei';

interface StationsProps {
  currentTool?: string;
  sessionTools?: Record<string, string | null>;
  onStationClick?: (sessionId: string) => void;
}

interface StationConfig {
  position: [number, number, number];
  label: string;
  color: string;
  tools: string[];
}

const STATIONS: StationConfig[] = [
  {
    position: [-3, 0, 0],
    label: 'Reader',
    color: '#3b82f6',
    tools: ['Read'],
  },
  {
    position: [-1, 0, 0],
    label: 'Editor',
    color: '#22c55e',
    tools: ['Write', 'Edit', 'NotebookEdit'],
  },
  {
    position: [1, 0, 0],
    label: 'Terminal',
    color: '#f97316',
    tools: ['Bash'],
  },
  {
    position: [3, 0, 0],
    label: 'Search',
    color: '#a855f7',
    tools: ['Grep', 'Glob'],
  },
  {
    position: [0, 0, 2],
    label: 'Web',
    color: '#06b6d4',
    tools: ['WebFetch', 'WebSearch'],
  },
  {
    position: [0, 0, -2],
    label: 'Tasks',
    color: '#eab308',
    tools: ['Task', 'TodoWrite', 'EnterPlanMode', 'ExitPlanMode'],
  },
];

/**
 * Workstations where Claude can work on different tool types.
 * Highlights active stations based on current tools.
 */
export function Stations({ currentTool, sessionTools = {}, onStationClick }: StationsProps) {
  const [hoveredStation, setHoveredStation] = useState<string | null>(null);

  // Handle cursor change on hover
  useEffect(() => {
    if (onStationClick) {
      document.body.style.cursor = hoveredStation ? 'pointer' : 'auto';
    }
    return () => {
      document.body.style.cursor = 'auto';
    };
  }, [hoveredStation, onStationClick]);

  // Check if any session is active at a station
  const getActiveSessionsAtStation = (station: StationConfig): string[] => {
    return Object.entries(sessionTools)
      .filter(([, tool]) => tool && station.tools.includes(tool))
      .map(([sessionId]) => sessionId);
  };

  // Get the primary active station (for selected session)
  const getActiveStation = () => {
    if (!currentTool) return null;
    return STATIONS.find((s) => s.tools.includes(currentTool));
  };

  const activeStation = getActiveStation();

  // Handle station click - select first session at that station
  const handleStationClick = (station: StationConfig) => {
    if (!onStationClick) return;
    const sessionsAtStation = getActiveSessionsAtStation(station);
    if (sessionsAtStation.length > 0) {
      onStationClick(sessionsAtStation[0]);
    }
  };

  return (
    <group>
      {STATIONS.map((station) => {
        const isActive = activeStation === station;
        const sessionsAtStation = getActiveSessionsAtStation(station);
        const hasAnySessions = sessionsAtStation.length > 0;
        const isHovered = hoveredStation === station.label;

        return (
          <group
            key={station.label}
            position={station.position}
            onClick={(e) => {
              if (hasAnySessions) {
                e.stopPropagation();
                handleStationClick(station);
              }
            }}
            onPointerOver={() => hasAnySessions && setHoveredStation(station.label)}
            onPointerOut={() => setHoveredStation(null)}
          >
            {/* Station platform */}
            <mesh receiveShadow position={[0, -0.1, 0]}>
              <cylinderGeometry args={[0.6, 0.7, 0.2, 6]} />
              <meshStandardMaterial
                color={isActive || hasAnySessions ? station.color : '#334155'}
                roughness={0.8}
                metalness={0.2}
              />
            </mesh>

            {/* Station glow ring */}
            <mesh position={[0, -0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.55, 0.65, 32]} />
              <meshBasicMaterial
                color={station.color}
                transparent
                opacity={isActive ? 0.8 : hasAnySessions ? 0.5 : 0.2}
              />
            </mesh>

            {/* Hover indicator */}
            {isHovered && (
              <mesh position={[0, -0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[0.65, 0.72, 32]} />
                <meshBasicMaterial color="#f8fafc" transparent opacity={0.4} />
              </mesh>
            )}

            {/* Station console/desk */}
            <mesh position={[0, 0.2, 0.3]} rotation={[-0.2, 0, 0]}>
              <boxGeometry args={[0.5, 0.3, 0.2]} />
              <meshStandardMaterial
                color="#1e293b"
                roughness={0.5}
              />
            </mesh>

            {/* Console screen */}
            <mesh position={[0, 0.3, 0.32]} rotation={[-0.2, 0, 0]}>
              <planeGeometry args={[0.4, 0.2]} />
              <meshBasicMaterial
                color={isActive ? station.color : '#0f172a'}
              />
            </mesh>

            {/* Label */}
            <Text
              position={[0, 0.8, 0]}
              fontSize={0.15}
              color={isActive ? station.color : '#64748b'}
              anchorX="center"
              anchorY="middle"
            >
              {station.label}
            </Text>

            {/* Active indicator pillar */}
            {isActive && (
              <mesh position={[0, 0.5, 0]}>
                <cylinderGeometry args={[0.02, 0.02, 1, 8]} />
                <meshBasicMaterial
                  color={station.color}
                  transparent
                  opacity={0.5}
                />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
}
