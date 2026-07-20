'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useVisualizerThemeStore } from '@/stores/visualizerTheme';
import { ThemeSwitcher } from './shared/ThemeSwitcher';

function LoadingFallback() {
  return (
    <div className="visualizer-loading">
      <div className="visualizer-loading-spinner" />
    </div>
  );
}

const BotspaceTheme = dynamic(
  () => import('./themes/botspace/BotspaceTheme').then((mod) => mod.BotspaceTheme),
  { ssr: false, loading: LoadingFallback }
);
const CivilizationTheme = dynamic(
  () => import('./themes/civilization/CivilizationTheme').then((mod) => mod.CivilizationTheme),
  { ssr: false, loading: LoadingFallback }
);
const BridgeControlTheme = dynamic(
  () => import('./themes/bridge-control/BridgeControlTheme').then((mod) => mod.BridgeControlTheme),
  { ssr: false, loading: LoadingFallback }
);

export function VisualizerPage() {
  const { theme } = useVisualizerThemeStore();

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

      {renderTheme()}
    </>
  );
}
