import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const output = 'install-ui-results';
await mkdir(output, { recursive: true });
const base = process.env.INSTALL_BASE_URL || 'http://127.0.0.1:3102';
const log = createWriteStream(`${output}/next.log`);
const server = process.env.INSTALL_BASE_URL ? null : spawn('node', ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3102'], { stdio: ['ignore', 'pipe', 'pipe'] });
server?.stdout.pipe(log); server?.stderr.pipe(log);
let browser, currentPage;
const checks = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const androidUA = 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36';
const iosUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1';
const account = { configured: false, user: null, entitlements: { removeAds: false, premiumFonts: false, premiumSymbols: false, voiceChat: false, originalRules: false }, profile: { font: 'default', symbol: 'initials' }, accessAdmin: false };

try {
  let ready = false;
  for (let n = 0; n < 90; n++) { try { ready = (await fetch(`${base}/install`)).ok; } catch {} if (ready) break; await pause(1000); }
  assert.ok(ready, 'Install page must start');
  const manifest = await (await fetch(`${base}/manifest.webmanifest`)).json();
  assert.equal(manifest.start_url, '/'); assert.equal(manifest.id, '/'); assert.equal(manifest.display, 'standalone');
  for (const size of [180, 192, 512]) {
    const r = await fetch(`${base}/app-icon/${size}.png`);
    assert.equal(r.status, 200, `Icon ${size}`);
    assert.match(r.headers.get('content-type'), /image\/png/);
    const bytes = Buffer.from(await r.arrayBuffer());
    assert.equal(bytes.readUInt32BE(16), size); assert.equal(bytes.readUInt32BE(20), size);
  }
  browser = await chromium.launch({ headless: true });
  const scenarios = [
    { name: 'desktop', width: 1440, height: 900, ua: undefined, selected: 'Chrome' },
    { name: 'android', width: 390, height: 844, ua: androidUA, selected: 'Chrome' },
    { name: 'small-phone', width: 320, height: 568, ua: androidUA, selected: 'Chrome' },
    { name: 'iphone', width: 390, height: 844, ua: iosUA, selected: 'Safari' },
    { name: 'samsung', width: 360, height: 800, ua: androidUA + ' SamsungBrowser/28.0', selected: 'Samsung Internet' },
    { name: 'opera', width: 390, height: 844, ua: androidUA + ' OPR/89.0', selected: 'Opera' },
    { name: 'in-app', width: 390, height: 844, ua: androidUA + ' Instagram', selected: 'Chrome' },
  ];
  for (const screen of scenarios) {
    const context = await browser.newContext({ viewport: { width: screen.width, height: screen.height }, ...(screen.ua ? { userAgent: screen.ua, isMobile: true, hasTouch: true } : {}), reducedMotion: 'reduce' });
    const page = await context.newPage(); currentPage = page;
    const errors = []; page.on('pageerror', err => errors.push(err.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin) return route.abort();
      if (url.pathname === '/api/account/session') return route.fulfill({ json: account });
      return route.continue();
    });
    await page.goto(base, { waitUntil: 'networkidle' });
    const shortcut = page.locator('.home-header .install-phone-shortcut');
    await shortcut.waitFor({ state: 'visible' });
    assert.equal(await page.locator('.home-tab-content .install-phone-shortcut').count(), 0, 'Install is not a primary play action');
    assert.equal(await shortcut.count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `Header overflow ${screen.name}`);
    await page.screenshot({ path: `${output}/${screen.name}-home.png` });
    await shortcut.click();
    await page.waitForURL('**/install');
    await page.getByRole('tab', { name: screen.selected, exact: true }).waitFor();
    await page.waitForFunction(label => [...document.querySelectorAll('[role=tab]')].some(e => e.textContent === label && e.getAttribute('aria-selected') === 'true'), screen.selected);
    assert.equal(await page.locator('.install-steps>li').count(), 3);
    assert.equal(await page.locator('.install-illustration[role=img]').count(), 3);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `Guide overflow ${screen.name}`);
    assert.equal(await page.evaluate(() => localStorage.getItem('parkes-rummy:install-guide-seen-v1')), 'yes');
    if (screen.name === 'desktop') assert.equal(await page.getByRole('img', { name: 'Scan for phone installation steps' }).count(), 1);
    if (screen.name === 'in-app') assert.equal(await page.locator('.install-browser-warning').count(), 1);
    const font = await page.locator('.install-step>p').first().evaluate(e => parseFloat(getComputedStyle(e).fontSize));
    assert.ok(font >= 16);
    await page.screenshot({ path: `${output}/${screen.name}-guide.png`, fullPage: true });
    // Choosing another browser always works, regardless of the auto-detected choice.
    await page.getByRole('tab', { name: 'Safari', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'iPhone / iPad', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.match(await page.locator('.install-route-heading h2').textContent(), /Safari/);
    await page.getByRole('tab', { name: 'Samsung Internet', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Android', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('tab', { name: 'Chrome', exact: true }).click();
    if (screen.name === 'android') {
      // Browser native UI is simulated only; no device installation or permissions are triggered by tests.
      await page.evaluate(() => {
        window.__installCalls = 0;
        const event = new Event('beforeinstallprompt', { cancelable: true });
        event.prompt = async () => { window.__installCalls++; };
        event.userChoice = Promise.resolve({ outcome: 'accepted' });
        window.dispatchEvent(event);
      });
      await page.getByRole('button', { name: 'Install on this phone' }).click();
      await page.getByText('Request accepted.', { exact: false }).waitFor();
      assert.equal(await page.evaluate(() => window.__installCalls), 1);
      assert.equal(await page.getByRole('button', { name: 'Install on this phone' }).count(), 0);
      assert.equal(await page.locator('.install-already').count(), 0, 'Accepting a request is not proof of installation');
      await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
      await page.locator('.install-already').waitFor();
    }
    await page.getByRole('link', { name: 'Back to game', exact: true }).click();
    await page.locator('.home-header').waitFor();
    await page.waitForTimeout(200);
    assert.equal(await page.locator('.install-phone-shortcut').count(), 0);
    await page.locator('.home-settings').click();
    await page.locator('.settings-install-entry a').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.settings-install-entry').count(), 1);
    await page.locator('.settings-install-entry a').click();
    await page.waitForURL('**/install');
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('.home-header').waitFor();
    assert.equal(await page.locator('.install-phone-shortcut').count(), 0, 'Seen state survives a fresh page load');
    assert.deepEqual(errors, [], `Browser errors ${screen.name}`);
    checks.push({ screen: screen.name, selected: screen.selected, font, steps: 3, shortcutDisappears: true, settingsLink: true, noOverflow: true });
    await context.close();
  }
  await writeFile(`${output}/checks.json`, JSON.stringify({ manifest: true, icons: [180, 192, 512], checks }, null, 2));
  console.log(JSON.stringify(checks, null, 2));
} catch (error) {
  try { await currentPage?.screenshot({ path: `${output}/failure.png`, fullPage: true }); } catch {}
  throw error;
} finally { await browser?.close(); server?.kill('SIGTERM'); log.end(); }
