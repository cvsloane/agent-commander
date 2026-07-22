'use client';

import { useMemo } from 'react';
import {
  AlertTriangle,
  Check,
  Loader2,
  MessageSquareReply,
  ShieldAlert,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { mergeAttentionItems } from '@/lib/attentionMerge';
import { cn } from '@/lib/utils';
import {
  type OrchestratorItem,
  useOrchestratorStore,
} from '@/stores/orchestrator';
import {
  getAttentionDecisionOptions,
} from './attentionActions';
import { useAttentionItemActions } from './useAttentionItemActions';

interface TerminalAttentionOverlayProps {
  sessionId: string;
  readOnly?: boolean;
  onRespond?: (item: OrchestratorItem) => void;
  className?: string;
}

export function shouldShowTerminalAttention(
  candidate: OrchestratorItem,
  sessionId: string
): boolean {
  return candidate.sessionId === sessionId
    && (
      candidate.source === 'approval'
      || candidate.sessionStatus === 'ERROR'
      || candidate.action?.type === 'error'
      || (
        candidate.sessionStatus !== 'WAITING_FOR_INPUT'
        && candidate.attentionReason !== 'waiting_input'
      )
    );
}

export function TerminalAttentionOverlay({
  sessionId,
  readOnly = false,
  onRespond,
  className,
}: TerminalAttentionOverlayProps) {
  const rawItems = useOrchestratorStore((state) => state.items);
  const dismissItem = useOrchestratorStore((state) => state.dismissItem);
  const item = useMemo(
    () => mergeAttentionItems(rawItems).find(
      (candidate) => shouldShowTerminalAttention(candidate, sessionId)
    ),
    [rawItems, sessionId]
  );

  if (!item) return null;

  return (
    <TerminalAttentionOverlayCard
      item={item}
      onDismiss={dismissItem}
      onRespond={onRespond}
      readOnly={readOnly}
      className={className}
    />
  );
}

export function TerminalAttentionOverlayCard({
  item,
  onDismiss,
  onRespond,
  readOnly = false,
  className,
}: {
  item: OrchestratorItem;
  onDismiss: (itemId: string) => void;
  onRespond?: (item: OrchestratorItem) => void;
  readOnly?: boolean;
  className?: string;
}) {
  const {
    respond,
    pendingResponse,
    loading,
    error,
  } = useAttentionItemActions({
    item,
    onSuccess: () => onDismiss(item.id),
  });

  const decisions = getAttentionDecisionOptions(item);
  const readOnlyHintId = `terminal-attention-readonly-${item.id}`;
  const question = item.action?.question
    || (item.sessionStatus === 'ERROR' ? 'This session reported an error.' : 'This session needs attention.');

  const decide = (kind: 'approve' | 'deny') => {
    if (!decisions) return;
    void respond(decisions[kind].value);
  };

  return (
    <aside
      className={cn(
        'absolute inset-x-2 z-50 mx-auto max-w-2xl rounded-lg border border-amber-500/40 bg-background/95 p-2.5 shadow-xl backdrop-blur-sm',
        item.sessionStatus === 'ERROR' && 'border-destructive/50',
        className
      )}
      style={{ bottom: 'calc(var(--terminal-rail-height, 0px) + 0.5rem)' }}
      aria-label="Session attention"
      data-testid="terminal-attention-overlay"
    >
      <div className="flex items-start gap-2">
        {item.sessionStatus === 'ERROR'
          ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          : <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />}
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {item.sessionStatus === 'ERROR' ? 'Session error' : 'Needs attention'}
          </p>
          <p className="line-clamp-2 text-sm leading-snug">{question}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 shrink-0 p-0"
          onClick={() => onDismiss(item.id)}
          aria-label="Dismiss session attention"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>

      <div className="mt-2 flex flex-wrap justify-end gap-1.5">
        {decisions && (
          <>
            <Button
              type="button"
              size="sm"
              className="h-8 gap-1.5 px-2.5"
              onClick={() => decide('approve')}
              disabled={loading}
            >
              {pendingResponse === decisions.approve.value
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
              {decisions.approve.label}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 px-2.5"
              onClick={() => decide('deny')}
              disabled={loading}
            >
              {pendingResponse === decisions.deny.value && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              {decisions.deny.label}
            </Button>
          </>
        )}
        <Button
          type="button"
          size="sm"
          variant={decisions ? 'ghost' : 'default'}
          className="h-8 gap-1.5 px-2.5"
          onClick={() => !readOnly && onRespond?.(item)}
          disabled={readOnly}
          aria-describedby={readOnly ? readOnlyHintId : undefined}
        >
          <MessageSquareReply className="h-3.5 w-3.5" aria-hidden="true" />
          Respond
        </Button>
      </div>
      {readOnly && (
        <p
          id={readOnlyHintId}
          className="mt-1.5 text-right text-xs text-amber-700 dark:text-amber-400"
          role="status"
        >
          Read-only — take control to type
        </p>
      )}
      {error && <p className="mt-1.5 text-xs text-destructive" role="alert">{error}</p>}
    </aside>
  );
}
