import type { MutableRefObject } from 'react';
import type { BrowserTerminalNavigateMessage } from '@agent-command/schema';
import type { ConnectionStatus, TerminalController, XTerminal } from './types';
import type { TerminalGridDimensions } from '@/hooks/terminalGrid';
import { captureTerminalWarmBuffer } from '@/hooks/terminalWarmCache';

export interface TerminalHostDescriptor {
  sessionId: string;
  hostId?: string;
  paneId?: string;
  tmuxSessionKey?: string;
  autoAttach: boolean;
  letterbox?: TerminalGridDimensions;
  preferLocalChat?: boolean;
}

export interface TerminalHostSnapshot {
  descriptor: TerminalHostDescriptor | null;
  attachmentDescriptor: TerminalHostDescriptor | null;
  descriptorKey: string | null;
  target: HTMLDivElement | null;
  visible: boolean;
  terminalInstance: XTerminal | null;
  status: ConnectionStatus;
  readOnly: boolean;
  resumeAvailable: boolean;
  navigation: {
    status: 'pending' | 'error';
    targetSessionId: string;
    message?: string;
  } | null;
}

export type FocusWithinAttachmentResult =
  | { status: 'unavailable' }
  | { status: 'success' }
  | { status: 'error'; message: string }
  | { status: 'superseded' };

interface SurfaceRegistration {
  id: string;
  descriptor: TerminalHostDescriptor;
  target: HTMLDivElement;
  visible: boolean;
  controllerRef?: MutableRefObject<TerminalController | null>;
  order: number;
}

const EMPTY_SNAPSHOT: TerminalHostSnapshot = {
  descriptor: null,
  attachmentDescriptor: null,
  descriptorKey: null,
  target: null,
  visible: false,
  terminalInstance: null,
  status: 'disconnected',
  readOnly: false,
  resumeAvailable: false,
  navigation: null,
};

export function getTerminalDescriptorKey(descriptor: TerminalHostDescriptor): string {
  // Identity starts as session+pane. A successful viewer-scoped navigation
  // explicitly preserves the existing key in the store. Letterbox dims must
  // never be part of this identity or they recreate the attach/detach loop.
  return `${descriptor.sessionId}\u0000${descriptor.paneId || ''}`;
}

export function getTerminalWarmKey(descriptor: TerminalHostDescriptor): string {
  return `${descriptor.sessionId}\u0000${descriptor.paneId || ''}`;
}

export function createTerminalHostStore() {
  const listeners = new Set<() => void>();
  const surfaces = new Map<string, SurfaceRegistration>();
  let snapshot = EMPTY_SNAPSHOT;
  let order = 0;
  let controller: TerminalController | null = null;
  let activeControllerRef: MutableRefObject<TerminalController | null> | undefined;
  const pendingRetargetDescriptorKeys = new Set<string>();
  let navigationGeneration = 0;

  const emit = () => {
    for (const listener of listeners) listener();
  };

  const setActiveControllerRef = (
    nextRef: MutableRefObject<TerminalController | null> | undefined
  ) => {
    if (activeControllerRef && activeControllerRef !== nextRef) {
      activeControllerRef.current = null;
    }
    activeControllerRef = nextRef;
    if (activeControllerRef) {
      activeControllerRef.current = controller;
    }
  };

  const selectActiveSurface = () => {
    const activeSurface = Array.from(surfaces.values()).reduce<SurfaceRegistration | null>(
      (current, candidate) => !current || candidate.order > current.order ? candidate : current,
      null
    );

    if (!activeSurface) {
      setActiveControllerRef(undefined);
      snapshot = {
        ...snapshot,
        target: null,
        visible: false,
      };
      emit();
      return;
    }

    const targetDescriptorKey = getTerminalDescriptorKey(activeSurface.descriptor);
    const sameTmuxSession = Boolean(
      activeSurface.descriptor.tmuxSessionKey
      && activeSurface.descriptor.tmuxSessionKey === snapshot.attachmentDescriptor?.tmuxSessionKey
    );
    const alreadySelected = snapshot.descriptor
      ? getTerminalDescriptorKey(snapshot.descriptor) === targetDescriptorKey
      : false;
    const preserveNavigatedAttachment = sameTmuxSession && (
      pendingRetargetDescriptorKeys.has(targetDescriptorKey) || alreadySelected
    );
    const completesPendingRetarget = pendingRetargetDescriptorKeys.has(targetDescriptorKey);
    const descriptorKey = preserveNavigatedAttachment && snapshot.descriptorKey
      ? snapshot.descriptorKey
      : targetDescriptorKey;
    pendingRetargetDescriptorKeys.delete(targetDescriptorKey);
    const descriptorChanged = descriptorKey !== snapshot.descriptorKey;
    if (descriptorChanged) {
      const attachmentDescriptor = snapshot.attachmentDescriptor ?? snapshot.descriptor;
      if (attachmentDescriptor && snapshot.terminalInstance) {
        captureTerminalWarmBuffer(
          getTerminalWarmKey(attachmentDescriptor),
          snapshot.terminalInstance
        );
      }
      controller = null;
    }
    setActiveControllerRef(activeSurface.controllerRef);
    snapshot = {
      descriptor: activeSurface.descriptor,
      attachmentDescriptor: descriptorChanged
        ? activeSurface.descriptor
        : snapshot.attachmentDescriptor ?? activeSurface.descriptor,
      descriptorKey,
      target: activeSurface.target,
      visible: activeSurface.visible,
      terminalInstance: descriptorChanged ? null : snapshot.terminalInstance,
      status: descriptorChanged ? 'disconnected' : snapshot.status,
      readOnly: descriptorChanged ? false : snapshot.readOnly,
      resumeAvailable: descriptorChanged ? false : snapshot.resumeAvailable,
      navigation: completesPendingRetarget
        && snapshot.navigation?.targetSessionId === activeSurface.descriptor.sessionId
        ? null
        : snapshot.navigation,
    };
    emit();
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return snapshot;
    },
    getServerSnapshot() {
      return EMPTY_SNAPSHOT;
    },
    registerSurface(registration: Omit<SurfaceRegistration, 'order'>) {
      order += 1;
      surfaces.set(registration.id, { ...registration, order });
      selectActiveSurface();
      return () => {
        const registered = surfaces.get(registration.id);
        if (registered?.controllerRef) {
          registered.controllerRef.current = null;
        }
        surfaces.delete(registration.id);
        selectActiveSurface();
      };
    },
    setSurfaceVisibility(id: string, visible: boolean) {
      const surface = surfaces.get(id);
      if (!surface || surface.visible === visible) return;
      surface.visible = visible;
      selectActiveSurface();
    },
    setController(nextController: TerminalController | null) {
      controller = nextController;
      if (activeControllerRef) {
        activeControllerRef.current = nextController;
      }
      const readOnly = nextController?.readOnly ?? false;
      const status = nextController?.status ?? 'disconnected';
      if (snapshot.readOnly !== readOnly || snapshot.status !== status) {
        snapshot = { ...snapshot, readOnly, status };
        emit();
      }
    },
    navigateWithinAttachment(
      descriptor: TerminalHostDescriptor,
      messages: BrowserTerminalNavigateMessage[]
    ) {
      if (
        !descriptor.tmuxSessionKey
        || descriptor.tmuxSessionKey !== snapshot.attachmentDescriptor?.tmuxSessionKey
        || controller?.status !== 'connected'
      ) {
        return false;
      }
      const navigated = messages.length > 0
        && messages.every((message) => controller?.navigate(message) ?? false);
      if (navigated) {
        pendingRetargetDescriptorKeys.add(getTerminalDescriptorKey(descriptor));
      }
      return navigated;
    },
    async focusWithinAttachment(
      descriptor: TerminalHostDescriptor,
      zoom: boolean
    ): Promise<FocusWithinAttachmentResult> {
      if (
        !descriptor.paneId
        || !descriptor.tmuxSessionKey
        || descriptor.tmuxSessionKey !== snapshot.attachmentDescriptor?.tmuxSessionKey
        || controller?.status !== 'connected'
      ) {
        return { status: 'unavailable' };
      }

      const generation = ++navigationGeneration;
      snapshot = {
        ...snapshot,
        navigation: { status: 'pending', targetSessionId: descriptor.sessionId },
      };
      emit();
      const result = await controller.focusPane(descriptor.paneId, zoom);
      if (generation !== navigationGeneration) return { status: 'superseded' };

      const targetConverged = result.pane_id === descriptor.paneId && result.zoomed === zoom;
      if (!targetConverged) {
        const message = result.ok
          ? 'Tmux reported a different pane or zoom state.'
          : result.message;
        const selectedConverged = result.pane_id === snapshot.descriptor?.paneId
          && result.zoomed === zoom;
        snapshot = {
          ...snapshot,
          // A failed request can still report authoritative viewer state. Adopt
          // the still-selected pane only when pane and zoom both converge;
          // otherwise retain the pending state as the shared input fence.
          navigation: selectedConverged
            ? null
            : {
                status: 'pending',
                targetSessionId: descriptor.sessionId,
                message,
              },
        };
        emit();
        return { status: 'error', message };
      }

      const targetDescriptorKey = getTerminalDescriptorKey(descriptor);
      const alreadySelected = snapshot.descriptor
        && getTerminalDescriptorKey(snapshot.descriptor) === targetDescriptorKey;
      if (!alreadySelected) {
        pendingRetargetDescriptorKeys.add(targetDescriptorKey);
      }
      snapshot = { ...snapshot, navigation: alreadySelected ? null : snapshot.navigation };
      emit();
      return { status: 'success' };
    },
    beginViewerReconciliation(descriptor: TerminalHostDescriptor) {
      if (
        !descriptor.paneId
        || !snapshot.descriptor
        || getTerminalDescriptorKey(snapshot.descriptor) !== getTerminalDescriptorKey(descriptor)
      ) {
        return false;
      }
      navigationGeneration += 1;
      snapshot = {
        ...snapshot,
        navigation: { status: 'pending', targetSessionId: descriptor.sessionId },
      };
      emit();
      return true;
    },
    finishViewerReconciliation(
      descriptor: TerminalHostDescriptor,
      message?: string
    ) {
      if (
        !snapshot.descriptor
        || getTerminalDescriptorKey(snapshot.descriptor) !== getTerminalDescriptorKey(descriptor)
        || snapshot.navigation?.targetSessionId !== descriptor.sessionId
      ) {
        return false;
      }
      snapshot = {
        ...snapshot,
        navigation: message
          ? {
              status: 'pending',
              targetSessionId: descriptor.sessionId,
              message,
            }
          : null,
      };
      emit();
      return true;
    },
    setTerminalInstance(descriptorKey: string, instance: XTerminal | null) {
      if (snapshot.descriptorKey !== descriptorKey) return;
      snapshot = { ...snapshot, terminalInstance: instance };
      emit();
    },
    setResumeAvailable(descriptorKey: string, available: boolean) {
      if (snapshot.descriptorKey !== descriptorKey || snapshot.resumeAvailable === available) return;
      snapshot = { ...snapshot, resumeAvailable: available };
      emit();
    },
    reset() {
      surfaces.clear();
      setActiveControllerRef(undefined);
      controller = null;
      order = 0;
      pendingRetargetDescriptorKeys.clear();
      navigationGeneration += 1;
      snapshot = EMPTY_SNAPSHOT;
      emit();
    },
  };
}

export const terminalHostStore = createTerminalHostStore();
