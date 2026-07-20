'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  Bot,
  ChevronDown,
  ChevronRight,
  Loader2,
  Moon,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OrchestratorItem } from '@/components/orchestrator/OrchestratorItem';
import { useAttentionQueue } from '@/hooks/useAttentionQueue';
import { useOrchestratorFleet } from '@/hooks/useOrchestratorFleet';
import { OrchestratorFleetCard } from '@/components/orchestrator/OrchestratorFleetCard';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { assignAttentionToOrchestrators } from '@/lib/attentionMerge';

export default function OrchestratorPageClient() {
  const [idleExpanded, setIdleExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState('fleet');
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
  const fleet = useOrchestratorFleet();
  const runSessionById = useMemo(() => Object.fromEntries(
    fleet.runs.map((run) => [run.id, run.session_id])
  ), [fleet.runs]);
  const attentionByOrchestrator = useMemo(() => assignAttentionToOrchestrators(
    items,
    fleet.cards.map((card) => ({
      orchestratorId: card.session.id,
      sessionIds: card.children.map((child) => child.id),
    })),
    runSessionById
  ), [fleet.cards, items, runSessionById]);

  const refreshAll = async () => {
    await Promise.all([refresh(), fleet.refresh()]);
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-3 py-4 sm:px-4 sm:py-6">
      <header className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-cyan-500 sm:h-6 sm:w-6" />
            <h1 className="text-xl font-bold sm:text-2xl">Orchestrators</h1>
            {items.length > 0 && (
              <span className="rounded-full bg-orange-500 px-2 py-0.5 text-xs font-semibold text-white">
                {items.length}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Supervise agent fleets, make decisions, and steer work without terminal focus.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refreshAll()}
          disabled={isRefreshing || fleet.isRefreshing}
          className="shrink-0 gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing || fleet.isRefreshing ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Refresh</span>
          <span className="sr-only sm:hidden">Refresh attention queue</span>
        </Button>
      </header>

      {[...errors, ...fleet.errors].length > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Some fleet sources are unavailable. Showing the data that loaded successfully.</span>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid h-11 w-full grid-cols-2">
          <TabsTrigger value="fleet" className="h-9">
            Fleet ({fleet.cards.length})
          </TabsTrigger>
          <TabsTrigger value="attention" className="h-9">
            Attention ({items.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="fleet" className="space-y-4">
          {fleet.isLoading && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading orchestrator fleet…
            </div>
          )}
          {!fleet.isLoading && fleet.cards.length === 0 && (
            <div className="rounded-xl border border-dashed py-14 text-center text-muted-foreground">
              <Bot className="mx-auto mb-3 h-12 w-12 opacity-25" />
              <p className="font-medium text-foreground">No orchestrator sessions are online</p>
              <p className="mt-1 text-sm">Sessions with the orchestrator role will appear here.</p>
            </div>
          )}
          {fleet.cards.map((card) => (
            <OrchestratorFleetCard
              key={card.session.id}
              {...card}
              attentionItems={attentionByOrchestrator[card.session.id] ?? []}
              onRefresh={() => void refreshAll()}
            />
          ))}
        </TabsContent>

        <TabsContent value="attention">
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
