'use client';

import { Suspense, useMemo, useRef } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment, Text } from '@react-three/drei';
import { useSpring } from '@react-spring/three';
import { ClaudeCharacter } from './ClaudeCharacter';
import { Stations } from './Stations';
import { HexGrid } from './HexGrid';
import { SpatialAudioManager } from './SpatialAudioManager';
import type { SessionWithSnapshot } from '@agent-command/schema';
import type { CameraMode } from '@/stores/workshop';
import { SESSION_COLORS } from '@/stores/workshop';
import { Vector3 } from 'three';

interface WorkshopSceneProps {
  sessions?: SessionWithSnapshot[];
  activeSessionId?: string;
  currentTool?: string;
  className?: string;
  cameraMode?: CameraMode;
  // Multi-session tool tracking
  sessionTools?: Record<string, string | null>;
  onSessionSelect?: (sessionId: string) => void;
  // Settings
  annotationsEnabled?: boolean;
  soundsEnabled?: boolean;
}

const DEFAULT_CAMERA_POSITION: [number, number, number] = [0, 5, 8];
const FOCUSED_CAMERA_OFFSET: [number, number, number] = [1.5, 2.5, 3.5];
const FOLLOW_CAMERA_OFFSET: [number, number, number] = [0, 2.2, 4.5];

// Map tool names to station positions
const TOOL_TO_STATION: Record<string, [number, number, number]> = {
  Read: [-3, 0, 0],
  Write: [-1, 0, 0],
  Edit: [-1, 0, 0],
  NotebookEdit: [-1, 0, 0],
  Bash: [1, 0, 0],
  Grep: [3, 0, 0],
  Glob: [3, 0, 0],
  WebFetch: [0, 0, 2],
  WebSearch: [0, 0, 2],
  Task: [0, 0, -2],
  TodoWrite: [0, 0, -2],
  EnterPlanMode: [0, 0, -2],
  ExitPlanMode: [0, 0, -2],
  default: [0, 0, 0],
};

// Get position offset for characters at same station to avoid collision
function getPositionOffset(index: number, total: number): [number, number, number] {
  if (total <= 1) return [0, 0, 0];
  const angle = (index / total) * Math.PI * 2;
  return [Math.cos(angle) * 0.5, 0, Math.sin(angle) * 0.5];
}

// Get station position for a tool
function getStationPosition(tool: string | null): [number, number, number] {
  return TOOL_TO_STATION[tool || 'default'] || TOOL_TO_STATION.default;
}

/**
 * 3D Workshop visualization showing Claude working at different stations
 * based on the current tool being used.
 */
export function WorkshopScene({
  sessions = [],
  activeSessionId,
  currentTool,
  className,
  cameraMode = 'overview',
  sessionTools = {},
  onSessionSelect,
  annotationsEnabled = true,
  soundsEnabled = false,
}: WorkshopSceneProps) {
  // Get selected session's position for camera targeting
  const selectedSessionTool = activeSessionId
    ? sessionTools[activeSessionId] || currentTool
    : currentTool;
  const stationPosition = useMemo(
    () => getStationPosition(selectedSessionTool || null),
    [selectedSessionTool]
  );

  // Group sessions by their current station for collision avoidance
  const sessionsByStation = useMemo(() => {
    const groups: Record<string, string[]> = {};
    sessions.forEach((session) => {
      const tool = sessionTools[session.id] || null;
      const pos = getStationPosition(tool);
      const key = pos.join(',');
      if (!groups[key]) groups[key] = [];
      groups[key].push(session.id);
    });
    return groups;
  }, [sessions, sessionTools]);

  return (
    <div className={className} style={{ height: '100%', minHeight: 400 }}>
      {/* Spatial audio manager - plays positioned sounds when tools start */}
      <SpatialAudioManager enabled={soundsEnabled} sessionTools={sessionTools} />

      <Canvas
        camera={{ position: [0, 5, 8], fov: 50 }}
        shadows
        gl={{ antialias: true }}
      >
        <Suspense fallback={null}>
          {/* Lighting */}
          <ambientLight intensity={0.5} />
          <directionalLight
            position={[10, 10, 5]}
            intensity={1}
            castShadow
            shadow-mapSize={[2048, 2048]}
          />
          <pointLight position={[-5, 5, -5]} intensity={0.5} color="#8b5cf6" />

          {/* Environment */}
          <Environment preset="night" />
          <fog attach="fog" args={['#0f172a', 10, 30]} />

          {/* Ground with annotation support */}
          <HexGrid annotationsEnabled={annotationsEnabled} />

          {/* Stations */}
          <Stations
            currentTool={selectedSessionTool || undefined}
            sessionTools={sessionTools}
            onStationClick={onSessionSelect}
          />

          {/* Claude Characters - one per session */}
          {sessions.slice(0, 6).map((session, sessionIndex) => {
            const sessionTool = sessionTools[session.id] || null;
            const position = getStationPosition(sessionTool);
            const posKey = position.join(',');
            const sessionsAtStation = sessionsByStation[posKey] || [];
            const indexAtStation = sessionsAtStation.indexOf(session.id);
            const offset = getPositionOffset(indexAtStation, sessionsAtStation.length);

            return (
              <ClaudeCharacter
                key={session.id}
                position={position}
                positionOffset={offset}
                isActive={!!sessionTool}
                currentTool={sessionTool || undefined}
                sessionId={session.id}
                sessionColor={SESSION_COLORS[sessionIndex % SESSION_COLORS.length]}
                sessionName={session.title || `Session ${sessionIndex + 1}`}
                isSelected={session.id === activeSessionId}
                onClick={onSessionSelect}
              />
            );
          })}

          {/* Title */}
          <Text
            position={[0, 4, -5]}
            fontSize={0.5}
            color="#f8fafc"
            anchorX="center"
            anchorY="middle"
          >
            Agent Workshop
          </Text>

          {/* Controls */}
          <CameraRig mode={cameraMode} target={stationPosition} />
        </Suspense>
      </Canvas>
    </div>
  );
}

interface CameraRigProps {
  mode: CameraMode;
  target: [number, number, number];
}

function CameraRig({ mode, target }: CameraRigProps) {
  const controlsRef = useRef<any>(null);
  const { camera } = useThree();

  // Calculate target camera position based on mode
  const targetCameraPos = useMemo((): [number, number, number] => {
    if (mode === 'overview') {
      return DEFAULT_CAMERA_POSITION;
    }
    const offset = mode === 'focused' ? FOCUSED_CAMERA_OFFSET : FOLLOW_CAMERA_OFFSET;
    return [target[0] + offset[0], target[1] + offset[1], target[2] + offset[2]];
  }, [mode, target]);

  // Calculate target look-at position
  const targetLookAt = useMemo((): [number, number, number] => {
    if (mode === 'overview') {
      return [0, 0, 0];
    }
    return target;
  }, [mode, target]);

  // Spring animation for smooth camera transitions
  const { cameraPos, lookAtPos } = useSpring({
    cameraPos: targetCameraPos,
    lookAtPos: targetLookAt,
    config: { mass: 1, tension: 80, friction: 26 }, // Slower than character movement
  });

  // Smooth lerp for camera position and target in follow mode
  useFrame(() => {
    const camPos = cameraPos.get() as [number, number, number];
    const lookAt = lookAtPos.get() as [number, number, number];

    // Lerp camera position
    camera.position.lerp(new Vector3(...camPos), 0.08);

    // Update controls target
    if (controlsRef.current) {
      const controls = controlsRef.current as { target: Vector3; update: () => void };
      controls.target.lerp(new Vector3(...lookAt), 0.08);
      controls.update();
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enablePan={false}
      enableRotate={mode !== 'follow'}
      enableZoom={mode !== 'follow'}
      maxPolarAngle={Math.PI / 2.2}
      minDistance={mode === 'overview' ? 5 : 2.5}
      maxDistance={mode === 'overview' ? 15 : 6}
    />
  );
}
