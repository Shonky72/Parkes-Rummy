// Page readiness is checked by the existing UI locators below. Foreground presence is periodic network traffic.
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
const user = { id: 'footer-ui-player', name: 'Dan Schonberg', email: 'footer@example.test', image: null };
function account(signed) { return { configured: true, user: signed ? user : null, entitlements: { removeAds: signed, premiumFonts: false, premiumSymbols: false, voiceChat: false, originalRules: false }, profile: { font: 'default', symbol: 'initials' }, accessAdmin: false }; }
const fixedSelectors = ['.home-header', '.home-hero', '.hero-title', '.hero-card-fan', '.start-panel', '.start-panel > h2', '.account-controls', '.home-play-tabs', '.home-information-footer', '.home-information-footer .developer-wordmark', '.home-information-footer .site-links'];
async function geometry(page) {
  return page.evaluate(selectors => Object.fromEntries(selectors.map(selector => {
    const box = document.querySelector(selector).getBoundingClientRect();
    return [selector, { x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height }];
  })), fixedSelectors);
}
function sameShell(before, after, label) {
  for (const selector of fixedSelectors) for (const key of ['x', 'y', 'width', 'height']) {
    assert.ok(Math.abs(before[selector][key] - after[selector][key]) <= 1, `${label}: ${selector} ${key} moved: ${before[selector][key]} to ${after[selector][key]}`);
  }
}
try {
  let ready = false;
  for (let n = 0; n < 90; n++) { try { ready = (await fetch(base)).ok; } catch {} if (ready) break; await pause(1000); }
  assert.ok(ready);
  browser = await chromium.launch({ headless: true });
  const cases = [
    { name: 'desktop-screenshot', width: 1408, height: 1060, signed: true, completed: true },
    { name: 'desktop-first-visit', width: 1440, height: 900, signed: true, completed: false },
    { name: 'desktop-guest', width: 1440, height: 900, signed: false, completed: false },
    { name: 'full-hd', width: 1920, height: 1000, signed: false, completed: false },
    { name: 'laptop', width: 1366, height: 768, signed: true, completed: true },
    { name: 'laptop-first-visit', width: 1366, height: 768, signed: true, completed: false },
    { name: 'laptop-guest', width: 1366, height: 768, signed: false, completed: false },
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
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.locator('.home-information-footer').waitFor({ state: 'visible' });
    await page.waitForTimeout(200);
    const shell = await geometry(page);
    const info = await page.evaluate(() => {
      const box = sel => document.querySelector(sel).getBoundingClientRect();
      const footer = document.querySelector('.home-information-footer');
      const content = document.querySelector('.start-panel > .home-tab-content');
      const input = box('.code-entry-form .code-input'), join = box('.join-button');
      const nameLabel = box('label[for=home-name]'), nameInput = box('.name-input');
      const quick = box('.quick-play-button');
      return { footerBottom: box('.home-information-footer').bottom, footerTop: box('.home-information-footer').top,
        panelBottom: box('.start-panel').bottom, scrollY, overflow: document.documentElement.scrollWidth > innerWidth + 1,
        logoWidth: box('.home-information-footer .developer-wordmark').width,
        creditSize: parseFloat(getComputedStyle(footer.querySelector('.developer-credit')).fontSize),
        linkSize: parseFloat(getComputedStyle(footer.querySelector('.site-links')).fontSize),
        linksBelowLogo: box('.home-information-footer .site-links').top >= box('.home-information-footer .developer-wordmark').bottom,
        linkCentre: (box('.home-information-footer .site-links').left + box('.home-information-footer .site-links').right) / 2,
        footerCentre: (box('.home-information-footer').left + box('.home-information-footer').right) / 2,
        nameStacked: nameLabel.bottom <= nameInput.top + 1,
        joinStacked: input.bottom <= join.top + 1 && Math.abs(input.width - join.width) < 1,
        contentHeight: content.clientHeight, contentScrollHeight: content.scrollHeight,
        quickVisible: quick.top >= content.getBoundingClientRect().top && quick.bottom <= Math.min(content.getBoundingClientRect().bottom, innerHeight),
        headerFont: parseFloat(getComputedStyle(document.querySelector('.start-panel > h2')).fontSize),
        buttonFont: parseFloat(getComputedStyle(document.querySelector('.create-button')).fontSize),
        visibleCredits: [...document.querySelectorAll('.developer-credit')].filter(e => e.getBoundingClientRect().height > 0).length,
      };
    });
    assert.equal(info.overflow, false, `${item.name}: horizontal overflow`);
    assert.equal(info.visibleCredits, 1);
    assert.equal(info.nameStacked, true, 'Restore label ABOVE the name input');
    assert.equal(info.joinStacked, true, 'Restore Join game BELOW the full-width room code input');
    assert.equal(info.creditSize, 18); assert.equal(info.linkSize, 15);
    assert.equal(info.logoWidth, 276, 'Exactly 1.5 times the original 184px logo');
    assert.equal(info.linksBelowLogo, true, 'Restore site links below the centred credit');
    assert.ok(Math.abs(info.linkCentre - info.footerCentre) < 1);
    assert.ok(info.footerTop >= info.panelBottom, 'Footer does not overlay the play panel');
    if (item.width > 850) {
      assert.ok(info.headerFont >= 36 && info.buttonFont >= 22, 'Do not shrink original text to fit a redesign');
      assert.equal(info.quickVisible, true, `${item.name}: primary play actions must not be squeezed out of view`);
      // The user rejected squeezing/reformatting for tiny-height laptop screens.
      if (item.height >= 900) {
        assert.ok(info.footerBottom <= item.height + 1, `${item.name}: footer below viewport ${info.footerBottom}`);
        assert.ok(info.footerBottom >= item.height - 35, 'Fill vertical screen space instead of packing at the top');
      }
      assert.equal(info.scrollY, 0);
    }
    await page.screenshot({ path: `${output}/${item.name}.png` });
    const nav = page.locator('.home-play-tabs');
    for (const tab of ['Your Games', 'Store', 'Play']) {
      await nav.getByRole('button', { name: tab, exact: true }).click();
      await page.waitForTimeout(100);
      sameShell(shell, await geometry(page), `${item.name} / ${tab}`);
      if (item.width > 850) assert.equal(await page.evaluate(() => scrollY), 0, 'Desktop must not jump during tab selection');
      if (item.name === 'desktop-screenshot') await page.screenshot({ path: `${output}/desktop-${tab.replace(/ /g, '-').toLowerCase()}.png` });
    }
    const beforeScroll = await geometry(page);
    const scrollY = await page.evaluate(() => window.scrollY);
    await page.locator('.home-tab-content').evaluate(el => {
      const longContent = document.createElement('div'); longContent.id = 'local-scroll-fixture'; longContent.style.height = '1800px';
      el.append(longContent); el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(100);
    assert.ok(await page.locator('.home-tab-content').evaluate(el => el.scrollTop) > 0);
    assert.equal(await page.evaluate(() => window.scrollY), scrollY);
    sameShell(beforeScroll, await geometry(page), `${item.name} / inner scroll`);
    await page.locator('.home-tab-content').evaluate(el => { el.querySelector('#local-scroll-fixture').remove(); el.scrollTop = 0; });
    const join = page.locator('.join-button');
    await join.scrollIntoViewIfNeeded();
    assert.ok(await join.isVisible());
    sameShell(shell, await geometry(page), `${item.name} / reach Join`);
    const footer = page.locator('.home-information-footer');
    const link = footer.locator('.site-links a').last();
    await link.scrollIntoViewIfNeeded();
    assert.equal(await link.evaluate(el => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2); return hit === el || el.contains(hit); }), true);
    results.push({ ...item, ...info, stableAcrossAllTabs: true, isolatedScrolling: true });
    await page.goto(`${base}/tutorial`, { waitUntil: 'domcontentloaded' });
    assert.equal(await page.locator('.home-information-footer').count(), 0);
    assert.deepEqual(errors, [], `${item.name}: page errors`);
    await context.close();
  }
  await writeFile(`${output}/checks.json`, JSON.stringify({ results }, null, 2));
  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  await writeFile(`${output}/checks.json`, JSON.stringify({ results, error: String(error) }, null, 2));
  try { await currentPage?.screenshot({ path: `${output}/failure.png`, fullPage: true }); } catch {}
  throw error;
} finally { await browser?.close(); server?.kill('SIGTERM'); log.end(); }
