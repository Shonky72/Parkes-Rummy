import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const output = 'home-footer-ui-results';
await mkdir(output, { recursive: true });
const base = process.env.HOME_FOOTER_BASE_URL || 'http://127.0.0.1:3104';
const log = createWriteStream(`${output}/next.log`);
const server = process.env.HOME_FOOTER_BASE_URL ? null : spawn('node', ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3104'], { stdio: ['ignore', 'pipe', 'pipe'] });
server?.stdout.pipe(log); server?.stderr.pipe(log);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, currentPage;
const results = [];
const failures = [];
const user = { id: 'footer-ui-player', name: 'Dan Schonberg', email: 'footer@example.test', image: null };
function account(signed) { return { configured: true, user: signed ? user : null, entitlements: { removeAds: signed, premiumFonts: false, premiumSymbols: false, voiceChat: false, originalRules: false }, profile: { font: 'default', symbol: 'initials' }, accessAdmin: false }; }
const documentBox = locator => locator.evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width }; });

try {
  let ready = false;
  for (let n = 0; n < 90; n++) { try { ready = (await fetch(base)).ok; } catch {} if (ready) break; await pause(1000); }
  assert.ok(ready);
  browser = await chromium.launch({ headless: true });
  const cases = [
    { name: 'desktop-screenshot', width: 1408, height: 1060, signed: true, completed: true, firstFold: true },
    { name: 'desktop-first-visit', width: 1440, height: 900, signed: true, completed: false, firstFold: true },
    { name: 'desktop-guest', width: 1440, height: 900, signed: false, completed: false, firstFold: true },
    { name: 'full-hd', width: 1920, height: 1000, signed: false, completed: false, firstFold: true },
    { name: 'laptop', width: 1366, height: 768, signed: true, completed: true, firstFold: true },
    { name: 'laptop-first-visit', width: 1366, height: 768, signed: true, completed: false, firstFold: true },
    { name: 'laptop-guest', width: 1366, height: 768, signed: false, completed: false, firstFold: true },
    { name: 'phone', width: 390, height: 844, signed: true, completed: false },
    { name: 'small-phone', width: 320, height: 568, signed: false, completed: false },
  ];
  for (const item of cases) {
    const context = await browser.newContext({ viewport: { width: item.width, height: item.height }, reducedMotion: 'reduce' });
    const page = await context.newPage(); currentPage = page;
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(completed => {
      if (completed) {
        localStorage.setItem('parkes-rummy:tutorial-completed-v1', 'yes');
        localStorage.setItem('parkes-rummy:install-guide-seen-v1', 'yes');
      }
    }, item.completed);
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin) return route.abort();
      if (url.pathname === '/api/account/session') return route.fulfill({ json: account(item.signed) });
      if (url.pathname === '/api/account/games') return route.fulfill({ json: { games: [] } });
      return route.continue();
    });
    await page.goto(base, { waitUntil: 'networkidle' });
    const footer = page.locator('.home-information-footer');
    await footer.waitFor({ state: 'visible' });
    await page.waitForTimeout(150);
    const initial = await footer.evaluate(el => {
      const rect = el.getBoundingClientRect();
      const panel = document.querySelector('.start-panel').getBoundingClientRect();
      const main = document.querySelector('.home-main').getBoundingClientRect();
      const image = el.querySelector('.developer-wordmark');
      const links = [...el.querySelectorAll('.site-links a')];
      const credits = [...document.querySelectorAll('.developer-credit')].map(e => ({ parent: e.parentElement.className, visible: e.getBoundingClientRect().height > 0 && getComputedStyle(e).visibility !== 'hidden' }));
      return {
        top: rect.top, bottom: rect.bottom, footerHeight: rect.height,
        panelBottom: panel.bottom, mainTop: main.top,
        creditSize: parseFloat(getComputedStyle(el.querySelector('.developer-credit')).fontSize),
        linkSize: parseFloat(getComputedStyle(links[0]).fontSize),
        logoWidth: image.getBoundingClientRect().width,
        linkCount: links.length, credits,
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        scrollY, position: getComputedStyle(el).position,
      };
    });
    results.push({ ...item, ...initial });
    await page.screenshot({ path: `${output}/${item.name}.png` });
    await page.screenshot({ path: `${output}/${item.name}-full.png`, fullPage: true });
    assert.equal(await footer.count(), 1);
    if (initial.credits.filter(c => c.visible).length !== 1) failures.push(`${item.name}: duplicate credits ${JSON.stringify(initial.credits)}`);
    assert.equal(initial.overflow, false, `${item.name}: horizontal overflow`);
    assert.ok(initial.creditSize >= 16 && initial.linkSize >= 15, `${item.name}: small footer text`);
    assert.ok(initial.logoWidth >= 225, `${item.name}: logo too small`);
    assert.ok(initial.linkCount >= 4, `${item.name}: missing site information links`);
    assert.notEqual(initial.position, 'fixed');
    assert.ok(initial.top >= initial.panelBottom - 1, `${item.name}: footer must not cover play controls`);
    if (item.firstFold && (initial.bottom > item.height + 1 || initial.scrollY !== 0)) failures.push(`${item.name}: footer bottom ${initial.bottom}, viewport ${item.height}, initial scroll ${initial.scrollY}`);
    const nav = page.locator('.home-play-tabs');
    const before = await documentBox(nav);
    await nav.getByRole('button', { name: 'Your Games', exact: true }).click();
    const after = await documentBox(nav);
    if (Math.abs(before.x - after.x) > 1 || Math.abs(before.y - after.y) > 1) failures.push(`${item.name}: Games tabs moved ${JSON.stringify({ before, after })}`);
    await nav.getByRole('button', { name: 'Store', exact: true }).click();
    const store = await documentBox(nav);
    if (Math.abs(before.x - store.x) > 1 || Math.abs(before.y - store.y) > 1) failures.push(`${item.name}: Store tabs moved ${JSON.stringify({ before, store })}`);
    assert.equal(await footer.count(), 1);
    await nav.getByRole('button', { name: 'Play', exact: true }).click();
    // Reserve ad space locally only. No ad network request or ad click is made.
    await page.evaluate(() => {
      const ad = document.createElement('aside'); ad.className = 'ad-slot ad-slot-home'; ad.id = 'footer-test-ad'; ad.style.height = '180px';
      document.querySelector('.home-main').append(ad);
    });
    const order = await page.evaluate(() => ({ footer: document.querySelector('.home-information-footer').getBoundingClientRect().bottom, ad: document.getElementById('footer-test-ad').getBoundingClientRect().top }));
    assert.ok(order.footer <= order.ad, 'Future ads must not push the footer down');
    await page.evaluate(() => document.getElementById('footer-test-ad').remove());
    const lastLink = footer.locator('.site-links a').last();
    await lastLink.scrollIntoViewIfNeeded();
    assert.equal(await lastLink.evaluate(el => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2); return hit === el || el.contains(hit); }), true);
    await page.goto(`${base}/tutorial`, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('.home-information-footer').count(), 0, 'No home footer over tutorial/game controls');
    assert.deepEqual(errors, [], `${item.name}: page errors`);
    await context.close();
  }
  await writeFile(`${output}/checks.json`, JSON.stringify({ results, failures }, null, 2));
  console.log(JSON.stringify({ results, failures }, null, 2));
  assert.deepEqual(failures, [], 'Desktop footer should be visible once without the first scroll and tabs should stay aligned');
} catch (error) {
  await writeFile(`${output}/checks.json`, JSON.stringify({ results, failures, error: String(error) }, null, 2));
  try { await currentPage?.screenshot({ path: `${output}/failure.png`, fullPage: true }); } catch {}
  throw error;
} finally { await browser?.close(); server?.kill('SIGTERM'); log.end(); }
