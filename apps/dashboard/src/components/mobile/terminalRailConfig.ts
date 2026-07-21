import { DEFAULT_TMUX_PREFIX, tmuxPrefixToSequence } from '@/lib/tmuxKeys';

export const TERMINAL_RAIL_KEYSYMS = [
  'ctrl',
  'esc',
  'tab',
  'enter',
  'arrow_up',
  'arrow_down',
  'arrow_left',
  'arrow_right',
  'home',
  'end',
  'page_up',
  'page_down',
  'prefix',
  'history',
  'previous_mark',
  'next_mark',
] as const;

export type TerminalRailKeysym = (typeof TERMINAL_RAIL_KEYSYMS)[number];
export type TerminalRailBinding =
  | { type: 'keysym'; value: TerminalRailKeysym }
  | { type: 'chord'; value: string[] }
  | { type: 'macro'; value: string };

export type TerminalRailPopup = TerminalRailBinding & { label: string };

export interface TerminalRailKey {
  id: string;
  label: string;
  binding: TerminalRailBinding;
  popup?: TerminalRailPopup;
}

export interface TerminalRailConfig {
  version: 1;
  keys: TerminalRailKey[];
}

export type TerminalRailPreset = 'minimal' | 'expanded' | 'custom';
export type TerminalRailAction =
  | { type: 'input'; data: string }
  | { type: 'modifier'; modifier: 'ctrl' }
  | { type: 'history' }
  | { type: 'mark'; direction: 'previous' | 'next' };

const KEY_DATA: Partial<Record<TerminalRailKeysym, string>> = {
  esc: '\x1b',
  tab: '\t',
  enter: '\r',
  arrow_up: '\x1b[A',
  arrow_down: '\x1b[B',
  arrow_left: '\x1b[D',
  arrow_right: '\x1b[C',
  home: '\x1b[H',
  end: '\x1b[F',
  page_up: '\x1b[5~',
  page_down: '\x1b[6~',
};

export const MINIMAL_TERMINAL_RAIL_CONFIG: TerminalRailConfig = {
  version: 1,
  keys: [
    { id: 'esc', label: 'Esc', binding: { type: 'keysym', value: 'esc' } },
    { id: 'ctrl', label: 'Ctrl', binding: { type: 'keysym', value: 'ctrl' } },
    {
      id: 'up',
      label: '↑',
      binding: { type: 'keysym', value: 'arrow_up' },
      popup: { label: 'PgUp', type: 'keysym', value: 'page_up' },
    },
    {
      id: 'down',
      label: '↓',
      binding: { type: 'keysym', value: 'arrow_down' },
      popup: { label: 'PgDn', type: 'keysym', value: 'page_down' },
    },
    {
      id: 'left',
      label: '←',
      binding: { type: 'keysym', value: 'arrow_left' },
      popup: { label: 'Home', type: 'keysym', value: 'home' },
    },
    {
      id: 'right',
      label: '→',
      binding: { type: 'keysym', value: 'arrow_right' },
      popup: { label: 'End', type: 'keysym', value: 'end' },
    },
  ],
};

export const EXPANDED_TERMINAL_RAIL_CONFIG: TerminalRailConfig = {
  version: 1,
  keys: [
    ...MINIMAL_TERMINAL_RAIL_CONFIG.keys,
    { id: 'tab', label: 'Tab', binding: { type: 'keysym', value: 'tab' } },
    { id: 'prefix', label: 'Prefix', binding: { type: 'keysym', value: 'prefix' } },
    { id: 'history', label: 'History', binding: { type: 'keysym', value: 'history' } },
    { id: 'previous-mark', label: '⌃ Mark', binding: { type: 'keysym', value: 'previous_mark' } },
    { id: 'next-mark', label: '⌄ Mark', binding: { type: 'keysym', value: 'next_mark' } },
    { id: 'approve', label: 'y↵', binding: { type: 'macro', value: 'y\r' } },
    { id: 'compact', label: '/compact', binding: { type: 'macro', value: '/compact' } },
  ],
};

export function cloneTerminalRailConfig(config: TerminalRailConfig): TerminalRailConfig {
  return JSON.parse(JSON.stringify(config)) as TerminalRailConfig;
}

export function terminalRailPresetConfig(preset: Exclude<TerminalRailPreset, 'custom'>): TerminalRailConfig {
  return cloneTerminalRailConfig(
    preset === 'expanded' ? EXPANDED_TERMINAL_RAIL_CONFIG : MINIMAL_TERMINAL_RAIL_CONFIG
  );
}

function isBinding(value: unknown): value is TerminalRailBinding {
  if (!value || typeof value !== 'object') return false;
  const binding = value as Record<string, unknown>;
  if (binding.type === 'keysym') {
    return TERMINAL_RAIL_KEYSYMS.includes(binding.value as TerminalRailKeysym);
  }
  if (binding.type === 'chord') {
    return Array.isArray(binding.value)
      && binding.value.length >= 2
      && binding.value.every((part) => typeof part === 'string' && part.length > 0);
  }
  return binding.type === 'macro' && typeof binding.value === 'string';
}

export function parseTerminalRailConfig(value: unknown): TerminalRailConfig {
  if (!value || typeof value !== 'object') throw new Error('Rail config must be a JSON object.');
  const config = value as Record<string, unknown>;
  if (config.version !== 1 || !Array.isArray(config.keys) || config.keys.length === 0) {
    throw new Error('Rail config must use version 1 and include at least one key.');
  }
  const ids = new Set<string>();
  const keys = config.keys.map((value, index): TerminalRailKey => {
    if (!value || typeof value !== 'object') throw new Error(`Key ${index + 1} must be an object.`);
    const key = value as Record<string, unknown>;
    if (typeof key.id !== 'string' || !key.id.trim() || ids.has(key.id)) {
      throw new Error(`Key ${index + 1} needs a unique id.`);
    }
    if (typeof key.label !== 'string' || !key.label.trim() || !isBinding(key.binding)) {
      throw new Error(`Key ${key.id} needs a label and valid binding.`);
    }
    ids.add(key.id);
    let popup: TerminalRailPopup | undefined;
    if (key.popup !== undefined) {
      if (!key.popup || typeof key.popup !== 'object') throw new Error(`Key ${key.id} popup is invalid.`);
      const candidate = key.popup as Record<string, unknown>;
      if (typeof candidate.label !== 'string' || !candidate.label.trim() || !isBinding(candidate)) {
        throw new Error(`Key ${key.id} popup needs a label and valid binding.`);
      }
      popup = candidate as unknown as TerminalRailPopup;
    }
    return {
      id: key.id,
      label: key.label,
      binding: key.binding,
      ...(popup ? { popup } : {}),
    };
  });
  return { version: 1, keys };
}

function ctrlCharacter(value: string): string | null {
  if (value.length !== 1) return null;
  const upper = value.toUpperCase();
  const code = upper.charCodeAt(0);
  if (code < 64 || code > 95) return null;
  return String.fromCharCode(code & 31);
}

export function resolveTerminalRailBinding(
  binding: TerminalRailBinding,
  prefix = tmuxPrefixToSequence(DEFAULT_TMUX_PREFIX)
): TerminalRailAction {
  if (binding.type === 'macro') return { type: 'input', data: binding.value };
  if (binding.type === 'keysym') {
    if (binding.value === 'ctrl') return { type: 'modifier', modifier: 'ctrl' };
    if (binding.value === 'history') return { type: 'history' };
    if (binding.value === 'previous_mark') return { type: 'mark', direction: 'previous' };
    if (binding.value === 'next_mark') return { type: 'mark', direction: 'next' };
    if (binding.value === 'prefix') return { type: 'input', data: prefix };
    return { type: 'input', data: KEY_DATA[binding.value] ?? '' };
  }

  const [modifier, ...parts] = binding.value;
  const value = parts.join('');
  switch (modifier.toLowerCase()) {
    case 'ctrl': {
      const data = ctrlCharacter(value);
      if (!data) throw new Error(`Unsupported Ctrl chord: ${binding.value.join('+')}`);
      return { type: 'input', data };
    }
    case 'alt':
      return { type: 'input', data: `\x1b${value}` };
    case 'prefix':
      return { type: 'input', data: `${prefix}${value}` };
    default:
      throw new Error(`Unsupported chord modifier: ${modifier}`);
  }
}

export function isArrowRailKey(key: TerminalRailKey): boolean {
  return key.binding.type === 'keysym' && key.binding.value.startsWith('arrow_');
}
