'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getControlPlaneToken } from '@/lib/wsToken';
import { getRuntimeConfig } from '@/lib/runtimeConfig';
import { VirtualKeyboard, SelectionPopup, TerminalContextMenu } from '@/components/mobile';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useClipboard } from '@/hooks/useClipboard';

// Types for xterm
type XTerminal = import('xterm').Terminal;
type XFitAddon = import('xterm-addon-fit').FitAddon;

interface TerminalViewProps {
  sessionId: string;
  paneId?: string;
  className?: string;
}

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export function TerminalView({ sessionId, paneId, className }: TerminalViewProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerminal | null>(null);
  const fitAddonRef = useRef<XFitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const dataDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const fitTimerRef = useRef<number | null>(null);
  const readOnlyRef = useRef(false);
  const intentionalCloseRef = useRef(false);
  const suppressCloseErrorRef = useRef(false);
  const touchScrollRef = useRef<{ lastY: number; lastX: number; remainder: number; active: boolean }>({
    lastY: 0,
    lastX: 0,
    remainder: 0,
    active: false,
  });

  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const [selectionText, setSelectionText] = useState('');
  const [selectionAnchor, setSelectionAnchor] = useState<{ x: number; y: number } | null>(null);
  const isMobile = useIsMobile();
  const { copyToClipboard, readFromClipboard } = useClipboard();

  // Virtual keyboard handlers
  const handleVirtualInput = useCallback((data: string) => {
    if (readOnlyRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input', data }));
    }
  }, []);

  const handleVirtualInterrupt = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      // Send Ctrl+C escape sequence
      wsRef.current.send(JSON.stringify({ type: 'input', data: '\x03' }));
    }
  }, []);

  // Clipboard handlers
  const handleCopy = useCallback(() => {
    // Get xterm selection
    const selection = terminalRef.current?.getSelection();
    if (selection) {
      copyToClipboard(selection);
    }
  }, [copyToClipboard]);

  const handleCopyLastLines = useCallback((lines: number) => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    // Read lines from buffer
    const buffer = terminal.buffer.active;
    const totalLines = buffer.length;
    const startLine = Math.max(0, totalLines - lines);
    const content: string[] = [];

    for (let i = startLine; i < totalLines; i++) {
      const line = buffer.getLine(i);
      if (line) {
        content.push(line.translateToString(true));
      }
    }

    copyToClipboard(content.join('\n'));
  }, [copyToClipboard]);

  const handleCopyAll = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    // Read all lines from buffer
    const buffer = terminal.buffer.active;
    const content: string[] = [];

    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i);
      if (line) {
        content.push(line.translateToString(true));
      }
    }

    copyToClipboard(content.join('\n'));
  }, [copyToClipboard]);

  const handlePaste = useCallback(async (text?: string) => {
    if (readOnlyRef.current) return;

    const pasteText = text || await readFromClipboard();
    if (pasteText && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input', data: pasteText }));
    }
  }, [readFromClipboard]);

  const handleClear = useCallback(() => {
    // Send Ctrl+L to clear terminal
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input', data: '\x0c' }));
    }
  }, []);

  const handleSelectionCopy = useCallback((text: string) => {
    copyToClipboard(text);
  }, [copyToClipboard]);

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

    if (!url) {
      if (base) {
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
    }

    if (!url) {
      url = new URL(`${protocol}//${window.location.host}/v1/ui/stream`);
    }

    url.pathname = `/v1/ui/terminal/${sessionId}`;
    url.search = '';
    url.searchParams.set('token', token);
    return url.toString();
  }, [sessionId]);

  const fitAndResize = useCallback(() => {
    if (!fitAddonRef.current) return;
    fitAddonRef.current.fit();
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const dims = fitAddonRef.current.proposeDimensions();
      if (dims) {
        wsRef.current.send(JSON.stringify({
          type: 'resize',
          cols: dims.cols,
          rows: dims.rows,
        }));
      }
    }
  }, []);

  const connect = useCallback(async () => {
    if (!termRef.current || !paneId) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setStatus('connecting');
    setErrorMessage(null);

    // Initialize terminal if not already done
    if (!terminalRef.current) {
      // Dynamically import xterm modules
      const { Terminal } = await import('xterm');
      const { FitAddon } = await import('xterm-addon-fit');
      const { WebLinksAddon } = await import('xterm-addon-web-links');

      // Use smaller font on mobile for better fit
      const fontSize = window.matchMedia('(max-width: 767px)').matches ? 11 : 14;

      const terminal = new Terminal({
        cursorBlink: true,
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        fontSize,
        lineHeight: 1.25,
        scrollback: 4000,
        convertEol: true,
        theme: {
          background: '#0a0a0a',
          foreground: '#e5e5e5',
          cursor: '#e5e5e5',
          cursorAccent: '#0a0a0a',
          selectionBackground: '#3b3b3b',
          black: '#000000',
          red: '#ff5555',
          green: '#50fa7b',
          yellow: '#f1fa8c',
          blue: '#bd93f9',
          magenta: '#ff79c6',
          cyan: '#8be9fd',
          white: '#bbbbbb',
          brightBlack: '#555555',
          brightRed: '#ff5555',
          brightGreen: '#50fa7b',
          brightYellow: '#f1fa8c',
          brightBlue: '#bd93f9',
          brightMagenta: '#ff79c6',
          brightCyan: '#8be9fd',
          brightWhite: '#ffffff',
        },
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(new WebLinksAddon());

      terminal.open(termRef.current);
      fitAddon.fit();
      terminal.attachCustomKeyEventHandler((e) => {
        if (e.key === 'Tab') {
          e.preventDefault();
          return true;
        }
        if (e.key === 'Enter' && e.shiftKey) {
          e.preventDefault();
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            // CSI u encoding for Shift+Enter
            wsRef.current.send(JSON.stringify({ type: 'input', data: '\x1b[13;2u' }));
          }
          return false;
        }
        return true;
      });

      // Track selection changes for mobile copy button
      terminal.onSelectionChange(() => {
        const selection = terminal.getSelection();
        const hasText = !!selection && selection.length > 0;
        setHasSelection(hasText);
        setSelectionText(hasText ? selection : '');
      });

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      // Handle resize
      const resizeObserver = new ResizeObserver(() => {
        fitAndResize();
      });
      resizeObserver.observe(termRef.current);
      resizeObserverRef.current = resizeObserver;

      // Viewport resize listeners are registered in effect cleanup below.
    }

    // Build WebSocket URL
    const token = await getControlPlaneToken();
    if (!token) {
      setStatus('error');
      setErrorMessage('Authentication token not found');
      return;
    }

    const wsUrl = resolveWsUrl(token);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('connected');
      terminalRef.current?.focus();
      window.setTimeout(() => terminalRef.current?.focus(), 0);

      // Send initial resize
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
      } catch (err) {
        console.error('Failed to parse terminal message:', err);
      }
    };

    ws.onerror = () => {
      setStatus('error');
      setErrorMessage('WebSocket connection error');
    };

    ws.onclose = (event) => {
      if (status !== 'error') {
        setStatus('disconnected');
      }
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

    // Handle terminal input
    dataDisposableRef.current?.dispose();
    dataDisposableRef.current = terminalRef.current?.onData((data) => {
      if (readOnlyRef.current) {
        return;
      }
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

  }, [paneId, resolveWsUrl, status, fitAndResize]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      // Send detach message before closing
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'detach' }));
      }
      intentionalCloseRef.current = true;
      wsRef.current.close();
      wsRef.current = null;
    }
    if (dataDisposableRef.current) {
      dataDisposableRef.current.dispose();
      dataDisposableRef.current = null;
    }
    setStatus('disconnected');
    setReadOnly(false);
    setErrorMessage(null);
  }, []);

  useEffect(() => {
    if (!isMobile) return;
    const container = termRef.current;
    if (!container) return;

    const handleTouchStart = (event: TouchEvent) => {
      if (!terminalRef.current) return;
      const touch = event.touches[0];
      if (!touch) return;
      touchScrollRef.current.active = true;
      touchScrollRef.current.lastY = touch.clientY;
      touchScrollRef.current.lastX = touch.clientX;
      touchScrollRef.current.remainder = 0;
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!touchScrollRef.current.active) return;
      if (hasSelection) return;
      const touch = event.touches[0];
      if (!touch) return;
      const deltaY = touch.clientY - touchScrollRef.current.lastY;
      const deltaX = touch.clientX - touchScrollRef.current.lastX;
      if (Math.abs(deltaY) < Math.abs(deltaX)) {
        touchScrollRef.current.lastY = touch.clientY;
        touchScrollRef.current.lastX = touch.clientX;
        return;
      }
      const terminal = terminalRef.current;
      if (!terminal) return;
      const rows = terminal.rows || 0;
      const height = container.clientHeight || 0;
      const lineHeight = rows > 0 && height > 0 ? height / rows : 16;
      const totalDelta = deltaY + touchScrollRef.current.remainder;
      const lines = Math.trunc(totalDelta / lineHeight);
      touchScrollRef.current.remainder = totalDelta - lines * lineHeight;
      if (lines !== 0) {
        terminal.scrollLines(-lines);
        event.preventDefault();
      }
      touchScrollRef.current.lastY = touch.clientY;
      touchScrollRef.current.lastX = touch.clientX;
    };

    const handleTouchEnd = () => {
      touchScrollRef.current.active = false;
      touchScrollRef.current.remainder = 0;
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);
    container.addEventListener('touchcancel', handleTouchEnd);

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [isMobile, hasSelection]);

  const handleViewportResize = useCallback(() => {
    if (fitTimerRef.current) {
      window.clearTimeout(fitTimerRef.current);
    }
    fitTimerRef.current = window.setTimeout(() => {
      fitAndResize();
    }, 100);
  }, [fitAndResize]);

  // Cleanup on unmount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', handleViewportResize);
      }
      window.addEventListener('orientationchange', handleViewportResize);
    }

    return () => {
      disconnect();
      if (fitTimerRef.current) {
        window.clearTimeout(fitTimerRef.current);
      }
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      }
      // Clean up viewport listeners
      if (typeof window !== 'undefined') {
        if (window.visualViewport) {
          window.visualViewport.removeEventListener('resize', handleViewportResize);
        }
        window.removeEventListener('orientationchange', handleViewportResize);
      }
      if (terminalRef.current) {
        terminalRef.current.dispose();
      }
    };
  }, [disconnect, fitAndResize, handleViewportResize]);

  const statusColors: Record<ConnectionStatus, string> = {
    disconnected: 'bg-gray-500',
    connecting: 'bg-yellow-500 animate-pulse',
    connected: 'bg-green-500',
    error: 'bg-red-500',
  };

  const statusLabels: Record<ConnectionStatus, string> = {
    disconnected: 'Disconnected',
    connecting: 'Connecting...',
    connected: 'Connected',
    error: 'Error',
  };

  if (!paneId) {
    return (
      <div className={cn('flex flex-col h-full', className)}>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p>Terminal not available - session has no tmux pane</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full min-h-0', className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 border-b bg-muted/30">
        {status === 'connected' ? (
          <Button size="sm" variant="outline" onClick={disconnect}>
            Detach
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={connect}
            disabled={status === 'connecting'}
          >
            {status === 'connecting' ? 'Connecting...' : 'Attach Terminal'}
          </Button>
        )}

        <div className="flex items-center gap-2 text-xs">
          <span className={cn('h-2 w-2 rounded-full', statusColors[status])} />
          {statusLabels[status]}
        </div>

        {status === 'connected' && readOnly && (
          <div className="flex items-center gap-2 text-xs text-amber-600">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            Read-only
          </div>
        )}

        {errorMessage && (
          <span className="text-xs text-destructive ml-2">{errorMessage}</span>
        )}

        <div className="flex-1" />

        {status === 'connected' && readOnly && (
          <Button
            size="sm"
            variant="default"
            onClick={() => {
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: 'control' }));
              }
            }}
          >
            Take Control
          </Button>
        )}

        {status === 'connected' && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => terminalRef.current?.focus()}
          >
            Focus
          </Button>
        )}
      </div>

      {/* Terminal container */}
      <div
        ref={termRef}
        tabIndex={0}
        onMouseDown={(event) => {
          setSelectionAnchor({ x: event.clientX, y: event.clientY });
          terminalRef.current?.focus();
          window.setTimeout(() => terminalRef.current?.focus(), 0);
        }}
        onTouchStart={(event) => {
          const touch = event.touches[0];
          if (touch) {
            setSelectionAnchor({ x: touch.clientX, y: touch.clientY });
          }
          terminalRef.current?.focus();
          window.setTimeout(() => terminalRef.current?.focus(), 0);
        }}
        className={cn(
          'flex-1 min-h-0 bg-[#0a0a0a] p-1 overflow-hidden focus:outline-none cursor-text relative touch-pan-y',
          status === 'connected' && 'border-l-2 border-emerald-500 shadow-[inset_2px_0_0_rgba(16,185,129,0.35)]'
        )}
        aria-label="Interactive terminal"
      />

      {/* Mobile clipboard components */}
      {isMobile && status === 'connected' && (
        <>
          <SelectionPopup
            containerRef={termRef as React.RefObject<HTMLElement>}
            onCopy={handleSelectionCopy}
            selectionText={selectionText}
            anchorPosition={selectionAnchor ?? undefined}
          />
          <TerminalContextMenu
            containerRef={termRef as React.RefObject<HTMLElement>}
            onCopySelection={handleCopy}
            onCopyLastLines={handleCopyLastLines}
            onCopyAll={handleCopyAll}
            onPaste={() => handlePaste()}
            onClear={handleClear}
            canPaste={!readOnly}
            selectionActive={hasSelection}
          />
        </>
      )}

      {/* Virtual keyboard for mobile */}
      {status === 'connected' && !readOnly && (
        <VirtualKeyboard
          onInput={handleVirtualInput}
          onInterrupt={handleVirtualInterrupt}
          onCopy={handleCopy}
          onPaste={handlePaste}
          canCopy={hasSelection}
          canPaste={!readOnly}
          autoShowOnMobile={isMobile}
        />
      )}
    </div>
  );
}
