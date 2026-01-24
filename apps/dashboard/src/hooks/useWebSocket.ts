'use client';

import { useEffect, useCallback, useRef, useMemo } from 'react';
import type { ServerToUIMessage } from '@agent-command/schema';
import { getWebSocketClient } from '@/lib/ws';
import { getControlPlaneToken } from '@/lib/wsToken';

export function useWebSocket(
  topics: Array<{ type: string; filter?: Record<string, unknown> }>,
  onMessage: (message: ServerToUIMessage) => void,
  enabled: boolean = true
) {
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;
  const topicsRef = useRef(topics);
  const topicsKey = useMemo(() => JSON.stringify(topics), [topics]);

  useEffect(() => {
    topicsRef.current = topics;
  }, [topics]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const client = getWebSocketClient();
    let subscriptionId: string | null = null;
    let removeHandler: (() => void) | null = null;

    const setup = async () => {
      const token = await getControlPlaneToken();
      if (!active) return;
      if (!token) return;
      client.setTokenProvider(getControlPlaneToken);
      client.setToken(token);
      void client.connect();
      subscriptionId = client.registerSubscription(topicsRef.current);

      removeHandler = client.addHandler((message) => {
        handlerRef.current(message);
      });
    };

    setup();

    return () => {
      active = false;
      if (removeHandler) {
        removeHandler();
      }
      if (subscriptionId) {
        client.unregisterSubscription(subscriptionId);
      }
    };
  }, [topicsKey, enabled]);
}
