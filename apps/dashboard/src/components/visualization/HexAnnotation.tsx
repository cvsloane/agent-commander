'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import type { Mesh } from 'three';

interface HexAnnotationProps {
  position: [number, number, number];
  label: string;
  color?: string;
  onClick?: () => void;
}

/**
 * Annotation marker for hex tiles - renders a cone with a label.
 */
export function HexAnnotation({
  position,
  label,
  color = '#22c55e',
  onClick,
}: HexAnnotationProps) {
  const markerRef = useRef<Mesh>(null);

  // Gentle bobbing animation
  useFrame((state) => {
    if (markerRef.current) {
      markerRef.current.position.y =
        position[1] + 0.3 + Math.sin(state.clock.elapsedTime * 2) * 0.05;
    }
  });

  return (
    <group position={[position[0], 0, position[2]]}>
      {/* Cone marker */}
      <mesh
        ref={markerRef}
        position={[0, position[1] + 0.3, 0]}
        rotation={[Math.PI, 0, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onClick?.();
        }}
      >
        <coneGeometry args={[0.15, 0.3, 8]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.3}
        />
      </mesh>

      {/* Base glow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, position[1] + 0.02, 0]}>
        <ringGeometry args={[0.1, 0.2, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.5} />
      </mesh>

      {/* Label */}
      <Text
        position={[0, position[1] + 0.7, 0]}
        fontSize={0.1}
        color={color}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.01}
        outlineColor="#0f172a"
      >
        {label}
      </Text>
    </group>
  );
}
