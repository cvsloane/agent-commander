'use client';

import { createContext, useContext } from 'react';
import type { TerminalGridDimensions } from './terminalGrid';

export const TerminalGridContext = createContext<TerminalGridDimensions | undefined>(undefined);

export function useTerminalGrid() {
  return useContext(TerminalGridContext);
}
