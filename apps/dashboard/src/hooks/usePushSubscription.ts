'use client';

import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { useSession } from 'next-auth/react';
import { APIError } from '@/lib/api';
import {
  createBrowserPushSubscriptionController,
  PushBackendUnavailableError,
} from '@/lib/pushSubscription';
import {
  INITIAL_PUSH_SUBSCRIPTION_STATE,
  reducePushSubscription,
} from '@/lib/pushSubscriptionMachine';

const PUSH_STATE_CHANGED_EVENT = 'agent-command:push-state-changed';

export function usePushSubscription() {
  const { data: session, status: sessionStatus } = useSession();
  const [state, dispatch] = useReducer(
    reducePushSubscription,
    INITIAL_PUSH_SUBSCRIPTION_STATE
  );
  const ownerId = session?.user?.id ?? null;
  const controller = useMemo(
    () => createBrowserPushSubscriptionController(ownerId),
    [ownerId]
  );

  const refresh = useCallback(async () => {
    if (sessionStatus === 'loading' || !ownerId) return;
    dispatch({ type: 'CHECK_STARTED' });
    try {
      const result = await controller.check();
      dispatch({ type: 'CHECK_RESOLVED', ...result });
    } catch (error) {
      if (
        (error instanceof APIError && error.status === 404) ||
        error instanceof PushBackendUnavailableError
      ) {
        dispatch({ type: 'BACKEND_UNAVAILABLE' });
        return;
      }
      dispatch({
        type: 'FAILED',
        message: error instanceof Error ? error.message : 'Could not check push notifications.',
      });
    }
  }, [controller, ownerId, sessionStatus]);

  useEffect(() => {
    void refresh();
    const handleChange = () => void refresh();
    window.addEventListener(PUSH_STATE_CHANGED_EVENT, handleChange);
    return () => window.removeEventListener(PUSH_STATE_CHANGED_EVENT, handleChange);
  }, [refresh]);

  const subscribe = useCallback(async () => {
    dispatch({ type: 'SUBSCRIBE_STARTED' });
    try {
      await controller.subscribe();
      dispatch({ type: 'SUBSCRIBE_SUCCEEDED' });
      window.dispatchEvent(new Event(PUSH_STATE_CHANGED_EVENT));
    } catch (error) {
      if (
        (error instanceof APIError && error.status === 404) ||
        error instanceof PushBackendUnavailableError
      ) {
        dispatch({ type: 'BACKEND_UNAVAILABLE' });
        return;
      }
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        dispatch({
          type: 'CHECK_RESOLVED',
          supported: true,
          permission: 'denied',
          subscribed: false,
        });
        return;
      }
      dispatch({
        type: 'FAILED',
        message: error instanceof Error ? error.message : 'Could not enable push notifications.',
      });
    }
  }, [controller]);

  const unsubscribe = useCallback(async () => {
    dispatch({ type: 'UNSUBSCRIBE_STARTED' });
    try {
      await controller.unsubscribe();
      dispatch({ type: 'UNSUBSCRIBE_SUCCEEDED' });
      window.dispatchEvent(new Event(PUSH_STATE_CHANGED_EVENT));
    } catch (error) {
      if (error instanceof APIError && error.status === 404) {
        dispatch({ type: 'BACKEND_UNAVAILABLE' });
        return;
      }
      dispatch({
        type: 'FAILED',
        message: error instanceof Error ? error.message : 'Could not disable push notifications.',
      });
    }
  }, [controller]);

  return { state, subscribe, unsubscribe, refresh };
}
