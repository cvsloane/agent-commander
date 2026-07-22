import { expect, test, type Page } from '@playwright/test';
import {
  approvalSession,
  host,
  interactiveSession,
  mockControlPlane,
  signIn,
  type JourneyRecorder,
  windowSession,
} from './controlPlaneMock';

function isMobile(page: Page): Promise<boolean> {
  return page.evaluate(() => window.innerWidth < 1024);
}

async function selectSession(page: Page, title: string): Promise<void> {
  await page.goto('/');
  await page.getByText('agents', { exact: true }).click();
  await page.getByRole('treeitem').filter({ hasText: title }).last().click();
  if (await isMobile(page)) {
    await expect(page.getByTestId('tmux-window-strip').first()).toBeVisible();
  } else {
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
  }
}

async function openPaneActions(page: Page) {
  await page.getByRole('button', { name: 'Open pane actions' }).click();
  return page.getByRole('dialog').filter({ hasText: 'Pane actions' });
}

function recordedTerminalInput(recorder: JourneyRecorder): string {
  return recorder.terminalMessages
    .filter((message) => message.type === 'input')
    .map((message) => message.data || '')
    .join('');
}

function visibleTerminalInput(page: Page) {
  return page.locator('[aria-label="Interactive terminal"]:visible .xterm-helper-textarea').first();
}

test.describe('Command Center program journeys', () => {
  let recorder: JourneyRecorder;

  test.beforeEach(async ({ page }, testInfo) => {
    recorder = await mockControlPlane(page, {
      terminalReadOnly: testInfo.title.includes('take-control handoff'),
      multiWindow: testInfo.title.includes('window tab')
        || testInfo.title.includes('pane switcher')
        || testInfo.title.includes('resumed viewer'),
      focusPaneDelayMs: testInfo.title.includes('delayed acknowledgement') ? 800 : undefined,
    });
  });

  test('cold open restores the last pane at a usable local-fit grid', async ({ page }) => {
    // Exercise the real local-fit path: topology may not be ready before a cold attach.
    await page.routeWebSocket(/\/v1\/ui\/stream\?ticket=/, (socket) => {
      socket.onMessage(() => undefined);
    });
    await page.goto('/signin');
    await page.evaluate(
      ({ hostId, sessionId }) => {
        window.localStorage.setItem(
          'ui-storage',
          JSON.stringify({
            state: { lastAttachedTmux: { hostId, sessionId } },
            version: 0,
          })
        );
      },
      { hostId: host.id, sessionId: interactiveSession.id }
    );

    await signIn(page);

    await expect(page).toHaveURL(
      new RegExp(`host_id=${host.id}.*session_id=${interactiveSession.id}.*mode=terminal.*attach=1`)
    );
    await expect(page.getByLabel('Interactive terminal')).toBeVisible();
    await expect.poll(() => recorder.terminalSessionIds).toContain(interactiveSession.id);
    await expect.poll(() => {
      const url = recorder.terminalWebSocketUrls.at(-1);
      return url ? Number(new URL(url).searchParams.get('rows')) : 0;
    }).toBeGreaterThanOrEqual(20);

    if (!(await isMobile(page))) {
      const workspace = await page.getByTestId('tmux-terminal-workspace').boundingBox();
      expect(workspace).not.toBeNull();
      expect(workspace!.width).toBeGreaterThanOrEqual(680);
      expect(workspace!.height).toBeGreaterThanOrEqual(580);
    }
  });

  test('window tab retargets the live viewer', async ({ page }) => {
    await signIn(page);
    await selectSession(page, interactiveSession.title);

    const strip = page.getByTestId('tmux-window-strip').first();
    await expect.poll(() => recorder.terminalWebSocketUrls.length).toBeGreaterThan(0);
    const terminalWebSocketCount = recorder.terminalWebSocketUrls.length;
    await strip.getByRole('tab', { name: 'Window 1: verification' }).click();

    await expect
      .poll(() => recorder.terminalMessages)
      .toContainEqual(expect.objectContaining({
        type: 'navigate',
        op: 'focus_pane',
        pane_id: windowSession.tmux_pane_id,
      }));
    await expect(page).toHaveURL(
      new RegExp(`session_id=${windowSession.id}.*mode=terminal.*attach=1`)
    );
    await expect(page.getByLabel('Interactive terminal')).toBeVisible();
    await expect.poll(() => recorder.terminalWebSocketUrls.length).toBe(terminalWebSocketCount);
    expect(recorder.terminalSessionIds).not.toContain(windowSession.id);
    expect(recorder.commandRequests).not.toContainEqual({
      type: 'select_window',
      payload: { window_index: 1 },
    });
  });

  test('window tab keyboard navigation focuses before activation', async ({ page }) => {
    await signIn(page);
    await selectSession(page, interactiveSession.title);
    const terminalRegion = page.getByRole('region', { name: 'Primary terminal' });
    await expect(terminalRegion.getByText('Connected', { exact: true })).toHaveText('Connected');
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    );

    const strip = page.getByTestId('tmux-window-strip').first();
    const firstWindow = strip.getByRole('tab', { name: 'Window 0: command-center' });
    const secondWindow = strip.getByRole('tab', { name: 'Window 1: verification' });
    await firstWindow.focus();
    await firstWindow.press('ArrowRight');

    await expect(secondWindow).toBeFocused();
    expect(recorder.commandRequests).toEqual([]);

    await secondWindow.press('Enter');
    await expect
      .poll(() => recorder.terminalMessages)
      .toContainEqual(expect.objectContaining({
        type: 'navigate',
        op: 'focus_pane',
        pane_id: windowSession.tmux_pane_id,
      }));
    await expect(page).toHaveURL(new RegExp(`session_id=${windowSession.id}`));

    await firstWindow.focus();
    await firstWindow.press(' ');
    await expect
      .poll(() => recorder.terminalMessages)
      .toContainEqual(expect.objectContaining({
        type: 'navigate',
        op: 'focus_pane',
        pane_id: interactiveSession.tmux_pane_id,
      }));
    await expect(page).toHaveURL(new RegExp(`session_id=${interactiveSession.id}`));
  });

  test('window tab delayed acknowledgement fences terminal and prompt input', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1280x720', 'desktop delayed pane acknowledgement');
    await signIn(page);
    await selectSession(page, interactiveSession.title);
    await page.getByRole('button', { name: 'Send a prompt' }).click();
    await page.getByLabel(new RegExp(`Prompt ${interactiveSession.title}`)).fill('do not misroute');
    const inputCount = recorder.terminalMessages.filter((message) => message.type === 'input').length;

    await page.getByTestId('tmux-window-strip').first()
      .getByRole('tab', { name: 'Window 1: verification' })
      .click();
    await expect(page.getByText('Switching pane — input paused').first()).toBeVisible();
    await expect(page.getByLabel(new RegExp(`Prompt ${interactiveSession.title}`))).toBeDisabled();
    await visibleTerminalInput(page).focus();
    await page.keyboard.type('x');
    expect(recorder.terminalMessages.filter((message) => message.type === 'input')).toHaveLength(inputCount);

    await expect(page).toHaveURL(new RegExp(`session_id=${windowSession.id}`));
    await expect(page.getByText('Switching pane — input paused')).toHaveCount(0);
  });

  test('resumed viewer reconciles the selected pane before input', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1280x720', 'desktop resumed viewer');
    await signIn(page);
    await selectSession(page, interactiveSession.title);

    const strip = page.getByTestId('tmux-window-strip').first();
    await expect.poll(() => recorder.terminalWebSocketUrls.length).toBe(1);
    await strip.getByRole('tab', { name: 'Window 1: verification' }).click();
    await expect.poll(() => recorder.terminalMessages).toContainEqual(expect.objectContaining({
      type: 'navigate',
      op: 'focus_pane',
      pane_id: windowSession.tmux_pane_id,
    }));
    await expect(page).toHaveURL(new RegExp(`session_id=${windowSession.id}`));
    expect(recorder.terminalSessionIds).toEqual([interactiveSession.id]);
    await page.getByRole('button', { name: 'Send a prompt' }).click();
    const prompt = page.getByLabel(new RegExp(`Prompt ${windowSession.title}`));

    const resumeMessageIndex = recorder.terminalMessages.length;
    await recorder.disconnectTerminal();
    await expect.poll(() => recorder.terminalWebSocketUrls.length).toBe(2);
    const terminal = page.locator('[aria-label="Interactive terminal"]:visible').first();
    await expect(terminal).toHaveAttribute('aria-disabled', 'true');
    await expect(prompt).toBeDisabled();
    await expect.poll(() => recorder.terminalMessages.slice(resumeMessageIndex)).toContainEqual(
      expect.objectContaining({ type: 'navigate', op: 'viewer_state' })
    );
    await expect(terminal).toHaveAttribute('aria-disabled', 'false');
    await expect(prompt).toBeEnabled();

    await visibleTerminalInput(page).focus();
    await page.keyboard.type('x');
    await expect.poll(() => recorder.terminalInputPaneIds.at(-1)).toBe(windowSession.tmux_pane_id);
    expect(recorder.terminalMessages.slice(resumeMessageIndex)).not.toContainEqual(
      expect.objectContaining({
        type: 'navigate',
        op: 'focus_pane',
        pane_id: interactiveSession.tmux_pane_id,
      })
    );
    expect(recorder.terminalSessionIds).toEqual([interactiveSession.id, interactiveSession.id]);
  });

  test('desktop window tab focus control uses the acknowledged viewer intent', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1280x720', 'desktop pane focus control');
    await signIn(page);
    await selectSession(page, interactiveSession.title);
    await expect(page.getByRole('region', { name: 'Primary terminal' })
      .getByText('Connected', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Focus pane' }).click();

    await expect.poll(() => recorder.terminalMessages).toContainEqual(expect.objectContaining({
      type: 'navigate',
      op: 'focus_pane',
      pane_id: interactiveSession.tmux_pane_id,
      zoom: true,
    }));
    expect(recorder.commandRequests).not.toContainEqual(expect.objectContaining({
      type: 'zoom_pane',
    }));
  });

  test('terminal text size is separate from pane focus', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1280x720', 'desktop terminal text controls');
    await signIn(page);
    await selectSession(page, interactiveSession.title);

    await expect(page.getByRole('group', { name: 'Terminal text size 14 pixels' })).toBeVisible();
    await page.getByRole('button', { name: 'Increase terminal text size' }).click();
    await expect(page.getByRole('group', { name: 'Terminal text size 15 pixels' })).toBeVisible();
    expect(recorder.terminalMessages.filter(
      (message) => message.type === 'navigate' && message.op === 'focus_pane'
    )).toHaveLength(0);
  });

  test('mobile pane switcher searches groups and supports number shortcuts', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-412x915', 'mobile pane switcher');
    await signIn(page);
    await selectSession(page, interactiveSession.title);

    await page.getByRole('button', { name: 'Open pane switcher' }).click();
    const switcher = page.getByTestId('tmux-pane-switcher');
    await switcher.getByRole('searchbox', { name: 'Search panes' }).fill('Claude');
    await expect(switcher.getByRole('region', { name: 'agents · 1 verification' })).toBeVisible();
    await expect(switcher.getByText(/\d+h old/)).toBeVisible();

    await switcher.getByText('Switch pane', { exact: true }).click();
    await page.keyboard.press('1');
    await expect(page).toHaveURL(new RegExp(`session_id=${windowSession.id}`));
  });

  test('mobile desktop-attached grid stays letterboxed through a keyboard transition', async ({
    page,
  }) => {
    test.skip(!(await isMobile(page)), 'mobile keyboard journey');
    await signIn(page);
    await selectSession(page, interactiveSession.title);

    await expect
      .poll(() =>
        recorder.terminalWebSocketUrls.some((value) => {
          const url = new URL(value);
          return (
            url.searchParams.get('letterbox') === '1' &&
            url.searchParams.get('cols') === '160' &&
            url.searchParams.get('rows') === '50'
          );
        })
      )
      .toBe(true);

    const resizeCount = () =>
      recorder.terminalMessages.filter((message) => message.type === 'resize').length;
    const initialResizeCount = resizeCount();
    await page.setViewportSize({ width: 412, height: 760 });
    await page.waitForTimeout(100);
    await page.setViewportSize({ width: 412, height: 620 });
    await page.waitForTimeout(100);
    await page.setViewportSize({ width: 412, height: 560 });
    await page.waitForTimeout(350);

    expect(resizeCount()).toBe(initialResizeCount);
  });

  test('mobile rail sticky Control sends one control byte', async ({ page }) => {
    test.skip(!(await isMobile(page)), 'mobile key rail journey');
    await signIn(page);
    await selectSession(page, interactiveSession.title);

    const rail = page.getByTestId('terminal-key-rail');
    await rail.getByRole('button', { name: 'Control modifier inactive' }).click();
    await expect(rail.getByRole('button', { name: 'Control modifier one-shot' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await visibleTerminalInput(page).focus();
    await page.keyboard.press('c');

    await expect.poll(() => recordedTerminalInput(recorder)).toContain('\x03');
    await expect(rail.getByRole('button', { name: 'Control modifier inactive' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  test.describe('touch rail input', () => {
    test.use({ hasTouch: true });

    test('mobile rail honors the selected host prefix key', async ({ page }) => {
      test.skip(!(await isMobile(page)), 'mobile key rail journey');
      await page.addInitScript(
        ({ hostId }) => {
          window.localStorage.setItem(
            'settings-storage',
            JSON.stringify({
              state: {
                terminalRailPreset: 'custom',
                terminalRailConfig: {
                  version: 1,
                  keys: [
                    { id: 'esc', label: 'Esc', binding: { type: 'keysym', value: 'esc' } },
                    { id: 'prefix', label: 'Prefix', binding: { type: 'keysym', value: 'prefix' } },
                  ],
                },
                tmuxPrefixByHost: { [hostId]: 'C-a' },
              },
              version: 0,
            })
          );
        },
        { hostId: host.id }
      );
      await signIn(page);
      await selectSession(page, interactiveSession.title);

      await expect(page.getByTestId('tmux-attached-status')).toContainText('Connected');
      await page.getByTestId('terminal-key-rail').getByRole('button', { name: 'Prefix' }).tap();

      await expect.poll(() => recordedTerminalInput(recorder)).toContain('\x01');
    });
  });

  test('signin to Command Center first paint', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/signin/);

    await signIn(page);

    await expect(page.getByRole('heading', { name: 'Command Center' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Launch' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'tmux', exact: true })).toBeVisible();
    await expect(page.getByText('agents', { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
  });

  test('roster to attach, type, and detach', async ({ page }) => {
    await signIn(page);
    await selectSession(page, interactiveSession.title);

    if (await isMobile(page)) {
      // Wait for writability, not just attachment: typing during the WS
      // handshake drops keystrokes and flakes under parallel load.
      await expect(page.getByTestId('tmux-attached-status')).toContainText('Connected');
      await visibleTerminalInput(page).focus();
      await page.keyboard.type('echo journey');
      await expect.poll(() => recordedTerminalInput(recorder)).toContain('echo journey');

      const actions = await openPaneActions(page);
      await actions.getByRole('button', { name: 'Detach', exact: true }).click();
      await expect(page.getByRole('button', { name: /Attach Terminal|Resume/ })).toBeVisible();
    } else {
      await expect(page.getByRole('button', { name: 'Detach', exact: true })).toBeVisible();
      await visibleTerminalInput(page).focus();
      await page.keyboard.type('echo journey');
      await expect.poll(() => recordedTerminalInput(recorder)).toContain('echo journey');

      await page.getByRole('button', { name: 'Detach', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Attach Terminal', exact: true })
      ).toBeVisible();
    }
  });

  test('window create, rename, kill, and last-window confirmation', async ({ page }) => {
    await signIn(page);
    await selectSession(page, interactiveSession.title);

    const strip = page.getByTestId('tmux-window-strip').first();
    await expect(strip.getByRole('tab', { name: 'Window 0: command-center' })).toBeVisible();

    await strip.getByRole('button', { name: 'New tmux window' }).click();
    await expect
      .poll(() => recorder.commandRequests)
      .toContainEqual({
        type: 'new_window',
        payload: { cwd: interactiveSession.cwd },
      });
    await expect(strip.getByRole('tab', { name: 'Window 1: new' })).toBeVisible();

    await strip.getByRole('button', { name: 'Window 1 actions' }).click();
    await strip.getByRole('button', { name: 'Rename', exact: true }).click();
    const rename = strip.getByLabel('Rename window 1');
    await rename.fill('verification');
    await rename.press('Enter');
    await expect
      .poll(() => recorder.commandRequests)
      .toContainEqual({
        type: 'rename_window',
        payload: { window_index: 1, name: 'verification' },
      });
    await expect(strip.getByRole('tab', { name: 'Window 1: verification' })).toBeVisible();

    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toBe('Close this window?');
      await dialog.accept();
    });
    await strip.getByRole('button', { name: 'Window 1 actions' }).click();
    await strip.getByRole('button', { name: 'Close', exact: true }).click();
    await expect
      .poll(() => recorder.commandRequests)
      .toContainEqual({
        type: 'kill_window',
        payload: { window_index: 1 },
      });

    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toBe('This ends the whole tmux session');
      await dialog.accept();
    });
    await strip.getByRole('button', { name: 'Window 0 actions' }).click();
    await strip.getByRole('button', { name: 'Close', exact: true }).click();
    await expect
      .poll(() => recorder.commandRequests)
      .toContainEqual({
        type: 'kill_window',
        payload: { window_index: 0 },
      });
  });

  test('scrollback history opens and loads older output', async ({ page }) => {
    await signIn(page);
    await selectSession(page, interactiveSession.title);

    if (await isMobile(page)) {
      const actions = await openPaneActions(page);
      await actions.getByRole('button', { name: 'View history' }).click();
    } else {
      await page.getByRole('button', { name: 'View terminal history' }).click();
    }

    const history = page.getByRole('dialog', { name: 'Terminal history' });
    await expect(history).toBeVisible();
    // The pager anchors to the newest output and virtualizes rows, so which
    // lines are in the DOM after open depends on when the bottom-anchor rAF
    // lands. Assert the deterministic count, then pin the viewport to the top
    // before asserting the oldest captured line renders.
    await expect(history.getByText('500 lines', { exact: true })).toBeVisible();
    await history
      .getByLabel('Captured terminal history')
      .evaluate((element) => { element.scrollTop = 0; });
    await expect(history.getByText('recent line 1', { exact: true })).toBeVisible();
    await history.getByRole('button', { name: 'Load older' }).click();
    await expect
      .poll(() => recorder.scrollbackRequests.slice(-2))
      .toEqual([
        { mode: 'range', start_line: -500, end_line: -1, strip_ansi: true },
        { mode: 'range', start_line: -1000, end_line: -501, strip_ansi: true },
      ]);
    await expect(history.getByRole('button', { name: 'Start of history' })).toBeDisabled();
  });

  test('take-control handoff unlocks a read-only viewer', async ({ page }) => {
    await signIn(page);
    await selectSession(page, interactiveSession.title);

    if (await isMobile(page)) {
      await expect(page.getByTestId('tmux-attached-status')).toContainText('Read-only');
      const actions = await openPaneActions(page);
      await actions.getByRole('button', { name: 'Take Control', exact: true }).click();
      await page.getByRole('button', { name: 'Close actions' }).click();
    } else {
      await expect(page.getByText('Read-only — take control to type')).toBeVisible();
      await page.getByRole('button', { name: 'Take Control', exact: true }).click();
    }
    await expect
      .poll(() => recorder.terminalMessages.some((message) => message.type === 'control'))
      .toBe(true);
    await expect(page.getByText('Read-only', { exact: true })).toHaveCount(0);

    await visibleTerminalInput(page).focus();
    await page.keyboard.type('whoami');
    await expect.poll(() => recordedTerminalInput(recorder)).toContain('whoami');
  });

  test('launch rail spawns a coding agent', async ({ page }) => {
    await signIn(page);

    const launchRail = page.getByRole('region', { name: 'Launch' });
    await launchRail.getByRole('button', { name: 'New', exact: true }).click();
    const launch = page.getByRole('dialog', { name: 'Launch agent' });
    await launch.getByPlaceholder('Optional first instruction').fill('Run the final verification.');
    await launch.getByRole('button', { name: 'Launch Codex' }).click();

    await expect
      .poll(() => recorder.launchRequests)
      .toEqual([
        {
          host_id: host.id,
          provider: 'codex',
          working_directory: '/home/cvsloane/dev/agent-command',
          prompt: 'Run the final verification.',
          wait: true,
          wait_timeout_ms: 10_000,
        },
      ]);
    await expect(page).toHaveURL(new RegExp(`session_id=${interactiveSession.id}`));
  });

  test('mobile pane actions launch a new window in place', async ({ page }) => {
    test.skip(!(await isMobile(page)), 'mobile window-here journey');
    await signIn(page);
    await selectSession(page, interactiveSession.title);

    const actions = await openPaneActions(page);
    await actions.getByRole('button', { name: 'New window here' }).click();

    const launch = page.getByRole('dialog', { name: 'Launch agent' });
    await expect(launch).toContainText('New window in agents');
    await expect(launch).toContainText(`${host.name} · ${interactiveSession.cwd}`);
    await launch.getByRole('button', { name: 'Launch window here' }).click();

    await expect
      .poll(() => recorder.launchRequests)
      .toEqual([
        {
          host_id: host.id,
          provider: 'codex',
          working_directory: interactiveSession.cwd,
          tmux: { target_session: 'agents' },
          wait: true,
          wait_timeout_ms: 10_000,
        },
      ]);
  });

  test('attention approval is decided from the terminal overlay', async ({ page }) => {
    await signIn(page);
    await selectSession(page, approvalSession.title);

    const overlay = page.getByTestId('terminal-attention-overlay');
    await expect(overlay).toContainText('Run release verification?');
    await overlay.getByRole('button', { name: 'Approve', exact: true }).click();

    await expect
      .poll(() => recorder.approvalDecisions)
      .toEqual([{ decision: 'allow', mode: 'both' }]);
    await expect(overlay).toHaveCount(0);
  });
});
