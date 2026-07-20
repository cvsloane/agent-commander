'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  Bell,
  ChevronDown,
  ChevronRight,
  Loader2,
  Moon,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OrchestratorItem } from '@/components/orchestrator/OrchestratorItem';
import { useAttentionQueue } from '@/hooks/useAttentionQueue';

export default function OrchestratorPageClient() {
  const [idleExpanded, setIdleExpanded] = useState(false);
  const {
    items,
    idledItems,
    errors,
    isLoading,
    isRefreshing,
    refresh,
    dismissItem,
    handleIdle,
    handleUnidle,
    summariesEnabled,
    summaryStatusLoading,
  } = useAttentionQueue();

  return (
    <div className="mx-auto w-full max-w-3xl px-3 py-4 sm:px-4 sm:py-6">
      <header className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-cyan-500 sm:h-6 sm:w-6" />
            <h1 className="text-xl font-bold sm:text-2xl">Attention queue</h1>
            {items.length > 0 && (
              <span className="rounded-full bg-orange-500 px-2 py-0.5 text-xs font-semibold text-white">
                {items.length}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Approvals, waiting input, governance, and failed runs in priority order.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refresh()}
          disabled={isRefreshing}
          className="shrink-0 gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Refresh</span>
          <span className="sr-only sm:hidden">Refresh attention queue</span>
        </Button>
      </header>

      {errors.length > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Some attention sources are unavailable. Showing the data that loaded successfully.</span>
        </div>
      )}

      {!summaryStatusLoading && !summariesEnabled && (
        <div className="mb-4 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          AI summaries are unavailable; queue actions and captured context still work.
        </div>
      )}

      <section aria-label="Items needing attention" aria-busy={isLoading}>
        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading attention sources…
          </div>
        )}

        {!isLoading && items.length === 0 && (
          <div className="rounded-xl border border-dashed py-14 text-center text-muted-foreground">
            <Bell className="mx-auto mb-3 h-12 w-12 opacity-25" />
            <p className="font-medium text-foreground">Nothing needs your attention</p>
            <p className="mt-1 text-sm">New prompts, approvals, and failed runs will appear here.</p>
          </div>
        )}

        {items.length > 0 && (
          <div className="space-y-3">
            {items.map((item) => (
              <OrchestratorItem
                key={item.id}
                item={item}
                onDismiss={dismissItem}
                onIdle={handleIdle}
                onUnidle={handleUnidle}
                onResponseSent={() => void refresh()}
                summariesEnabled={summariesEnabled}
              />
            ))}
          </div>
        )}
      </section>

      {idledItems.length > 0 && (
        <section className="mt-6 border-t pt-4">
          <button
            type="button"
            onClick={() => setIdleExpanded((expanded) => !expanded)}
            className="flex min-h-11 w-full items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-expanded={idleExpanded}
          >
            {idleExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <Moon className="h-4 w-4" />
            Idled ({idledItems.length})
          </button>
          {idleExpanded && (
            <div className="mt-2 space-y-3">
              {idledItems.map((item) => (
                <OrchestratorItem
                  key={item.id}
                  item={item}
                  onDismiss={dismissItem}
                  onIdle={handleIdle}
                  onUnidle={handleUnidle}
                  onResponseSent={() => void refresh()}
                  summariesEnabled={summariesEnabled}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
