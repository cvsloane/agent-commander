'use client';

import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import { WorkshopBoundary } from './WorkshopBoundary';
import type { ComponentProps } from 'react';
import { useMemo } from 'react';

/**
 * SSR-guarded 3D Workshop Scene
 * Uses dynamic import with ssr: false to prevent server-side rendering issues
 * with React Three Fiber.
 */
export const WorkshopScene = dynamic(
  () => import('./WorkshopScene').then((mod) => mod.WorkshopScene),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full bg-slate-900 rounded-lg">
        <div className="flex flex-col items-center gap-2 text-slate-400">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="text-sm">Loading 3D view...</span>
        </div>
      </div>
    ),
  }
);

function isWebGLSupported(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl') || canvas.getContext('webgl2'));
  } catch {
    return false;
  }
}

export function WorkshopSceneSafe(props: ComponentProps<typeof WorkshopScene>) {
  const webglSupported = useMemo(isWebGLSupported, []);

  if (!webglSupported) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg bg-muted/30 text-sm text-muted-foreground">
        WebGL is not available in this browser.
      </div>
    );
  }

  return (
    <WorkshopBoundary
      fallback={
        <div className="flex h-full items-center justify-center rounded-lg bg-muted/30 text-sm text-muted-foreground">
          3D view crashed. Refresh the page to try again.
        </div>
      }
    >
      <WorkshopScene {...props} />
    </WorkshopBoundary>
  );
}
