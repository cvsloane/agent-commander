export type StickyCtrlMode = 'inactive' | 'one-shot' | 'held' | 'locked';
export type StickyCtrlEvent = 'tap' | 'hold-start' | 'hold-end' | 'double-tap' | 'consume';

export function reduceStickyCtrl(mode: StickyCtrlMode, event: StickyCtrlEvent): StickyCtrlMode {
  switch (event) {
    case 'tap':
      return mode === 'locked' ? 'inactive' : 'one-shot';
    case 'hold-start':
      return 'held';
    case 'hold-end':
      return mode === 'held' ? 'inactive' : mode;
    case 'double-tap':
      return 'locked';
    case 'consume':
      return mode === 'one-shot' ? 'inactive' : mode;
  }
}

export function applyStickyCtrl(
  mode: StickyCtrlMode,
  data: string
): { data: string; mode: StickyCtrlMode; consumed: boolean } {
  if (mode === 'inactive') {
    return { data, mode, consumed: false };
  }
  if (data.length !== 1 || !/[A-Za-z@\[\\\]^_?]/.test(data)) {
    // Escape sequences (arrows/nav keys) deliberately pass through with the
    // one-shot Ctrl still armed. Multi-codepoint TEXT (Android IME word
    // commits, paste, emoji) disarms a one-shot instead of letting it silently
    // attach to a later unintended keystroke; locked Ctrl always persists.
    const isEscapeSequence = data.startsWith('\x1b');
    return {
      data,
      mode: mode === 'one-shot' && data.length > 1 && !isEscapeSequence ? 'inactive' : mode,
      consumed: false,
    };
  }
  const normalized = data === '?' ? String.fromCharCode(127) : String.fromCharCode(data.toUpperCase().charCodeAt(0) & 31);
  return {
    data: normalized,
    mode: reduceStickyCtrl(mode, 'consume'),
    consumed: true,
  };
}
