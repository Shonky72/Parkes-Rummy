import assert from 'node:assert/strict';
import { chromium } from 'playwright';

/**
 * Read-only smoke probe for the Netlify Next.js route handler.
 * All requests use text/plain, rejected before any room write or DB access.
 * This verifies the actual browser Origin and Netlify's internal URL handling.
 */
const pull = process.env.NETLIFY_PR_NUMBER;
if (!pull || !/^\d+$/.test(pull)) throw new Error('NETLIFY_PR_NUMBER is required.');
const base = 'https://deploy-preview-' + pull + '--parkes-rummy.netlify.app';
const path = '/api/rooms';
const headers = { 'Content-Type': 'text/plain', 'X-Parkes-Protocol': 'multi-game-turns-v6' };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

let ready = false;
for (let attempt = 0; attempt < 45; attempt++) {
  try {
    const result = await fetch(base + '/');
    if (result.ok) { ready = true; break; }
  } catch { /* Preview deployment is not yet available. */ }
  await pause(2000);
}
assert.ok(ready, 'Netlify preview did not become available for origin verification');

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  const sameOrigin = await page.evaluate(async ({ path, headers }) => {
    const response = await fetch(path, { method: 'POST', headers, body: '{}' });
    return { status: response.status, response: await response.text() };
  }, { path, headers });
  assert.equal(sameOrigin.status, 415, 'Valid Chrome POST was blocked by the host origin check: ' + sameOrigin.response.slice(0, 280));

  const canonicalOrigin = await fetch(base + path, {
    method: 'POST',
    headers: { ...headers, Origin: 'https://parkesrummy.com', 'Sec-Fetch-Site': 'same-origin' },
    body: '{}',
  });
  assert.equal(canonicalOrigin.status, 415, 'Canonical production Origin was rejected through Netlify proxy');

  const forbidden = await fetch(base + path, {
    method: 'POST',
    headers: { ...headers, Origin: 'https://malicious.example', 'Sec-Fetch-Site': 'cross-site' },
    body: '{}',
  });
  assert.equal(forbidden.status, 403, 'External Origin was not blocked');

  console.log('Netlify preview Origin verified:', { sameOriginStatus: sameOrigin.status, canonicalOriginStatus: canonicalOrigin.status, crossSiteStatus: forbidden.status });
} finally { await browser.close(); }
