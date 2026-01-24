'use client';

import { useRef, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useSpring, animated } from '@react-spring/three';
import { Float, Text } from '@react-three/drei';
import type { Mesh, Group } from 'three';

interface ClaudeCharacterProps {
  position: [number, number, number];
  isActive: boolean;
  currentTool?: string;
  // Multi-session props
  sessionId?: string;
  sessionColor?: string;
  sessionName?: string;
  isSelected?: boolean;
  onClick?: (sessionId: string) => void;
  // Position offset for collision avoidance
  positionOffset?: [number, number, number];
}

/**
 * Animated Claude character that moves between stations
 * and shows activity state.
 */
export function ClaudeCharacter({
  position,
  isActive,
  currentTool,
  sessionId,
  sessionColor,
  sessionName,
  isSelected = false,
  onClick,
  positionOffset = [0, 0, 0],
}: ClaudeCharacterProps) {
  const groupRef = useRef<Group>(null);
  const bodyRef = useRef<Mesh>(null);
  const eyeRef = useRef<Mesh>(null);
  const [hovered, setHovered] = useState(false);

  // Handle cursor change on hover
  useEffect(() => {
    if (onClick) {
      document.body.style.cursor = hovered ? 'pointer' : 'auto';
    }
    return () => {
      document.body.style.cursor = 'auto';
    };
  }, [hovered, onClick]);

  // Calculate final position with offset
  const finalPosition: [number, number, number] = [
    position[0] + positionOffset[0],
    position[1] + positionOffset[1],
    position[2] + positionOffset[2],
  ];

  // Smooth position animation
  const { pos } = useSpring({
    pos: finalPosition,
    config: { mass: 1, tension: 180, friction: 30 },
  });

  // Idle animation
  useFrame((state) => {
    if (groupRef.current) {
      // Gentle bobbing
      groupRef.current.position.y = Math.sin(state.clock.elapsedTime * 2) * 0.05 + 0.5;
    }
    if (bodyRef.current && isActive) {
      // Subtle rotation when active
      bodyRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 3) * 0.1;
    }
    if (eyeRef.current) {
      // Eye glow pulsing
      const material = eyeRef.current.material as any;
      if (material.emissiveIntensity !== undefined) {
        material.emissiveIntensity = isActive
          ? 0.8 + Math.sin(state.clock.elapsedTime * 4) * 0.2
          : 0.3;
      }
    }
  });

  // Color based on session or current tool
  const getToolColor = () => {
    // If session has a specific color, use it when active
    if (sessionColor && isActive) {
      return sessionColor;
    }
    switch (currentTool) {
      case 'Read':
        return '#3b82f6'; // Blue
      case 'Write':
      case 'Edit':
        return '#22c55e'; // Green
      case 'Bash':
        return '#f97316'; // Orange
      case 'Grep':
      case 'Glob':
        return '#a855f7'; // Purple
      case 'WebFetch':
      case 'WebSearch':
        return '#06b6d4'; // Cyan
      default:
        return sessionColor || '#f8fafc'; // Use session color or white
    }
  };

  // Get a truncated session name for display
  const displayName = sessionName
    ? sessionName.length > 12
      ? sessionName.slice(0, 12) + '...'
      : sessionName
    : undefined;

  return (
    <animated.group
      position={pos as any}
      ref={groupRef}
      onClick={(e) => {
        if (onClick && sessionId) {
          e.stopPropagation();
          onClick(sessionId);
        }
      }}
      onPointerOver={() => onClick && setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      <Float speed={3} rotationIntensity={0.2} floatIntensity={0.3}>
        {/* Body - stylized Claude shape */}
        <mesh ref={bodyRef} castShadow receiveShadow>
          <capsuleGeometry args={[0.3, 0.6, 8, 16]} />
          <meshStandardMaterial
            color="#e2e8f0"
            roughness={0.2}
            metalness={0.1}
          />
        </mesh>

        {/* Face plate */}
        <mesh position={[0, 0.1, 0.25]}>
          <planeGeometry args={[0.4, 0.3]} />
          <meshStandardMaterial
            color="#0f172a"
            roughness={0.8}
          />
        </mesh>

        {/* Eye - indicator light */}
        <mesh
          ref={eyeRef}
          position={[0, 0.15, 0.26]}
        >
          <circleGeometry args={[0.08, 16]} />
          <meshStandardMaterial
            color={getToolColor()}
            emissive={getToolColor()}
            emissiveIntensity={isActive ? 0.8 : 0.3}
          />
        </mesh>

        {/* Activity indicator ring */}
        {isActive && (
          <mesh position={[0, 0.15, 0.27]}>
            <ringGeometry args={[0.1, 0.12, 32]} />
            <meshBasicMaterial
              color={getToolColor()}
              transparent
              opacity={0.5}
            />
          </mesh>
        )}

        {/* Arms (when active) */}
        {isActive && (
          <>
            <mesh position={[-0.35, 0, 0]} rotation={[0, 0, Math.PI / 4]}>
              <capsuleGeometry args={[0.05, 0.3, 4, 8]} />
              <meshStandardMaterial color="#cbd5e1" />
            </mesh>
            <mesh position={[0.35, 0, 0]} rotation={[0, 0, -Math.PI / 4]}>
              <capsuleGeometry args={[0.05, 0.3, 4, 8]} />
              <meshStandardMaterial color="#cbd5e1" />
            </mesh>
          </>
        )}
      </Float>

      {/* Shadow plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.49, 0]}>
        <circleGeometry args={[0.4, 32]} />
        <meshBasicMaterial color="#000" transparent opacity={0.3} />
      </mesh>

      {/* Selection ring */}
      {isSelected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.48, 0]}>
          <ringGeometry args={[0.5, 0.6, 32]} />
          <meshBasicMaterial color="#22c55e" transparent opacity={0.8} />
        </mesh>
      )}

      {/* Hover ring */}
      {hovered && !isSelected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.48, 0]}>
          <ringGeometry args={[0.5, 0.55, 32]} />
          <meshBasicMaterial color="#94a3b8" transparent opacity={0.5} />
        </mesh>
      )}

      {/* Session name label */}
      {displayName && (
        <Text
          position={[0, 1.3, 0]}
          fontSize={0.12}
          color={sessionColor || '#f8fafc'}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.01}
          outlineColor="#0f172a"
        >
          {displayName}
        </Text>
      )}
    </animated.group>
  );
}
