import { expect, test, type Page } from '@playwright/test';
import {
  interactiveSession,
  mockControlPlane,
  signIn,
  type JourneyRecorder,
  windowSession,
} from './controlPlaneMock';

async function selectSession(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByText('agents', { exact: true }).click();
  await page.getByRole('treeitem').filter({ hasText: interactiveSession.title }).last().click();
  await expect(page.getByTestId('tmux-attached-status')).toContainText('Connected');
}

async function dragTerminal(page: Page, deltaY: number): Promise<void> {
  const terminal = page.getByLabel('Interactive terminal');
  await expect(terminal).toBeVisible();
  await terminal.evaluate(async (element, requestedDeltaY) => {
    const rect = element.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const startY = rect.top + rect.height / 2;
    const endY = Math.max(rect.top + 24, Math.min(rect.bottom - 24, startY + requestedDeltaY));
    const dispatch = (type: 'touchstart' | 'touchmove' | 'touchend', clientY: number) => {
      const touch = new Touch({
        identifier: 1,
        target: element,
        clientX,
        clientY,
        pageX: clientX,
        pageY: clientY,
        screenX: clientX,
        screenY: clientY,
      });
      element.dispatchEvent(new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        touches: type === 'touchend' ? [] : [touch],
        changedTouches: [touch],
      }));
    };
    const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    dispatch('touchstart', startY);
    await nextFrame();
    dispatch('touchmove', startY + Math.sign(requestedDeltaY) * 8);
    await nextFrame();
    dispatch('touchmove', endY);
    await nextFrame();
    dispatch('touchend', endY);
    await nextFrame();
  }, deltaY);
}

async function openInlineHistory(page: Page): Promise<void> {
  await dragTerminal(page, 140);
  await expect(page.getByTestId('terminal-history-overlay')).toBeVisible();
  await expect(page.getByLabel('Inline terminal history')).toBeVisible();
}

async function waitForScrollModeProbe(
  page: Page,
  recorder: JourneyRecorder,
  sessionId: string,
  previousCount = 0
): Promise<void> {
  await expect
    .poll(() => recorder.scrollbackSessionIds.filter((candidate) => candidate === sessionId).length)
    .toBeGreaterThan(previousCount);
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function overscrollHistoryPastBottom(page: Page): Promise<void> {
  const history = page.getByLabel('Inline terminal history');
  await history.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    const rect = element.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const startY = rect.top + rect.height / 2;
    const dispatch = (type: 'touchstart' | 'touchmove' | 'touchend', clientY: number) => {
      const touch = new Touch({
        identifier: 2,
        target: element,
        clientX,
        clientY,
        pageX: clientX,
        pageY: clientY,
        screenX: clientX,
        screenY: clientY,
      });
      element.dispatchEvent(new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        touches: type === 'touchend' ? [] : [touch],
        changedTouches: [touch],
      }));
    };

    dispatch('touchstart', startY);
    dispatch('touchmove', startY - 64);
    dispatch('touchend', startY - 64);
  });
}

test.describe('FW6 mobile Focus journey', () => {
  test.use({ hasTouch: true });

  let recorder: JourneyRecorder;

  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-412x915', 'mobile Focus journey');
    recorder = await mockControlPlane(page, {
      multiWindow: true,
      terminalOutput: '\x1b[?1049h\x1b[?1002h\x1b[?1006h',
      appScrollSessionIds: [windowSession.id],
    });
  });

  test('opens inline history without emitting terminal scroll or SGR frames', async ({ page }) => {
    await signIn(page);
    await selectSession(page);
    await waitForScrollModeProbe(page, recorder, interactiveSession.id);
    const scrollbackStart = recorder.scrollbackRequests.length;
    const messageStart = recorder.terminalMessages.length;

    await openInlineHistory(page);
    await expect.poll(() => recorder.scrollbackRequests.length).toBe(scrollbackStart + 1);

    const gestureMessages = recorder.terminalMessages.slice(messageStart);
    expect(gestureMessages.filter(
      (message) => message.type === 'navigate' && message.op === 'scroll'
    )).toHaveLength(0);
    const terminalInput = gestureMessages
      .filter((message) => message.type === 'input')
      .map((message) => message.data || '')
      .join('');
    expect(terminalInput).toBe('');
    expect(terminalInput).not.toMatch(/\x1b\[<6[45];\d+;\d+M/);
  });

  test('ignores upward swipes at live view without opening history or emitting frames', async ({
    page,
  }) => {
    await signIn(page);
    await selectSession(page);
    await waitForScrollModeProbe(page, recorder, interactiveSession.id);
    const scrollbackStart = recorder.scrollbackRequests.length;
    const messageStart = recorder.terminalMessages.length;

    await dragTerminal(page, -140);

    await expect(page.getByTestId('terminal-history-overlay')).toHaveCount(0);
    expect(recorder.scrollbackRequests).toHaveLength(scrollbackStart);
    const gestureMessages = recorder.terminalMessages.slice(messageStart);
    expect(gestureMessages.filter(
      (message) => message.type === 'navigate' && message.op === 'scroll'
    )).toHaveLength(0);
    const terminalInput = gestureMessages
      .filter((message) => message.type === 'input')
      .map((message) => message.data || '')
      .join('');
    expect(terminalInput).toBe('');
  });

  test('prepends older history without moving the visible transcript', async ({ page }) => {
    await signIn(page);
    await selectSession(page);
    await waitForScrollModeProbe(page, recorder, interactiveSession.id);
    await openInlineHistory(page);
    const history = page.getByLabel('Inline terminal history');
    const initialHeight = await history.evaluate((element) => element.scrollHeight);

    await history.evaluate((element) => {
      element.scrollTop = 0;
      element.dispatchEvent(new Event('scroll', { bubbles: true }));
    });

    await expect.poll(() => recorder.scrollbackRequests.slice(-2)).toEqual([
      { mode: 'range', start_line: -500, end_line: -1, strip_ansi: true },
      { mode: 'range', start_line: -1000, end_line: -501, strip_ansi: true },
    ]);
    await expect.poll(async () => history.evaluate((element, previousHeight) => (
      Math.abs(element.scrollTop - (element.scrollHeight - previousHeight)) <= 1
    ), initialHeight)).toBe(true);
    await expect(page.getByText('Start of history', { exact: true })).toBeVisible();
  });

  test('bottom over-scroll returns live without reconnecting the terminal', async ({ page }) => {
    await signIn(page);
    await selectSession(page);
    const terminalWebSocketCount = recorder.terminalWebSocketUrls.length;
    await openInlineHistory(page);

    await overscrollHistoryPastBottom(page);

    await expect(page.getByTestId('terminal-history-overlay')).toHaveCount(0);
    await expect(page.getByLabel('Interactive terminal')).toBeVisible();
    await expect.poll(() => recorder.terminalWebSocketUrls.length).toBe(terminalWebSocketCount);
  });

  test('keeps plain taps keyboard-free until the Keyboard rail key is pressed', async ({ page }) => {
    await signIn(page);
    await selectSession(page);
    const terminal = page.getByLabel('Interactive terminal');
    const textarea = page
      .locator('[aria-label="Interactive terminal"]:visible .xterm-helper-textarea')
      .first();
    const rail = page.getByTestId('terminal-key-rail');

    await expect(textarea).toHaveAttribute('inputmode', 'none');
    await terminal.tap();
    await expect(textarea).toHaveAttribute('inputmode', 'none');

    const keyboardOff = rail.getByRole('button', { name: 'Keyboard off' });
    await expect(keyboardOff).toHaveAttribute('aria-pressed', 'false');
    await keyboardOff.tap();
    const keyboardOn = rail.getByRole('button', { name: 'Keyboard on' });
    await expect(keyboardOn).toHaveAttribute('aria-pressed', 'true');
    await expect(textarea).toHaveAttribute('inputmode', 'text');

    await keyboardOn.tap();
    await expect(rail.getByRole('button', { name: 'Keyboard off' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    await expect(textarea).toHaveAttribute('inputmode', 'none');
  });

  test('arms cursor drag for exactly one touch gesture', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'settings-storage',
        JSON.stringify({ state: { terminalRailPreset: 'expanded' }, version: 0 })
      );
    });
    await signIn(page);
    await selectSession(page);
    const rail = page.getByTestId('terminal-key-rail');
    const cursorOff = rail.getByRole('button', { name: 'Cursor drag inactive' });
    const inputCount = () => recorder.terminalMessages.filter(
      (message) => message.type === 'input'
    ).length;
    const initialInputCount = inputCount();

    await cursorOff.tap();
    await expect(rail.getByRole('button', { name: 'Cursor drag armed' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await dragTerminal(page, -140);
    await expect.poll(inputCount).toBeGreaterThan(initialInputCount);
    await expect(rail.getByRole('button', { name: 'Cursor drag inactive' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );

    const inputCountAfterCursorGesture = inputCount();
    await dragTerminal(page, 140);
    await expect(page.getByTestId('terminal-history-overlay')).toBeVisible();
    expect(inputCount()).toBe(inputCountAfterCursorGesture);
  });

  test('re-resolves hybrid scroll mode across in-place codex and claude window switches', async ({
    page,
  }) => {
    await signIn(page);
    await selectSession(page);
    await waitForScrollModeProbe(page, recorder, interactiveSession.id);
    const terminalWebSocketCount = recorder.terminalWebSocketUrls.length;

    const codexMessageStart = recorder.terminalMessages.length;
    await openInlineHistory(page);
    expect(recorder.terminalMessages.slice(codexMessageStart).filter(
      (message) => message.type === 'navigate' && message.op === 'scroll'
    )).toHaveLength(0);
    await page.getByRole('button', { name: 'Live terminal' }).click();

    await page
      .getByTestId('tmux-window-strip')
      .first()
      .getByRole('tab', { name: 'Window 1: verification' })
      .click();
    await expect(page).toHaveURL(new RegExp(`session_id=${windowSession.id}`));
    await expect.poll(() => recorder.terminalWebSocketUrls.length).toBe(terminalWebSocketCount);
    await waitForScrollModeProbe(page, recorder, windowSession.id);

    const claudeMessageStart = recorder.terminalMessages.length;
    await dragTerminal(page, 140);
    await expect.poll(() => recorder.terminalMessages.slice(claudeMessageStart).filter(
      (message) => message.type === 'navigate' && message.op === 'scroll'
    ).length).toBeGreaterThan(0);
    await expect(page.getByTestId('terminal-history-overlay')).toHaveCount(0);

    const priorInteractiveProbeCount = recorder.scrollbackSessionIds.filter(
      (sessionId) => sessionId === interactiveSession.id
    ).length;
    await page
      .getByTestId('tmux-window-strip')
      .first()
      .getByRole('tab', { name: 'Window 0: command-center' })
      .click();
    await expect(page).toHaveURL(new RegExp(`session_id=${interactiveSession.id}`));
    await waitForScrollModeProbe(
      page,
      recorder,
      interactiveSession.id,
      priorInteractiveProbeCount
    );

    const returnedCodexMessageStart = recorder.terminalMessages.length;
    await openInlineHistory(page);
    expect(recorder.terminalMessages.slice(returnedCodexMessageStart).filter(
      (message) => message.type === 'navigate' && message.op === 'scroll'
    )).toHaveLength(0);
  });

  test('routes a resolved claude-like pane to app scroll without leaving an overlay', async ({
    page,
  }) => {
    await signIn(page);
    await selectSession(page);
    await page
      .getByTestId('tmux-window-strip')
      .first()
      .getByRole('tab', { name: 'Window 1: verification' })
      .click();
    await expect(page).toHaveURL(new RegExp(`session_id=${windowSession.id}`));
    await waitForScrollModeProbe(page, recorder, windowSession.id);
    const scrollbackCount = recorder.scrollbackRequests.length;
    const messageStart = recorder.terminalMessages.length;

    await dragTerminal(page, 140);

    await expect.poll(() => recorder.terminalMessages.slice(messageStart).filter(
      (message) => message.type === 'navigate' && message.op === 'scroll'
    ).length).toBeGreaterThan(0);
    await expect(page.getByTestId('terminal-history-overlay')).toHaveCount(0);
    expect(recorder.scrollbackRequests).toHaveLength(scrollbackCount);
    expect(recorder.terminalMessages.slice(messageStart).filter(
      (message) => message.type === 'input'
    )).toHaveLength(0);
  });

  test('auto-closes an unclassified thin overlay and caches app scroll', async ({ page }) => {
    await page.route(/\/v1\/sessions\/[^/]+\/scrollback$/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.fallback();
    });
    await signIn(page);
    await selectSession(page);
    await page
      .getByTestId('tmux-window-strip')
      .first()
      .getByRole('tab', { name: 'Window 1: verification' })
      .click();
    await expect(page).toHaveURL(new RegExp(`session_id=${windowSession.id}`));

    const messageStart = recorder.terminalMessages.length;
    await dragTerminal(page, 140);
    const overlay = page.getByTestId('terminal-history-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveCount(0, { timeout: 8000 });
    expect(recorder.terminalMessages.slice(messageStart).filter(
      (message) => message.type === 'navigate' && message.op === 'scroll'
    )).toHaveLength(0);

    const appScrollStart = recorder.terminalMessages.length;
    await dragTerminal(page, 140);
    await expect.poll(() => recorder.terminalMessages.slice(appScrollStart).filter(
      (message) => message.type === 'navigate' && message.op === 'scroll'
    ).length).toBeGreaterThan(0);
    await expect(overlay).toHaveCount(0);
  });

  test('keeps the History dialog reachable from pane actions', async ({ page }) => {
    await signIn(page);
    await selectSession(page);

    await page.getByRole('button', { name: 'Open pane actions' }).click();
    const actions = page.getByRole('dialog').filter({ hasText: 'Pane actions' });
    await actions.getByRole('button', { name: 'View history' }).click();
    await expect(page.getByRole('dialog', { name: 'Terminal history' })).toBeVisible();
    await expect.poll(() => recorder.scrollbackRequests.length).toBeGreaterThan(0);
  });

  test('round-trips automatic and toggled zoom through topology truth', async ({ page }) => {
    await signIn(page);
    await selectSession(page);

    const focus = page.getByRole('button', { name: 'Turn Focus off' });
    await expect
      .poll(() => recorder.terminalMessages)
      .toContainEqual({ type: 'navigate', op: 'zoom', on: true });
    await expect(focus).toHaveAttribute('aria-pressed', 'true');

    await focus.click();
    await expect
      .poll(() => recorder.terminalMessages)
      .toContainEqual({ type: 'navigate', op: 'zoom', on: false });
    const enableFocus = page.getByRole('button', { name: 'Turn Focus on' });
    await expect(enableFocus).toHaveAttribute('aria-pressed', 'false');

    const priorZoomOnCount = recorder.terminalMessages.filter(
      (message) => message.type === 'navigate' && message.op === 'zoom' && message.on === true
    ).length;
    await enableFocus.click();
    await expect
      .poll(() => recorder.terminalMessages.filter(
        (message) => message.type === 'navigate' && message.op === 'zoom' && message.on === true
      ).length)
      .toBeGreaterThan(priorZoomOnCount);
    await expect(page.getByRole('button', { name: 'Turn Focus off' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });
});
