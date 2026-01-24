'use client';

import { useEffect } from 'react';
import { useOrchestratorStore } from '@/stores/orchestrator';

interface AttentionTitleProps {
  baseTitle?: string;
}

/**
 * Updates the browser tab title with the count of active orchestrator items.
 * Uses the orchestrator store as the single source of truth.
 */
export function AttentionTitle({ baseTitle = 'Agent Commander' }: AttentionTitleProps) {
  const count = useOrchestratorStore((s) => s.getItemCount());

  useEffect(() => {
    document.title = count > 0 ? `(${count}) ${baseTitle}` : baseTitle;
  }, [count, baseTitle]);

  return null;
}
