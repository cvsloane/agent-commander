'use client';

import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import { useRef } from 'react';
import { Group, Mesh, Vector3 } from 'three';
import { useSpring, animated } from '@react-spring/three';

interface OrbBotProps {
  position: Vector3;
  state: 'idle' | 'thinking' | 'working' | 'finished' | 'error';
  color: string;
  name?: string;
  onClick?: () => void;
  scale?: number;
}

// Status colors for the eye display
const STATUS_COLORS = {
  idle: '#F5A623',     // Amber
  thinking: '#C4B5FD', // Lavender (pulsing)
  working: '#2DD4BF',  // Teal
  finished: '#A6DA95', // Green flash
  error: '#ED8796',    // Red
};

export function OrbBot({ position, state, color, name, onClick, scale = 1 }: OrbBotProps) {
  const groupRef = useRef<Group>(null);
  const bobRef = useRef<Group>(null);
  const eyeRef = useRef<Mesh>(null);
  const thrusterRef = useRef<Mesh>(null);
  const leftArmRef = useRef<Group>(null);
  const rightArmRef = useRef<Group>(null);
  const dishRef = useRef<Mesh>(null);

  const { pos } = useSpring({
    pos: [position.x, position.y, position.z],
    config: { mass: 1, tension: 180, friction: 28 },
  });

  useFrame((stateFrame) => {
    const t = stateFrame.clock.elapsedTime;

    // Floating/bobbing animation
    if (bobRef.current) {
      const bobSpeed = state === 'working' ? 3 : 1.5;
      const bobAmount = state === 'working' ? 0.08 : 0.05;
      bobRef.current.position.y = Math.sin(t * bobSpeed) * bobAmount;

      // Slow rotation when thinking
      if (state === 'thinking') {
        bobRef.current.rotation.y += 0.003;
      }
    }

    // Eye pulsing effect
    if (eyeRef.current) {
      const eyeMat = eyeRef.current.material as any;
      if (state === 'thinking') {
        // Pulsing effect
        const pulse = 0.5 + Math.sin(t * 4) * 0.5;
        eyeMat.emissiveIntensity = 0.4 + pulse * 0.6;
      } else if (state === 'working') {
        eyeMat.emissiveIntensity = 1.0;
      } else if (state === 'error') {
        // Warning flash pattern
        eyeMat.emissiveIntensity = Math.sin(t * 8) > 0 ? 1.2 : 0.3;
      } else {
        eyeMat.emissiveIntensity = 0.6;
      }
    }

    // Thruster glow when working
    if (thrusterRef.current) {
      const thrusterMat = thrusterRef.current.material as any;
      if (state === 'working') {
        thrusterMat.opacity = 0.6 + Math.sin(t * 10) * 0.2;
        thrusterMat.emissiveIntensity = 1.0;
      } else {
        thrusterMat.opacity = 0.2;
        thrusterMat.emissiveIntensity = 0.3;
      }
    }

    // Retractable arms animation when working
    if (leftArmRef.current && rightArmRef.current) {
      const extended = state === 'working' ? 0.15 : 0;
      const armSwing = state === 'working' ? Math.sin(t * 6) * 0.3 : 0;

      leftArmRef.current.position.x = -0.38 - extended;
      leftArmRef.current.rotation.z = armSwing;

      rightArmRef.current.position.x = 0.38 + extended;
      rightArmRef.current.rotation.z = -armSwing;
    }

    // Dish antenna rotation
    if (dishRef.current) {
      dishRef.current.rotation.y = t * 0.5;
    }
  });

  const eyeColor = STATUS_COLORS[state] || STATUS_COLORS.idle;

  return (
    <animated.group
      position={pos as any}
      ref={groupRef}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      <group ref={bobRef} scale={scale}>
        {/* Main spherical body */}
        <mesh position={[0, 0.5, 0]} castShadow>
          <sphereGeometry args={[0.35, 32, 32]} />
          <meshStandardMaterial
            color={color}
            roughness={0.2}
            metalness={0.8}
            envMapIntensity={1.2}
          />
        </mesh>

        {/* Body panel lines (decorative rings) */}
        <mesh position={[0, 0.5, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.35, 0.015, 8, 32]} />
          <meshStandardMaterial color="#1A1B26" roughness={0.5} metalness={0.3} />
        </mesh>
        <mesh position={[0, 0.5, 0]} rotation={[0, 0, Math.PI / 2]}>
          <torusGeometry args={[0.35, 0.01, 8, 32]} />
          <meshStandardMaterial color="#1A1B26" roughness={0.5} metalness={0.3} />
        </mesh>

        {/* Single circular eye display */}
        <mesh ref={eyeRef} position={[0, 0.55, 0.32]}>
          <circleGeometry args={[0.12, 32]} />
          <meshStandardMaterial
            color={eyeColor}
            emissive={eyeColor}
            emissiveIntensity={0.6}
            roughness={0.3}
          />
        </mesh>

        {/* Eye socket/frame */}
        <mesh position={[0, 0.55, 0.31]}>
          <ringGeometry args={[0.12, 0.15, 32]} />
          <meshStandardMaterial color="#1A1B26" roughness={0.7} metalness={0.2} />
        </mesh>

        {/* Inner eye detail (pupil-like) */}
        <mesh position={[0, 0.55, 0.33]}>
          <circleGeometry args={[0.04, 16]} />
          <meshBasicMaterial color="#1A1B26" />
        </mesh>

        {/* Thruster ring at bottom */}
        <mesh ref={thrusterRef} position={[0, 0.12, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.2, 0.05, 16, 32]} />
          <meshStandardMaterial
            color="#2DD4BF"
            emissive="#2DD4BF"
            emissiveIntensity={0.3}
            transparent
            opacity={0.2}
          />
        </mesh>

        {/* Thruster glow effect */}
        <mesh position={[0, 0.05, 0]}>
          <cylinderGeometry args={[0.15, 0.05, 0.15, 16]} />
          <meshBasicMaterial
            color="#2DD4BF"
            transparent
            opacity={state === 'working' ? 0.4 : 0.1}
          />
        </mesh>

        {/* Dish antenna on top */}
        <group position={[0, 0.9, 0]}>
          {/* Antenna stalk */}
          <mesh>
            <cylinderGeometry args={[0.02, 0.02, 0.15, 8]} />
            <meshStandardMaterial color="#6E738D" metalness={0.7} roughness={0.3} />
          </mesh>
          {/* Dish */}
          <mesh ref={dishRef} position={[0, 0.12, 0]} rotation={[Math.PI / 4, 0, 0]}>
            <coneGeometry args={[0.08, 0.04, 16, 1, true]} />
            <meshStandardMaterial
              color="#CAD3F5"
              side={2}
              metalness={0.8}
              roughness={0.2}
            />
          </mesh>
          {/* Antenna tip */}
          <mesh position={[0, 0.1, 0]}>
            <sphereGeometry args={[0.03, 8, 8]} />
            <meshStandardMaterial
              color={eyeColor}
              emissive={eyeColor}
              emissiveIntensity={0.4}
            />
          </mesh>
        </group>

        {/* Retractable arms */}
        <group ref={leftArmRef} position={[-0.38, 0.5, 0]}>
          {/* Arm segment */}
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <capsuleGeometry args={[0.04, 0.12, 4, 8]} />
            <meshStandardMaterial color="#6E738D" metalness={0.6} roughness={0.4} />
          </mesh>
          {/* Gripper */}
          <mesh position={[-0.12, 0, 0]}>
            <boxGeometry args={[0.06, 0.08, 0.06]} />
            <meshStandardMaterial color="#363A4F" metalness={0.5} roughness={0.5} />
          </mesh>
        </group>

        <group ref={rightArmRef} position={[0.38, 0.5, 0]}>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <capsuleGeometry args={[0.04, 0.12, 4, 8]} />
            <meshStandardMaterial color="#6E738D" metalness={0.6} roughness={0.4} />
          </mesh>
          <mesh position={[0.12, 0, 0]}>
            <boxGeometry args={[0.06, 0.08, 0.06]} />
            <meshStandardMaterial color="#363A4F" metalness={0.5} roughness={0.5} />
          </mesh>
        </group>

        {/* Status glow ring around body */}
        <mesh position={[0, 0.5, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.36, 0.42, 32]} />
          <meshBasicMaterial
            color={eyeColor}
            transparent
            opacity={state === 'working' ? 0.6 : state === 'thinking' ? 0.4 : 0.2}
          />
        </mesh>
      </group>

      {/* Name tag */}
      {name && (
        <group position={[0, 1.3, 0]}>
          <mesh>
            <planeGeometry args={[1.6, 0.35]} />
            <meshBasicMaterial color="#1A1B26" transparent opacity={0.85} />
          </mesh>
          <Text position={[0, 0, 0.01]} fontSize={0.18} color="#CAD3F5" anchorX="center" anchorY="middle">
            {name.length > 14 ? `${name.slice(0, 12)}...` : name}
          </Text>
        </group>
      )}
    </animated.group>
  );
}
