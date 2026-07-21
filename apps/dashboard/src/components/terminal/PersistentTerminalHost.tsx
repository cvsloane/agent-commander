'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MutableRefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { TerminalView } from '@/components/TerminalView';
import type { TerminalController, XTerminal } from './types';
import {
  getTerminalWarmKey,
  terminalHostStore,
  type TerminalHostDescriptor,
} from './terminalHostStore';
import { cn } from '@/lib/utils';
import { TerminalGridContext } from '@/hooks/terminalGridContext';
import { Button } from '@/components/ui/button';
import {
  DEFAULT_TERMINAL_WARM_TIMEOUT_MINUTES,
  useSettingsStore,
} from '@/stores/settings';

export const TERMINAL_BACKGROUND_TIMEOUT_MS = DEFAULT_TERMINAL_WARM_TIMEOUT_MINUTES * 60 * 1000;

interface PersistentTerminalSlotProps extends TerminalHostDescriptor {
  className?: string;
  controllerRef?: MutableRefObject<TerminalController | null>;
}

function isSurfaceVisible(element: HTMLDivElement): boolean {
  return element.getClientRects().length > 0;
}

export function PersistentTerminalSlot({
  sessionId,
  hostId,
  paneId,
  tmuxSessionKey,
  autoAttach,
  letterbox,
  className,
  controllerRef,
}: PersistentTerminalSlotProps) {
  const id = useId();
  const targetRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const target = targetRef.current;
    if (!target) return;

    const unregister = terminalHostStore.registerSurface({
      id,
      descriptor: { sessionId, hostId, paneId, tmuxSessionKey, autoAttach, letterbox },
      target,
      visible: isSurfaceVisible(target),
      controllerRef,
    });
    const resizeObserver = new ResizeObserver(() => {
      terminalHostStore.setSurfaceVisibility(id, isSurfaceVisible(target));
    });
    resizeObserver.observe(target);

    return () => {
      resizeObserver.disconnect();
      unregister();
    };
  }, [autoAttach, controllerRef, hostId, id, letterbox, paneId, sessionId, tmuxSessionKey]);

  return (
    <div
      ref={targetRef}
      className={cn('relative h-full min-h-0 w-full', className)}
      data-terminal-slot={sessionId}
    />
  );
}

export function PersistentTerminalHost() {
  const snapshot = useSyncExternalStore(
    terminalHostStore.subscribe,
    terminalHostStore.getSnapshot,
    terminalHostStore.getServerSnapshot
  );
  const [portalNode, setPortalNode] = useState<HTMLDivElement | null>(null);
  const parkingRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<TerminalController | null>(null);
  const hiddenTimerRef = useRef<number | null>(null);
  const shouldResumeRef = useRef(false);
  const previousDescriptorKeyRef = useRef<string | null>(null);
  const terminalWarmTimeoutMinutes = useSettingsStore(
    (state) => state.terminalWarmTimeoutMinutes ?? DEFAULT_TERMINAL_WARM_TIMEOUT_MINUTES
  );
  const attachmentDescriptor = snapshot.attachmentDescriptor ?? snapshot.descriptor;
  const selectedSessionId = snapshot.descriptor?.sessionId;
  const terminalContext = attachmentDescriptor
    ? {
        descriptorKey: snapshot.descriptorKey!,
        letterbox: attachmentDescriptor.letterbox,
        warmKey: getTerminalWarmKey(attachmentDescriptor),
      }
    : undefined;

  useEffect(() => {
    const node = document.createElement('div');
    node.className = 'h-full min-h-0 w-full';
    node.dataset.persistentTerminal = 'true';
    setPortalNode(node);
    return () => node.remove();
  }, []);

  useLayoutEffect(() => {
    if (!portalNode) return;
    const destination = snapshot.target || parkingRef.current;
    if (destination && portalNode.parentElement !== destination) {
      destination.appendChild(portalNode);
    }
  }, [portalNode, snapshot.target]);

  useEffect(() => {
    if (previousDescriptorKeyRef.current !== snapshot.descriptorKey) {
      shouldResumeRef.current = false;
      previousDescriptorKeyRef.current = snapshot.descriptorKey;
    }

    if (hiddenTimerRef.current !== null) {
      window.clearTimeout(hiddenTimerRef.current);
      hiddenTimerRef.current = null;
    }

    if (snapshot.visible) {
      if (shouldResumeRef.current) {
        shouldResumeRef.current = false;
        controllerRef.current?.attach();
      }
      return;
    }

    if (!snapshot.descriptor) return;
    hiddenTimerRef.current = window.setTimeout(() => {
      hiddenTimerRef.current = null;
      shouldResumeRef.current = controllerRef.current?.suspend() ?? false;
    }, terminalWarmTimeoutMinutes * 60 * 1000);

    return () => {
      if (hiddenTimerRef.current !== null) {
        window.clearTimeout(hiddenTimerRef.current);
        hiddenTimerRef.current = null;
      }
    };
  }, [snapshot.descriptor, snapshot.descriptorKey, snapshot.visible, terminalWarmTimeoutMinutes]);

  const handleControllerChange = useCallback((controller: TerminalController | null) => {
    controllerRef.current = controller;
    terminalHostStore.setController(controller);
  }, []);

  const handleTerminalInstanceChange = useCallback((terminal: XTerminal | null) => {
    if (!snapshot.descriptorKey) return;
    terminalHostStore.setTerminalInstance(snapshot.descriptorKey, terminal);
  }, [snapshot.descriptorKey]);

  return (
    <>
      <div ref={parkingRef} hidden aria-hidden="true" data-terminal-parking />
      {portalNode && attachmentDescriptor && selectedSessionId && createPortal(
        <TerminalGridContext.Provider value={terminalContext}>
          <TerminalView
            key={snapshot.descriptorKey}
            sessionId={attachmentDescriptor.sessionId}
            historySessionId={selectedSessionId}
            hostId={attachmentDescriptor.hostId}
            paneId={attachmentDescriptor.paneId}
            autoAttach={attachmentDescriptor.autoAttach}
            onControllerChange={handleControllerChange}
            onTerminalInstanceChange={handleTerminalInstanceChange}
          />
        </TerminalGridContext.Provider>,
        portalNode
      )}
      {snapshot.target && snapshot.resumeAvailable && createPortal(
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <Button type="button" onClick={() => controllerRef.current?.attach()}>
            Resume
          </Button>
        </div>,
        snapshot.target
      )}
    </>
  );
}
