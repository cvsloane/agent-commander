'use client';

import { useState } from 'react';
import { Clock3, FolderOpen, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MobileLaunchSheet, type LaunchSheetView } from './MobileLaunchSheet';
import { getLaunchProvider } from './definitions';
import { useRecentLaunch } from './recentLaunchStore';

interface LaunchRailProps {
  className?: string;
  selectedHostId?: string;
  onLaunched?: () => void;
}

export function LaunchRail({ className, selectedHostId, onLaunched }: LaunchRailProps) {
  const recentLaunch = useRecentLaunch();
  const [open, setOpen] = useState(false);
  const [initialView, setInitialView] = useState<LaunchSheetView>('new');

  const openSheet = (view: LaunchSheetView) => {
    setInitialView(view);
    setOpen(true);
  };

  const recentLabel = recentLaunch
    ? `${getLaunchProvider(recentLaunch.provider)?.shortName ?? recentLaunch.provider} · ${recentLaunch.working_directory.split('/').filter(Boolean).pop() ?? recentLaunch.working_directory}`
    : 'Previous projects';

  return (
    <>
      <section
        aria-label="Launch"
        className={cn(
          'flex flex-col gap-2 border-y bg-muted/25 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:rounded-lg sm:border',
          className
        )}
      >
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Launch</p>
          <p className="hidden truncate text-xs text-muted-foreground sm:block">Start work or return to a known tmux target.</p>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:flex sm:shrink-0">
          <button
            type="button"
            onClick={() => openSheet('new')}
            className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            New
          </button>
          <button
            type="button"
            onClick={() => openSheet('recent')}
            className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm font-medium shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={recentLabel}
          >
            <Clock3 className="h-4 w-4" aria-hidden="true" />
            Recent
          </button>
          <button
            type="button"
            onClick={() => openSheet('existing')}
            className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm font-medium shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <FolderOpen className="h-4 w-4" aria-hidden="true" />
            <span className="sm:hidden">Open</span>
            <span className="hidden sm:inline">Open existing</span>
          </button>
        </div>
      </section>

      <MobileLaunchSheet
        open={open}
        initialView={initialView}
        selectedHostId={selectedHostId}
        onClose={() => setOpen(false)}
        onLaunched={onLaunched}
      />
    </>
  );
}
