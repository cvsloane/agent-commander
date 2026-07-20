'use client';

import { useEffect, useCallback, useRef, useMemo } from 'react';
import type { ServerToUIMessage } from '@agent-command/schema';
import { getWebSocketClient } from '@/lib/ws';
import { getWebSocketTicket } from '@/lib/wsToken';

export function useWebSocket(
  topics: Array<{ type: string; filter?: Record<string, unknown> }>,
  onMessage: (message: ServerToUIMessage) => void,
  enabled: boolean = true,
  channel: string = 'default'
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
    const client = getWebSocketClient(channel);
    client.setTicketProvider(getWebSocketTicket);
    const subscriptionId = client.registerSubscription(topicsRef.current);
    const removeHandler = client.addHandler((message) => {
      handlerRef.current(message);
    });
    void client.connect();

    return () => {
      removeHandler();
      client.unregisterSubscription(subscriptionId);
    };
  }, [topicsKey, enabled, channel]);
}
