'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { OrchestratorItem } from '@/stores/orchestrator';
import {
  executeAttentionResponse,
  type AttentionResponseMode,
} from './attentionActions';

interface UseAttentionItemActionsOptions {
  item: OrchestratorItem;
  mode?: AttentionResponseMode;
  successDelayMs?: number;
  onSuccess?: () => void;
}

export function useAttentionItemActions({
  item,
  mode = 'action',
  successDelayMs = 0,
  onSuccess,
}: UseAttentionItemActionsOptions) {
  const [pendingResponse, setPendingResponse] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setPendingResponse(null);
    setError(null);
    setSuccess(false);
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    successTimerRef.current = null;
  }, [item.id]);

  useEffect(() => () => {
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
  }, []);

  const respond = useCallback(async (choice: string) => {
    if (pendingResponse) return false;
    setPendingResponse(choice);
    setError(null);
    try {
      await executeAttentionResponse(item, choice, mode);
      setSuccess(true);
      if (successDelayMs > 0) {
        successTimerRef.current = setTimeout(() => {
          successTimerRef.current = null;
          onSuccess?.();
        }, successDelayMs);
      } else {
        onSuccess?.();
      }
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to send response');
      return false;
    } finally {
      setPendingResponse(null);
    }
  }, [item, mode, onSuccess, pendingResponse, successDelayMs]);

  return {
    respond,
    pendingResponse,
    loading: pendingResponse !== null,
    error,
    success,
  };
}
