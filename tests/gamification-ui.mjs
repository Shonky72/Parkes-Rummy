import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PGlite } from '@electric-sql/pglite';
import { RecordsRepository } from '../db/records.ts';
import { CompetitionRepository } from '../db/competition.ts';
import { LadderRepository } from '../db/ladder.ts';
import { PostgresRoomRepository } from '../db/room-repository.ts';
import { PostgresJoinRequests } from '../db/join-requests.ts';
import { createRecordsHandlers, RECORDS_PUBLIC_HEADERS } from '../lib/records-server.ts';
import { createCompetitionHandlers } from '../lib/competition-server.ts';
import { createLadderHandlers } from '../lib/ladder-server.ts';
import { createRoomHandlers } from '../lib/room-server.ts';
import { sharedRecordImage } from '../lib/records-share-image.ts';
import { sharedRecordPage } from '../lib/records-share-page.ts';
import { accountMarker } from '../lib/auth-config.ts';
import { ROOM_PROTOCOL, ROOM_PROTOCOL_HEADER } from '../lib/room-protocol.ts';
import { RECORDS_ENGINE_VERSION } from '../lib/records-types.ts';
import { getRuleExample, findBotOpening } from '../lib/rummy.ts';
import { applyChallengeAction } from '../lib/challenge-engine/v1/index.ts';

// Production Next pages, real service handlers, SQL constraints and transactions.
// Only the Google session boundary and wall-clock rate limiter are substituted.
// This in-process database has no live credentials or production players.
const output = 'gamification-results';
await mkdir(output, { recursive: true });
const pg = new PGlite();
const connection = target => ({ async query(sql, values) { const value = await target.query(sql, values); return { rows: value.rows, rowCount: value.affectedRows ?? value.rows.length }; } });
const db = { ...connection(pg), transaction: work => pg.transaction(tx => work(connection(tx))) };
await pg.query(await readFile(new URL('../db/schema-editor.sql', import.meta.url), 'utf8'));
const records = new RecordsRepository(db), rooms = new PostgresRoomRepository(db), ladder = new LadderRepository(db);
const styles = async () => ({ font: 'default', symbol: 'initials' });
const entitlements = { removeAds: true, originalRules: false, premiumFonts: false, premiumSymbols: false, voiceChat: false };
const competition = new CompetitionRepository(db, { records, entitled: async () => false, styles });
const security = { check: async () => {} };
await records.ensure(); await competition.ensure(); await ladder.ensure();
const profileUser = async name => {
  const user = { id: crypto.randomUUID(), name: `Private Google ${name}`, email: `${crypto.randomUUID()}@example.test`, image: null };
  await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)', [user.id, user.name, user.email]);
  await records.profile(user.id);
  return user;
};
const owner = await profileUser('Owner'), friend = await profileUser('Friend'), stranger = await profileUser('Stranger');
await records.updateProfile(friend.id, 'Golden Wattle', []);
let serial = 0;
function sampleEvidence(playerId, overrides = {}) {
  const now = Date.now() - 60_000;
  const opening = getRuleExample(1, 1).map(meld => ({ ...meld, ownerId: playerId, cards: meld.cards.map(card => ({ ...card, id: `synthetic-ui-card-${++serial}` })) }));
  return { schemaVersion: 1, gameId: crypto.randomUUID(), handId: crypto.randomUUID(), playerId, game: 1, ruleNumber: 1, ruleId: '1:1', handNumber: 1,
    startedAt: now, finishedAt: now + 30_000, status: 'completed', eligible: true, exclusionReason: null,
    conditions: { engineVersion: RECORDS_ENGINE_VERSION, format: 'quick-play', deal: 'random', playerCount: 2, humanCount: 1, seat: 0, startingSeat: 0,
      roster: [{ playerId, name: 'Private seat name', isBot: false, difficulty: 'easy' }, { playerId: 'synthetic-bot', name: 'AI', isBot: true, difficulty: 'easy' }], hints: true, timerSeconds: 0 },
    readyFromDeal: true, firstDrawReady: true, firstDrawCompletedOpening: false,
    firstReady: { turn: 0, actionId: 1, opening }, firstLegal: { turn: 2, actionId: 6, opening }, actualOpening: { turn: 2, actionId: 7, opening },
    opportunitiesPassed: 0, legalOpportunityTurns: [2], firstDiscardSurvived: true, readinessLostOnDiscard: 0, completed: true, wentOut: true, closingTurns: 2,
    penalty: 0, totalScore: 0, ownTurns: 4, wildcardCount: 0, naturalEligible: true, achievements: ['born-ready', 'first-chance', 'natural-talent'],
    timeline: [{ kind: 'deal', turn: 0, actionId: 1, ready: true, legal: false, opening, text: 'Complete opening in the original deal.' },
      { kind: 'draw', turn: 2, actionId: 6, ready: true, legal: true, opening, text: 'Opening available on Turn 2.' },
      { kind: 'opening', turn: 2, actionId: 7, ready: true, legal: true, opening, text: 'Opening played on Turn 2.' }],
    timelineTruncated: false, gameOutcome: null, endActionId: 10, ...overrides };
}
async function saveSample(user, evidence) {
  await db.query('INSERT INTO records_evidence(user_id,hand_id,game_id,player_id,room_code,rule_id,status,source_event,started_at,updated_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)',
    [user.id, evidence.handId, evidence.gameId, evidence.playerId, 'TEST', evidence.ruleId, evidence.status, `${evidence.handId}:end`, evidence.startedAt, evidence.finishedAt ?? evidence.startedAt, JSON.stringify(evidence)]);
  return evidence;
}
const selectedRecord = await saveSample(owner, sampleEvidence('owner-seat'));
await saveSample(friend, sampleEvidence('friend-seat'));
await saveSample(owner, sampleEvidence('pending-seat', { status: 'started', finishedAt: null, completed: false, actualOpening: null, firstLegal: null, achievements: [], penalty: null }));

const port = await new Promise(resolve => { const server = createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
const base = process.env.GAMIFICATION_TEST_BASE_URL || `http://127.0.0.1:${port}`;
const server = process.env.GAMIFICATION_TEST_BASE_URL ? null : spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '-p', String(port)], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
let serverLog = ''; server?.stdout.on('data', data => { serverLog += data; }); server?.stderr.on('data', data => { serverLog += data; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, lastPage;
const checks = [], errors = [];
function pass(name) { checks.push(name); console.log(`PASS: ${name}`); }
async function contextFor(user, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', ...options });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const session = { user };
  const resolveSession = async () => session.user;
  const recordApi = createRecordsHandlers({ records, resolveSession, security });
  const competitionApi = createCompetitionHandlers({ competition, resolveSession, security, enabled: true });
  const ladderApi = createLadderHandlers({ ladder, resolveSession, security, enabled: true });
  const roomApi = createRoomHandlers({ repository: rooms, resolveSession, security, captureRecords: true, configured: () => true,
    joins: new PostgresJoinRequests(db), profile: styles, entitlements: async () => entitlements,
    rankedAccess: (room, userId, action) => ladder.assertAccess(room, userId, action), rankedHeartbeat: (room, userId) => room.ranked ? ladder.heartbeat(userId, room.ranked.matchId) : Promise.resolve() });
  await context.addInitScript(() => {
    localStorage.setItem('parkes-rummy:advertising-consent-v1', 'declined');
    // The native system sheet cannot be displayed by headless Chrome. Capture its
    // real Web Share arguments; file contents and download fallback are checked.
    window.sharedRecords = [];
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: data => Array.isArray(data.files) });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async data => { window.sharedRecords.push({ title: data.title, url: data.url, fileName: data.files?.[0]?.name, bytes: data.files?.[0]?.size }); } });
  });
  context.on('page', page => { page.on('pageerror', error => errors.push(error.message)); });
  await context.route('**/*', async route => {
    const original = route.request(), url = new URL(original.url());
    if (url.origin !== new URL(base).origin) return route.abort();
    const path = url.pathname;
    if (!path.startsWith('/api/') && !path.startsWith('/records/shared/')) return route.continue();
    const headers = await original.allHeaders();
    headers['x-nf-client-connection-ip'] = '192.0.2.80';
    const request = new Request(original.url(), { method: original.method(), headers, ...(original.postData() ? { body: original.postData() } : {}) });
    const json = (data, status = 200) => Response.json(data, { status, headers: { [ROOM_PROTOCOL_HEADER]: ROOM_PROTOCOL } });
    let response;
    if (path === '/api/account/session') response = json({ configured: true, user: session.user, entitlements, profile: await styles(), accessAdmin: false });
    else if (path === '/api/auth/sign-out') { session.user = null; response = json({ success: true }); }
    else if (path === '/api/activity/presence') response = new Response(null, { status: 204 });
    else if (path === '/api/records') response = await (original.method() === 'POST' ? recordApi.mutate(request) : recordApi.snapshot(request));
    else if (path === '/api/competition') response = await (original.method() === 'POST' ? competitionApi.mutate(request) : competitionApi.snapshot(request));
    else if (path === '/api/ladder') response = await (original.method() === 'POST' ? ladderApi.mutate(request) : ladderApi.snapshot(request));
    else if (path.startsWith('/api/competition/challenge/')) response = await competitionApi.challenge(request, path.split('/').at(-1));
    else if (path.startsWith('/api/records/share/') || path.startsWith('/records/shared/')) {
      const token = path.startsWith('/records/shared/') ? path.split('/').at(-1) : path.split('/')[4];
      const record = await recordApi.shared(request, token);
      response = record instanceof Response ? record : path.endsWith('/image') ? sharedRecordImage(record) : path.startsWith('/records/shared/') ? sharedRecordPage(record, token) : Response.json(record, { headers: RECORDS_PUBLIC_HEADERS });
    } else if (path === '/api/account/games') response = await roomApi.accountGamesRequest(request);
    else if (path === '/api/rooms/summaries') response = await roomApi.listRoomSummariesRequest(request);
    else if (path === '/api/rooms') response = await roomApi.createRoomRequest(request);
    else if (/^\/api\/rooms\/[^/]+/.test(path)) {
      const code = path.split('/')[3], action = path.split('/')[4];
      if (action === 'action') response = await roomApi.actionRoomRequest(request, code);
      else if (action === 'join') response = await roomApi.joinRoomRequest(request, code);
      else if (action === 'preview') response = await roomApi.roomPreviewRequest(request, code);
      else if (action === 'join-requests') response = json({ requests: [] });
      else response = await roomApi.readRoomRequest(request, code);
    } else response = json({ error: `Unexpected isolated test endpoint ${path}` }, 404);
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers.entries()), body: Buffer.from(await response.arrayBuffer()) });
  });
  return { context, session, page: await context.newPage() };
}
async function noOverflow(page, name) {
  const overflow = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.ok(overflow.page <= overflow.viewport + 1, `${name}: horizontal page overflow ${JSON.stringify(overflow)}`);
}
async function finishChallenge(code) {
  for (let count = 0; count < 2500; count++) {
    const record = await rooms.load(code), room = record.room;
    if (room.status !== 'playing') { await competition.settle([owner.id, friend.id]); return room; }
    const human = room.players.find(player => !player.isBot);
    let action;
    if (room.turnPlayerId !== human.id) action = { type: 'botStep' };
    else if (room.phase === 'draw') action = { type: 'draw', source: room.stock.length || room.discardPile.length > 1 ? 'stock' : 'discard' };
    else {
      const opening = !human.down && human.completedTurns > 0 ? findBotOpening(human.hand, room.game, room.quickPlay.ruleNumber) : null;
      action = opening ? { type: 'goDown', cardIds: opening.flatMap(meld => meld.cards.map(card => card.id)) } : { type: 'discard', cardId: human.hand.at(-1).id };
    }
    const next = applyChallengeAction(room, human.id, action, Date.now());
    assert.equal(await rooms.save(next, record.version, undefined, { membershipUnchanged: true }), true);
  }
  throw new Error('Synthetic fixed challenge did not settle within the bounded test budget.');
}

try {
  let ready = false;
  for (let count = 0; count < 100; count++) { try { ready = (await fetch(base)).ok; } catch {} if (ready) break; await pause(200); }
  assert.ok(ready, `Next production server failed to start: ${serverLog}`);
  browser = await chromium.launch({ headless: true });
  const anonymous = await contextFor(null);
  lastPage = anonymous.page; await anonymous.page.goto(`${base}/profile`);
  await anonymous.page.getByRole('heading', { name: 'Your records, your progress' }).waitFor();
  assert.equal(await anonymous.page.locator('.record-review').count(), 0);
  await anonymous.context.close(); pass('Anonymous profile shows the sign-in flow and no private records');

  const own = await contextFor(owner), other = await contextFor(friend), outsider = await contextFor(stranger);
  const page = own.page; lastPage = page;
  await page.goto(`${base}/profile`);
  await page.getByLabel('Display name', { exact: true }).fill('River Gum');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await page.getByRole('heading', { name: 'River Gum’s profile' }).waitFor();
  assert.equal((await records.profile(owner.id)).displayName, 'River Gum');
  await page.getByRole('button', { name: 'Achievements', exact: true }).click();
  assert.equal(await page.locator('.achievement-badge').count(), 16);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByLabel('First Chance', { exact: true }).check();
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Saved.' }).waitFor();
  assert.deepEqual((await records.profile(owner.id)).featuredBadges, ['first-chance']);
  pass('Chosen profile name and one of three permitted earned featured badges persist through the real service');

  await page.getByRole('button', { name: 'Rule Records', exact: true }).click();
  for (const game of ['Game 1', 'Game 2', 'Game 3', 'Original Rules']) {
    await page.getByRole('button', { name: game, exact: true }).click();
    assert.equal(await page.locator('.record-index button').count(), 10);
    for (let rule = 0; rule < 10; rule++) {
      await page.locator('.record-index button').nth(rule).click();
      assert.ok(await page.locator('.record-detail .record-card').count() > 0, `${game} rule ${rule + 1}`);
    }
  }
  await page.getByRole('button', { name: 'Game 1', exact: true }).click();
  await page.locator('.record-index button').first().click();
  assert.match(await page.locator('.record-cohort').innerText(), /50% \(1\/2\)/);
  pass('All 40 complete rules render engine examples; pending hands remain in the displayed success denominator');

  await page.getByRole('button', { name: 'Hand review', exact: true }).click();
  await page.getByText('Detailed hand timeline', { exact: true }).click();
  await page.getByText('Opening available on Turn 2.', { exact: true }).waitFor();
  assert.equal(await page.locator('.record-review').count(), 1);
  await page.locator('.record-review').getByRole('button', { name: 'Share', exact: true }).click();
  const sharePanel = page.getByRole('region', { name: 'Share selected record' });
  await sharePanel.waitFor();
  await sharePanel.getByRole('button', { name: 'Share', exact: true }).click();
  await page.waitForFunction(() => window.sharedRecords.length === 1);
  const native = await page.evaluate(() => window.sharedRecords[0]);
  assert.equal(native.fileName, 'parkes-rummy-record.png'); assert.ok(native.bytes > 10_000);
  await sharePanel.getByRole('button', { name: 'Copy link', exact: true }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const selectedShare = (await records.shares(owner.id))[0];
  assert.ok(copied.endsWith(selectedShare.url));
  const downloadEvent = page.waitForEvent('download');
  await sharePanel.getByRole('link', { name: 'Save image', exact: true }).click();
  const download = await downloadEvent; await download.saveAs(`${output}/verified-record.png`);
  const png = await readFile(`${output}/verified-record.png`);
  assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a'); assert.equal(png.readUInt32BE(16), 1200); assert.equal(png.readUInt32BE(20), 630);
  await outsider.page.goto(`${base}${selectedShare.url}`);
  await outsider.page.getByRole('heading', { name: 'Beat my record', exact: true }).waitFor();
  const sharedText = await outsider.page.textContent('body');
  assert.ok(!sharedText.includes(owner.email)); assert.ok(!sharedText.includes(owner.id)); assert.ok(!sharedText.includes('Private seat name'));
  await outsider.page.screenshot({ path: `${output}/public-record-desktop.png`, fullPage: true });
  await sharePanel.getByRole('button', { name: 'Revoke this public link' }).click();
  await sharePanel.waitFor({ state: 'hidden' });
  const revoked = await outsider.page.goto(`${base}${selectedShare.url}`); assert.equal(revoked.status(), 404);
  pass('Private hand timeline, explicit public share, native file arguments, copied link, 1200×630 PNG and immediate revocation work');

  await page.getByRole('button', { name: 'Friends', exact: true }).click();
  await page.getByLabel('Friend’s code', { exact: true }).fill((await records.profile(friend.id)).friendCode);
  await page.getByRole('button', { name: 'Send friend request', exact: true }).click();
  await page.getByRole('heading', { name: 'Waiting for acceptance', exact: true }).locator('..').getByText('Golden Wattle', { exact: true }).waitFor();
  await other.page.goto(`${base}/profile?tab=friends`);
  await other.page.getByRole('heading', { name: 'Requests for you', exact: true }).locator('..').getByRole('button', { name: 'Accept', exact: true }).click();
  await other.page.getByRole('heading', { name: 'Your friends', exact: true }).locator('..').getByText('River Gum', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Refresh profile', exact: true }).click();
  await page.getByRole('button', { name: 'Compare records', exact: true }).click();
  await page.getByRole('heading', { name: 'Compare with Golden Wattle' }).waitFor();
  const friendship = (await records.friends(owner.id)).accepted[0];
  pass('Friend code request, recipient acceptance and comparable record access work across two isolated account sessions');

  // Controlled deal entry goes through its focused page and the real atomic
  // reservation API. The first two human actions use the actual card table.
  const calendar = await competition.snapshot(owner.id);
  await page.goto(`${base}${calendar.daily.publicUrl}`);
  await page.getByRole('button', { name: /Play this challenge|Start first scored attempt/ }).click();
  await page.waitForURL(/\/join\/[A-Z0-9]{4}$/);
  const code = new URL(page.url()).pathname.split('/').at(-1);
  await page.locator('.game-header').waitFor();
  const beforeDraw = await rooms.load(code);
  await page.getByRole('button', { name: /^Draw a card from the stock pile/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-hand-card]').length === 11);
  const afterDraw = await rooms.load(code); assert.ok(afterDraw.version > beforeDraw.version);
  const simultaneous = await Promise.all([competition.reserveAttempt(owner.id, calendar.daily.token), competition.reserveAttempt(owner.id, calendar.daily.token)]);
  assert.ok(simultaneous.every(value => value.roomCode === code && value.resumed));
  const challengePrivate = (await rooms.load(code)).room.challenge.config.seed;
  assert.ok(!(await page.textContent('body')).includes(challengePrivate));
  await page.screenshot({ path: `${output}/fixed-challenge-table.png`, fullPage: true });
  await page.goto(`${base}/competition`);
  const completed = await finishChallenge(code);
  assert.notEqual(completed.status, 'playing');
  const firstAttempt = (await competition.snapshot(owner.id)).attempts.find(value => value.roomCode === code);
  assert.equal(firstAttempt.status, 'completed');
  const practice = await competition.reserveAttempt(owner.id, calendar.daily.token, true);
  assert.equal(practice.attempt.practice, true); assert.notEqual(practice.roomCode, code);
  assert.equal((await rooms.load(practice.roomCode)).room.records.eligible, false);
  pass('Focused daily landing starts a real frozen game; draw persists; simultaneous reconnects reuse the first attempt; practice earns no records');

  // Ranked invitations remain opt-in for each player, then create a real locked
  // two-human table. The explicit forfeit flow settles its rating transaction.
  await page.goto(`${base}/ladder`);
  const invite = page.getByRole('button', { name: 'Create ranked invitation', exact: true });
  await page.getByLabel('Or invite an accepted friend').selectOption(friendship.id);
  assert.equal(await invite.isDisabled(), true);
  await page.getByRole('checkbox', { name: /I agree to the ranked rules/ }).check(); await invite.click();
  await page.getByText('Ranked invitation ready for your friend to accept.', { exact: true }).waitFor();
  await other.page.goto(`${base}/ladder`);
  const accept = other.page.getByRole('button', { name: 'Accept ranked match', exact: true });
  await accept.waitFor(); assert.equal(await accept.isDisabled(), true);
  await other.page.getByRole('checkbox', { name: /I agree to the ranked rules/ }).check(); await accept.click();
  await other.page.waitForURL(/\/join\/[A-Z0-9]{4}$/); await other.page.locator('.game-header').waitFor();
  const rankedCode = new URL(other.page.url()).pathname.split('/').at(-1), ranked = (await rooms.load(rankedCode)).room;
  assert.equal(ranked.players.length, 2); assert.equal(ranked.showMoveHints, false); assert.equal(ranked.turnLimitSeconds, 90); assert.equal(ranked.game, 1);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('button', { name: 'Forfeit this match', exact: true }).click();
  const previousRating = (await ladder.snapshot(owner.id)).player.rating;
  await page.getByRole('button', { name: 'Keep playing', exact: true }).click();
  assert.equal((await ladder.snapshot(owner.id)).player.rating, previousRating);
  await page.getByRole('button', { name: 'Forfeit this match', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm forfeit', exact: true }).click();
  await page.getByText('Rating recorded.', { exact: false }).waitFor();
  assert.equal((await ladder.snapshot(owner.id)).player.rating, 984);
  assert.equal((await ladder.snapshot(friend.id)).player.rating, 1016);
  await page.screenshot({ path: `${output}/human-ladder-desktop.png`, fullPage: true });
  pass('Both players consent to the controlled human ladder; cancelling forfeit keeps play active; confirming settles the expected Elo result');

  for (const size of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'phone', width: 390, height: 844 }, { name: 'fold-cover', width: 344, height: 882 }, { name: 'small-phone', width: 320, height: 568 }]) {
    await page.setViewportSize({ width: size.width, height: size.height });
    for (const destination of ['profile?tab=rules', 'profile?tab=achievements', 'competition', 'ladder']) {
      await page.goto(`${base}/${destination}`);
      await page.locator('.progress-main').waitFor();
      await page.waitForFunction(() => !document.querySelector('[aria-busy=true]'));
      await noOverflow(page, `${size.name} ${destination}`);
      await page.screenshot({ path: `${output}/${size.name}-${destination.replaceAll(/[?=]/g, '-')}.png`, fullPage: true });
    }
  }
  pass('Profile, challenges and ladder fit desktop, phone, narrow Fold cover and 320px screens with reduced motion');

  // Sign-out revokes the in-memory private view before another session can use it.
  await page.goto(`${base}/`);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.goto(`${base}/profile`);
  await page.getByRole('heading', { name: 'Your records, your progress' }).waitFor();
  assert.ok(!(await page.textContent('body')).includes('River Gum’s profile'));
  assert.deepEqual(errors, []);
  pass('Account sign-out clears private progress and every exercised page has no browser runtime errors');
  await own.context.close(); await other.context.close(); await outsider.context.close();
} catch (error) {
  try { await lastPage?.screenshot({ path: `${output}/failure.png`, fullPage: true }); } catch {}
  await writeFile(`${output}/checks.json`, JSON.stringify({ checks, errors, failure: String(error) }, null, 2));
  throw error;
} finally {
  await writeFile(`${output}/next.log`, serverLog);
  await writeFile(`${output}/checks.json`, JSON.stringify({ checks, errors }, null, 2));
  await browser?.close(); server?.kill('SIGTERM'); await pg.close();
}
