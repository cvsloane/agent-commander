import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  PersistentSessionTerminal,
  PersistentTerminalRegion,
} from '@/components/tmux/TmuxMobileShell';

describe('mobile terminal mount', () => {
  it('keeps terminal children rendered while the roster CSS-hides the region', () => {
    const hidden = renderToStaticMarkup(
      createElement(
        PersistentTerminalRegion,
        { visible: false },
        createElement('span', { 'data-scrollback': 'preserved' }, 'terminal buffer')
      )
    );
    const visible = renderToStaticMarkup(
      createElement(
        PersistentTerminalRegion,
        { visible: true },
        createElement('span', { 'data-scrollback': 'preserved' }, 'terminal buffer')
      )
    );

    expect(hidden).toContain('data-scrollback="preserved"');
    expect(hidden).toContain('hidden');
    expect(visible).toContain('data-scrollback="preserved"');
    expect(visible).not.toContain('hidden=""');
  });

  it('keeps the mount key for mode changes and replaces it for a different session', () => {
    const first = PersistentSessionTerminal({ sessionId: 'session-a', children: 'terminal' });
    const rosterRoundTrip = PersistentSessionTerminal({ sessionId: 'session-a', children: 'terminal' });
    const nextSession = PersistentSessionTerminal({ sessionId: 'session-b', children: 'terminal' });

    expect(first.key).toBe('session-a');
    expect(rosterRoundTrip.key).toBe(first.key);
    expect(nextSession.key).not.toBe(first.key);
  });
});
