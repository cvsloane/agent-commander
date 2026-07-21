import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalController, XTerminal } from './types';
import {
  createTerminalHostStore,
  getTerminalDescriptorKey,
  getTerminalWarmKey,
} from './terminalHostStore';
import {
  paintTerminalWarmBuffer,
  resetTerminalWarmCache,
} from '@/hooks/terminalWarmCache';

function controller(readOnly: boolean): TerminalController {
  return {
    status: 'connected',
    readOnly,
    attach: () => undefined,
    detach: () => undefined,
    suspend: () => false,
    takeControl: () => undefined,
    navigate: () => false,
    focus: () => undefined,
    copySelection: () => undefined,
    copyLastLines: () => undefined,
    copyAll: () => undefined,
    paste: () => undefined,
  };
}

describe('persistent terminal host', () => {
  beforeEach(resetTerminalWarmCache);

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

  it('retargets within one tmux session without replacing the live attachment or xterm instance', () => {
    const host = createTerminalHostStore();
    const first = {
      sessionId: 'session-a',
      hostId: 'host-1',
      paneId: '%1',
      tmuxSessionKey: 'host-1\u0000agents',
      autoAttach: true,
    };
    const second = {
      sessionId: 'session-b',
      hostId: 'host-1',
      paneId: '%2',
      tmuxSessionKey: 'host-1\u0000agents',
      autoAttach: true,
    };
    const terminal = {} as XTerminal;
    const leaveFirst = host.registerSurface({
      id: 'first',
      descriptor: first,
      target: {} as HTMLDivElement,
      visible: true,
    });
    host.setTerminalInstance(getTerminalDescriptorKey(first), terminal);
    host.setController({ ...controller(false), navigate: () => true });
    expect(host.navigateWithinAttachment(second, [
      { type: 'navigate', op: 'select_window', window_index: 2 },
      { type: 'navigate', op: 'select_pane', pane_id: '%2' },
    ])).toBe(true);

    leaveFirst();
    host.registerSurface({
      id: 'second',
      descriptor: second,
      target: {} as HTMLDivElement,
      visible: true,
    });

    expect(host.getSnapshot()).toMatchObject({
      descriptor: second,
      attachmentDescriptor: first,
      descriptorKey: 'session-a\u0000%1',
      terminalInstance: terminal,
    });
  });

  it('emits navigation only when the target shares the live attachment key', () => {
    const host = createTerminalHostStore();
    const descriptor = {
      sessionId: 'session-a',
      hostId: 'host-1',
      paneId: '%1',
      tmuxSessionKey: 'host-1\u0000agents',
      autoAttach: true,
    };
    host.registerSurface({
      id: 'first',
      descriptor,
      target: {} as HTMLDivElement,
      visible: true,
    });
    const navigate = vi.fn(() => true);
    host.setController({ ...controller(false), navigate } as TerminalController);

    const sameTmuxSession = {
      ...descriptor,
      sessionId: 'session-b',
      paneId: '%2',
    };
    expect(host.navigateWithinAttachment(sameTmuxSession, [
      { type: 'navigate', op: 'select_window', window_index: 2 },
      { type: 'navigate', op: 'select_pane', pane_id: '%2' },
    ])).toBe(true);
    expect(navigate).toHaveBeenCalledTimes(2);

    expect(host.navigateWithinAttachment({
      ...sameTmuxSession,
      tmuxSessionKey: 'host-1\u0000other',
    }, [{ type: 'navigate', op: 'select_window', window_index: 0 }])).toBe(false);
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it('falls back to a pane-specific reattach when same-session navigation was not emitted', () => {
    const host = createTerminalHostStore();
    const first = {
      sessionId: 'session-a',
      hostId: 'host-1',
      paneId: '%1',
      tmuxSessionKey: 'host-1\u0000agents',
      autoAttach: true,
    };
    const second = { ...first, sessionId: 'session-b', paneId: '%2' };
    const leaveFirst = host.registerSurface({
      id: 'first',
      descriptor: first,
      target: {} as HTMLDivElement,
      visible: true,
    });
    host.setTerminalInstance(getTerminalDescriptorKey(first), {} as XTerminal);

    leaveFirst();
    host.registerSurface({
      id: 'second',
      descriptor: second,
      target: {} as HTMLDivElement,
      visible: true,
    });

    expect(host.getSnapshot()).toMatchObject({
      descriptorKey: 'session-b\u0000%2',
      attachmentDescriptor: second,
      terminalInstance: null,
    });
  });

  it('snapshots the prior pane buffer when a different session takes the host', () => {
    const host = createTerminalHostStore();
    const first = { sessionId: 'session-a', paneId: '%1', autoAttach: true };
    host.registerSurface({
      id: 'first',
      descriptor: first,
      target: {} as HTMLDivElement,
      visible: true,
    });
    host.setTerminalInstance(getTerminalDescriptorKey(first), {
      buffer: {
        active: {
          length: 1,
          getLine: () => ({ isWrapped: false, translateToString: () => '$ still warm' }),
        },
      },
    } as unknown as XTerminal);

    host.registerSurface({
      id: 'second',
      descriptor: { sessionId: 'session-b', paneId: '%2', autoAttach: true },
      target: {} as HTMLDivElement,
      visible: true,
    });

    const target = { write: vi.fn() } as unknown as XTerminal;
    expect(paintTerminalWarmBuffer(getTerminalWarmKey(first), target, 60_000)).toBe(true);
    expect(target.write).toHaveBeenCalledWith('$ still warm');
  });

  it('publishes the active terminal read-only permission from its controller', () => {
    const host = createTerminalHostStore();
    host.registerSurface({
      id: 'tmux-workbench',
      descriptor: { sessionId: 'session-a', paneId: '%1', autoAttach: true },
      target: {} as HTMLDivElement,
      visible: true,
    });

    host.setController(controller(true));
    expect(host.getSnapshot().readOnly).toBe(true);

    host.setController(controller(false));
    expect(host.getSnapshot().readOnly).toBe(false);
  });

  it('publishes a resumable terminal state only for the active descriptor', () => {
    const host = createTerminalHostStore();
    const descriptor = { sessionId: 'session-a', paneId: '%1', autoAttach: true };
    host.registerSurface({
      id: 'tmux-workbench',
      descriptor,
      target: {} as HTMLDivElement,
      visible: true,
    });

    host.setResumeAvailable(getTerminalDescriptorKey(descriptor), true);
    expect(host.getSnapshot().resumeAvailable).toBe(true);
    host.setResumeAvailable('another-terminal', false);
    expect(host.getSnapshot().resumeAvailable).toBe(true);
  });

  it('retains terminal permission while the same pane moves between responsive surfaces', () => {
    const host = createTerminalHostStore();
    const descriptor = { sessionId: 'session-a', paneId: '%1', autoAttach: true };
    const leaveDesktop = host.registerSurface({
      id: 'desktop-workbench',
      descriptor,
      target: {} as HTMLDivElement,
      visible: true,
    });
    host.setController(controller(true));

    leaveDesktop();
    host.registerSurface({
      id: 'mobile-workbench',
      descriptor,
      target: {} as HTMLDivElement,
      visible: true,
    });

    expect(host.getSnapshot().readOnly).toBe(true);
  });
});
