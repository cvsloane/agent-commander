'use client';

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { getRuntimeConfig } from '@/lib/runtimeConfig';
import { getControlPlaneToken } from '@/lib/wsToken';
import type { ConnectionStatus, XTerminal } from '@/components/terminal/types';

export function useTerminalConnection({
  sessionId,
  paneId,
  autoAttach,
  wsRef,
  terminalRef,
  ensureTerminal,
  fitAndResize,
}: {
  sessionId: string;
  paneId?: string;
  autoAttach: boolean;
  wsRef: MutableRefObject<WebSocket | null>;
  terminalRef: MutableRefObject<XTerminal | null>;
  ensureTerminal: () => Promise<XTerminal | null>;
  fitAndResize: () => void;
}) {
  const dataDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const fitTimerRef = useRef<number | null>(null);
  const readOnlyRef = useRef(false);
  const intentionalCloseRef = useRef(false);
  const suppressCloseErrorRef = useRef(false);
  const autoAttachedSessionRef = useRef<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);

  useEffect(() => {
    readOnlyRef.current = readOnly;
  }, [readOnly]);

  const resolveWsUrl = useCallback((token: string) => {
    const runtime = getRuntimeConfig();
    const base =
      runtime.controlPlaneUrl ||
      process.env.NEXT_PUBLIC_CONTROL_PLANE_URL ||
      process.env.NEXT_PUBLIC_CONTROL_PLANE_BASE_URL ||
      '';
    const configuredWs =
      runtime.controlPlaneWsUrl ||
      process.env.NEXT_PUBLIC_CONTROL_PLANE_WS_URL ||
      '';
    let configured = configuredWs;
    if (base && configuredWs) {
      try {
        const baseHost = new URL(base.replace(/\/+$/, '')).host;
        const wsHost = new URL(configuredWs).host;
        if (baseHost && wsHost && baseHost !== wsHost) {
          configured = '';
        }
      } catch {
        // ignore invalid URL parsing
      }
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let url: URL | null = null;

    if (configured) {
      try {
        url = new URL(configured);
        const host = url.hostname;
        if (
          host === 'control-plane' ||
          (!host.includes('.') && host !== 'localhost' && host !== '127.0.0.1')
        ) {
          url.host = window.location.host;
          url.protocol = protocol;
        } else {
          url.protocol = url.protocol === 'https:' ? 'wss:' : url.protocol;
          url.protocol = url.protocol === 'http:' ? 'ws:' : url.protocol;
        }
      } catch {
        url = null;
      }
    }

    if (!url && base) {
      try {
        url = new URL(base.replace(/\/+$/, ''));
        const host = url.hostname;
        if (
          host === 'control-plane' ||
          (!host.includes('.') && host !== 'localhost' && host !== '127.0.0.1')
        ) {
          url.host = window.location.host;
          url.protocol = protocol;
        } else {
          url.protocol = url.protocol === 'https:' ? 'wss:' : url.protocol;
          url.protocol = url.protocol === 'http:' ? 'ws:' : url.protocol;
        }
      } catch {
        url = null;
      }
    }

    if (!url) {
      url = new URL(`${protocol}//${window.location.host}/v1/ui/stream`);
    }

    url.pathname = `/v1/ui/terminal/${sessionId}`;
    url.search = '';
    url.searchParams.set('token', token);
    return url.toString();
  }, [sessionId]);

  const connect = useCallback(async () => {
    if (!paneId) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setStatus('connecting');
    setErrorMessage(null);

    await ensureTerminal();

    const token = await getControlPlaneToken();
    if (!token) {
      setStatus('error');
      setErrorMessage('Authentication token not found');
      return;
    }

    const ws = new WebSocket(resolveWsUrl(token));
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('connected');
      terminalRef.current?.focus();
      window.setTimeout(() => terminalRef.current?.focus(), 0);
      fitAndResize();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case 'output':
            if (msg.encoding === 'base64' && typeof msg.data === 'string') {
              const decoded = atob(msg.data);
              const bytes = new Uint8Array(decoded.length);
              for (let i = 0; i < decoded.length; i += 1) {
                bytes[i] = decoded.charCodeAt(i);
              }
              terminalRef.current?.write(bytes);
            } else {
              terminalRef.current?.write(msg.data);
            }
            terminalRef.current?.scrollToBottom();
            break;
          case 'attached':
            setStatus('connected');
            setReadOnly(false);
            fitAndResize();
            terminalRef.current?.focus();
            break;
          case 'readonly':
            setReadOnly(true);
            setErrorMessage(null);
            break;
          case 'control':
            setReadOnly(false);
            setErrorMessage(null);
            break;
          case 'detached':
            setStatus('disconnected');
            setReadOnly(false);
            suppressCloseErrorRef.current = true;
            terminalRef.current?.writeln('\r\n\x1b[33m[Terminal detached]\x1b[0m');
            break;
          case 'error':
            setStatus('error');
            setReadOnly(false);
            setErrorMessage(msg.message || 'Terminal error');
            terminalRef.current?.writeln(`\r\n\x1b[31m[Error: ${msg.message || 'Unknown error'}]\x1b[0m`);
            break;
          case 'idle_timeout':
            setStatus('disconnected');
            setReadOnly(false);
            suppressCloseErrorRef.current = true;
            terminalRef.current?.writeln('\r\n\x1b[33m[Session timed out due to inactivity]\x1b[0m');
            break;
        }
      } catch (error) {
        console.error('Failed to parse terminal message:', error);
      }
    };

    ws.onerror = () => {
      setStatus('error');
      setErrorMessage('WebSocket connection error');
    };

    ws.onclose = (event) => {
      setStatus((current) => (current === 'error' ? current : 'disconnected'));
      const suppressed = intentionalCloseRef.current || suppressCloseErrorRef.current;
      intentionalCloseRef.current = false;
      suppressCloseErrorRef.current = false;
      if (suppressed) {
        setErrorMessage(null);
        return;
      }
      if (event.code !== 1000 && event.code !== 1001 && event.code !== 1005) {
        setErrorMessage(`Connection closed: ${event.reason || `code ${event.code}`}`);
      }
    };

    dataDisposableRef.current?.dispose();
    dataDisposableRef.current = terminalRef.current?.onData((data) => {
      if (readOnlyRef.current) return;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    }) || null;

    if (fitTimerRef.current) {
      window.clearTimeout(fitTimerRef.current);
    }
    fitTimerRef.current = window.setTimeout(() => {
      fitAndResize();
    }, 60);
  }, [ensureTerminal, fitAndResize, paneId, resolveWsUrl, terminalRef, wsRef]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'detach' }));
      }
      intentionalCloseRef.current = true;
      wsRef.current.close();
      wsRef.current = null;
    }
    dataDisposableRef.current?.dispose();
    dataDisposableRef.current = null;
    setStatus('disconnected');
    setReadOnly(false);
    setErrorMessage(null);
  }, [wsRef]);

  const takeControl = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'control' }));
    }
  }, []);

  const sendInput = useCallback((data: string) => {
    if (readOnlyRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input', data }));
    }
  }, []);

  const handleViewportResize = useCallback(() => {
    if (fitTimerRef.current) {
      window.clearTimeout(fitTimerRef.current);
    }
    fitTimerRef.current = window.setTimeout(() => {
      fitAndResize();
    }, 100);
  }, [fitAndResize]);

  useEffect(() => {
    if (!autoAttach || !paneId) return;
    if (autoAttachedSessionRef.current === sessionId) return;
    if (status !== 'disconnected') return;
    autoAttachedSessionRef.current = sessionId;
    void connect();
  }, [autoAttach, connect, paneId, sessionId, status]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.visualViewport?.addEventListener('resize', handleViewportResize);
      window.addEventListener('orientationchange', handleViewportResize);
    }

    return () => {
      disconnect();
      if (fitTimerRef.current) {
        window.clearTimeout(fitTimerRef.current);
      }
      if (typeof window !== 'undefined') {
        window.visualViewport?.removeEventListener('resize', handleViewportResize);
        window.removeEventListener('orientationchange', handleViewportResize);
      }
    };
  }, [disconnect, handleViewportResize]);

  return {
    readOnlyRef,
    status,
    errorMessage,
    readOnly,
    connect,
    disconnect,
    takeControl,
    sendInput,
  };
}
