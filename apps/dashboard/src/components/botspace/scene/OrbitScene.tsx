'use client';

import { Suspense, forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Environment, Text, Stars } from '@react-three/drei';
import type { SessionWithSnapshot } from '@agent-command/schema';
import { Color, Vector3, BufferGeometry, Float32BufferAttribute, Group } from 'three';
import * as THREE from 'three';
import { PlatformGrid, type PlatformCoord } from '@/lib/botspace/platformGrid';
import { MODULE_POSITIONS, type ModuleType, getModuleForTool, MODULE_LABELS } from '@/lib/botspace/moduleMap';
import type { PaintedPlatform, TextTile, CameraMode } from '@/stores/visualizerState';
import { OrbBot } from './characters/OrbBot';
import { ModuleDetails } from './modules/ModuleDetails';
import { NOTIFICATION_COLORS, type ZoneNotification } from '@/lib/workshop/notifications';

export interface SessionVizState {
  status: 'idle' | 'thinking' | 'working' | 'finished';
  currentTool?: string | null;
  toolContext?: string | null;
  lastToolAt?: number;
  highlightUntil?: number;
  subagents?: number;
  moduleHistory?: Partial<Record<ModuleType, ToolHistoryItem[]>>;
}

export interface ToolHistoryItem {
  text: string;
  success: boolean;
  timestamp: number;
}

export interface OrbitSceneHandle {
  getOrbitScreenPosition: (sessionId: string) => { x: number; y: number } | null;
}

interface OrbitSceneProps {
  sessions: SessionWithSnapshot[];
  sessionStates: Record<string, SessionVizState>;
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  cameraMode: CameraMode;
  paintedPlatforms: PaintedPlatform[];
  textTiles: TextTile[];
  notifications: ZoneNotification[];
  preferredAssignments?: Record<string, PlatformCoord>;
  drawEnabled: boolean;
  drawBrushSize: number;
  drawColor: string | null;
  drawIs3D: boolean;
  onPaintPlatform: (platforms: PlatformCoord[], color: string | null) => void;
  modulePanelsEnabled: boolean;
  onHoverPlatformChange?: (platform: PlatformCoord | null) => void;
  onFloorContextMenu?: (payload: { platform: PlatformCoord; screenX: number; screenY: number; world: { x: number; z: number } }) => void;
  onOrbitContextMenu?: (payload: { sessionId: string; screenX: number; screenY: number }) => void;
  onUserCameraControl?: () => void;
}

// Botspace color palette - amber/teal theme
export const ORBIT_COLORS = [
  '#F5A623',  // Amber (primary)
  '#2DD4BF',  // Teal
  '#60A5FA',  // Blue
  '#A6DA95',  // Green
  '#C4B5FD',  // Lavender
  '#FB923C',  // Orange
  '#F472B6',  // Pink
  '#FCD34D',  // Yellow
];

const DEFAULT_CAMERA: [number, number, number] = [10, 8, 10];

export const OrbitScene = forwardRef<OrbitSceneHandle, OrbitSceneProps>(function OrbitScene(
  {
    sessions,
    sessionStates,
    selectedSessionId,
    onSelectSession,
    cameraMode,
    paintedPlatforms,
    textTiles,
    notifications,
    preferredAssignments,
    drawEnabled,
    drawBrushSize,
    drawColor,
    drawIs3D,
    onPaintPlatform,
    modulePanelsEnabled,
    onHoverPlatformChange,
    onFloorContextMenu,
    onOrbitContextMenu,
    onUserCameraControl,
  },
  ref
) {
  return (
    <div className="botspace-canvas">
      <Canvas
        shadows
        camera={{ position: DEFAULT_CAMERA, fov: 50, near: 0.1, far: 1000 }}
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        tabIndex={0}
      >
        <Suspense fallback={null}>
          <SceneContents
            sceneRef={ref}
            sessions={sessions}
            sessionStates={sessionStates}
            selectedSessionId={selectedSessionId}
            onSelectSession={onSelectSession}
            cameraMode={cameraMode}
            paintedPlatforms={paintedPlatforms}
            textTiles={textTiles}
            notifications={notifications}
            preferredAssignments={preferredAssignments}
            drawEnabled={drawEnabled}
            drawBrushSize={drawBrushSize}
            drawColor={drawColor}
            drawIs3D={drawIs3D}
            onPaintPlatform={onPaintPlatform}
            modulePanelsEnabled={modulePanelsEnabled}
            onHoverPlatformChange={onHoverPlatformChange}
            onFloorContextMenu={onFloorContextMenu}
            onOrbitContextMenu={onOrbitContextMenu}
            onUserCameraControl={onUserCameraControl}
          />
        </Suspense>
      </Canvas>
    </div>
  );
});

interface SceneContentsProps extends OrbitSceneProps {
  sceneRef: Ref<OrbitSceneHandle>;
}

interface OrbitAssignment {
  sessionId: string;
  position: Vector3;
  platform: PlatformCoord;
  color: string;
}

function SceneContents({
  sceneRef,
  sessions,
  sessionStates,
  selectedSessionId,
  onSelectSession,
  cameraMode,
  paintedPlatforms,
  textTiles,
  notifications,
  preferredAssignments,
  drawEnabled,
  drawBrushSize,
  drawColor,
  drawIs3D,
  onPaintPlatform,
  modulePanelsEnabled,
  onHoverPlatformChange,
  onFloorContextMenu,
  onOrbitContextMenu,
  onUserCameraControl,
}: SceneContentsProps) {
  const platformGridRef = useRef(new PlatformGrid(12, 1.0));
  const assignmentsRef = useRef(new Map<string, PlatformCoord>());
  const colorIndexRef = useRef(0);
  const [assignments, setAssignments] = useState<OrbitAssignment[]>([]);

  useEffect(() => {
    const grid = platformGridRef.current;
    const known = assignmentsRef.current;
    const sessionIds = new Set(sessions.map((s) => s.id));

    for (const id of Array.from(known.keys())) {
      if (!sessionIds.has(id)) {
        grid.release(id);
        known.delete(id);
      }
    }

    for (const session of sessions) {
      if (!known.has(session.id)) {
        let platform = preferredAssignments?.[session.id] || null;
        if (platform) {
          if (grid.isOccupied(platform) && grid.getOccupant(platform) !== session.id) {
            const { x, z } = grid.coordToCartesian(platform);
            platform = grid.findNearestFreeFromCartesian(x, z);
          }
        } else {
          platform = grid.getNextInSpiral();
        }
        grid.occupy(platform, session.id);
        known.set(session.id, platform);
      }
    }

    const nextAssignments = sessions.map((session, index) => {
      const platform = known.get(session.id) || { x: 0, y: 0 };
      const { x, z } = grid.coordToCartesian(platform);
      const color = ORBIT_COLORS[(index + colorIndexRef.current) % ORBIT_COLORS.length];
      return {
        sessionId: session.id,
        position: new Vector3(x, 0, z),
        platform,
        color,
      };
    });

    setAssignments(nextAssignments);
  }, [preferredAssignments, sessions]);

  return (
    <SceneRig
      sceneRef={sceneRef}
      assignments={assignments}
      sessions={sessions}
      sessionStates={sessionStates}
      selectedSessionId={selectedSessionId}
      onSelectSession={onSelectSession}
      cameraMode={cameraMode}
      paintedPlatforms={paintedPlatforms}
      textTiles={textTiles}
      notifications={notifications}
      drawEnabled={drawEnabled}
      drawBrushSize={drawBrushSize}
      drawColor={drawColor}
      drawIs3D={drawIs3D}
      onPaintPlatform={onPaintPlatform}
      modulePanelsEnabled={modulePanelsEnabled}
      platformGrid={platformGridRef.current}
      onHoverPlatformChange={onHoverPlatformChange}
      onFloorContextMenu={onFloorContextMenu}
      onOrbitContextMenu={onOrbitContextMenu}
      onUserCameraControl={onUserCameraControl}
    />
  );
}

interface SceneRigProps {
  sceneRef: Ref<OrbitSceneHandle>;
  assignments: OrbitAssignment[];
  sessions: SessionWithSnapshot[];
  sessionStates: Record<string, SessionVizState>;
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  cameraMode: CameraMode;
  paintedPlatforms: PaintedPlatform[];
  textTiles: TextTile[];
  notifications: ZoneNotification[];
  drawEnabled: boolean;
  drawBrushSize: number;
  drawColor: string | null;
  drawIs3D: boolean;
  onPaintPlatform: (platforms: PlatformCoord[], color: string | null) => void;
  modulePanelsEnabled: boolean;
  platformGrid: PlatformGrid;
  onHoverPlatformChange?: (platform: PlatformCoord | null) => void;
  onFloorContextMenu?: (payload: { platform: PlatformCoord; screenX: number; screenY: number; world: { x: number; z: number } }) => void;
  onOrbitContextMenu?: (payload: { sessionId: string; screenX: number; screenY: number }) => void;
  onUserCameraControl?: () => void;
}

function SceneRig({
  sceneRef,
  assignments,
  sessions,
  sessionStates,
  selectedSessionId,
  onSelectSession,
  cameraMode,
  paintedPlatforms,
  textTiles,
  notifications,
  drawEnabled,
  drawBrushSize,
  drawColor,
  drawIs3D,
  onPaintPlatform,
  modulePanelsEnabled,
  platformGrid,
  onHoverPlatformChange,
  onFloorContextMenu,
  onOrbitContextMenu,
  onUserCameraControl,
}: SceneRigProps) {
  const { camera, gl } = useThree();
  const controlsRef = useRef<any>(null);
  const hoverPlatformRef = useRef<PlatformCoord | null>(null);
  const [hoverPlatform, setHoverPlatform] = useState<PlatformCoord | null>(null);
  const mouseDownRef = useRef<{ x: number; y: number } | null>(null);
  const isPaintingRef = useRef(false);
  const paintedThisDragRef = useRef<Set<string>>(new Set());

  const paintedMap = useMemo(() => {
    const map = new Map<string, PaintedPlatform>();
    paintedPlatforms.forEach((p) => map.set(`${p.x},${p.y}`, p));
    return map;
  }, [paintedPlatforms]);

  const elevatedAssignments = useMemo(() => {
    return assignments.map((orbit) => {
      const key = `${orbit.platform.x},${orbit.platform.y}`;
      const painted = paintedMap.get(key);
      const elevation = painted && drawIs3D ? painted.height * 0.3 : 0;
      const elevatedPosition = orbit.position.clone();
      elevatedPosition.y += elevation;
      return { ...orbit, position: elevatedPosition, elevation };
    });
  }, [assignments, paintedMap, drawIs3D]);

  const orbitMap = useMemo(() => {
    const map = new Map<string, { position: Vector3; elevation: number }>();
    for (const orbit of elevatedAssignments) {
      map.set(orbit.sessionId, { position: orbit.position.clone(), elevation: orbit.elevation || 0 });
    }
    return map;
  }, [elevatedAssignments]);

  // Tether connections between adjacent platforms
  const tetherConnections = useMemo(() => {
    const platforms = assignments.map(a => a.platform);
    return platformGrid.getTetherConnections(platforms);
  }, [assignments, platformGrid]);

  const selectedOrbit = elevatedAssignments.find((orbit) => orbit.sessionId === selectedSessionId);
  const targetPos = selectedOrbit?.position || new Vector3(0, 0, 0);

  useImperativeHandle(sceneRef, () => ({
    getOrbitScreenPosition: (sessionId: string) => {
      const orbit = orbitMap.get(sessionId);
      if (!orbit) return null;
      const projected = orbit.position.clone();
      projected.y += 2;
      projected.project(camera as THREE.PerspectiveCamera);
      const rect = gl.domElement.getBoundingClientRect();
      return {
        x: rect.left + (projected.x * 0.5 + 0.5) * rect.width,
        y: rect.top + (-projected.y * 0.5 + 0.5) * rect.height,
      };
    },
  }), [camera, gl.domElement, orbitMap]);

  useFrame((state, delta) => {
    const mode = cameraMode;
    const target = targetPos.clone();
    let cameraTarget = new Vector3(...DEFAULT_CAMERA);

    if (mode === 'focused') {
      cameraTarget = target.clone().add(new Vector3(8, 6, 8));
    } else if (mode === 'follow-active') {
      cameraTarget = target.clone().add(new Vector3(5, 5, 6));
    }

    if (mode !== 'overview') {
      camera.position.lerp(cameraTarget, 1 - Math.exp(-delta * 3));
      const lookAt = target;
      camera.lookAt(lookAt);
      if (controlsRef.current) {
        controlsRef.current.target.lerp(lookAt, 1 - Math.exp(-delta * 3));
        controlsRef.current.update();
      }
    } else if (controlsRef.current) {
      controlsRef.current.update();
    }

    if (hoverPlatformRef.current !== hoverPlatform) {
      setHoverPlatform(hoverPlatformRef.current);
    }
  });

  useEffect(() => {
    if (!drawEnabled) {
      hoverPlatformRef.current = null;
      setHoverPlatform(null);
    }
  }, [drawEnabled]);

  useEffect(() => {
    onHoverPlatformChange?.(hoverPlatform);
  }, [hoverPlatform, onHoverPlatformChange]);

  const paintWithBrush = (centerPlatform: PlatformCoord) => {
    const platforms = platformGrid.getPlatformsInRadius(centerPlatform, drawBrushSize);
    const filtered = platforms.filter((p) => {
      const key = `${p.x},${p.y}`;
      if (paintedThisDragRef.current.has(key)) {
        return false;
      }
      paintedThisDragRef.current.add(key);
      return true;
    });
    if (filtered.length > 0) {
      onPaintPlatform(filtered, drawColor);
    }
  };

  const handlePointerMove = (event: any) => {
    if (!drawEnabled) return;
    const point = event.point as Vector3;
    const platform = platformGrid.cartesianToCoord(point.x, point.z);
    hoverPlatformRef.current = platform;
    if (isPaintingRef.current) {
      paintWithBrush(platform);
    }
  };

  const handlePointerOut = () => {
    hoverPlatformRef.current = null;
    setHoverPlatform(null);
    if (isPaintingRef.current) {
      isPaintingRef.current = false;
      paintedThisDragRef.current.clear();
    }
  };

  const handlePointerDown = (event: any) => {
    mouseDownRef.current = { x: event.clientX, y: event.clientY };
    if (!drawEnabled || event.button !== 0) return;
    const point = event.point as Vector3;
    const centerPlatform = platformGrid.cartesianToCoord(point.x, point.z);
    paintedThisDragRef.current.clear();
    isPaintingRef.current = true;
    paintWithBrush(centerPlatform);
    event.stopPropagation();
  };

  const handlePointerUp = (event: any) => {
    if (isPaintingRef.current) {
      isPaintingRef.current = false;
      paintedThisDragRef.current.clear();
    }

    if (!mouseDownRef.current || drawEnabled) return;

    const dx = event.clientX - mouseDownRef.current.x;
    const dy = event.clientY - mouseDownRef.current.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    mouseDownRef.current = null;

    if (distance > 5 || event.button !== 0) return;

    const point = event.point as Vector3;
    const platform = platformGrid.cartesianToCoord(point.x, point.z);
    onFloorContextMenu?.({
      platform,
      screenX: event.clientX,
      screenY: event.clientY,
      world: { x: point.x, z: point.z },
    });
    event.stopPropagation();
  };

  return (
    <>
      {/* Deep space background */}
      <color attach="background" args={[new Color('#0A0B10')]} />

      {/* Starfield */}
      <Stars radius={300} depth={100} count={3000} factor={4} saturation={0} fade speed={0.5} />

      {/* Lighting - warm amber tones */}
      <ambientLight intensity={0.4} color="#F5A623" />
      <directionalLight position={[15, 20, 10]} intensity={0.8} color="#FFF8E7" castShadow />
      <pointLight position={[-10, 8, -10]} intensity={0.3} color="#2DD4BF" />
      <pointLight position={[10, 8, 10]} intensity={0.2} color="#F5A623" />
      <Environment preset="night" />

      {/* Space debris / ambient particles */}
      <SpaceDebris />

      {/* Platform tethers */}
      <TetherLines connections={tetherConnections} platformGrid={platformGrid} />

      {/* Painted platforms */}
      <PaintedPlatforms platformGrid={platformGrid} painted={paintedPlatforms} drawIs3D={drawIs3D} />

      {/* Text tiles */}
      <TextLabels platformGrid={platformGrid} tiles={textTiles} />

      {/* Floor interaction plane */}
      <group
        onPointerMove={handlePointerMove}
        onPointerOut={handlePointerOut}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      >
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1, 0]}>
          <planeGeometry args={[400, 400]} />
          <meshBasicMaterial transparent opacity={0} />
        </mesh>
      </group>

      {/* Orbital platforms */}
      {elevatedAssignments.map((orbit) => {
        const session = sessions.find((s) => s.id === orbit.sessionId);
        if (!session) return null;
        const state = sessionStates[orbit.sessionId];
        return (
          <OrbitalPlatform
            key={orbit.sessionId}
            position={orbit.position}
            color={orbit.color}
            session={session}
            state={state}
            isSelected={orbit.sessionId === selectedSessionId}
            onSelect={() => onSelectSession(orbit.sessionId)}
            modulePanelsEnabled={modulePanelsEnabled}
            drawEnabled={drawEnabled}
            onContextMenu={(event) => {
              if (!onOrbitContextMenu) return;
              onOrbitContextMenu({
                sessionId: orbit.sessionId,
                screenX: event.clientX,
                screenY: event.clientY,
              });
            }}
          />
        );
      })}

      {/* OrbBots */}
      {elevatedAssignments.map((orbit) => {
        const session = sessions.find((s) => s.id === orbit.sessionId);
        if (!session) return null;
        const state = sessionStates[orbit.sessionId];
        const moduleType = getModuleForTool(state?.currentTool || null);
        const moduleOffset = MODULE_POSITIONS[moduleType];
        const basePosition = orbit.position.clone().add(new Vector3(...moduleOffset));
        basePosition.y += 0.3;
        return (
          <OrbBot
            key={`orbbot-${orbit.sessionId}`}
            position={basePosition}
            state={state?.status || 'idle'}
            color={orbit.color}
            name={session.title || session.cwd?.split('/').pop() || 'OrbBot'}
            onClick={drawEnabled ? undefined : () => onSelectSession(orbit.sessionId)}
          />
        );
      })}

      {/* Subagent OrbBots */}
      {elevatedAssignments.map((orbit) => {
        const state = sessionStates[orbit.sessionId];
        const subagents = state?.subagents || 0;
        if (subagents <= 0) return null;
        const airlockOffset = MODULE_POSITIONS.airlock;
        const base = orbit.position.clone().add(new Vector3(...airlockOffset));
        base.y += 0.3;
        return Array.from({ length: subagents }).map((_, idx) => {
          const angle = (idx / subagents) * Math.PI * 2;
          const offset = new Vector3(Math.cos(angle) * 0.8, 0, Math.sin(angle) * 0.8);
          return (
            <OrbBot
              key={`subagent-${orbit.sessionId}-${idx}`}
              position={base.clone().add(offset)}
              state="working"
              color="#C4B5FD"
              scale={0.6}
            />
          );
        });
      })}

      {/* Notifications */}
      <OrbitNotifications notifications={notifications} orbits={orbitMap} />

      {/* Hover highlight */}
      {hoverPlatform && drawEnabled && (
        <PlatformHoverHighlight platform={hoverPlatform} platformGrid={platformGrid} />
      )}

      {/* Title */}
      <Text position={[0, 8, -15]} fontSize={0.8} color="#F5A623" anchorX="center" anchorY="middle">
        Botspace Station
      </Text>
      <CreditBanner />

      <OrbitControls
        ref={controlsRef}
        enablePan={cameraMode === 'overview'}
        enableRotate={cameraMode !== 'follow-active'}
        enableZoom={cameraMode !== 'follow-active'}
        minDistance={5}
        maxDistance={200}
        maxPolarAngle={Math.PI / 2.1}
        onStart={() => {
          onUserCameraControl?.();
        }}
      />
    </>
  );
}

function CreditBanner() {
  const groupRef = useRef<Group>(null);

  useFrame((state) => {
    const group = groupRef.current;
    if (!group) return;
    const t = state.clock.elapsedTime;
    group.position.y = 6.4 + Math.sin(t * 0.6) * 0.25;
    group.rotation.y = Math.sin(t * 0.2) * 0.12;
    group.rotation.z = Math.sin(t * 0.4) * 0.06;
  });

  return (
    <group ref={groupRef} position={[0, 6.4, -12]}>
      <mesh>
        <planeGeometry args={[7.2, 1.2]} />
        <meshStandardMaterial
          color="#111827"
          transparent
          opacity={0.7}
          emissive="#F5A623"
          emissiveIntensity={0.12}
        />
      </mesh>
      <Text position={[0, 0, 0.02]} fontSize={0.32} color="#F5A623" anchorX="center" anchorY="middle">
        Inspired by vibecraft.sh!
      </Text>
    </group>
  );
}

function SpaceDebris() {
  const pointsRef = useRef<THREE.Points | null>(null);
  const dataRef = useRef<Array<{ baseY: number; phase: number; speed: number; radius: number; angle: number }>>([]);

  const geometry = useMemo(() => {
    const particleCount = 80;
    const positions = new Float32Array(particleCount * 3);
    dataRef.current = [];

    for (let i = 0; i < particleCount; i += 1) {
      const radius = 5 + Math.random() * 25;
      const angle = Math.random() * Math.PI * 2;
      const baseY = 4 + Math.random() * 15;

      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = baseY;
      positions[i * 3 + 2] = Math.sin(angle) * radius;

      dataRef.current.push({
        baseY,
        phase: Math.random() * Math.PI * 2,
        speed: 0.2 + Math.random() * 0.4,
        radius,
        angle,
      });
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
    return geo;
  }, []);

  useFrame((state, delta) => {
    const points = pointsRef.current;
    if (!points) return;
    const positions = points.geometry.attributes.position.array as Float32Array;
    dataRef.current.forEach((data, i) => {
      data.angle += delta * 0.015 * data.speed;
      const yOffset = Math.sin(state.clock.elapsedTime * data.speed + data.phase) * 2;
      positions[i * 3] = Math.cos(data.angle) * data.radius;
      positions[i * 3 + 1] = data.baseY + yOffset;
      positions[i * 3 + 2] = Math.sin(data.angle) * data.radius;
    });
    points.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} geometry={geometry}>
      <pointsMaterial
        color={0xF5A623}
        size={0.15}
        transparent
        opacity={0.5}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

function TetherLines({
  connections,
  platformGrid,
}: {
  connections: Array<[PlatformCoord, PlatformCoord]>;
  platformGrid: PlatformGrid;
}) {
  const lineGeometry = useMemo(() => {
    const points: number[] = [];

    for (const [a, b] of connections) {
      const posA = platformGrid.coordToCartesian(a);
      const posB = platformGrid.coordToCartesian(b);
      points.push(posA.x, 0.5, posA.z);
      points.push(posB.x, 0.5, posB.z);
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
    return geometry;
  }, [connections, platformGrid]);

  return (
    <lineSegments geometry={lineGeometry}>
      <lineBasicMaterial color="#2DD4BF" transparent opacity={0.4} />
    </lineSegments>
  );
}

function PaintedPlatforms({
  platformGrid,
  painted,
  drawIs3D,
}: {
  platformGrid: PlatformGrid;
  painted: PaintedPlatform[];
  drawIs3D: boolean;
}) {
  return (
    <group>
      {painted.map((p) => {
        const { x, z } = platformGrid.coordToCartesian({ x: p.x, y: p.y });
        const height = drawIs3D ? Math.max(0.3, p.height * 0.3) : 0.3;
        return (
          <mesh key={`${p.x},${p.y}`} position={[x, height / 2, z]}>
            <boxGeometry args={[platformGrid.platformSize * 0.9, height, platformGrid.platformSize * 0.9]} />
            <meshStandardMaterial color={p.color} roughness={0.5} metalness={0.3} />
          </mesh>
        );
      })}
    </group>
  );
}

function TextLabels({ platformGrid, tiles }: { platformGrid: PlatformGrid; tiles: TextTile[] }) {
  return (
    <group>
      {tiles.map((tile) => {
        const { x, z } = platformGrid.coordToCartesian({ x: tile.q, y: tile.r });
        return (
          <Text
            key={tile.id}
            position={[x, 1.0, z]}
            fontSize={0.4}
            color={tile.color}
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.02}
            outlineColor="#0A0B10"
          >
            {tile.text}
          </Text>
        );
      })}
    </group>
  );
}

function PlatformHoverHighlight({ platform, platformGrid }: { platform: PlatformCoord; platformGrid: PlatformGrid }) {
  const { x, z } = platformGrid.coordToCartesian(platform);
  const size = platformGrid.platformSize * 0.95;

  return (
    <mesh position={[x, 0.1, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial color="#F5A623" transparent opacity={0.3} />
    </mesh>
  );
}

function OrbitNotifications({
  notifications,
  orbits,
}: {
  notifications: ZoneNotification[];
  orbits: Map<string, { position: Vector3; elevation: number }>;
}) {
  return (
    <group>
      {notifications.map((notification) => {
        const orbit = orbits.get(notification.sessionId);
        if (!orbit) return null;
        return (
          <OrbitNotificationItem
            key={notification.id}
            notification={notification}
            basePosition={orbit.position}
            elevation={orbit.elevation}
          />
        );
      })}
    </group>
  );
}

function OrbitNotificationItem({
  notification,
  basePosition,
  elevation,
}: {
  notification: ZoneNotification;
  basePosition: Vector3;
  elevation: number;
}) {
  const groupRef = useRef<Group>(null);
  const materialRef = useRef<any>(null);
  const startY = 3.0 + (notification.slot ?? 0) * 0.7 + elevation;

  useFrame(() => {
    if (!groupRef.current || !materialRef.current) return;
    const ageMs = performance.now() - notification.createdAt;
    const durationMs = notification.duration;
    const progress = durationMs > 0 ? ageMs / durationMs : 1;
    if (progress >= 1) {
      groupRef.current.visible = false;
      return;
    }
    const floatProgress = 1 - Math.pow(1 - progress, 2);
    const y = startY + floatProgress * 2;
    groupRef.current.position.set(basePosition.x, basePosition.y + y, basePosition.z);

    const fadeStart = 0.6;
    const opacity =
      progress < fadeStart
        ? 1
        : 1 - Math.pow((progress - fadeStart) / (1 - fadeStart), 2);
    materialRef.current.opacity = opacity;
  });

  const color = NOTIFICATION_COLORS[notification.style] || '#CAD3F5';
  const text = notification.icon ? `${notification.icon} ${notification.text}` : notification.text;

  return (
    <group ref={groupRef} position={[basePosition.x, basePosition.y + startY, basePosition.z]}>
      <mesh>
        <planeGeometry args={[3.5, 0.7]} />
        <meshBasicMaterial ref={materialRef} color="#1A1B26" transparent opacity={0.9} />
      </mesh>
      <Text position={[0, 0, 0.01]} fontSize={0.24} color={color} anchorX="center" anchorY="middle" maxWidth={3.2} textAlign="center">
        {text}
      </Text>
    </group>
  );
}

function OrbitalPlatform({
  position,
  color,
  session,
  state,
  isSelected,
  onSelect,
  modulePanelsEnabled,
  drawEnabled,
  onContextMenu,
}: {
  position: Vector3;
  color: string;
  session: SessionWithSnapshot;
  state?: SessionVizState;
  isSelected: boolean;
  onSelect: () => void;
  modulePanelsEnabled: boolean;
  drawEnabled: boolean;
  onContextMenu?: (event: any) => void;
}) {
  const pulseRef = useRef<any>(null);
  const attention =
    session.status === 'WAITING_FOR_INPUT' ||
    session.status === 'WAITING_FOR_APPROVAL' ||
    session.status === 'ERROR';
  const attentionColor = session.status === 'ERROR' ? '#ED8796' : '#FCD34D';

  useFrame((stateFrame) => {
    if (!pulseRef.current) return;
    if (!attention) {
      pulseRef.current.visible = false;
      return;
    }
    pulseRef.current.visible = true;
    const material = pulseRef.current.material as any;
    material.opacity = 0.3 + Math.sin(stateFrame.clock.elapsedTime * 3) * 0.2;
  });

  return (
    <group
      position={position}
      raycast={drawEnabled ? (() => null) : undefined}
      onContextMenu={(event) => {
        if (drawEnabled) return;
        event.stopPropagation();
        event.nativeEvent.preventDefault();
        onContextMenu?.(event);
      }}
    >
      {/* Main platform - rectangular with rounded appearance */}
      <mesh castShadow receiveShadow onClick={(e) => { if (drawEnabled) return; e.stopPropagation(); onSelect(); }}>
        <cylinderGeometry args={[10, 10, 0.8, 32]} />
        <meshStandardMaterial color="#24273A" roughness={0.5} metalness={0.4} />
      </mesh>

      {/* Platform edge glow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.42, 0]}>
        <ringGeometry args={[9.5, 10.2, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.6} />
      </mesh>

      {/* Attention pulse ring */}
      <mesh ref={pulseRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.45, 0]}>
        <ringGeometry args={[10.3, 11.0, 32]} />
        <meshBasicMaterial color={attentionColor} transparent opacity={0.4} />
      </mesh>

      {/* Platform panel lines */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.41, 0]}>
        <ringGeometry args={[5, 5.1, 32]} />
        <meshBasicMaterial color="#363A4F" transparent opacity={0.8} />
      </mesh>

      {/* Session title */}
      <Text position={[0, 4.5, 0]} fontSize={0.8} color={color} anchorX="center" anchorY="middle">
        {session.title || session.cwd?.split('/').pop() || 'Orbit'}
      </Text>
      {session.git_branch && (
        <Text position={[0, 1.0, 3]} fontSize={0.4} color="#CAD3F5" anchorX="center" anchorY="middle">
          {session.git_branch}
        </Text>
      )}

      {/* Modules */}
      {Object.entries(MODULE_POSITIONS)
        .filter(([type]) => type !== 'center')
        .map(([type, offset]) => (
          <Module
            key={`${session.id}-${type}`}
            type={type as ModuleType}
            position={new Vector3(offset[0], offset[1], offset[2])}
            color={color}
            isActive={getModuleForTool(state?.currentTool || null) === type}
            toolContext={getModuleForTool(state?.currentTool || null) === type ? state?.toolContext || undefined : undefined}
            modulePanelsEnabled={modulePanelsEnabled}
            history={state?.moduleHistory?.[type as ModuleType]}
          />
        ))}

      {/* Selection indicator */}
      {isSelected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.46, 0]}>
          <ringGeometry args={[10.0, 10.4, 32]} />
          <meshBasicMaterial color="#A6DA95" transparent opacity={0.8} />
        </mesh>
      )}
    </group>
  );
}

function Module({
  type,
  position,
  color,
  isActive,
  toolContext,
  modulePanelsEnabled,
  history,
}: {
  type: ModuleType;
  position: Vector3;
  color: string;
  isActive: boolean;
  toolContext?: string;
  modulePanelsEnabled: boolean;
  history?: ToolHistoryItem[];
}) {
  return (
    <group position={position}>
      {/* Module base */}
      <mesh castShadow receiveShadow position={[0, 0.4, 0]}>
        <boxGeometry args={[1.6, 0.6, 1.2]} />
        <meshStandardMaterial color={isActive ? color : '#363A4F'} roughness={0.6} metalness={0.3} />
      </mesh>

      {/* Module details */}
      <ModuleDetails type={type} />

      {/* Label */}
      <Text position={[0, 1.8, 0]} fontSize={0.28} color={isActive ? color : '#6E738D'} anchorX="center" anchorY="middle">
        {MODULE_LABELS[type]}
      </Text>

      {/* Active tool context */}
      {toolContext && (
        <Text position={[0, 2.4, 0]} fontSize={0.24} color="#CAD3F5" anchorX="center" anchorY="middle" maxWidth={3.5}>
          {toolContext}
        </Text>
      )}

      {/* History panel */}
      {modulePanelsEnabled && (
        <ModulePanel
          history={history}
          label={MODULE_LABELS[type]}
          accentColor={color}
        />
      )}
    </group>
  );
}

function ModulePanel({
  history,
  label,
  accentColor,
}: {
  history?: ToolHistoryItem[];
  label: string;
  accentColor: string;
}) {
  const items = history ? history.slice(-3) : [];
  return (
    <group position={[0, 3.2, 0]}>
      <mesh>
        <planeGeometry args={[3.0, 1.5]} />
        <meshBasicMaterial color="#1A1B26" transparent opacity={0.9} />
      </mesh>
      <Text position={[0, 0.5, 0.01]} fontSize={0.22} color={accentColor} anchorX="center" anchorY="middle">
        {label}
      </Text>
      {items.length === 0 ? (
        <Text position={[0, 0.1, 0.01]} fontSize={0.2} color="#6E738D" anchorX="center" anchorY="middle">
          Standby
        </Text>
      ) : (
        items.map((item, idx) => (
          <Text
            key={`${item.timestamp}-${idx}`}
            position={[0, 0.1 - idx * 0.3, 0.01]}
            fontSize={0.18}
            color={item.success ? '#CAD3F5' : '#ED8796'}
            anchorX="center"
            anchorY="middle"
            maxWidth={2.6}
          >
            {item.text}
          </Text>
        ))
      )}
    </group>
  );
}
