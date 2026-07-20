'use client';

import { useCallback } from 'react';
import { CheckCircle, Moon, Sun, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn, getProviderIcon } from '@/lib/utils';
import type { OrchestratorItem as OrchestratorItemType } from '@/stores/orchestrator';
import type { AttentionResponseMode } from './attentionActions';
import { useAttentionItemActions } from './useAttentionItemActions';
import { AttentionItemActions } from './item-renderers/AttentionItemActions';
import {
  AttentionItemDetails,
  AttentionItemStatus,
  AttentionItemSummary,
} from './item-renderers/AttentionItemPresentation';

interface OrchestratorItemProps {
  item: OrchestratorItemType;
  onDismiss: (itemId: string) => void;
  onResponseSent?: () => void;
  onIdle?: (sessionId: string) => void;
  onUnidle?: (sessionId: string) => void;
  summariesEnabled?: boolean;
  mode?: AttentionResponseMode;
  showSummary?: boolean;
  showItemActions?: boolean;
}

export function OrchestratorItem({
  item,
  onDismiss,
  onResponseSent,
  onIdle,
  onUnidle,
  summariesEnabled = false,
  mode = 'action',
  showSummary = true,
  showItemActions = true,
}: OrchestratorItemProps) {
  const handleSuccess = useCallback(() => {
    onDismiss(item.id);
    onResponseSent?.();
  }, [item.id, onDismiss, onResponseSent]);
  const {
    respond,
    loading,
    error,
    success,
  } = useAttentionItemActions({
    item,
    mode,
    successDelayMs: 500,
    onSuccess: handleSuccess,
  });

  const showIdleToggle = item.sessionId
    && ['snapshot', 'approval', 'status'].includes(item.source);

  return (
    <Card className={cn(
      'relative transition-all',
      success && 'opacity-50',
      item.action?.type === 'error' && 'border-red-500/50',
      item.idledAt && 'border-dashed opacity-60'
    )}>
      <CardContent className="p-3">
        <div className="flex items-start gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold">
            {getProviderIcon(item.sessionProvider || 'unknown')}
          </div>

          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <span className="truncate text-sm font-medium">
                {item.sessionTitle || item.sessionCwd?.split('/').pop() || 'Session'}
              </span>
              <AttentionItemStatus item={item} mode={mode} />
            </div>

            <AttentionItemDetails item={item} />
            {showSummary && (
              <AttentionItemSummary item={item} enabled={summariesEnabled} />
            )}
            <AttentionItemActions
              item={item}
              mode={mode}
              loading={loading}
              success={success}
              onRespond={respond}
              onIdle={onIdle}
            />

            {error && <p className="mt-2 text-xs text-destructive" role="alert">{error}</p>}
            {success && (
              <p className="mt-2 flex items-center gap-1 text-xs text-green-600" role="status">
                <CheckCircle className="h-3 w-3" aria-hidden="true" />
                Response sent
              </p>
            )}
          </div>

          {showItemActions && (
            <div className="flex shrink-0 flex-col gap-1">
              {showIdleToggle && (item.idledAt ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => item.sessionId && onUnidle?.(item.sessionId)}
                  title="Bring back"
                  aria-label="Bring attention item back"
                >
                  <Sun className="h-3 w-3" aria-hidden="true" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => item.sessionId && onIdle?.(item.sessionId)}
                  title="Mark idle"
                  aria-label="Mark attention item idle"
                >
                  <Moon className="h-3 w-3" aria-hidden="true" />
                </Button>
              ))}
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => onDismiss(item.id)}
                title="Dismiss"
                aria-label="Dismiss attention item"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
