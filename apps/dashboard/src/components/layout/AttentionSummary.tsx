'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, ChevronRight } from 'lucide-react';
import { useIsMobile } from '@/hooks/useIsMobile';
import { mergeAttentionItems } from '@/lib/attentionMerge';
import { cn } from '@/lib/utils';
import { useOrchestratorStore, type OrchestratorItem } from '@/stores/orchestrator';

function itemLabel(item: OrchestratorItem): string {
  return item.action?.question
    || item.attentionReason
    || item.sessionTitle
    || item.governanceApproval?.type?.replace(/_/g, ' ')
    || 'Operator decision required';
}

export function AttentionSummary() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const rawItems = useOrchestratorStore((state) => state.items);
  const open = useOrchestratorStore((state) => state.open);
  const queue = useMemo(() => mergeAttentionItems(rawItems), [rawItems]);
  const topItem = queue[0];

  const handleOpen = () => {
    if (isMobile) {
      router.push('/orchestrator?tab=attention');
      return;
    }
    open();
  };

  return (
    <button
      type="button"
      onClick={handleOpen}
      className={cn(
        'flex min-h-14 w-full items-center gap-3 border-y px-4 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:rounded-lg sm:border',
        queue.length > 0
          ? 'border-orange-500/30 bg-orange-500/10 hover:bg-orange-500/15'
          : 'bg-muted/25 hover:bg-muted/50'
      )}
      aria-label={queue.length > 0
        ? `Open attention: ${queue.length} items, highest priority ${itemLabel(topItem)}`
        : 'Open attention: queue is clear'}
    >
      <span className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
        queue.length > 0 ? 'bg-orange-500 text-white' : 'bg-muted text-muted-foreground'
      )}>
        <Bell className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="text-sm font-semibold">Attention</span>
          <span className="text-xs text-muted-foreground">
            {queue.length === 0 ? 'All clear' : `${queue.length} ${queue.length === 1 ? 'item' : 'items'}`}
          </span>
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {topItem ? itemLabel(topItem) : 'No agents or runs need intervention.'}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}
