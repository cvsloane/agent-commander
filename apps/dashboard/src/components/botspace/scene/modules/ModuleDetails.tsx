'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import type { ModuleType } from '@/lib/botspace/moduleMap';

interface ModuleDetailsProps {
  type: ModuleType;
}

/**
 * ModuleDetails renders the 3D visual details for each module type.
 * Each module has a distinct silhouette and appearance.
 */
export function ModuleDetails({ type }: ModuleDetailsProps) {
  const moduleColor = '#363A4F';
  const accentColor = '#F5A623';
  const glowColor = '#2DD4BF';

  switch (type) {
    case 'dataCore':
      // Data Core - tall cylindrical server with data rings
      return (
        <group>
          <mesh position={[0, 0.8, 0]}>
            <cylinderGeometry args={[0.4, 0.5, 1.2, 8]} />
            <meshStandardMaterial color={moduleColor} metalness={0.7} roughness={0.3} />
          </mesh>
          {/* Data rings */}
          {[0.4, 0.7, 1.0].map((y, i) => (
            <mesh key={i} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.45, 0.03, 8, 32]} />
              <meshStandardMaterial
                color={glowColor}
                emissive={glowColor}
                emissiveIntensity={0.3}
              />
            </mesh>
          ))}
          {/* Top glow */}
          <mesh position={[0, 1.45, 0]}>
            <sphereGeometry args={[0.15, 16, 16]} />
            <meshStandardMaterial
              color={glowColor}
              emissive={glowColor}
              emissiveIntensity={0.5}
              transparent
              opacity={0.8}
            />
          </mesh>
        </group>
      );

    case 'commandDeck':
      // Command Deck - console with angled screens
      return (
        <group>
          {/* Main console base */}
          <mesh position={[0, 0.3, 0]}>
            <boxGeometry args={[1.4, 0.4, 0.8]} />
            <meshStandardMaterial color={moduleColor} metalness={0.6} roughness={0.4} />
          </mesh>
          {/* Angled display */}
          <mesh position={[0, 0.7, -0.1]} rotation={[-0.3, 0, 0]}>
            <boxGeometry args={[1.2, 0.6, 0.05]} />
            <meshStandardMaterial
              color="#1A1B26"
              emissive={accentColor}
              emissiveIntensity={0.2}
            />
          </mesh>
          {/* Status lights */}
          {[-0.4, 0, 0.4].map((x, i) => (
            <mesh key={i} position={[x, 0.55, 0.35]}>
              <boxGeometry args={[0.1, 0.1, 0.05]} />
              <meshStandardMaterial
                color={i === 1 ? accentColor : glowColor}
                emissive={i === 1 ? accentColor : glowColor}
                emissiveIntensity={0.5}
              />
            </mesh>
          ))}
        </group>
      );

    case 'fabricator':
      // Fabricator - industrial arm/manipulator style
      return (
        <group>
          {/* Base platform */}
          <mesh position={[0, 0.15, 0]}>
            <cylinderGeometry args={[0.6, 0.7, 0.3, 6]} />
            <meshStandardMaterial color={moduleColor} metalness={0.7} roughness={0.3} />
          </mesh>
          {/* Arm segments */}
          <mesh position={[0, 0.6, 0]} rotation={[0, 0, 0.2]}>
            <boxGeometry args={[0.15, 0.8, 0.15]} />
            <meshStandardMaterial color="#6E738D" metalness={0.6} roughness={0.4} />
          </mesh>
          <mesh position={[0.2, 1.0, 0]} rotation={[0, 0, -0.4]}>
            <boxGeometry args={[0.12, 0.5, 0.12]} />
            <meshStandardMaterial color="#6E738D" metalness={0.6} roughness={0.4} />
          </mesh>
          {/* Tool head */}
          <mesh position={[0.35, 1.2, 0]}>
            <coneGeometry args={[0.1, 0.2, 8]} />
            <meshStandardMaterial
              color={accentColor}
              emissive={accentColor}
              emissiveIntensity={0.4}
            />
          </mesh>
        </group>
      );

    case 'shellBay':
      // Shell Bay - terminal/console bank
      return (
        <group>
          {/* Terminal bank */}
          <mesh position={[0, 0.5, 0]}>
            <boxGeometry args={[1.2, 0.8, 0.4]} />
            <meshStandardMaterial color={moduleColor} metalness={0.5} roughness={0.5} />
          </mesh>
          {/* Screen grid */}
          {[-0.35, 0, 0.35].map((x, i) => (
            <mesh key={i} position={[x, 0.6, 0.21]}>
              <boxGeometry args={[0.28, 0.5, 0.02]} />
              <meshStandardMaterial
                color="#1A1B26"
                emissive={glowColor}
                emissiveIntensity={0.15}
              />
            </mesh>
          ))}
          {/* Keyboard ledge */}
          <mesh position={[0, 0.15, 0.35]}>
            <boxGeometry args={[1.0, 0.1, 0.3]} />
            <meshStandardMaterial color="#24273A" metalness={0.4} roughness={0.6} />
          </mesh>
        </group>
      );

    case 'sensorArray':
      // Sensor Array - dish and scanner apparatus
      return (
        <group>
          {/* Base */}
          <mesh position={[0, 0.2, 0]}>
            <boxGeometry args={[0.8, 0.4, 0.8]} />
            <meshStandardMaterial color={moduleColor} metalness={0.6} roughness={0.4} />
          </mesh>
          {/* Dish mount */}
          <mesh position={[0, 0.6, 0]}>
            <cylinderGeometry args={[0.1, 0.15, 0.4, 8]} />
            <meshStandardMaterial color="#6E738D" metalness={0.7} roughness={0.3} />
          </mesh>
          {/* Scanner dish */}
          <mesh position={[0, 0.9, 0]} rotation={[Math.PI / 6, 0, 0]}>
            <coneGeometry args={[0.5, 0.25, 32, 1, true]} />
            <meshStandardMaterial
              color="#CAD3F5"
              metalness={0.8}
              roughness={0.2}
              side={THREE.DoubleSide}
            />
          </mesh>
          {/* Sensor tip */}
          <mesh position={[0, 1.1, -0.1]}>
            <sphereGeometry args={[0.08, 16, 16]} />
            <meshStandardMaterial
              color={glowColor}
              emissive={glowColor}
              emissiveIntensity={0.6}
            />
          </mesh>
        </group>
      );

    case 'commRelay':
      // Comm Relay - antenna array
      return (
        <group>
          {/* Base */}
          <mesh position={[0, 0.15, 0]}>
            <cylinderGeometry args={[0.5, 0.6, 0.3, 8]} />
            <meshStandardMaterial color={moduleColor} metalness={0.6} roughness={0.4} />
          </mesh>
          {/* Central mast */}
          <mesh position={[0, 0.8, 0]}>
            <cylinderGeometry args={[0.05, 0.08, 1.2, 8]} />
            <meshStandardMaterial color="#6E738D" metalness={0.7} roughness={0.3} />
          </mesh>
          {/* Antenna arms */}
          {[0, Math.PI / 2, Math.PI, Math.PI * 1.5].map((angle, i) => (
            <mesh
              key={i}
              position={[Math.cos(angle) * 0.3, 1.2, Math.sin(angle) * 0.3]}
              rotation={[Math.PI / 4, angle, 0]}
            >
              <cylinderGeometry args={[0.02, 0.02, 0.4, 6]} />
              <meshStandardMaterial color="#CAD3F5" metalness={0.6} roughness={0.4} />
            </mesh>
          ))}
          {/* Signal indicator */}
          <mesh position={[0, 1.5, 0]}>
            <sphereGeometry args={[0.1, 16, 16]} />
            <meshStandardMaterial
              color={accentColor}
              emissive={accentColor}
              emissiveIntensity={0.5}
            />
          </mesh>
        </group>
      );

    case 'airlock':
      // Airlock - portal/gateway structure
      return (
        <group>
          {/* Frame */}
          <mesh position={[0, 0.8, 0]}>
            <torusGeometry args={[0.6, 0.1, 8, 32]} />
            <meshStandardMaterial color={moduleColor} metalness={0.7} roughness={0.3} />
          </mesh>
          {/* Inner ring */}
          <mesh position={[0, 0.8, 0]}>
            <torusGeometry args={[0.45, 0.05, 8, 32]} />
            <meshStandardMaterial
              color={glowColor}
              emissive={glowColor}
              emissiveIntensity={0.4}
            />
          </mesh>
          {/* Portal surface */}
          <mesh position={[0, 0.8, 0]}>
            <circleGeometry args={[0.4, 32]} />
            <meshBasicMaterial
              color="#2DD4BF"
              transparent
              opacity={0.3}
            />
          </mesh>
          {/* Base support */}
          <mesh position={[0, 0.15, 0]}>
            <boxGeometry args={[1.0, 0.3, 0.4]} />
            <meshStandardMaterial color={moduleColor} metalness={0.5} roughness={0.5} />
          </mesh>
        </group>
      );

    case 'missionBoard':
      // Mission Board - display panel
      return (
        <group>
          {/* Stand */}
          <mesh position={[0, 0.5, 0]}>
            <boxGeometry args={[0.15, 1.0, 0.15]} />
            <meshStandardMaterial color={moduleColor} metalness={0.6} roughness={0.4} />
          </mesh>
          {/* Board */}
          <mesh position={[0, 0.9, 0.2]}>
            <boxGeometry args={[1.2, 0.8, 0.05]} />
            <meshStandardMaterial color="#1A1B26" metalness={0.3} roughness={0.7} />
          </mesh>
          {/* Task items (decorative) */}
          {[-0.4, -0.1, 0.2].map((y, i) => (
            <mesh key={i} position={[0, 0.9 + y * 0.3, 0.23]}>
              <boxGeometry args={[1.0, 0.15, 0.01]} />
              <meshStandardMaterial
                color={i === 0 ? accentColor : i === 1 ? glowColor : '#A6DA95'}
                emissive={i === 0 ? accentColor : i === 1 ? glowColor : '#A6DA95'}
                emissiveIntensity={0.3}
              />
            </mesh>
          ))}
        </group>
      );

    case 'center':
    default:
      // Center hub - simple beacon
      return (
        <group>
          <mesh position={[0, 0.3, 0]}>
            <octahedronGeometry args={[0.3]} />
            <meshStandardMaterial
              color={accentColor}
              emissive={accentColor}
              emissiveIntensity={0.3}
              transparent
              opacity={0.8}
            />
          </mesh>
        </group>
      );
  }
}
