import { expect, test, type Page } from '@playwright/test';
import {
  approvalSession,
  host,
  interactiveSession,
  mockControlPlane,
  signIn,
  type JourneyRecorder,
} from './controlPlaneMock';

function isMobile(page: Page): Promise<boolean> {
  return page.evaluate(() => window.innerWidth < 1024);
}

async function selectSession(page: Page, title: string): Promise<void> {
  await page.goto('/');
  await page.getByText('agents', { exact: true }).click();
  await page.getByText(title, { exact: true }).click();
  if (await isMobile(page)) {
    await expect(page.getByTestId('tmux-window-strip').first()).toBeVisible();
  } else {
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
  }
}

async function openPaneActions(page: Page) {
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  return page.getByRole('dialog').filter({ hasText: 'Pane actions' });
}

function recordedTerminalInput(recorder: JourneyRecorder): string {
  return recorder.terminalMessages
    .filter((message) => message.type === 'input')
    .map((message) => message.data || '')
    .join('');
}

test.describe('Command Center program journeys', () => {
  let recorder: JourneyRecorder;

  test.beforeEach(async ({ page }, testInfo) => {
    recorder = await mockControlPlane(page, {
      terminalReadOnly: testInfo.title.includes('take-control handoff'),
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

    await page.getByRole('button', { name: 'Attach Terminal', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Detach', exact: true })).toBeVisible();
    const terminal = page.getByLabel('Interactive terminal');
    await terminal.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type('echo journey');
    await expect.poll(() => recordedTerminalInput(recorder)).toContain('echo journey');

    await page.getByRole('button', { name: 'Detach', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Attach Terminal', exact: true })).toBeVisible();
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
    await expect(history.getByText('recent line 1', { exact: true })).toBeVisible();
    await history.getByRole('button', { name: 'Load older' }).click();
    await expect
      .poll(() => recorder.scrollbackRequests)
      .toEqual([
        { mode: 'range', start_line: -500, end_line: -1, strip_ansi: true },
        { mode: 'range', start_line: -1000, end_line: -501, strip_ansi: true },
      ]);
    await expect(history.getByRole('button', { name: 'Start of history' })).toBeDisabled();
  });

  test('take-control handoff unlocks a read-only viewer', async ({ page }) => {
    await signIn(page);
    await selectSession(page, interactiveSession.title);

    await page.getByRole('button', { name: 'Attach Terminal', exact: true }).click();
    await expect(page.getByText('Read-only — take control to type')).toBeVisible();
    await page.getByRole('button', { name: 'Take Control', exact: true }).click();
    await expect
      .poll(() => recorder.terminalMessages.some((message) => message.type === 'control'))
      .toBe(true);
    await expect(page.getByText('Read-only', { exact: true })).toHaveCount(0);

    const terminal = page.getByLabel('Interactive terminal');
    await terminal.locator('.xterm-helper-textarea').focus();
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
