import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const output = 'tutorial-ui-results';
await mkdir(output, { recursive: true });
const base = process.env.TUTORIAL_BASE_URL || 'http://127.0.0.1:3100';
const serverLog = createWriteStream(`${output}/next.log`);
const server = process.env.TUTORIAL_BASE_URL ? null : spawn('node', ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3100'], { stdio: ['ignore', 'pipe', 'pipe'] });
server?.stdout.pipe(serverLog); server?.stderr.pipe(serverLog);
const checks = [];
let browser;
let currentPage;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function luminance(rgb) {
  const values = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
  return .2126 * values[0] + .7152 * values[1] + .0722 * values[2];
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    try { ready = (await fetch(`${base}/tutorial`)).ok; } catch {}
    if (ready) break;
    await sleep(1000);
  }
  assert.ok(ready, 'Tutorial server did not start');
  browser = await chromium.launch({ headless: true });
  const screens = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'phone', width: 390, height: 844 },
    { name: 'small-phone', width: 320, height: 568 },
    { name: 'landscape', width: 844, height: 390 },
    { name: 'zoom-equivalent', width: 720, height: 450 },
  ];
  for (const screen of screens) {
    const context = await browser.newContext({ viewport: { width: screen.width, height: screen.height }, hasTouch: screen.width <= 390, isMobile: screen.width <= 390, reducedMotion: 'reduce' });
    const page = await context.newPage(); currentPage = page;
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
    await page.goto(`${base}/tutorial`, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('.tutorial-guide, .tutorial-mobile-step, .tutorial-coach, .tutorial-hand-pointer').count(), 0, 'Old inline instructions must be removed');
    assert.equal(await page.getByRole('dialog').count(), 0, 'No unnecessary intro screen');

    async function popup(prefix, screenshot = '') {
      const coach = page.locator('[data-tutorial-coach]');
      await page.waitForFunction(value => document.querySelector('[data-tutorial-coach]')?.getAttribute('data-step-id')?.startsWith(value), prefix);
      await coach.waitFor({ state: 'visible' });
      await page.waitForTimeout(100);
      assert.equal(await coach.count(), 1, 'Exactly one teaching popup');
      const info = await coach.evaluate(element => {
        const box = element.getBoundingClientRect();
        const selector = element.getAttribute('data-target-selector');
        const target = document.querySelector(selector);
        const r = target.getBoundingClientRect();
        const body = element.querySelector('.practice-coach-body');
        const colour = getComputedStyle(body).color;
        const background = getComputedStyle(element).backgroundColor;
        const view = window.visualViewport;
        const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
        return { step: element.getAttribute('data-step-id'), selector, colour, background, font: parseFloat(getComputedStyle(body).fontSize), text: body.textContent,
          popup: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
          target: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
          viewport: { left: view?.offsetLeft || 0, top: view?.offsetTop || 0, width: view?.width || innerWidth, height: view?.height || innerHeight },
          hittable: hit === target || target.contains(hit), overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        };
      });
      const p = info.popup, t = info.target, v = info.viewport;
      const overlap = p.left < t.right && p.right > t.left && p.top < t.bottom && p.bottom > t.top;
      assert.equal(overlap, false, JSON.stringify({ screen, ...info }));
      assert.ok(p.left >= v.left - 2 && p.top >= v.top - 2 && p.right <= v.left + v.width + 2 && p.bottom <= v.top + v.height + 2, JSON.stringify({ screen, ...info }));
      assert.equal(info.hittable, true, `Target blocked: ${screen.name} ${info.step}`);
      assert.equal(info.overflow, false, `Horizontal overflow: ${screen.name} ${info.step}`);
      assert.ok(info.font >= 16, 'Body text must remain readable');
      const fg = luminance(info.colour), bg = luminance(info.background);
      const contrast = (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05);
      assert.ok(contrast >= 7, `Insufficient contrast: ${contrast}`);
      assert.ok(info.text.length > 50, 'Full explanation belongs inside the popup');
      checks.push({ screen: screen.name, step: info.step, contrast, font: info.font, overlapsTarget: overlap });
      if (screenshot) await page.screenshot({ path: `${output}/${screen.name}-${screenshot}.png` });
      return page.locator(info.selector).first();
    }
    await (await popup('sort:', 'sort')).click();
    const sort = await popup('sort-mode:hold');
    await sort.click({ delay: 650 });
    await (await popup('sort-mode:menu', 'sort-menu')).click();
    await (await popup('settings:')).click();
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.locator('[data-tutorial-coach]').count(), 0);
    await page.getByRole('button', { name: 'Low → high', exact: true }).click();
    await page.getByRole('button', { name: 'Done, back to cards' }).click();
    await popup('first-draw:', 'draw');
    await page.getByRole('button', { name: 'Cards and points', exact: true }).click();
    await page.getByRole('dialog', { name: 'Cards and points' }).waitFor();
    assert.equal(await page.locator('[data-tutorial-coach]').count(), 0);
    await page.getByRole('button', { name: 'Close cards and points' }).click();
    await (await popup('first-draw:')).click();
    // A wrong card stays in the hand and gets a friendly correction in the same popup.
    await page.locator('[data-tutorial-card="13D"]').focus();
    await page.keyboard.press('Enter');
    assert.ok(await page.locator('.practice-coach-feedback').isVisible());
    await (await popup('first-discard:card')).click();
    await (await popup('first-discard:button', 'discard')).click();
    await (await popup('second-draw:')).click();
    for (const id of ['5H', '6C', '7D', '2D', '9S']) {
      await (await popup(`opening:${id}`, id === '2D' ? 'wild' : '')).click();
    }
    await (await popup('opening:ready', 'go-down')).click();
    await (await popup('second-discard:card')).click();
    await (await popup('second-discard:button')).click();
    await (await popup('third-draw:')).click();
    for (const [index, id] of ['10C', '11H', '12S', '13D', '10D'].entries()) {
      await (await popup(`layoff:pick-${id}`)).click();
      await (await popup(`layoff:place-${index}`, index === 4 ? 'alex-run' : '')).click();
    }
    await (await popup('final-discard:card')).click();
    await (await popup('final-discard:button')).click();
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.locator('[data-tutorial-coach]').count(), 0);
    assert.equal(await page.locator('[data-tutorial-card]').count(), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem('parkes-rummy:tutorial-completed-v1')), 'yes');
    await page.screenshot({ path: `${output}/${screen.name}-complete.png` });
    await page.getByRole('button', { name: 'Replay tutorial' }).click();
    await popup('sort:');
    assert.deepEqual(errors, [], `${screen.name} browser errors`);
    await context.close();
  }
  await writeFile(`${output}/checks.json`, JSON.stringify({ passed: true, checks }, null, 2));
  console.log(`PASS: ${checks.length} popup checks across desktop, phones, landscape and zoom-equivalent viewports.`);
} catch (error) {
  if (currentPage && !currentPage.isClosed()) {
    await currentPage.screenshot({ path: `${output}/failure.png` }).catch(() => {});
    await writeFile(`${output}/failure.html`, await currentPage.content()).catch(() => {});
  }
  await writeFile(`${output}/checks.json`, JSON.stringify({ passed: false, error: String(error), checks }, null, 2));
  throw error;
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
  serverLog.end();
}
