export interface TmuxShortcutKey {
  label: string;
  ariaLabel: string;
  data: string;
  icon: 'left' | 'right' | 'up' | 'down' | null;
}

export const DEFAULT_TMUX_PREFIX = 'C-b';

export function isValidTmuxPrefix(prefix: string): boolean {
  return /^C-[A-Za-z@\[\\\]^_?]$/.test(prefix.trim()) || /^M-.$/.test(prefix.trim());
}

export function tmuxPrefixToSequence(prefix = DEFAULT_TMUX_PREFIX): string {
  const normalized = prefix.trim();
  const ctrl = normalized.match(/^C-([A-Za-z@\[\\\]^_?])$/);
  if (ctrl) {
    const key = ctrl[1]!;
    return key === '?'
      ? String.fromCharCode(127)
      : String.fromCharCode(key.toUpperCase().charCodeAt(0) & 31);
  }
  const alt = normalized.match(/^M-(.)$/);
  if (alt) return `\x1b${alt[1]}`;
  return tmuxPrefixToSequence(DEFAULT_TMUX_PREFIX);
}

export function buildTmuxShortcutKeys(prefix = DEFAULT_TMUX_PREFIX): TmuxShortcutKey[] {
  const data = tmuxPrefixToSequence(prefix);
  return [
    { label: 'Prefix', ariaLabel: 'tmux prefix', data, icon: null },
    { label: 'Prev', ariaLabel: 'tmux previous window', data: `${data}p`, icon: null },
    { label: 'Next', ariaLabel: 'tmux next window', data: `${data}n`, icon: null },
    { label: 'Copy', ariaLabel: 'tmux copy mode', data: `${data}[`, icon: null },
    { label: 'Zoom', ariaLabel: 'tmux zoom pane', data: `${data}z`, icon: null },
    { label: 'Split H', ariaLabel: 'tmux split horizontal', data: `${data}"`, icon: null },
    { label: 'Split V', ariaLabel: 'tmux split vertical', data: `${data}%`, icon: null },
    { label: '', ariaLabel: 'tmux pane left', data: `${data}\x1b[D`, icon: 'left' },
    { label: '', ariaLabel: 'tmux pane down', data: `${data}\x1b[B`, icon: 'down' },
    { label: '', ariaLabel: 'tmux pane up', data: `${data}\x1b[A`, icon: 'up' },
    { label: '', ariaLabel: 'tmux pane right', data: `${data}\x1b[C`, icon: 'right' },
  ];
}

export const TMUX_SHORTCUT_KEYS = buildTmuxShortcutKeys();
