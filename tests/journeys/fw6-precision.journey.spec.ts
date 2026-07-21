import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import {
  approvalSession,
  host,
  interactiveSession,
  mockControlPlane,
  signIn,
} from './controlPlaneMock';

let terminalSocket: WebSocketRoute | null;

async function selectSession(page: Page, title: string): Promise<void> {
  await page.goto('/');
  await page.getByText('agents', { exact: true }).click();
  await page.getByRole('treeitem').filter({ hasText: title }).last().click();
  await expect(page.getByTestId('tmux-attached-status')).toBeVisible();
  await expect(page.getByLabel('Interactive terminal')).toBeVisible();
}

async function openHistory(page: Page) {
  await page.getByRole('button', { name: 'Open pane actions' }).click();
  const actions = page.getByRole('dialog').filter({ hasText: 'Pane actions' });
  await actions.getByRole('button', { name: 'View history' }).click();
  return page.getByRole('dialog', { name: 'Terminal history' });
}

async function sendTerminalOutput(data: string): Promise<void> {
  await expect.poll(() => terminalSocket !== null).toBe(true);
  terminalSocket!.send(JSON.stringify({ type: 'output', data, encoding: 'utf8' }));
}

test.describe('FW6 mobile precision journeys', () => {
  test.beforeEach(async ({ context, page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-412x915', '412x915 precision journey');
    terminalSocket = null;
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await mockControlPlane(page);
    await page.routeWebSocket(/\/v1\/ui\/terminal\//, (socket) => {
      terminalSocket = socket;
      socket.onMessage((message) => {
        if (typeof message !== 'string') return;
        const parsed = JSON.parse(message) as { type?: string };
        if (parsed.type === 'hello') {
          socket.send(JSON.stringify({
            type: 'attached',
            readonly: false,
            resumed: false,
            resume_token: 'fw6-precision-terminal-resume',
          }));
        }
      });
    });
  });

  test('freezes streamed output while reading and jumps to the tail', async ({ page }) => {
    await signIn(page);
    await selectSession(page, interactiveSession.title);
    await expect(page.getByTestId('tmux-attached-status')).toContainText('Connected');

    const initialOutput = Array.from(
      { length: 120 },
      (_, index) => `initial line ${index + 1}\r\n`
    ).join('');
    await sendTerminalOutput(initialOutput);
    const terminal = page.locator('[aria-label="Interactive terminal"]:visible').first();
    const viewport = terminal.locator('.terminal.xterm.focus > .xterm-viewport');
    await expect(viewport).toBeVisible();
    await expect.poll(() => viewport.evaluate((element) => (
      Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop)
    ))).toBeLessThanOrEqual(1);
    await terminal.locator('.terminal.xterm.focus .xterm-screen').hover();
    await page.mouse.wheel(0, -4000);
    const jumpToLive = page.getByRole('button', { name: /jump to live terminal output/i });
    await expect(jumpToLive).toBeVisible();
    const frozenTop = await viewport.evaluate((element) => element.scrollTop);

    await sendTerminalOutput('tail line 1\r\ntail line 2\r\ntail line 3\r\n');
    await expect(page.getByRole('button', { name: /3 new lines; jump to live/i })).toBeVisible();
    await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(frozenTop);

    await page.getByRole('button', { name: /3 new lines; jump to live/i }).click();
    await expect(jumpToLive).toBeHidden();
    await expect.poll(() => viewport.evaluate((element) => (
      Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop)
    ))).toBeLessThanOrEqual(1);
  });

  test('copies an exact contiguous history line range', async ({ page }) => {
    await signIn(page);
    await selectSession(page, interactiveSession.title);
    const history = await openHistory(page);
    await expect(history.getByText('500 lines', { exact: true })).toBeVisible();
    await history.getByLabel('Captured terminal history').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(history.getByRole('button', {
      name: 'Select history line -3',
      exact: true,
    })).toBeVisible();

    await history.getByRole('button', { name: 'Select history line -3', exact: true }).click();
    await history.getByRole('button', { name: 'Select history line -1', exact: true }).click();
    await expect(history).toContainText('3 lines selected');
    await history.getByRole('button', { name: 'Copy selected lines' }).click();

    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(
      'recent line 498\nrecent line 499\nrecent line 500'
    );
  });

  test('opens thumbnail previews and switches panes', async ({ page }) => {
    await signIn(page);
    await selectSession(page, interactiveSession.title);
    await page.getByRole('button', { name: 'Open pane switcher' }).click();

    const switcher = page.getByTestId('tmux-pane-switcher');
    await expect(switcher).toBeVisible();
    await expect(switcher).toContainText('ready for input');
    await expect(switcher).toContainText('Approve the release verification command?');
    await switcher.getByRole('button').filter({ hasText: approvalSession.title }).click();

    await expect(switcher).toBeHidden();
    await expect(page.getByTestId('tmux-attached-status')).toContainText(approvalSession.title);
    await expect(page).toHaveURL(new RegExp(`host_id=${host.id}.*session_id=${approvalSession.id}`));
  });

  test('captures responsive precision audit states', async ({ page }, testInfo) => {
    test.skip(process.env.PLAYWRIGHT_CAPTURE_UI !== '1', 'visual audit capture only');
    await signIn(page);
    await page.setViewportSize({ width: 360, height: 800 });
    await selectSession(page, interactiveSession.title);
    await page.getByRole('button', { name: 'Open pane switcher' }).click();
    await expect(page.getByTestId('tmux-pane-switcher')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('fw6-precision-360x800.png') });

    await page.getByRole('button', { name: 'Close pane switcher' }).click();
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(page.getByTestId('tmux-attached-status')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('fw6-precision-768x1024.png') });

    await page.setViewportSize({ width: 1366, height: 768 });
    await expect(page.getByRole('region', { name: 'Primary terminal' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('fw6-precision-1366x768.png') });
  });
});
