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

async function swipeTerminalDown(page: Page): Promise<void> {
  const terminal = page.getByLabel('Interactive terminal');
  await expect(terminal).toBeVisible();
  await terminal.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const startY = rect.top + Math.min(100, rect.height / 4);
    const endY = startY + Math.min(140, Math.max(100, rect.height / 3));
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

    dispatch('touchstart', startY);
    dispatch('touchmove', startY + 8);
    dispatch('touchmove', endY);
    dispatch('touchend', endY);
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
    });
  });

  test('translates a vertical touch swipe into tmux SGR wheel input', async ({ page }) => {
    await signIn(page);
    await selectSession(page);
    await swipeTerminalDown(page);
    const wheelUpReport = new RegExp(`${String.fromCharCode(27)}\\[<64;\\d+;\\d+M`);

    await expect.poll(() => recorder.terminalMessages
      .filter((message) => message.type === 'input')
      .map((message) => message.data || '')
      .join(''))
      .toMatch(wheelUpReport);
  });

  test('loads History from the selected session after an in-place window switch', async ({
    page,
  }) => {
    await signIn(page);
    await selectSession(page);
    const terminalWebSocketCount = recorder.terminalWebSocketUrls.length;

    await page
      .getByTestId('tmux-window-strip')
      .first()
      .getByRole('tab', { name: 'Window 1: verification' })
      .click();
    await expect(page).toHaveURL(new RegExp(`session_id=${windowSession.id}`));
    await expect.poll(() => recorder.terminalWebSocketUrls.length).toBe(terminalWebSocketCount);

    await page.getByRole('button', { name: 'Open pane actions' }).click();
    const actions = page.getByRole('dialog').filter({ hasText: 'Pane actions' });
    await actions.getByRole('button', { name: 'View history' }).click();
    await expect(page.getByRole('dialog', { name: 'Terminal history' })).toBeVisible();
    await expect.poll(() => recorder.scrollbackSessionIds.at(-1)).toBe(windowSession.id);
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
