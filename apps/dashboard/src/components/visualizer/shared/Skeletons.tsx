'use client';

import type { CSSProperties } from 'react';
import { useVisualizerThemeStore } from '@/stores/visualizerTheme';

/**
 * Skeleton components for loading states across visualizer themes.
 * Uses CSS shimmer animation that adapts to current theme colors.
 */

interface SkeletonProps {
  className?: string;
  style?: CSSProperties;
}

/**
 * Base skeleton component with shimmer animation
 */
export function Skeleton({ className = '', style }: SkeletonProps) {
  return (
    <div
      className={`viz-skeleton ${className}`}
      style={style}
      aria-hidden="true"
    />
  );
}

/**
 * Session list skeleton - shows 4 pulsing card shapes
 */
export function SessionListSkeleton() {
  const theme = useVisualizerThemeStore((state) => state.theme);
  const isLCARS = theme === 'bridge-control';

  return (
    <div className="viz-skeleton-list" role="status" aria-label="Loading sessions">
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className={`viz-skeleton-card ${isLCARS ? 'viz-skeleton-card--lcars' : ''}`}
          style={{ animationDelay: `${i * 100}ms` }}
        >
          <Skeleton className="viz-skeleton-icon" />
          <div className="viz-skeleton-content">
            <Skeleton className="viz-skeleton-title" />
            <Skeleton className="viz-skeleton-subtitle" />
          </div>
        </div>
      ))}
      <span className="viz-sr-only">Loading sessions...</span>
    </div>
  );
}

/**
 * Activity feed skeleton - shows 5 pulsing line items
 */
export function ActivityFeedSkeleton() {
  return (
    <div className="viz-skeleton-feed" role="status" aria-label="Loading activity">
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="viz-skeleton-feed-item"
          style={{ animationDelay: `${i * 75}ms` }}
        >
          <Skeleton className="viz-skeleton-category" />
          <div className="viz-skeleton-feed-content">
            <Skeleton className="viz-skeleton-tool" />
            <Skeleton className="viz-skeleton-context" />
          </div>
          <Skeleton className="viz-skeleton-time" />
        </div>
      ))}
      <span className="viz-sr-only">Loading activity...</span>
    </div>
  );
}

/**
 * Metrics skeleton - shows pulsing number blocks
 */
export function MetricsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="viz-skeleton-metrics" role="status" aria-label="Loading metrics">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="viz-skeleton-metric"
          style={{ animationDelay: `${i * 50}ms` }}
        >
          <Skeleton className="viz-skeleton-metric-value" />
          <Skeleton className="viz-skeleton-metric-label" />
        </div>
      ))}
      <span className="viz-sr-only">Loading metrics...</span>
    </div>
  );
}

/**
 * Hex map skeleton - shows shimmer effect on grid pattern
 */
export function HexMapSkeleton() {
  return (
    <div className="viz-skeleton-hexmap" role="status" aria-label="Loading map">
      <svg viewBox="0 0 400 300" className="viz-skeleton-hexmap-svg">
        {/* Generate placeholder hex pattern */}
        {[0, 1, 2].map((row) =>
          [0, 1, 2, 3, 4].map((col) => {
            const x = 40 + col * 70 + (row % 2 === 1 ? 35 : 0);
            const y = 50 + row * 60;
            return (
              <polygon
                key={`${row}-${col}`}
                points={getHexPoints(x, y, 30)}
                className="viz-skeleton-hex"
                style={{ animationDelay: `${(row * 5 + col) * 50}ms` }}
              />
            );
          })
        )}
      </svg>
      <span className="viz-sr-only">Loading map...</span>
    </div>
  );
}

/**
 * Territory list skeleton - shows grouped card placeholders
 */
export function TerritoryListSkeleton() {
  return (
    <div className="viz-skeleton-territories" role="status" aria-label="Loading territories">
      <Skeleton className="viz-skeleton-group-title" />
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="viz-skeleton-territory"
          style={{ animationDelay: `${i * 100}ms` }}
        >
          <Skeleton className="viz-skeleton-territory-icon" />
          <div className="viz-skeleton-territory-info">
            <Skeleton className="viz-skeleton-territory-name" />
            <Skeleton className="viz-skeleton-territory-status" />
          </div>
        </div>
      ))}
      <span className="viz-sr-only">Loading territories...</span>
    </div>
  );
}

/**
 * Panel skeleton - generic panel placeholder
 */
export function PanelSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="viz-skeleton-panel" role="status" aria-label="Loading panel">
      <Skeleton className="viz-skeleton-panel-header" />
      <div className="viz-skeleton-panel-body">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton
            key={i}
            className="viz-skeleton-line"
            style={{ width: `${100 - i * 15}%`, animationDelay: `${i * 100}ms` } as CSSProperties}
          />
        ))}
      </div>
      <span className="viz-sr-only">Loading...</span>
    </div>
  );
}

// Helper to generate hex polygon points
function getHexPoints(cx: number, cy: number, size: number): string {
  const points: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    const x = cx + size * Math.cos(angle);
    const y = cy + size * Math.sin(angle);
    points.push(`${x},${y}`);
  }
  return points.join(' ');
}
