import { expect, test, type Page } from '@playwright/test';
import {
  interactiveSession,
  mockControlPlane,
  signIn,
  type JourneyRecorder,
} from './controlPlaneMock';

async function selectSession(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByText('agents', { exact: true }).click();
  await page.getByRole('treeitem').filter({ hasText: interactiveSession.title }).last().click();
  await expect(page.getByTestId('tmux-attached-status')).toContainText('Connected');
}

test.describe('FW6 mobile Focus journey', () => {
  let recorder: JourneyRecorder;

  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-412x915', 'mobile Focus journey');
    recorder = await mockControlPlane(page, { multiWindow: true });
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
