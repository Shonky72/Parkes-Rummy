import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const output = 'tutorial-ui-results';
await mkdir(output, { recursive: true });
const base = 'http://127.0.0.1:3101';
const server = spawn('node', ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3101'], { stdio: 'ignore' });
let browser, page;
const checks = [];
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/tutorial`)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.goto(`${base}/tutorial`, { waitUntil: 'networkidle' });
  await page.locator('[data-tutorial-sort] .sort-button').click();
  await page.locator('[data-tutorial-sort] .sort-button').press('ArrowDown');
  await page.getByRole('menuitemradio', { name: /By colour/ }).click();
  await page.locator('[data-tutorial-settings]').click();
  await page.getByRole('button', { name: 'Done, back to cards' }).click();
  for (const [width, height] of [[1440, 900], [320, 568], [844, 390], [390, 844], [720, 450], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(250);
    const result = await page.evaluate(() => {
      const coach = document.querySelector('[data-tutorial-coach]');
      const target = document.querySelector(coach.getAttribute('data-target-selector'));
      const p = coach.getBoundingClientRect(), t = target.getBoundingClientRect();
      const boxes = [...document.querySelectorAll('.tutorial-header, .tutorial-table, .tutorial-hand, .tutorial-hand-card, .tutorial-opponent-backs')].map(element => {
        const b = element.getBoundingClientRect();
        return { className: element.className, left: b.left, right: b.right };
      });
      const hit = document.elementFromPoint((t.left + t.right) / 2, (t.top + t.bottom) / 2);
      return {
        step: coach.getAttribute('data-step-id'), boxes,
        internallyScrolled: document.querySelector('.tutorial-app').scrollLeft,
        popupInView: p.left >= 0 && p.right <= innerWidth + 1 && p.top >= 0 && p.bottom <= innerHeight + 1,
        overlaps: p.left < t.right && p.right > t.left && p.top < t.bottom && p.bottom > t.top,
        targetClickable: hit === target || target.contains(hit),
      };
    });
    assert.equal(result.step, 'first-draw:');
    assert.equal(result.internallyScrolled, 0, JSON.stringify(result));
    assert.equal(result.popupInView, true, JSON.stringify({ width, height, result }));
    assert.equal(result.overlaps, false);
    assert.equal(result.targetClickable, true, JSON.stringify({ width, height, result }));
    assert.ok(result.boxes.every(b => b.left >= -1 && b.right <= width + 1), JSON.stringify({ width, height, result }));
    checks.push({ width, height, ...result });
    await page.screenshot({ path: `${output}/resized-${width}-${height}.png` });
  }
  await writeFile(`${output}/responsive-checks.json`, JSON.stringify({ passed: true, checks }, null, 2));
  console.log('PASS: target visibility, popup placement and unclipped cards after six live viewport changes.');
} catch (error) {
  await page?.screenshot({ path: `${output}/responsive-failure.png` }).catch(() => {});
  await writeFile(`${output}/responsive-checks.json`, JSON.stringify({ passed: false, error: String(error), checks }, null, 2));
  throw error;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
