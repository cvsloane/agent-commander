'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import {
  AlertTriangle,
  Bell,
  Bot,
  ChevronDown,
  ChevronRight,
  Loader2,
  Moon,
  RefreshCw,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAttentionQueue } from '@/hooks/useAttentionQueue';
import { useOrchestratorFleet } from '@/hooks/useOrchestratorFleet';
import { useIsMobile } from '@/hooks/useIsMobile';
import { assignAttentionToOrchestrators } from '@/lib/attentionMerge';
import { cn } from '@/lib/utils';
import { useOrchestratorStore } from '@/stores/orchestrator';
import { OrchestratorFleetCard } from './OrchestratorFleetCard';
import { OrchestratorItem } from './OrchestratorItem';

type AttentionTab = 'fleet' | 'attention';

interface OrchestratorSurfaceProps {
  presentation: 'page' | 'sheet';
  initialTab?: AttentionTab;
  onClose?: () => void;
}

export function OrchestratorSurface({
  presentation,
  initialTab,
  onClose,
}: OrchestratorSurfaceProps) {
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab') === 'attention' ? 'attention' : 'fleet';
  const [idleExpanded, setIdleExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<AttentionTab>(initialTab ?? requestedTab);
  const closeStoreSurface = useOrchestratorStore((state) => state.close);
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

  useEffect(() => {
    setActiveTab(initialTab ?? requestedTab);
  }, [initialTab, requestedTab]);

  useEffect(() => {
    if (presentation === 'page') closeStoreSurface();
  }, [closeStoreSurface, presentation]);

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
  const allErrors = [...errors, ...fleet.errors];

  return (
    <div className={cn(
      'flex min-h-0 w-full flex-col bg-background',
      presentation === 'page'
        ? 'mx-auto max-w-5xl px-3 py-4 sm:px-4 sm:py-6'
        : 'h-full overflow-hidden'
    )} data-testid="attention-surface" data-presentation={presentation}>
      <header className={cn(
        'flex shrink-0 items-start justify-between gap-3',
        presentation === 'page' ? 'mb-5' : 'border-b px-4 py-3'
      )}>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 shrink-0 text-cyan-500 sm:h-6 sm:w-6" aria-hidden="true" />
            <h1 className={cn('font-bold', presentation === 'page' ? 'text-xl sm:text-2xl' : 'text-lg')}>
              Attention
            </h1>
            {items.length > 0 && (
              <span className="rounded-full bg-orange-500 px-2 py-0.5 text-xs font-semibold text-white">
                {items.length}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Review urgent work, then inspect the orchestrator fleet without changing context.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="mobile-icon"
            onClick={() => void refreshAll()}
            disabled={isRefreshing || fleet.isRefreshing}
            aria-label="Refresh attention and fleet"
          >
            <RefreshCw className={cn('h-4 w-4', (isRefreshing || fleet.isRefreshing) && 'animate-spin')} />
          </Button>
          {presentation === 'sheet' && onClose && (
            <Button
              variant="ghost"
              size="mobile-icon"
              onClick={onClose}
              aria-label="Close attention"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </header>

      <div className={cn('min-h-0', presentation === 'sheet' && 'flex-1 overflow-y-auto p-4')}>
        {allErrors.length > 0 && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200" role="status">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Some sources are unavailable. Showing the actionable data that loaded.</span>
          </div>
        )}

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as AttentionTab)} className="space-y-4">
          <TabsList className="grid h-12 w-full grid-cols-2">
            <TabsTrigger value="attention" className="min-h-11">
              Attention ({items.length})
            </TabsTrigger>
            <TabsTrigger value="fleet" className="min-h-11">
              Fleet ({fleet.cards.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="attention" className="space-y-4">
            {!summaryStatusLoading && !summariesEnabled && (
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                AI summaries are unavailable; queue actions and captured context still work.
              </div>
            )}

            <section aria-label="Items needing attention" aria-busy={isLoading}>
              {isLoading && (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground" role="status">
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
                      showSummary={presentation === 'page'}
                    />
                  ))}
                </div>
              )}
            </section>

            {idledItems.length > 0 && (
              <section className="border-t pt-4">
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
                        showSummary={presentation === 'page'}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
          </TabsContent>

          <TabsContent value="fleet" className="space-y-4">
            {fleet.isLoading && (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground" role="status">
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
        </Tabs>
      </div>
    </div>
  );
}

export function OrchestratorSheet() {
  const isOpen = useOrchestratorStore((state) => state.isOpen);
  const close = useOrchestratorStore((state) => state.close);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (isMobile && isOpen) close();
  }, [close, isMobile, isOpen]);

  if (isMobile) return null;

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
        <Dialog.Content
          className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl border-l bg-background shadow-2xl focus:outline-none"
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            document.getElementById('attention-bell')?.focus();
          }}
        >
          <Dialog.Title className="sr-only">Attention</Dialog.Title>
          <OrchestratorSurface presentation="sheet" initialTab="attention" onClose={close} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
