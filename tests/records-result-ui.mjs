import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createRoomHandlers } from '../lib/room-server.ts';
import { accountMarker, ACCOUNT_IDENTITY_HEADER } from '../lib/auth-config.ts';
import { applyAction, createDeck, createPlayer, createRoom, enableRecords, getRuleExample, observeRecordsAction, publicRoom } from '../lib/rummy.ts';
import { handRevealDuration } from '../lib/hand-reveal.ts';
import { ROOM_PROTOCOL, ROOM_PROTOCOL_HEADER } from '../lib/room-protocol.ts';
import { createPlayStreakHandler } from '../lib/play-streak-server.ts';
import { summarizePlayStreak } from '../lib/play-streak.ts';
import { STREAK_CELEBRATION_TIMING } from '../lib/streak-celebration.ts';

// Local production UI, real room authorization/action handlers and real record
// observers. Only the external session provider and storage are substituted.
// No record payload or earned achievement is invented by the browser fixture.
const output = 'records-result-results';
await mkdir(output, { recursive: true });
const port = await new Promise(resolve => {
  const listener = createServer();
  listener.listen(0, '127.0.0.1', () => { const port = listener.address().port; listener.close(() => resolve(port)); });
});
const base = `http://127.0.0.1:${port}`;
const serverEnvironment = { ...process.env, CONTEXT: 'deploy-preview', NEXT_TELEMETRY_DISABLED: '1' };
for (const key of ['DATABASE_URL', 'NETLIFY_DATABASE_URL', 'NETLIFY_DATABASE_URL_UNPOOLED', 'NEON_DATABASE_URL']) delete serverEnvironment[key];
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {
  stdio: ['ignore', 'pipe', 'pipe'], env: serverEnvironment,
});
const log = createWriteStream(`${output}/next.log`);
server.stdout.pipe(log); server.stderr.pipe(log);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const owner = { id: 'records-result-owner', name: 'Record Owner', email: 'records-owner@example.test', image: null };
const outsider = { id: 'records-result-outsider', name: 'Other Account', email: 'records-other@example.test', image: null };
const entitlements = { removeAds: true, originalRules: false, voiceChat: false, premiumFonts: false, premiumSymbols: false };
const profile = { font: 'default', symbol: 'initials' };
const checks = []; let browser, lastPage;

function fixture() {
  const before = createRoom('RCRD', createPlayer({ id: 'owner-seat', name: owner.name, color: 0, tokenHash: 'isolated-account-seat' }));
  before.players.push(createPlayer({ id: 'other-seat', name: 'Fixture Guest', color: 1, tokenHash: 'isolated-other-seat' }));
  before.game = 2; before.quickPlay = { ruleNumber: 10 };
  let room = applyAction(before, before.hostId, { type: 'start' });
  const pool = createDeck(2).sort((a, b) => a.id.localeCompare(b.id));
  const take = ({ rank, suit }) => {
    const index = pool.findIndex(card => card.rank === rank && card.suit === suit);
    assert.notEqual(index, -1, `Fixture exceeds the engine's physical deck: ${rank}${suit}`);
    return pool.splice(index, 1)[0];
  };
  const opening = getRuleExample(2, 10).flatMap(meld => meld.cards).map(take);
  assert.equal(opening.length, 10);
  assert.ok(opening.every(card => card.rank !== 2), 'The fixture must earn its natural opening using actual cards');
  room.players[0].hand = opening;
  room.players[1].hand = pool.filter(card => card.rank !== 2).slice(0, 10).map(take);
  room.discardPile = [pool.pop()]; room.stock = pool;
  // Observe this fixed physical deal at the same hand-start boundary as the
  // authoritative engine. Every subsequent turn uses accepted engine actions.
  enableRecords(before, { eligiblePlayerIds: ['owner-seat'] });
  room.records = structuredClone(before.records);
  observeRecordsAction(before, room, 'owner-seat', { type: 'start' });
  for (const playerId of ['owner-seat', 'other-seat']) {
    room = applyAction(room, playerId, { type: 'draw', source: 'stock' });
    const picked = room.players.find(player => player.id === playerId).hand.at(-1);
    room = applyAction(room, playerId, { type: 'discard', cardId: picked.id });
  }
  room = applyAction(room, 'owner-seat', { type: 'draw', source: 'stock' });
  room = applyAction(room, 'owner-seat', { type: 'goDown', cardIds: opening.map(card => card.id), expectedRuleNumber: 10 });
  assert.equal(room.status, 'playing');
  assert.equal(room.players[0].hand.length, 1);
  assert.equal(room.records.current['owner-seat'].actualOpening.turn, 2);
  assert.ok(room.records.current['owner-seat'].achievements.includes('first-chance'));
  assert.ok(room.records.current['owner-seat'].achievements.includes('natural-talent'));
  assert.equal(publicRoom(room, 'owner-seat').completedRecord, undefined, 'Active telemetry must remain private');
  return room;
}

function isolatedApi(room) {
  let saved = { room: structuredClone(room), version: room.version, memberships: [{ userId: owner.id, playerId: 'owner-seat', hidden: false }] };
  const requests = [], results = [], errors = [];
  const resolveSession = async request => {
    const cookie = request.headers.get('Cookie') ?? '';
    return cookie.includes('records_result_session=owner') ? owner : cookie.includes('records_result_session=outsider') ? outsider : null;
  };
  const repository = {
    async load(code) { return code === saved.room.code ? structuredClone(saved) : null; },
    async save(next, expectedVersion) {
      if (saved.version !== expectedVersion) return false;
      saved = { ...saved, room: structuredClone(next), version: next.version }; return true;
    },
    async setHidden(code, userId, hidden, playerId) {
      const member = saved.memberships.find(member => member.userId === userId && member.playerId === playerId);
      if (code !== saved.room.code || !member) return false;
      member.hidden = hidden; return true;
    },
  };
  const handlers = createRoomHandlers({ repository, resolveSession, captureRecords: true, configured: () => true,
    security: { check: async () => {} }, entitlements: async () => entitlements, profile: async () => profile });
  const readPlayStreak = createPlayStreakHandler({ enabled: true, resolveSession, security: { check: async () => {} },
    records: { async playStreak(userId, now) {
      const member = saved.memberships.find(member => member.userId === userId);
      const evidence = member && saved.room.records?.current[member.playerId];
      return summarizePlayStreak(evidence ? [evidence] : [], now);
    } },
  });
  const respond = data => Response.json(data, { headers: { [ROOM_PROTOCOL_HEADER]: ROOM_PROTOCOL } });
  return { requests, results, errors, getRoom: () => saved.room, handlers,
    async handle(request) {
      const path = new URL(request.url).pathname, prefix = `/api/rooms/${room.code}`;
      requests.push({ path, method: request.method, identity: request.headers.get(ACCOUNT_IDENTITY_HEADER) });
      if (path === '/api/account/session') return respond({ configured: true, user: await resolveSession(request), entitlements, profile, accessAdmin: false });
      if (path === '/api/activity/presence') return new Response(null, { status: 204 });
      if (path === '/api/account/games') return respond({ games: [] });
      if (path === '/api/play-streak') return readPlayStreak(request);
      if (path === '/api/rooms/summaries') return respond({ summaries: [] });
      if (path === `${prefix}/join-requests`) return respond({ requests: [] });
      if (path === `${prefix}/preview`) return handlers.roomPreviewRequest(request, room.code);
      if (path === `${prefix}/join`) return handlers.joinRoomRequest(request, room.code);
      if (path === prefix) return handlers.readRoomRequest(request, room.code);
      if (path === `${prefix}/action`) {
        const response = await handlers.actionRoomRequest(request, room.code);
        const payload = await response.clone().json();
        results.push({ status: response.status, payload }); return response;
      }
      errors.push(`Unexpected API request ${request.method} ${path}`);
      return Response.json({ error: 'Unexpected isolated fixture endpoint.' }, { status: 404 });
    },
  };
}

async function mount(context, api) {
  await context.addCookies([{ name: 'records_result_session', value: 'owner', url: base, httpOnly: true, sameSite: 'Lax' }]);
  await context.addInitScript(() => {
    try {
      localStorage.setItem('parkes-rummy:audio', JSON.stringify({ muted: true, musicEnabled: false, volume: 0, musicVolume: 0 }));
      localStorage.setItem('parkes-rummy:advertising-consent-v1', 'declined');
    } catch { /* Opaque asset frames have no browser storage. */ }
  });
  await context.route('**/*', async route => {
    const browserRequest = route.request(), url = new URL(browserRequest.url());
    if (url.origin !== base) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    try {
      const method = browserRequest.method();
      const request = new Request(url, { method, headers: await browserRequest.allHeaders(),
        ...(!['GET', 'HEAD'].includes(method) ? { body: browserRequest.postData() } : {}) });
      const response = await api.handle(request);
      return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
    } catch (error) {
      api.errors.push(String(error)); return route.fulfill({ status: 503, json: { error: 'Isolated fixture failure.' } });
    }
  });
}

async function watchReveal(page) {
  await page.evaluate(() => {
    const audit = window.recordsResultAudit = { frames: 0, firstFlightAt: null, firstFlipAt: null, firstHighlightAt: null, firstAwardAt: null, violations: [], transitions: [] };
    let previous = '', running = true;
    const sample = () => {
      const at = performance.now();
      const flight = !!document.querySelector('.table-motion-winning-flight');
      const flipping = !!document.querySelector('.opponent .end-hand-flipping');
      const modal = !!document.querySelector('.result-modal');
      const highlight = !!document.querySelector('.record-result-highlight');
      const award = !!document.querySelector('.streak-award');
      if (flight && audit.firstFlightAt === null) audit.firstFlightAt = at;
      if (flipping && audit.firstFlipAt === null) audit.firstFlipAt = at;
      if (highlight && audit.firstHighlightAt === null) audit.firstHighlightAt = at;
      if (award && audit.firstAwardAt === null) audit.firstAwardAt = at;
      if ((highlight || modal) && (flight || flipping)) audit.violations.push({ at, flight, flipping, modal, highlight });
      const state = JSON.stringify({ flight, flipping, modal, highlight });
      if (state !== previous) { audit.transitions.push({ at, flight, flipping, modal, highlight }); previous = state; }
    };
    const observer = new MutationObserver(sample);
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    const frame = () => { if (!running) return; audit.frames++; sample(); requestAnimationFrame(frame); };
    sample(); requestAnimationFrame(frame);
    window.finishRecordsResultAudit = () => { running = false; observer.disconnect(); sample(); return audit; };
  });
}

const railGeometry = page => page.locator('.opponent-hand .card-backs').first().evaluate(element => {
  const rect = element.getBoundingClientRect(); return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height };
});

try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { ready = (await fetch(base)).ok; } catch { /* Wait for the isolated Next server. */ }
    if (ready) break;
    assert.equal(server.exitCode, null, 'The isolated production server exited before becoming ready');
    await pause(200);
  }
  assert.ok(ready, 'The isolated production build did not start');
  browser = await chromium.launch({ headless: true });
  for (const screen of [
    { name: 'desktop', width: 1440, height: 1000 }, { name: 'phone', width: 390, height: 844 },
    { name: 'fold-cover', width: 360, height: 780 }, { name: 'small-phone', width: 320, height: 568 },
  ]) {
    const room = fixture(), api = isolatedApi(room), errors = [];
    const context = await browser.newContext({ viewport: { width: screen.width, height: screen.height },
      isMobile: screen.width < 600, hasTouch: screen.width < 600, reducedMotion: 'no-preference' });
    await mount(context, api);
    const page = lastPage = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/join/${room.code}`, { waitUntil: 'domcontentloaded' });
    const finalCard = page.locator(`[data-hand-card="${room.players[0].hand[0].id}"]`);
    await finalCard.waitFor();
    assert.equal(await page.locator('.record-result-highlight,.result-modal').count(), 0);
    assert.equal(await page.getByRole('link', { name: 'View record', exact: true }).count(), 0);
    assert.equal(await page.locator('.opponent .end-hand-card').count(), 0);
    await watchReveal(page);
    await finalCard.click();
    const before = await railGeometry(page);
    await page.locator('.hand-actions>.button').filter({ hasText: 'Discard' }).click();
    await page.locator('.table-motion-winning-flight').waitFor({ timeout: 4000 });
    await page.locator('.opponent .end-hand-flipping').waitFor({ timeout: 1500 });
    assert.equal(await page.locator('.record-result-highlight,.result-modal').count(), 0, `${screen.name}: no highlight may cover the reveal`);
    assert.equal(await page.getByRole('link', { name: 'View record', exact: true }).count(), 0);
    assert.equal(await page.locator('.opponent .end-hand-card').count(), 10);
    const after = await railGeometry(page);
    for (const dimension of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(before[dimension] - after[dimension]) <= 1.5,
      `${screen.name}: opponent rail ${dimension} moved ${before[dimension]} → ${after[dimension]}`);
    await page.screenshot({ path: `${output}/${screen.name}-revealing.png` });

    const award = page.locator('.streak-award');
    await award.waitFor({ timeout: 7000 });
    assert.match(await award.textContent(), /Today’s streak earned!/);
    assert.deepEqual(await award.locator('.streak-award-reel > span').allTextContents(), ['0', '1']);
    assert.equal(await page.locator('.record-result-highlight').count(), 0, 'The streak celebration replaces the result content until continued');
    await page.locator('.streak-award-complete').waitFor({ timeout: STREAK_CELEBRATION_TIMING.messageMs + 2000 });
    assert.match(await award.locator('.streak-award-tomorrow').textContent(), /Come back tomorrow to continue your streak/);
    await page.screenshot({ path: `${output}/${screen.name}-streak.png` });
    await award.getByRole('button', { name: 'Continue', exact: true }).click();
    const highlight = page.getByRole('region', { name: 'Your hand record', exact: true });
    await highlight.waitFor({ timeout: 7000 });
    const audit = await page.evaluate(() => window.finishRecordsResultAudit());
    assert.deepEqual(audit.violations, [], `${screen.name}: results appeared during the winning flight or card flip`);
    assert.ok(audit.firstFlightAt !== null && audit.firstFlipAt !== null && audit.firstHighlightAt !== null);
    assert.ok(audit.firstAwardAt !== null && audit.firstAwardAt - audit.firstFlipAt >= handRevealDuration(api.getRoom()) - 80,
      `${screen.name}: streak celebration appeared before the card reveal completed`);
    assert.ok(audit.frames > 10, 'The animation must run rather than taking the reduced-motion bypass');
    assert.ok(audit.firstHighlightAt - audit.firstFlipAt >= handRevealDuration(api.getRoom()) - 80,
      `${screen.name}: the earned highlight appeared before the full flip and reveal hold completed`);
    assert.equal(await page.locator('.table-motion-winning-flight,.opponent .end-hand-flipping').count(), 0);
    assert.equal(await page.locator('.result-modal .record-result-highlight').count(), 1, 'The highlight belongs inside the existing results gate');

    const finalResponse = api.results.at(-1);
    assert.equal(finalResponse.status, 200, JSON.stringify(finalResponse));
    const completed = finalResponse.payload.room.completedRecord;
    assert.equal(finalResponse.payload.room.status, 'finished');
    assert.equal(finalResponse.payload.room.youId, 'owner-seat');
    assert.equal(finalResponse.payload.room.records, undefined);
    assert.deepEqual(finalResponse.payload.room.completedPlay, { handId: room.records.handId }, 'The streak receives only the authenticated finished hand identifier');
    assert.equal(completed.handId, room.records.handId);
    assert.equal(completed.openingTurn, 2); assert.equal(completed.firstLegalTurn, 2); assert.equal(completed.opportunitiesPassed, 0);
    for (const badge of ['born-ready', 'first-chance', 'natural-talent']) assert.ok(completed.achievements.includes(badge), badge);
    assert.match(await highlight.textContent(), /Your opening: Turn 2\./);
    assert.match(await highlight.textContent(), /First legal chance: Turn 2\./);
    assert.match(await highlight.textContent(), /Born Ready/);
    assert.match(await highlight.textContent(), /First Chance/);
    assert.match(await highlight.textContent(), /Natural Talent/);
    const review = highlight.getByRole('link', { name: 'View record', exact: true });
    assert.equal(await review.getAttribute('href'), `/profile?tab=history&handId=${encodeURIComponent(completed.handId)}`);
    assert.equal(await highlight.getByRole('button', { name: 'Share record', exact: true }).count(), 1);
    assert.equal(api.requests.filter(request => request.path === '/api/records').length, 0, 'Result display must not publish a share automatically');
    assert.equal(api.requests.find(request => request.path.endsWith('/action')).identity, accountMarker(owner.id));
    assert.equal(await page.locator('.result-hand [data-revealed-card]').count(), 10);

    await review.scrollIntoViewIfNeeded();
    const geometry = await page.locator('.result-modal').evaluate(modal => {
      const sections = [...modal.querySelectorAll('.record-result-highlight,.record-result-highlight .progress-actions,.record-result-highlight .button')];
      const bounds = modal.getBoundingClientRect();
      return { viewport: innerWidth, pageWidth: document.documentElement.scrollWidth, left: bounds.left, right: bounds.right,
        width: modal.clientWidth, scrollWidth: modal.scrollWidth, sections: sections.map(element => {
          const rect = element.getBoundingClientRect(); return { label: element.className, left: rect.left, right: rect.right,
            width: element.clientWidth, scrollWidth: element.scrollWidth };
        }) };
    });
    assert.ok(geometry.pageWidth <= geometry.viewport + 1);
    assert.ok(geometry.left >= -1 && geometry.right <= geometry.viewport + 1);
    assert.ok(geometry.scrollWidth <= geometry.width + 1);
    for (const section of geometry.sections) {
      assert.ok(section.scrollWidth <= section.width + 1, `${screen.name}: ${section.label} has horizontal overflow`);
      assert.ok(section.left >= geometry.left - 1 && section.right <= geometry.right + 1, `${screen.name}: highlight control escapes the result modal`);
    }
    const reviewBounds = await review.boundingBox();
    assert.ok(reviewBounds && reviewBounds.y >= -1 && reviewBounds.y + reviewBounds.height <= screen.height + 1, 'The hand review link is reachable within the phone viewport');
    await page.screenshot({ path: `${output}/${screen.name}-record.png`, fullPage: true });

    // Opening the same authoritative result again must not repeat a daily award.
    await page.locator('.result-modal').getByRole('button', { name: 'Close dialog', exact: true }).click();
    const reopenedRead = page.waitForResponse(response => new URL(response.url()).pathname === '/api/play-streak');
    await page.getByRole('button', { name: 'Hand results', exact: true }).click();
    await (await reopenedRead).finished();
    await highlight.waitFor();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator('.streak-award').count(), 0, 'Reopening results must not replay the earned streak');
    assert.equal(await page.evaluate(id => localStorage.getItem(`parkes-rummy:streak-celebration:v1:${encodeURIComponent(id)}`), owner.id),
      summarizePlayStreak([api.getRoom().records.current['owner-seat']]).today);

    for (const identity of ['guest', accountMarker(outsider.id)]) {
      const denied = await api.handlers.readRoomRequest(new Request(`${base}/api/rooms/${room.code}`, { headers: {
        [ACCOUNT_IDENTITY_HEADER]: identity,
        ...(identity === 'guest' ? {} : { Cookie: 'records_result_session=outsider', Authorization: `Bearer ${identity}` }),
      } }), room.code);
      assert.equal(denied.status, identity === 'guest' ? 401 : 403, 'Only the authenticated member may read this completed record');
    }
    assert.deepEqual(errors, [], `${screen.name}: browser errors`);
    assert.deepEqual(api.errors, [], `${screen.name}: isolated API errors`);
    checks.push({ screen: screen.name, width: screen.width, authoritativeCompletedRecord: true, openingTurn: completed.openingTurn,
      earned: completed.achievements, identity: 'authenticated member', noPrematureHighlight: true, fullRevealMilliseconds: Math.round(audit.firstHighlightAt - audit.firstFlipAt),
      unchangedOpponentRail: true, reviewLink: true, noHorizontalOverflow: true, noAutomaticShare: true,
      firstDailyStreakCelebrated: true, noStreakReplay: true, audioSetting: 'muted', audit, geometry });
    console.log(`PASS: ${screen.name} authenticated daily streak and record highlight, reveal gate, once-only celebration and geometry`);
    await context.close();
  }
  await writeFile(`${output}/checks.json`, JSON.stringify({ checks, fixtureOnly: true, buildId: (await readFile('.next/BUILD_ID', 'utf8')).trim() }, null, 2));
} catch (error) {
  await writeFile(`${output}/checks.json`, JSON.stringify({ checks, error: String(error), fixtureOnly: true }, null, 2));
  try { await lastPage?.screenshot({ path: `${output}/failure.png`, fullPage: true }); } catch { /* Retain the original failure. */ }
  throw error;
} finally {
  await browser?.close(); server.kill('SIGTERM'); log.end();
}

