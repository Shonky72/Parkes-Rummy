import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { ROOM_PROTOCOL } from '../lib/room-protocol.ts';

/**
 * Safe smoke probes for the Netlify Next.js route handler.
 * Game POSTs use text/plain, rejected before any room write or DB access.
 * Activity probes are anonymous reads and must not expose private data.
 */
const pull = process.env.NETLIFY_PR_NUMBER;
if (!pull || !/^\d+$/.test(pull)) throw new Error('NETLIFY_PR_NUMBER is required.');
const base = 'https://deploy-preview-' + pull + '--parkes-rummy.netlify.app';
const path = '/api/rooms';
const headers = { 'Content-Type': 'text/plain', 'X-Parkes-Protocol': ROOM_PROTOCOL };
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

  const activity = await fetch(base + '/api/admin/activity');
  assert.equal(activity.status, 401, 'Anonymous activity access must be denied');
  assert.match(activity.headers.get('cache-control') || '', /no-store/);
  assert.ok(!('players' in await activity.json()), 'No player data in denied responses');
  const deniedPage = await (await fetch(base + '/admin/activity')).text();
  assert.ok(deniedPage.includes('Owner access required'), 'Server page must deny anonymous access');
  assert.ok(!deniedPage.includes('People online'), 'Private dashboard is not server-rendered for guests');
  assert.equal((await fetch(base + '/activity-ui-fixture')).status, 404, 'CI-only fixture must never ship to Netlify');
  const htmlResponse=await fetch(base+'/');
  assert.match(htmlResponse.headers.get('content-security-policy')||'',/nonce-/);
  assert.equal(htmlResponse.headers.get('x-frame-options'),'DENY');
  // Invalid codes are rejected before loading any real room. Only quota rows
  // are touched; rotate untrusted headers to verify Netlify's IP trust boundary.
  let throttled=false;
  const run=Date.now().toString(36);
  for(let i=0;i<13;i++){
    const probe=await fetch(`${base}/api/rooms/invalid-${run}-${i}/preview`,{headers:{'x-vercel-forwarded-for':`192.0.2.${i+1}`,'x-forwarded-for':`192.0.2.${i+1}`}});
    if(probe.status===429){assert.ok(Number(probe.headers.get('retry-after'))>0);throttled=true;break;}
    assert.equal(probe.status,400,'Trusted client-IP forwarding failed or invalid-code probe read a room');
  }
  assert.ok(throttled,'Rotating caller-supplied forwarding headers must not bypass the distinct-code limit');
  console.log('Netlify preview verified:', { sameOriginStatus: sameOrigin.status, canonicalOriginStatus: canonicalOrigin.status, crossSiteStatus: forbidden.status, privateActivityStatus: activity.status, fixtureAbsent: true });
} finally { await browser.close(); }
