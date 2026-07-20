'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Bell, ChevronDown, ChevronRight, Loader2, Moon, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAttentionQueue } from '@/hooks/useAttentionQueue';
import { useOrchestratorStore } from '@/stores/orchestrator';
import { OrchestratorItem } from './OrchestratorItem';

interface OrchestratorModalProps {
  className?: string;
}

export function OrchestratorModal({ className }: OrchestratorModalProps) {
  const isOpen = useOrchestratorStore((state) => state.isOpen);
  if (!isOpen) return null;
  return <OrchestratorModalContent className={className} />;
}

function OrchestratorModalContent({ className }: OrchestratorModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [idleExpanded, setIdleExpanded] = useState(false);
  const close = useOrchestratorStore((state) => state.close);
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
  } = useAttentionQueue();

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab' || !modalRef.current) return;

      const focusable = modalRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    const focusTimer = window.setTimeout(() => {
      modalRef.current?.querySelector<HTMLElement>('button')?.focus();
    }, 0);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [close]);

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-50 cursor-default bg-black/55"
        onClick={close}
        aria-label="Close attention queue"
        tabIndex={-1}
      />

      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="orchestrator-title"
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 flex max-h-[calc(100dvh-env(safe-area-inset-top)-0.5rem)] w-full flex-col overflow-hidden rounded-t-2xl border bg-background pb-[env(safe-area-inset-bottom)] shadow-2xl',
          'md:inset-x-auto md:bottom-auto md:right-4 md:top-[calc(4rem+env(safe-area-inset-top))] md:max-h-[calc(100dvh-5rem-env(safe-area-inset-top))] md:max-w-md md:rounded-lg md:pb-0',
          className
        )}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/30 md:hidden" aria-hidden="true" />
        <header className="flex shrink-0 items-center justify-between border-b px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Bell className="h-5 w-5 shrink-0 text-cyan-500" />
            <div className="min-w-0">
              <h2 id="orchestrator-title" className="truncate font-semibold">Attention queue</h2>
              <p className="text-xs text-muted-foreground">Highest priority first</p>
            </div>
            {items.length > 0 && (
              <span className="rounded-full bg-orange-500 px-1.5 py-0.5 text-xs font-semibold text-white">
                {items.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() => void refresh()}
              disabled={isRefreshing}
              aria-label="Refresh attention queue"
            >
              <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
            </Button>
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={close} aria-label="Close attention queue">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 overscroll-contain">
          {errors.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200" role="status">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Some sources are unavailable; loaded items remain actionable.
            </div>
          )}

          {isLoading && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading attention…
            </div>
          )}

          {!isLoading && items.length === 0 && idledItems.length === 0 && (
            <div className="py-10 text-center text-muted-foreground">
              <Bell className="mx-auto mb-3 h-10 w-10 opacity-25" />
              <p className="text-sm font-medium text-foreground">Nothing needs your attention</p>
              <p className="mt-1 text-xs">This queue updates as agents and runs change.</p>
            </div>
          )}

          {items.map((item) => (
            <OrchestratorItem
              key={item.id}
              item={item}
              onDismiss={dismissItem}
              onIdle={handleIdle}
              onUnidle={handleUnidle}
              onResponseSent={() => void refresh()}
              summariesEnabled={summariesEnabled}
              showSummary={false}
            />
          ))}

          {idledItems.length > 0 && (
            <section className="border-t pt-2">
              <button
                type="button"
                onClick={() => setIdleExpanded((expanded) => !expanded)}
                className="flex min-h-11 w-full items-center gap-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-expanded={idleExpanded}
              >
                {idleExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <Moon className="h-4 w-4" />
                Idled ({idledItems.length})
              </button>
              {idleExpanded && (
                <div className="space-y-2">
                  {idledItems.map((item) => (
                    <OrchestratorItem
                      key={item.id}
                      item={item}
                      onDismiss={dismissItem}
                      onIdle={handleIdle}
                      onUnidle={handleUnidle}
                      onResponseSent={() => void refresh()}
                      summariesEnabled={summariesEnabled}
                      showSummary={false}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </div>

        <footer className="hidden shrink-0 border-t px-4 py-2 text-center text-xs text-muted-foreground md:block">
          Press <kbd className="rounded bg-muted px-1.5 py-0.5">Shift+O</kbd> to toggle
        </footer>
      </div>
    </>
  );
}
