const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const baseUrl = process.env.BASE_URL || 'https://agents.heavisidetechnology.com';
const accessCode = process.env.ACCESS_CODE;
if (!accessCode) {
  console.error('Missing ACCESS_CODE env var.');
  process.exit(1);
}

const outDir = path.resolve(process.env.OUT_DIR || 'docs/images');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const shots = [
  { name: 'dashboard-overview.png', path: '/' },
  { name: 'sessions-view.png', path: '/sessions', waitFor: '[data-session-card]' },
  { name: 'orchestrator.png', path: '/orchestrator' },
  { name: 'settings-alerts.png', path: '/settings', scrollText: 'Notifications & Alerts' },
  // Visualizer streams can keep the network "busy", so avoid networkidle.
  { name: 'visualizer.png', path: '/visualizer', waitMs: 4000, waitUntil: 'domcontentloaded' },
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  async function signInWithCode(code) {
    const csrfRes = await context.request.get(`${baseUrl}/api/auth/csrf`);
    if (!csrfRes.ok()) return false;
    const csrf = await csrfRes.json();
    if (!csrf?.csrfToken) return false;
    const body = new URLSearchParams({
      csrfToken: csrf.csrfToken,
      code,
      callbackUrl: '/',
      json: 'true',
    });
    const resp = await context.request.post(`${baseUrl}/api/auth/callback/credentials`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: body.toString(),
    });
    if (!resp.ok()) return false;
    const json = await resp.json().catch(() => ({}));
    const url = json?.url || '';
    return url && !url.includes('error=CredentialsSignin');
  }

  let signedIn = await signInWithCode(accessCode);
  if (!signedIn && !accessCode.startsWith('/')) {
    signedIn = await signInWithCode(`/${accessCode}`);
  }

  await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
  if (!signedIn || page.url().includes('/signin')) {
    const debugPath = path.join(outDir, 'signin-error.png');
    await page.screenshot({ path: debugPath, fullPage: false });
    console.error('Sign-in failed.', { url: page.url(), debugPath });
    await browser.close();
    process.exit(1);
  }

  for (const shot of shots) {
    const url = `${baseUrl}${shot.path}`;
    await page.goto(url, { waitUntil: shot.waitUntil || 'networkidle', timeout: 60000 });
    if (shot.waitFor) {
      await page.waitForSelector(shot.waitFor, { timeout: 20000 });
    }
    if (shot.waitMs) {
      await page.waitForTimeout(shot.waitMs);
    }
    if (shot.scrollText) {
      const locator = page.getByText(shot.scrollText, { exact: false });
      if (await locator.count()) {
        await locator.first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(1000);
      }
    }
    const outPath = path.join(outDir, shot.name);
    await page.screenshot({ path: outPath, fullPage: false });
    console.log(`Saved ${outPath}`);
  }

  // Session detail screenshot
  await page.goto(`${baseUrl}/sessions`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-session-card]', { timeout: 20000 });
  await page.locator('[data-session-card]').first().click();
  await page.waitForURL(/\/sessions\/.+/, { timeout: 20000 });
  await page.waitForTimeout(2000);
  const detailPath = path.join(outDir, 'session-detail.png');
  await page.screenshot({ path: detailPath, fullPage: false });
  console.log(`Saved ${detailPath}`);

  await browser.close();
})();
