'use client';

import { useMemo, useState, useEffect } from 'react';
import { HexAnnotation } from './HexAnnotation';
import { useWorkshopStore } from '@/stores/workshop';

interface HexGridProps {
  annotationsEnabled?: boolean;
}

/**
 * Generates a hexagonal grid of tiles for the workshop floor.
 * Supports click-to-annotate when annotations are enabled.
 */
export function HexGrid({ annotationsEnabled = true }: HexGridProps) {
  const { annotations, addAnnotation, removeAnnotation } = useWorkshopStore();
  const [hoveredTile, setHoveredTile] = useState<number | null>(null);

  // Handle cursor change on hover when annotations are enabled
  useEffect(() => {
    if (annotationsEnabled && hoveredTile !== null) {
      document.body.style.cursor = 'crosshair';
    } else if (hoveredTile !== null) {
      document.body.style.cursor = 'auto';
    }
    return () => {
      document.body.style.cursor = 'auto';
    };
  }, [hoveredTile, annotationsEnabled]);

  // Generate hex tile positions
  const tiles = useMemo(() => {
    const result: [number, number][] = [];
    const radius = 6;
    const tileSize = 0.8;
    const hexWidth = tileSize * Math.sqrt(3);
    const hexHeight = tileSize * 1.5;

    for (let q = -radius; q <= radius; q++) {
      const r1 = Math.max(-radius, -q - radius);
      const r2 = Math.min(radius, -q + radius);
      for (let r = r1; r <= r2; r++) {
        const x = hexWidth * (q + r / 2);
        const z = hexHeight * r;
        result.push([x, z]);
      }
    }

    return result;
  }, []);

  // Handle tile click
  const handleTileClick = (tileIndex: number, position: [number, number]) => {
    if (!annotationsEnabled) return;

    const existing = annotations.find((a) => a.tileIndex === tileIndex);
    if (existing) {
      removeAnnotation(existing.id);
    } else {
      addAnnotation(tileIndex, [position[0], 0.1, position[1]], 'Note');
    }
  };

  // Handle annotation click (remove)
  const handleAnnotationClick = (id: string) => {
    removeAnnotation(id);
  };

  return (
    <group position={[0, -0.5, 0]}>
      {tiles.map(([x, z], i) => {
        const isHovered = hoveredTile === i && annotationsEnabled;
        const hasAnnotation = annotations.some((a) => a.tileIndex === i);

        return (
          <mesh
            key={i}
            position={[x, 0, z]}
            rotation={[-Math.PI / 2, 0, Math.PI / 6]}
            receiveShadow
            onClick={(e) => {
              e.stopPropagation();
              handleTileClick(i, [x, z]);
            }}
            onPointerOver={() => setHoveredTile(i)}
            onPointerOut={() => setHoveredTile(null)}
          >
            <circleGeometry args={[0.38, 6]} />
            <meshStandardMaterial
              color={isHovered ? '#334155' : hasAnnotation ? '#1e3a5f' : '#1e293b'}
              roughness={0.9}
              metalness={0.1}
            />
          </mesh>
        );
      })}

      {/* Grid lines between tiles */}
      {tiles.map(([x, z], i) => {
        const isHovered = hoveredTile === i && annotationsEnabled;

        return (
          <mesh
            key={`outline-${i}`}
            position={[x, 0.01, z]}
            rotation={[-Math.PI / 2, 0, Math.PI / 6]}
          >
            <ringGeometry args={[0.36, 0.4, 6]} />
            <meshBasicMaterial
              color={isHovered ? '#22c55e' : '#334155'}
              transparent
              opacity={isHovered ? 0.8 : 0.5}
            />
          </mesh>
        );
      })}

      {/* Central platform highlight */}
      <mesh
        position={[0, 0.02, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <circleGeometry args={[1.2, 32]} />
        <meshBasicMaterial
          color="#475569"
          transparent
          opacity={0.3}
        />
      </mesh>

      {/* Annotations */}
      {annotationsEnabled &&
        annotations.map((annotation) => (
          <HexAnnotation
            key={annotation.id}
            position={annotation.position}
            label={annotation.label}
            color={annotation.color}
            onClick={() => handleAnnotationClick(annotation.id)}
          />
        ))}
    </group>
  );
}
