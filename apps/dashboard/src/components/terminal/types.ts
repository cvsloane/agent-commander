import type { BrowserTerminalNavigateMessage } from '@agent-command/schema';

export type XTerminal = import('@xterm/xterm').Terminal;
export type XFitAddon = import('@xterm/addon-fit').FitAddon;
export type XSearchAddon = import('@xterm/addon-search').SearchAddon;
export type XSearchResult = import('@xterm/addon-search').ISearchResultChangeEvent;

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'reconnecting'
  | 'connected'
  | 'error';

export interface TerminalController {
  status: ConnectionStatus;
  readOnly: boolean;
  attach: () => void;
  detach: () => void;
  suspend: () => boolean;
  takeControl: () => void;
  navigate: (message: BrowserTerminalNavigateMessage) => boolean;
  resetTouchModes: () => void;
  focus: () => void;
  copySelection: () => void;
  copyLastLines: (lines?: number) => void;
  copyAll: () => void;
  paste: () => void;
}
