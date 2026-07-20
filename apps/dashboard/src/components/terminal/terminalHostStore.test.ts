import { describe, expect, it } from 'vitest';
import type { XTerminal } from './types';
import { createTerminalHostStore, getTerminalDescriptorKey } from './terminalHostStore';

describe('persistent terminal host', () => {
  it('preserves the same xterm instance and buffer through roster flips and route navigation', () => {
    const host = createTerminalHostStore();
    const descriptor = { sessionId: 'session-a', paneId: '%1', autoAttach: true };
    const bufferContent = ['prompt', 'command output'];
    const terminal = { bufferContent } as unknown as XTerminal;
    const tmuxTarget = {} as HTMLDivElement;

    const leaveTmux = host.registerSurface({
      id: 'tmux-workbench',
      descriptor,
      target: tmuxTarget,
      visible: true,
    });
    host.setTerminalInstance(getTerminalDescriptorKey(descriptor), terminal);

    host.setSurfaceVisibility('tmux-workbench', false);
    expect(host.getSnapshot().terminalInstance).toBe(terminal);
    host.setSurfaceVisibility('tmux-workbench', true);
    expect(host.getSnapshot().terminalInstance).toBe(terminal);
    expect((host.getSnapshot().terminalInstance as unknown as { bufferContent: string[] }).bufferContent)
      .toEqual(['prompt', 'command output']);

    leaveTmux();
    expect(host.getSnapshot()).toMatchObject({
      descriptorKey: getTerminalDescriptorKey(descriptor),
      target: null,
      terminalInstance: terminal,
    });

    const returnToTmux = host.registerSurface({
      id: 'tmux-workbench-return',
      descriptor,
      target: {} as HTMLDivElement,
      visible: true,
    });
    expect(host.getSnapshot().terminalInstance).toBe(terminal);
    expect((host.getSnapshot().terminalInstance as unknown as { bufferContent: string[] }).bufferContent)
      .toEqual(bufferContent);

    returnToTmux();
  });

  it('drops the prior instance when a different session takes the single host', () => {
    const host = createTerminalHostStore();
    const first = { sessionId: 'session-a', paneId: '%1', autoAttach: false };
    host.registerSurface({
      id: 'first',
      descriptor: first,
      target: {} as HTMLDivElement,
      visible: true,
    });
    host.setTerminalInstance(getTerminalDescriptorKey(first), {} as XTerminal);

    host.registerSurface({
      id: 'second',
      descriptor: { sessionId: 'session-b', paneId: '%2', autoAttach: false },
      target: {} as HTMLDivElement,
      visible: true,
    });

    expect(host.getSnapshot().terminalInstance).toBeNull();
  });
});
