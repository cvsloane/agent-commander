'use client';

import { useEffect } from 'react';
import { BotspaceOrbit } from '@/components/botspace/BotspaceOrbit';

/**
 * BotspaceTheme
 *
 * Space station / orbital habitat theme for the visualizer.
 * Features floating platforms, OrbBot characters, and amber/teal aesthetics.
 *
 * This theme wraps the BotspaceOrbit component which contains the 3D scene,
 * platform grid, and all orbital functionality.
 */
export function BotspaceTheme() {
  // Cleanup on unmount (theme switch)
  useEffect(() => {
    return () => {
      // Three.js cleanup is handled internally by BotspaceOrbit
      // via its useEffect cleanup functions and Canvas disposal
    };
  }, []);

  return <BotspaceOrbit />;
}
