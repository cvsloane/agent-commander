import { describe, expect, it } from 'vitest';
import {
  parseTerminalRailConfig,
  resolveTerminalRailBinding,
} from './terminalRailConfig';

describe('terminal rail config engine', () => {
  it('parses keysyms, chords, macros, and popup bindings', () => {
    const config = parseTerminalRailConfig({
      version: 1,
      keys: [
        {
          id: 'up',
          label: '↑',
          binding: { type: 'keysym', value: 'arrow_up' },
          popup: { label: 'PgUp', type: 'keysym', value: 'page_up' },
        },
        { id: 'interrupt', label: 'C-c', binding: { type: 'chord', value: ['ctrl', 'c'] } },
        { id: 'approve', label: 'y↵', binding: { type: 'macro', value: 'y\r' } },
      ],
    });

    expect(config.keys).toHaveLength(3);
    expect(resolveTerminalRailBinding(config.keys[0]!.binding)).toEqual({
      type: 'input',
      data: '\x1b[A',
    });
    expect(resolveTerminalRailBinding(config.keys[0]!.popup!)).toEqual({
      type: 'input',
      data: '\x1b[5~',
    });
    expect(resolveTerminalRailBinding(config.keys[1]!.binding)).toEqual({
      type: 'input',
      data: '\x03',
    });
    expect(resolveTerminalRailBinding(config.keys[2]!.binding)).toEqual({
      type: 'input',
      data: 'y\r',
    });
  });

  it('resolves prefix keysyms and chords with the supplied host sequence', () => {
    expect(resolveTerminalRailBinding({ type: 'keysym', value: 'prefix' }, '\x01')).toEqual({
      type: 'input',
      data: '\x01',
    });
    expect(resolveTerminalRailBinding({ type: 'chord', value: ['prefix', '['] }, '\x01')).toEqual({
      type: 'input',
      data: '\x01[',
    });
  });

  it('rejects duplicate ids and invalid bindings', () => {
    expect(() => parseTerminalRailConfig({
      version: 1,
      keys: [
        { id: 'same', label: 'A', binding: { type: 'macro', value: 'a' } },
        { id: 'same', label: 'B', binding: { type: 'macro', value: 'b' } },
      ],
    })).toThrow(/unique id/);
    expect(() => parseTerminalRailConfig({
      version: 1,
      keys: [{ id: 'bad', label: 'Bad', binding: { type: 'keysym', value: 'nope' } }],
    })).toThrow(/valid binding/);
  });
});
