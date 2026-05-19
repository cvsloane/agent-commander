export interface TmuxShortcutKey {
  label: string;
  ariaLabel: string;
  data: string;
  icon: 'left' | 'right' | 'up' | 'down' | null;
}

export const TMUX_PREFIX = '\x02';

export const TMUX_SHORTCUT_KEYS: TmuxShortcutKey[] = [
  { label: 'Prefix', ariaLabel: 'tmux prefix', data: TMUX_PREFIX, icon: null },
  { label: 'Prev', ariaLabel: 'tmux previous window', data: `${TMUX_PREFIX}p`, icon: null },
  { label: 'Next', ariaLabel: 'tmux next window', data: `${TMUX_PREFIX}n`, icon: null },
  { label: 'Copy', ariaLabel: 'tmux copy mode', data: `${TMUX_PREFIX}[`, icon: null },
  { label: 'Zoom', ariaLabel: 'tmux zoom pane', data: `${TMUX_PREFIX}z`, icon: null },
  { label: 'Split H', ariaLabel: 'tmux split horizontal', data: `${TMUX_PREFIX}"`, icon: null },
  { label: 'Split V', ariaLabel: 'tmux split vertical', data: `${TMUX_PREFIX}%`, icon: null },
  { label: '', ariaLabel: 'tmux pane left', data: `${TMUX_PREFIX}\x1b[D`, icon: 'left' },
  { label: '', ariaLabel: 'tmux pane down', data: `${TMUX_PREFIX}\x1b[B`, icon: 'down' },
  { label: '', ariaLabel: 'tmux pane up', data: `${TMUX_PREFIX}\x1b[A`, icon: 'up' },
  { label: '', ariaLabel: 'tmux pane right', data: `${TMUX_PREFIX}\x1b[C`, icon: 'right' },
];
