'use client';

import type { ReactNode } from 'react';
import React from 'react';

interface WorkshopBoundaryProps {
  children: ReactNode;
  onError?: (error: Error) => void;
  fallback?: ReactNode;
}

interface WorkshopBoundaryState {
  hasError: boolean;
}

export class WorkshopBoundary extends React.Component<
  WorkshopBoundaryProps,
  WorkshopBoundaryState
> {
  state: WorkshopBoundaryState = { hasError: false };

  static getDerivedStateFromError(): WorkshopBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="flex h-full items-center justify-center rounded-lg bg-muted/30 text-sm text-muted-foreground">
            3D view unavailable. Disable and reload to continue.
          </div>
        )
      );
    }

    return this.props.children;
  }
}
