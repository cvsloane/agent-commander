'use client';

import { createContext, useContext } from 'react';
import type { TerminalGridDimensions } from './terminalGrid';

interface TerminalGridContextValue {
  descriptorKey: string;
  letterbox?: TerminalGridDimensions;
  warmKey: string;
}

export const TerminalGridContext = createContext<TerminalGridContextValue | undefined>(undefined);

export function useTerminalGrid() {
  return useContext(TerminalGridContext)?.letterbox;
}

export function useTerminalWarmKey() {
  return useContext(TerminalGridContext)?.warmKey;
}

export function useTerminalDescriptorKey() {
  return useContext(TerminalGridContext)?.descriptorKey;
}
