'use client';

import { Suspense, lazy, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useVisualizerThemeStore } from '@/stores/visualizerTheme';
import { ThemeSwitcher } from './shared/ThemeSwitcher';

// Lazy load theme components for code splitting
// This ensures heavy themes (like Botspace with Three.js) only load when needed
const BotspaceTheme = lazy(() =>
  import('./themes/botspace/BotspaceTheme').then((mod) => ({ default: mod.BotspaceTheme }))
);
const CivilizationTheme = lazy(() =>
  import('./themes/civilization/CivilizationTheme').then((mod) => ({ default: mod.CivilizationTheme }))
);
const BridgeControlTheme = lazy(() =>
  import('./themes/bridge-control/BridgeControlTheme').then((mod) => ({ default: mod.BridgeControlTheme }))
);

function LoadingFallback() {
  return (
    <div className="visualizer-loading">
      <div className="visualizer-loading-spinner" />
    </div>
  );
}

export function VisualizerPage() {
  const { theme } = useVisualizerThemeStore();
  const previousThemeRef = useRef(theme);

  // Track theme changes for cleanup purposes
  useEffect(() => {
    if (previousThemeRef.current !== theme) {
      // Theme changed - cleanup will be handled by individual theme components
      // via their useEffect cleanup functions
      previousThemeRef.current = theme;
    }
  }, [theme]);

  // Render the appropriate theme component based on current selection
  const renderTheme = () => {
    switch (theme) {
      case 'civilization':
        return <CivilizationTheme />;
      case 'bridge-control':
        return <BridgeControlTheme />;
      case 'botspace':
      default:
        return <BotspaceTheme />;
    }
  };

  return (
    <>
      {/* Theme switcher overlay - always visible */}
      <div className="visualizer-theme-switcher-container">
        <ThemeSwitcher />
      </div>

      <div className="visualizer-exit-container">
        <Link href="/sessions" className="visualizer-exit-button">
          Back to Console
        </Link>
      </div>

      {/* Theme-specific content with suspense boundary */}
      <Suspense fallback={<LoadingFallback />}>
        {renderTheme()}
      </Suspense>
    </>
  );
}
