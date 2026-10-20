import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomInt, randomUUID } from 'node:crypto';
import { applyAction, chooseBotAction, createPlayer, createRoom, enableRecords, getRuleExample, publicRoom } from '../lib/rummy.ts';
import { RECORDS_ENGINE_VERSION } from '../lib/records-types.ts';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../lib/room-code.ts';

// This module receives the main browser suite's isolated PGlite repositories
// and authenticated browser contexts. It never opens a database or a session.
export async function runCompetitionUi({
  page, otherPage, outsiderPage, base, competition, records, rooms, db,
  owner, friend, friendship, finishChallenge, output, readMutation,
}) {
  await mkdir(output, { recursive: true });
  const checks = [];
  let stage = 'custom fixed deal';
  const names = await Promise.all([records.profile(owner.id), records.profile(friend.id)]);
  const ownerName = names[0].displayName, friendName = names[1].displayName;
  const labels = { deals: 'My deals', clubs: 'Clubs', duels: 'Three-deal duels', rematches: 'Rematches' };
  const pass = name => { checks.push(name); console.log(`PASS: ${name}`); };
  const screenshot = (target, name) => target.screenshot({ path: `${output}/competition-${name}.png`, fullPage: true });

  async function openTab(target, tab) {
    await target.goto(`${base}/competition?tab=${tab}`);
    await target.getByRole('heading', { name: 'Challenges & clubs', exact: true }).waitFor();
    await target.getByRole('button', { name: labels[tab], exact: true }).waitFor();
    await target.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
  }
  async function action(target, name, click) {
    const pending = target.waitForResponse(response => {
      const request = response.request();
      if (new URL(response.url()).pathname !== '/api/competition' || request.method() !== 'POST') return false;
      try { return request.postDataJSON()?.action === name; } catch { return false; }
    });
    await click();
    const response = await pending;
    // Hard table navigation can discard Chrome's response-body handle. The
    // HTTP harness captures the exact handler JSON before sending those bytes.
    const captured = readMutation(target, name), data = captured.data;
    assert.equal(captured.status, response.status());
    assert.ok(response.ok(), `${stage}: ${name} returned ${response.status()} ${JSON.stringify(data)}`);
    return data;
  }
  async function openStartedTable(target, result) {
    await target.waitForURL(/\/join\/[A-Z0-9]{4}$/);
    assert.equal(new URL(target.url()).pathname.split('/').at(-1), result.roomCode);
    await target.locator('.game-header').waitFor();
    return (await rooms.load(result.roomCode)).room;
  }
  // Browser fetches use the main suite's isolated HTTP handlers and that page's
  // test session cookie, including the same identity marker as the product UI.
  async function browserJson(target, path, body) {
    return target.evaluate(async ({ path, body }) => {
      const session = await (await fetch('/api/account/session', { cache: 'no-store' })).json();
      const response = await fetch(path, {
        method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
        headers: { 'X-Parkes-Identity': `account:${session.user.id}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, data: await response.json(), cache: response.headers.get('Cache-Control') };
    }, { path, body });
  }
  const attemptCard = (target, handId) => target.locator('.competition-attempt').filter({
    has: target.locator(`a[href*="handId=${handId}"]`),
  });
  const section = (target, name) => target.locator('section.panel').filter({ has: target.getByRole('heading', { name, exact: true }) });

  try {
    await openTab(page, 'deals');
    await page.getByText('Create a fixed deal', { exact: true }).click();
    await page.getByLabel('Ruleset', { exact: true }).selectOption('1');
    await page.getByLabel('Opening rule', { exact: true }).selectOption('1');
    await page.getByLabel('Number of AI opponents', { exact: true }).selectOption('1');
    await page.getByLabel('AI 1 strength', { exact: true }).selectOption('easy');
    await page.getByText('Seat and hint options', { exact: true }).click();
    await page.getByLabel('Your seat', { exact: true }).selectOption('1');
    await page.getByLabel('Starting seat', { exact: true }).selectOption('1');
    await page.getByRole('checkbox', { name: 'Show move hints for everyone attempting this deal' }).check();
    assert.equal(await page.getByLabel('Ruleset', { exact: true }).locator('option[value="4"]').count(), 0);
    const created = await action(page, 'createChallenge', () => page.getByRole('button', { name: 'Create private deal', exact: true }).click());
    const challenge = created.challenge;
    assert.equal(challenge.game, 1); assert.equal(challenge.ruleNumber, 1);
    assert.deepEqual(challenge.difficulties, ['easy']); assert.equal(challenge.humanSeat, 1); assert.equal(challenge.startingSeat, 1); assert.equal(challenge.showMoveHints, true);
    const privateCard = page.locator('.competition-challenge').filter({ hasText: 'Manage this private deal' });
    await privateCard.getByRole('heading', { name: challenge.title, exact: true }).waitFor();
    await screenshot(page, 'custom-fixed-deal');
    const source = await action(page, 'startAttempt', () => privateCard.getByRole('button', { name: 'Play this challenge', exact: true }).click());
    const sourceRoom = await openStartedTable(page, source);
    const originalCards = structuredClone(sourceRoom.players[challenge.humanSeat].hand);
    const privateSeed = sourceRoom.challenge.config.seed;
    assert.equal(sourceRoom.records.current[sourceRoom.challenge.humanPlayerId].conditions.startingSeat, 1);
    assert.ok(!(await page.textContent('body')).includes(privateSeed));
    // Stop table polling before the bounded authoritative engine completion.
    await openTab(page, 'deals');
    await finishChallenge(source.roomCode);
    await openTab(page, 'deals');
    const sourceAttempt = attemptCard(page, source.attempt.handId);
    await sourceAttempt.getByRole('button', { name: 'Create Beat My Deal link', exact: true }).waitFor();
    const published = await action(page, 'shareChallenge', () => sourceAttempt.getByRole('button', { name: 'Create Beat My Deal link', exact: true }).click());
    const shared = published.challenge;
    assert.equal(shared.challengeId, challenge.challengeId); assert.notEqual(shared.id, challenge.id);
    const sharing = page.getByRole('region', { name: 'Your new Beat My Deal link' });
    await sharing.waitFor();
    await sharing.getByRole('button', { name: 'Copy link', exact: true }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(copied, `${base}${shared.publicUrl}`);
    await screenshot(page, 'beat-my-deal-link');

    stage = 'friend landing and durable reservation';
    await otherPage.goto(`${base}${shared.publicUrl}`);
    await otherPage.getByRole('heading', { name: 'Can you beat this deal?', exact: true }).waitFor();
    assert.equal(await otherPage.locator('.competition-challenge').count(), 1);
    await otherPage.getByText(`${ownerName}’s target`, { exact: true }).waitFor();
    await otherPage.getByRole('heading', { name: challenge.title, exact: true }).waitFor();
    assert.match(await otherPage.getByRole('list', { name: 'Fixed challenge conditions' }).innerText(), /seat 2; seat 2 starts/);
    const landingText = await otherPage.locator('.competition-landing').innerText();
    for (const hidden of [owner.id, owner.email, owner.name, privateSeed, 'randomCursor']) assert.ok(!landingText.includes(hidden), hidden);
    await otherPage.setViewportSize({ width: 390, height: 844 });
    await screenshot(otherPage, 'friend-landing-phone');
    assert.ok(await otherPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await otherPage.setViewportSize({ width: 1440, height: 1000 });
    const first = await action(otherPage, 'startAttempt', () => otherPage.getByRole('button', { name: 'Play this challenge', exact: true }).click());
    const friendRoom = await openStartedTable(otherPage, first);
    assert.deepEqual(friendRoom.players[challenge.humanSeat].hand, originalCards);
    assert.notEqual(first.attempt.id, source.attempt.id);
    await openTab(otherPage, 'deals');
    const resumed = await action(otherPage, 'resumeAttempt', () => otherPage.locator('.competition-attempt').first().getByRole('button', { name: 'Continue first attempt', exact: true }).click());
    assert.equal(resumed.attempt.id, first.attempt.id); assert.equal(resumed.roomCode, first.roomCode); assert.equal(resumed.resumed, true);
    await openStartedTable(otherPage, resumed);
    await openTab(otherPage, 'deals');

    await action(page, 'revokeChallenge', () => sharing.getByRole('button', { name: 'Revoke this link', exact: true }).click());
    await outsiderPage.goto(`${base}${shared.publicUrl}`);
    await outsiderPage.getByRole('heading', { name: 'Invitation unavailable', exact: true }).waitFor();
    assert.equal(await outsiderPage.getByRole('button', { name: 'Play this challenge', exact: true }).count(), 0);
    await screenshot(outsiderPage, 'revoked-invitation');
    const afterRevocation = await action(otherPage, 'resumeAttempt', () => otherPage.locator('.competition-attempt').first().getByRole('button', { name: 'Continue first attempt', exact: true }).click());
    assert.equal(afterRevocation.attempt.id, first.attempt.id); assert.equal(afterRevocation.roomCode, first.roomCode);
    await openStartedTable(otherPage, afterRevocation);
    await openTab(otherPage, 'deals');
    await openTab(page, 'deals');
    const republished = await action(page, 'shareChallenge', () => attemptCard(page, source.attempt.handId).getByRole('button', { name: 'Create Beat My Deal link', exact: true }).click());
    assert.notEqual(republished.challenge.token, shared.token);
    await otherPage.goto(`${base}${republished.challenge.publicUrl}`);
    const aliasResume = await action(otherPage, 'startAttempt', () => otherPage.getByRole('button', { name: 'Continue first attempt', exact: true }).click());
    assert.equal(aliasResume.attempt.id, first.attempt.id); assert.equal(aliasResume.roomCode, first.roomCode);
    await openStartedTable(otherPage, aliasResume);
    await openTab(otherPage, 'deals');
    assert.equal((await db.query('SELECT id FROM competition_attempts WHERE challenge_id=$1 AND user_id=$2 AND scored=true', [challenge.challengeId, friend.id])).rows.length, 1);
    pass('Custom conditions persist; Beat My Deal opens a focused matching friend deal; revocation blocks new visitors while both saved and replacement-link resumes preserve the original attempt');

    stage = 'club consent and private access';
    await openTab(page, 'clubs');
    await page.getByLabel('Club name', { exact: true }).fill('Riverbank Rivals');
    const clubCreated = await action(page, 'createClub', () => page.getByRole('button', { name: 'Create club', exact: true }).click());
    const clubId = clubCreated.club.id;
    await page.getByRole('heading', { name: 'Riverbank Rivals', exact: true }).waitFor();
    const club = await competition.club(owner.id, clubId);
    await openTab(otherPage, 'clubs');
    await otherPage.getByLabel('Invitation code', { exact: true }).fill(club.code);
    await action(otherPage, 'requestClub', () => otherPage.getByRole('button', { name: 'Request to join', exact: true }).click());
    await otherPage.getByText('Waiting for owner approval', { exact: true }).waitFor();
    assert.equal(await otherPage.getByRole('heading', { name: 'Club rule records', exact: true }).count(), 0);
    const pendingRead = await browserJson(otherPage, `/api/competition?clubId=${encodeURIComponent(clubId)}`);
    assert.equal(pendingRead.status, 403); assert.match(pendingRead.cache, /private.*no-store/);
    await openTab(page, 'clubs');
    const member = section(page, 'Members & permissions').locator('.progress-person').filter({ hasText: friendName });
    await action(page, 'approveMember', () => member.getByRole('button', { name: 'Approve', exact: true }).click());
    await openTab(otherPage, 'clubs');
    await otherPage.getByRole('heading', { name: 'Riverbank Rivals', exact: true }).waitFor();
    assert.equal(await otherPage.getByRole('button', { name: 'Approve', exact: true }).count(), 0);
    await openTab(outsiderPage, 'clubs');
    assert.equal(await outsiderPage.getByText('Riverbank Rivals', { exact: true }).count(), 0);
    const forbidden = await browserJson(outsiderPage, `/api/competition?clubId=${encodeURIComponent(clubId)}`);
    assert.equal(forbidden.status, 403); assert.ok(!JSON.stringify(forbidden.data).includes(club.code));
    pass('Club creation, explicit join request and owner approval control private boards across member, pending and outsider browser sessions');

    stage = 'club goals and comparable records';
    // SQL fixtures create comparable sample sizes without requiring 40 long
    // browser games. The pre-existing root samples precede membership consent.
    await seedClubSamples(db, owner, friend);
    await openTab(page, 'clubs');
    await page.getByRole('heading', { name: 'Club rule records', exact: true }).waitFor();
    assert.equal(await page.getByRole('progressbar', { name: 'Different opening rules completed by your club' }).getAttribute('value'), '1');
    const goal = section(page, 'Ten different openings, together');
    assert.match(await goal.innerText(), /1\/10/);
    for (const name of [ownerName, friendName]) assert.match(await goal.locator('.progress-person').filter({ hasText: name }).innerText(), /1 distinct opening/);
    const best = section(page, 'Club rule records').locator('.record-cohort').filter({ hasText: 'quick play' });
    const consistency = section(page, 'Rule consistency').locator('.record-cohort').filter({ hasText: 'quick play' });
    for (const name of [ownerName, friendName]) {
      const bestCells = await best.getByRole('row').filter({ hasText: name }).locator('td, th').allTextContents();
      assert.deepEqual(bestCells, ['1', name, 'Turn 2', '95% (19/20)', '1']);
      const rateCells = await consistency.getByRole('row').filter({ hasText: name }).locator('td, th').allTextContents();
      assert.deepEqual(rateCells, ['1', name, '95% (19/20)', 'Turn 2', '1', '0']);
    }
    assert.match(await consistency.innerText(), /20 attempts for a full ranking/);
    const board = await competition.club(owner.id, clubId);
    assert.equal(board.goal.completed, 1);
    const boardJson = JSON.stringify({ records: board.ruleRecords, consistency: board.consistency });
    for (const hidden of [owner.id, friend.id, owner.email, friend.email, 'private-ui-card', 'private-ui-roster']) assert.ok(!boardJson.includes(hidden), hidden);
    await screenshot(page, 'club-records-desktop');
    pass('Club goal contributions, equally early best records and established consistency ranks display 19 of 20 completions with pending hands in the denominator');

    stage = 'three-deal duel';
    await openTab(page, 'duels');
    await page.getByLabel('Choose an accepted friend', { exact: true }).selectOption(friendship.id);
    const invited = await action(page, 'createDuel', () => page.getByRole('button', { name: 'Create duel invitation', exact: true }).click());
    const duel = invited.duel;
    await page.getByText('Your friend must accept before either player can see the three deals.', { exact: true }).waitFor();
    assert.equal(await page.locator('.competition-challenge').count(), 0);
    await otherPage.goto(`${base}${duel.url}`);
    await action(otherPage, 'acceptDuel', () => otherPage.getByRole('button', { name: 'Accept duel', exact: true }).click());
    await otherPage.locator('.competition-challenge').nth(2).waitFor();
    assert.equal(await otherPage.locator('.competition-challenge').count(), 3);
    assert.equal(await otherPage.getByRole('button', { name: /Close duel|Revoke invitation|Decline duel/ }).count(), 0);
    const accepted = await competition.duel(owner.id, duel.id);
    assert.equal(accepted.challenges.length, 3);
    assert.equal(new Set(accepted.challenges.map(value => value.challengeId)).size, 3);
    const privateDuel = await browserJson(outsiderPage, `/api/competition?duel=${encodeURIComponent(duel.token)}`);
    assert.equal(privateDuel.status, 404);
    await screenshot(otherPage, 'accepted-three-deal-duel');
    const initialDeals = new Map();
    for (const [target, user] of [[page, owner], [otherPage, friend]]) {
      for (let index = 0; index < 3; index++) {
        await target.goto(`${base}${duel.url}`);
        const card = target.locator('.competition-challenge').nth(index);
        const played = await action(target, 'startAttempt', () => card.getByRole('button', { name: 'Play this challenge', exact: true }).click());
        const state = await openStartedTable(target, played);
        assert.equal(state.challenge.config.id, accepted.challenges[index].challengeId);
        const cards = state.players[state.challenge.config.humanSeat].hand;
        if (user.id === owner.id) initialDeals.set(index, structuredClone(cards));
        else assert.deepEqual(cards, initialDeals.get(index));
        await openTab(target, 'duels');
        await finishChallenge(played.roomCode);
      }
    }
    await page.goto(`${base}${duel.url}`);
    await page.getByText('A shared result. The duel is a draw.', { exact: true }).waitFor();
    const finalDuel = await competition.duel(owner.id, duel.id);
    assert.equal(finalDuel.complete, true); assert.equal(finalDuel.you.completedDeals, 3); assert.equal(finalDuel.other.completedDeals, 3);
    assert.equal(finalDuel.outcome, 'tie'); assert.equal(finalDuel.you.points, finalDuel.other.points);
    const cannotErase = await browserJson(page, '/api/competition', { action: 'revokeDuel', duelId: duel.id });
    assert.equal(cannotErase.status, 409);
    assert.equal((await competition.duel(owner.id, duel.id)).complete, true);
    await screenshot(page, 'completed-three-deal-duel');
    pass('The invited friend accepts before three fixed deals appear; both players complete all three original deals, equal results draw, and accepted results cannot be revoked');

    stage = 'verified shared-hand rematch';
    const sharedHand = await completeSharedHand({ rooms, db, owner, friend, ownerName, friendName });
    const comparison = await records.comparison(owner.id, friendship.id);
    assert.ok(comparison.rematchHands.some(hand => hand.handId === sharedHand.handId));
    await openTab(page, 'rematches');
    await page.getByLabel('Choose an accepted friend', { exact: true }).selectOption(friendship.id);
    await page.getByLabel('A completed hand you played together', { exact: true }).selectOption(sharedHand.handId);
    const rematchCreated = await action(page, 'createRematch', () => page.getByRole('button', { name: 'Create rematch invitation', exact: true }).click());
    assert.equal(rematchCreated.rematch.status, 'pending'); assert.equal(rematchCreated.rematch.roomCode, null);
    await page.getByText('Your invitation is waiting for your friend’s acceptance.', { exact: true }).waitFor();
    const privateRematch = await browserJson(outsiderPage, `/api/competition?rematch=${encodeURIComponent(rematchCreated.rematch.token)}`);
    assert.equal(privateRematch.status, 404);
    await otherPage.goto(`${base}${rematchCreated.rematch.url}`);
    const agreed = await action(otherPage, 'acceptRematch', () => otherPage.getByRole('button', { name: 'Accept rematch', exact: true }).click());
    await otherPage.waitForURL(/\/join\/[A-Z0-9]{4}$/);
    await otherPage.locator('.lobby-shell').waitFor();
    const savedRematch = await rooms.load(agreed.roomCode);
    assert.equal(savedRematch.room.status, 'lobby'); assert.equal(savedRematch.room.game, 1);
    assert.equal(savedRematch.room.players.length, 2); assert.ok(savedRematch.room.players.every(player => !player.isBot));
    assert.equal(savedRematch.room.ranked, undefined); assert.equal(savedRematch.room.challenge, undefined);
    assert.deepEqual(savedRematch.memberships.map(member => member.userId).sort(), [owner.id, friend.id].sort());
    assert.deepEqual(savedRematch.room.players.map(player => player.name), [ownerName, friendName]);
    await screenshot(otherPage, 'accepted-social-rematch');
    await openTab(page, 'rematches');
    await page.getByRole('button', { name: 'Open rematch table', exact: true }).click();
    await page.waitForURL(new RegExp(`/join/${agreed.roomCode}$`));
    await page.locator('.lobby-shell').waitFor();
    await page.getByRole('button', { name: 'Start with 2 players', exact: true }).waitFor();
    pass('A real completed two-human hand supplies the rematch selector; recipient consent creates one ordinary private table recoverable by both authenticated players');

    await openTab(page, 'deals');
    await openTab(otherPage, 'deals');
    await writeFile(`${output}/competition-checks.json`, JSON.stringify({ checks }, null, 2));
    return checks;
  } catch (error) {
    await Promise.allSettled([
      screenshot(page, 'failure-owner'), screenshot(otherPage, 'failure-friend'), screenshot(outsiderPage, 'failure-outsider'),
    ]);
    await writeFile(`${output}/competition-checks.json`, JSON.stringify({ checks, stage, failure: String(error) }, null, 2));
    throw new Error(`Release 2 browser flow (${stage}): ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

async function seedClubSamples(db, owner, friend) {
  for (const user of [owner, friend]) {
    for (let index = 0; index < 20; index++) {
      const playerId = randomUUID(), handId = randomUUID(), now = Date.now(), pending = index === 19;
      const opening = getRuleExample(1, 1).map(meld => ({ ...meld, ownerId: playerId, cards: meld.cards.map(card => ({ ...card, id: `private-ui-card-${randomUUID()}` })) }));
      const milestone = { turn: 2, actionId: 5, opening };
      const evidence = {
        schemaVersion: 1, gameId: randomUUID(), handId, playerId, game: 1, ruleNumber: 1, ruleId: '1:1', handNumber: 1,
        startedAt: now, finishedAt: pending ? null : now, status: pending ? 'started' : 'completed', eligible: true, exclusionReason: null,
        conditions: { engineVersion: RECORDS_ENGINE_VERSION, format: 'quick-play', deal: 'random', singleHand: true, playerCount: 2, humanCount: 1, seat: 0, startingSeat: 0,
          roster: [{ playerId, name: 'private-ui-roster', isBot: false, difficulty: 'easy' }, { playerId: randomUUID(), name: 'AI', isBot: true, difficulty: 'easy' }], hints: true, timerSeconds: 0 },
        readyFromDeal: false, firstDrawReady: false, firstDrawCompletedOpening: false,
        firstReady: pending ? null : milestone, firstLegal: pending ? null : milestone, actualOpening: pending ? null : milestone,
        opportunitiesPassed: 0, legalOpportunityTurns: pending ? [] : [2], firstDiscardSurvived: false, readinessLostOnDiscard: 0,
        completed: !pending, wentOut: false, closingTurns: null, penalty: pending ? null : 5, totalScore: pending ? null : 5, ownTurns: pending ? 0 : 3,
        wildcardCount: pending ? null : 0, naturalEligible: true, achievements: [], timeline: [], timelineTruncated: false, gameOutcome: null, endActionId: pending ? null : 9,
      };
      await db.query(`INSERT INTO records_evidence(user_id,hand_id,game_id,player_id,room_code,rule_id,status,source_event,started_at,updated_at,payload)
        VALUES($1,$2,$3,$4,'TEST',$5,$6,$7,$8,$8,$9::jsonb)`,
      [user.id, handId, evidence.gameId, playerId, evidence.ruleId, evidence.status, `${handId}:ui-sample`, now, JSON.stringify(evidence)]);
    }
  }
}

async function completeSharedHand({ rooms, db, owner, friend, ownerName, friendName }) {
  const host = createPlayer({ id: randomUUID(), name: ownerName, tokenHash: `synthetic:${randomUUID()}`, color: 0 });
  const guest = createPlayer({ id: randomUUID(), name: friendName, tokenHash: `synthetic:${randomUUID()}`, color: 1 });
  host.ready = true; guest.ready = true;
  let room;
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = Array.from({ length: ROOM_CODE_LENGTH }, () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)]).join('');
    const lobby = createRoom(code, host); lobby.players.push(guest);
    if (!await rooms.insert(lobby, { userId: owner.id, playerId: host.id })) continue;
    await db.query('INSERT INTO room_memberships(room_code,user_id,player_id) VALUES($1,$2,$3)', [code, friend.id, guest.id]);
    enableRecords(lobby, { eligiblePlayerIds: [host.id, guest.id] });
    room = applyAction(lobby, host.id, { type: 'start' });
    assert.equal(await rooms.save(room, lobby.version, undefined, { membershipUnchanged: true }), true);
    break;
  }
  assert.ok(room, 'An isolated shared-hand fixture room must be available.');
  for (let step = 0; step < 2500 && room.status === 'playing'; step++) {
    const action = chooseBotAction(publicRoom(room, room.turnPlayerId), 'medium');
    const next = applyAction(room, room.turnPlayerId, action);
    assert.equal(await rooms.save(next, room.version, undefined, { membershipUnchanged: true }), true);
    room = next;
  }
  assert.notEqual(room.status, 'playing', 'Real two-human engine fixture must finish its hand within a bounded action budget.');
  assert.equal(room.history.length, 1);
  const evidence = Object.values(room.records.current);
  assert.equal(evidence.length, 2); assert.ok(evidence.every(row => row.status === 'completed' && row.eligible));
  return { handId: room.records.handId, roomCode: room.code };
}
