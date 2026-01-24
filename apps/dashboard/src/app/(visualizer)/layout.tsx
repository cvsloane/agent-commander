'use client';

import { useEffect } from 'react';
import { useVisualizerThemeStore } from '@/stores/visualizerTheme';
import './visualizer.css';

export default function VisualizerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { theme } = useVisualizerThemeStore();

  // Apply theme attribute to document for CSS variable switching
  useEffect(() => {
    document.documentElement.setAttribute('data-visualizer-theme', theme);
    return () => {
      document.documentElement.removeAttribute('data-visualizer-theme');
    };
  }, [theme]);

  return (
    <div id="app" className="visualizer-root" data-visualizer-theme={theme}>
      {children}
    </div>
  );
}
