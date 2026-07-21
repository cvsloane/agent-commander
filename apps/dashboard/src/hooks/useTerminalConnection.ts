'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { getWebSocketTicket } from '@/lib/wsToken';
import {
  initialReconnectState,
  shouldReconnectTerminal,
  transitionReconnect,
  type ReconnectEvent,
  type ReconnectState,
} from '@/lib/reconnect';
import { resolveControlPlaneWebSocketUrl } from '@/lib/wsUrl';
import type { ConnectionStatus, XTerminal } from '@/components/terminal/types';
import {
  buildTerminalHello,
  buildTerminalWebSocketUrl,
  decodeTerminalFrame,
} from '@/components/terminal/protocol';
import { calculateKeyboardInset, calculateTerminalViewportHeight } from '@/components/terminal/viewport';
import { handleTerminalOutputFrame } from '@/components/terminal/terminalFrameRouter';
import { beginTerminalFrameTiming } from '@/components/terminal/terminalFrameTiming';
import { createSettledTerminalResize } from './terminalGrid';
import {
  useTerminalDescriptorKey,
  useTerminalGrid,
  useTerminalWarmKey,
} from './terminalGridContext';
import {
  clearProvisionalTerminalWarmBuffer,
  clearTerminalWarmResumeToken,
  getTerminalWarmResumeToken,
  getTerminalResumeNotice,
  hasTerminalWarmBuffer,
  setTerminalWarmResumeToken,
} from './terminalWarmCache';
import {
  DEFAULT_TERMINAL_WARM_TIMEOUT_MINUTES,
  useSettingsStore,
} from '@/stores/settings';
import { useNotificationStore } from '@/stores/notifications';
import { terminalHostStore } from '@/components/terminal/terminalHostStore';

export function useTerminalConnection({
  sessionId,
  paneId,
  autoAttach,
  wsRef,
  terminalRef,
  containerRef,
  ensureTerminal,
  fitAndResize,
  getDimensions,
  onOutputWritten,
}: {
  sessionId: string;
  paneId?: string;
  autoAttach: boolean;
  wsRef: MutableRefObject<WebSocket | null>;
  terminalRef: MutableRefObject<XTerminal | null>;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  ensureTerminal: () => Promise<XTerminal | null>;
  fitAndResize: () => void;
  getDimensions: () => { cols: number; rows: number } | undefined;
  onOutputWritten: (terminal: XTerminal) => void;
}) {
  const letterbox = useTerminalGrid();
  const warmKey = useTerminalWarmKey();
  const descriptorKey = useTerminalDescriptorKey();
  const terminalWarmTimeoutMinutes = useSettingsStore(
    (state) => state.terminalWarmTimeoutMinutes ?? DEFAULT_TERMINAL_WARM_TIMEOUT_MINUTES
  );
  const addNotification = useNotificationStore((state) => state.add);
  const settledResize = useMemo(
    () => createSettledTerminalResize(fitAndResize),
    [fitAndResize]
  );
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectStateRef = useRef<ReconnectState>(initialReconnectState);
  const readOnlyRef = useRef(false);
  const intentionalCloseRef = useRef(false);
  const terminalEndedRef = useRef(false);
  const idleTimedOutRef = useRef(false);
  const reconnectEnabledRef = useRef(false);
  const connectingRef = useRef(false);
  const connectionGenerationRef = useRef(0);
  const autoAttachedSessionRef = useRef<string | null>(null);
  const resumeTokenRef = useRef<string | null>(null);
  const requestedResumeRef = useRef(false);
  const warmBufferOnConnectRef = useRef(false);
  const restartedAfterResumeFailureRef = useRef(false);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lagMessage, setLagMessage] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const statusRef = useRef<ConnectionStatus>('disconnected');
  const errorMessageRef = useRef<string | null>(null);
  const lagMessageRef = useRef<string | null>(null);

  const updateStatus = useCallback((nextStatus: ConnectionStatus) => {
    if (statusRef.current === nextStatus) return;
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }, []);

  const updateErrorMessage = useCallback((nextMessage: string | null) => {
    if (errorMessageRef.current === nextMessage) return;
    errorMessageRef.current = nextMessage;
    setErrorMessage(nextMessage);
  }, []);

  const updateLagMessage = useCallback((nextMessage: string | null) => {
    if (lagMessageRef.current === nextMessage) return;
    lagMessageRef.current = nextMessage;
    setLagMessage(nextMessage);
  }, []);

  const updateReadOnly = useCallback((nextReadOnly: boolean) => {
    if (readOnlyRef.current === nextReadOnly) return;
    readOnlyRef.current = nextReadOnly;
    setReadOnly(nextReadOnly);
  }, []);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const applyReconnectEvent = useCallback(function handleReconnectEvent(
    event: ReconnectEvent,
    reconnect: () => void
  ) {
    const transition = transitionReconnect(reconnectStateRef.current, event);
    reconnectStateRef.current = transition.state;

    clearReconnectTimer();
    if (transition.effect.type === 'reconnect') {
      reconnect();
    } else if (transition.effect.type === 'schedule') {
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        handleReconnectEvent({ type: 'timer' }, reconnect);
      }, transition.effect.delayMs);
    }
  }, [clearReconnectTimer]);

  const connect = useCallback(async function connectTerminal() {
    if (!paneId) return;
    if (
      connectingRef.current ||
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    ) return;

    if (!reconnectEnabledRef.current) {
      reconnectStateRef.current = initialReconnectState;
    }
    reconnectEnabledRef.current = true;
    if (descriptorKey) terminalHostStore.setResumeAvailable(descriptorKey, false);
    intentionalCloseRef.current = false;
    terminalEndedRef.current = false;
    idleTimedOutRef.current = false;

    if (!navigator.onLine) {
      updateStatus('reconnecting');
      updateErrorMessage(null);
      return;
    }

    updateStatus(reconnectStateRef.current.attempt > 0 ? 'reconnecting' : 'connecting');
    updateErrorMessage(null);
    connectingRef.current = true;
    const generation = ++connectionGenerationRef.current;

    try {
      await ensureTerminal();
      if (generation !== connectionGenerationRef.current || !reconnectEnabledRef.current) return;

      const ticket = await getWebSocketTicket();
      if (generation !== connectionGenerationRef.current || !reconnectEnabledRef.current) return;
      if (!ticket) {
        reconnectEnabledRef.current = false;
        reconnectStateRef.current = initialReconnectState;
        updateStatus('error');
        updateErrorMessage('Authentication token not found');
        return;
      }

      const warmTimeoutMs = terminalWarmTimeoutMinutes * 60 * 1000;
      if (!resumeTokenRef.current && warmKey) {
        resumeTokenRef.current = getTerminalWarmResumeToken(warmKey, warmTimeoutMs) ?? null;
      }
      requestedResumeRef.current = Boolean(resumeTokenRef.current);
      warmBufferOnConnectRef.current = warmKey
        ? hasTerminalWarmBuffer(warmKey, warmTimeoutMs)
        : false;

      const ws = new WebSocket(buildTerminalWebSocketUrl(
        resolveControlPlaneWebSocketUrl({
          type: 'terminal',
          sessionId,
          ticket,
        }),
        getDimensions(),
        resumeTokenRef.current ?? undefined,
        Boolean(letterbox)
      ));
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      const markConnected = () => {
        if (statusRef.current !== 'connected') {
          applyReconnectEvent({ type: 'opened' }, () => undefined);
          updateStatus('connected');
        }
        updateErrorMessage(null);
      };

      ws.onopen = () => {
        if (wsRef.current !== ws) return;
        ws.send(JSON.stringify(buildTerminalHello()));
        fitAndResize();
      };

      ws.onmessage = (event) => {
        try {
          const completeFrameTiming = event.data instanceof ArrayBuffer
            ? beginTerminalFrameTiming(event.data.byteLength)
            : null;
          const msg = decodeTerminalFrame(event.data as string | ArrayBuffer);

          if (handleTerminalOutputFrame(msg, (data) => {
            if (!terminalRef.current) return;
            const terminal = terminalRef.current;
            if (warmKey) clearProvisionalTerminalWarmBuffer(warmKey, terminal);
            terminal.write(data, () => {
              onOutputWritten(terminal);
              completeFrameTiming?.();
            });
          })) {
            return;
          }

          switch (msg.type) {
            case 'attached':
              autoAttachedSessionRef.current = sessionId;
              if (descriptorKey) terminalHostStore.setResumeAvailable(descriptorKey, false);
              markConnected();
              if (msg.resume_token) {
                resumeTokenRef.current = msg.resume_token;
                if (warmKey) setTerminalWarmResumeToken(warmKey, msg.resume_token);
              }
              const resumeNotice = getTerminalResumeNotice({
                resumed: msg.resumed ?? false,
                requestedResume: requestedResumeRef.current,
                hadWarmBuffer: warmBufferOnConnectRef.current,
                restartedAfterFailure: restartedAfterResumeFailureRef.current,
              });
              if (resumeNotice === 'resumed') {
                addNotification({
                  type: 'success',
                  title: 'Terminal resumed',
                  message: 'Live pane output restored.',
                  sessionId,
                });
              } else if (resumeNotice === 'restarted') {
                addNotification({
                  type: 'warning',
                  title: 'Session restarted — history truncated',
                  message: 'The live pane could not continue its previous viewer session.',
                  sessionId,
                });
              }
              requestedResumeRef.current = false;
              restartedAfterResumeFailureRef.current = false;
              updateReadOnly(msg.readonly ?? false);
              updateLagMessage(null);
              fitAndResize();
              terminalRef.current?.focus();
              window.setTimeout(() => terminalRef.current?.focus(), 0);
              break;
            case 'readonly':
              markConnected();
              updateReadOnly(true);
              break;
            case 'control':
              markConnected();
              updateReadOnly(false);
              break;
            case 'detached':
              reconnectEnabledRef.current = false;
              terminalEndedRef.current = true;
              updateStatus('disconnected');
              updateReadOnly(false);
              updateErrorMessage(null);
              if (descriptorKey) terminalHostStore.setResumeAvailable(descriptorKey, true);
              terminalRef.current?.writeln('\r\n\x1b[33m[Terminal detached]\x1b[0m');
              ws.close(1000, 'terminal detached');
              break;
            case 'error':
              if (requestedResumeRef.current && /resume token/i.test(msg.message || '')) {
                requestedResumeRef.current = false;
                restartedAfterResumeFailureRef.current = true;
                resumeTokenRef.current = null;
                if (warmKey) clearTerminalWarmResumeToken(warmKey);
                if (wsRef.current === ws) wsRef.current = null;
                intentionalCloseRef.current = true;
                ws.close(1000, 'retry terminal without stale resume token');
                void connectTerminal();
                break;
              }
              reconnectEnabledRef.current = false;
              terminalEndedRef.current = true;
              updateStatus('error');
              updateReadOnly(false);
              updateErrorMessage(msg.message || 'Terminal error');
              terminalRef.current?.writeln(`\r\n\x1b[31m[Error: ${msg.message || 'Unknown error'}]\x1b[0m`);
              ws.close(1000, 'terminal error');
              break;
            case 'idle_timeout':
              reconnectEnabledRef.current = false;
              idleTimedOutRef.current = true;
              updateStatus('disconnected');
              updateReadOnly(false);
              updateErrorMessage(null);
              if (descriptorKey) terminalHostStore.setResumeAvailable(descriptorKey, true);
              terminalRef.current?.writeln('\r\n\x1b[33m[Session timed out due to inactivity]\x1b[0m');
              ws.close(1000, 'idle timeout');
              break;
            case 'lag': {
              const warning = msg.message || 'Terminal output was dropped while this viewer lagged';
              updateLagMessage(warning);
              terminalRef.current?.writeln(`\r\n\x1b[33m[Terminal lag: ${warning}]\x1b[0m`);
              break;
            }
          }
        } catch (error) {
          console.error('Failed to parse terminal message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('Terminal WebSocket error:', error);
      };

      ws.onclose = (event) => {
        if (wsRef.current !== ws) return;
        wsRef.current = null;
        const deliberate = intentionalCloseRef.current || terminalEndedRef.current;
        const idleTimedOut = idleTimedOutRef.current;

        if (
          reconnectEnabledRef.current &&
          shouldReconnectTerminal({ code: event.code, deliberate, idleTimedOut })
        ) {
          updateStatus('reconnecting');
          updateErrorMessage(null);
          applyReconnectEvent({ type: 'closed' }, () => void connectTerminal());
          return;
        }

        reconnectEnabledRef.current = false;
        reconnectStateRef.current = initialReconnectState;
        clearReconnectTimer();
        if (statusRef.current !== 'error') {
          updateStatus('disconnected');
        }
        if (!deliberate && !idleTimedOut && event.code !== 1000) {
          updateErrorMessage(`Connection closed: ${event.reason || `code ${event.code}`}`);
        }
      };

      settledResize.schedule();
    } finally {
      if (generation === connectionGenerationRef.current) {
        connectingRef.current = false;
      }
    }
  }, [
    applyReconnectEvent,
    addNotification,
    clearReconnectTimer,
    descriptorKey,
    ensureTerminal,
    fitAndResize,
    getDimensions,
    letterbox,
    onOutputWritten,
    paneId,
    sessionId,
    settledResize,
    terminalWarmTimeoutMinutes,
    terminalRef,
    updateErrorMessage,
    updateLagMessage,
    updateReadOnly,
    updateStatus,
    wsRef,
    warmKey,
  ]);

  const reconnectImmediately = useCallback((
    event: Extract<ReconnectEvent, { type: 'visibility' | 'online' }>
  ) => {
    if (!paneId || !reconnectEnabledRef.current) return;
    if (
      connectingRef.current ||
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    ) return;

    updateStatus('reconnecting');
    updateErrorMessage(null);
    applyReconnectEvent(event, () => void connect());
  }, [applyReconnectEvent, connect, paneId, updateErrorMessage, updateStatus, wsRef]);

  const disconnect = useCallback(() => {
    reconnectEnabledRef.current = false;
    reconnectStateRef.current = initialReconnectState;
    connectingRef.current = false;
    connectionGenerationRef.current += 1;
    clearReconnectTimer();

    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) {
      intentionalCloseRef.current = true;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'detach' }));
      }
      ws.close();
    }
    updateStatus('disconnected');
    updateReadOnly(false);
    updateErrorMessage(null);
    updateLagMessage(null);
    if (descriptorKey) terminalHostStore.setResumeAvailable(descriptorKey, true);
  }, [clearReconnectTimer, descriptorKey, updateErrorMessage, updateLagMessage, updateReadOnly, updateStatus, wsRef]);

  const suspend = useCallback(() => {
    const ws = wsRef.current;
    const wasActive = reconnectEnabledRef.current
      || connectingRef.current
      || ws?.readyState === WebSocket.OPEN
      || ws?.readyState === WebSocket.CONNECTING;
    if (!wasActive) return false;

    reconnectEnabledRef.current = false;
    reconnectStateRef.current = initialReconnectState;
    connectingRef.current = false;
    connectionGenerationRef.current += 1;
    clearReconnectTimer();

    wsRef.current = null;
    if (ws) {
      intentionalCloseRef.current = true;
      ws.close(1000, 'terminal background timeout');
    }
    updateStatus('disconnected');
    updateReadOnly(false);
    updateErrorMessage(null);
    updateLagMessage(null);
    if (descriptorKey) terminalHostStore.setResumeAvailable(descriptorKey, true);
    return true;
  }, [clearReconnectTimer, descriptorKey, updateErrorMessage, updateLagMessage, updateReadOnly, updateStatus, wsRef]);

  const takeControl = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'control' }));
    }
  }, [wsRef]);

  const sendInput = useCallback((data: string) => {
    if (readOnlyRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input', data }));
    }
  }, [wsRef]);

  const updateViewportHeight = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const viewport = window.visualViewport;
    if (!viewport) {
      container.style.removeProperty('--terminal-viewport-height');
      container.style.removeProperty('--keyboard-inset-height');
      return;
    }
    const bottomControls = container
      .closest<HTMLElement>('[data-terminal-workspace]')
      ?.querySelector<HTMLElement>('[data-terminal-bottom-controls]');
    const reservedBottom = bottomControls?.getBoundingClientRect().height ?? 0;
    const height = calculateTerminalViewportHeight(
      viewport,
      container.getBoundingClientRect().top,
      reservedBottom
    );
    const layoutHeight = document.documentElement.clientHeight || window.innerHeight;
    container.style.setProperty('--terminal-viewport-height', `${height}px`);
    container.style.setProperty(
      '--keyboard-inset-height',
      `${calculateKeyboardInset(layoutHeight, viewport)}px`
    );
  }, [containerRef]);

  const handleViewportResize = useCallback(() => {
    updateViewportHeight();
    settledResize.schedule();
  }, [settledResize, updateViewportHeight]);

  const handleOnline = useCallback(() => {
    reconnectImmediately({ type: 'online' });
  }, [reconnectImmediately]);

  const handleVisibilityChange = useCallback(() => {
    if (document.visibilityState === 'visible') {
      reconnectImmediately({ type: 'visibility' });
    }
  }, [reconnectImmediately]);

  useEffect(() => {
    if (!autoAttach || !paneId) return;
    if (autoAttachedSessionRef.current === sessionId) return;
    if (status !== 'disconnected') return;
    void connect();
  }, [autoAttach, connect, paneId, sessionId, status]);

  useEffect(() => {
    const resizeObserver = typeof ResizeObserver !== 'undefined' && containerRef.current
      ? new ResizeObserver(handleViewportResize)
      : null;
    if (typeof window !== 'undefined') {
      updateViewportHeight();
      if (containerRef.current) {
        resizeObserver?.observe(containerRef.current);
      }
      window.visualViewport?.addEventListener('resize', handleViewportResize);
      window.addEventListener('orientationchange', handleViewportResize);
      window.addEventListener('online', handleOnline);
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      resizeObserver?.disconnect();
      disconnect();
      settledResize.cancel();
      if (typeof window !== 'undefined') {
        window.visualViewport?.removeEventListener('resize', handleViewportResize);
        window.removeEventListener('orientationchange', handleViewportResize);
        window.removeEventListener('online', handleOnline);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [
    containerRef,
    disconnect,
    handleOnline,
    handleViewportResize,
    handleVisibilityChange,
    paneId,
    sessionId,
    settledResize,
    updateViewportHeight,
  ]);

  return {
    status,
    errorMessage,
    lagMessage,
    readOnly,
    connect,
    disconnect,
    suspend,
    takeControl,
    sendInput,
  };
}
