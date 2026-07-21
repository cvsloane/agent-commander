import type { MutableRefObject } from 'react';
import type { TerminalController, XTerminal } from './types';
import type { TerminalGridDimensions } from '@/hooks/terminalGrid';
import { captureTerminalWarmBuffer } from '@/hooks/terminalWarmCache';

export interface TerminalHostDescriptor {
  sessionId: string;
  paneId?: string;
  autoAttach: boolean;
  letterbox?: TerminalGridDimensions;
}

export interface TerminalHostSnapshot {
  descriptor: TerminalHostDescriptor | null;
  descriptorKey: string | null;
  target: HTMLDivElement | null;
  visible: boolean;
  terminalInstance: XTerminal | null;
  readOnly: boolean;
  resumeAvailable: boolean;
}

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
  descriptorKey: null,
  target: null,
  visible: false,
  terminalInstance: null,
  readOnly: false,
  resumeAvailable: false,
};

export function getTerminalDescriptorKey(descriptor: TerminalHostDescriptor): string {
  const grid = descriptor.letterbox
    ? `${descriptor.letterbox.cols}x${descriptor.letterbox.rows}`
    : 'fit';
  return `${descriptor.sessionId}\u0000${descriptor.paneId || ''}\u0000${grid}`;
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

    const descriptorKey = getTerminalDescriptorKey(activeSurface.descriptor);
    const descriptorChanged = descriptorKey !== snapshot.descriptorKey;
    if (descriptorChanged) {
      if (snapshot.descriptor && snapshot.terminalInstance) {
        captureTerminalWarmBuffer(
          getTerminalWarmKey(snapshot.descriptor),
          snapshot.terminalInstance
        );
      }
      controller = null;
    }
    setActiveControllerRef(activeSurface.controllerRef);
    snapshot = {
      descriptor: activeSurface.descriptor,
      descriptorKey,
      target: activeSurface.target,
      visible: activeSurface.visible,
      terminalInstance: descriptorChanged ? null : snapshot.terminalInstance,
      readOnly: descriptorChanged ? false : snapshot.readOnly,
      resumeAvailable: descriptorChanged ? false : snapshot.resumeAvailable,
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
      if (snapshot.readOnly !== readOnly) {
        snapshot = { ...snapshot, readOnly };
        emit();
      }
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
      snapshot = EMPTY_SNAPSHOT;
      emit();
    },
  };
}

export const terminalHostStore = createTerminalHostStore();
