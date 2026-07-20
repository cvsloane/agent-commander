export type XTerminal = import('@xterm/xterm').Terminal;
export type XFitAddon = import('@xterm/addon-fit').FitAddon;

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'reconnecting'
  | 'connected'
  | 'error';

export interface TerminalController {
  attach: () => void;
  detach: () => void;
  takeControl: () => void;
  focus: () => void;
  copySelection: () => void;
  copyLastLines: (lines?: number) => void;
  copyAll: () => void;
  paste: () => void;
}
