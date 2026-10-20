import assert from 'node:assert/strict';
import test, { before, beforeEach, after } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import type { QueryResultRow } from 'pg';
import type { SqlConnection, SqlDatabase } from '../db';
import { LadderRepository, LADDER_SCHEMA, processRankedRoom } from '../db/ladder';
import { RecordsRepository } from '../db/records';
import { PostgresRoomRepository } from '../db/room-repository';
import { PostgresRequestSecurity } from '../db/security';
import { createLadderHandlers } from '../lib/ladder-server';
import { createRoomHandlers } from '../lib/room-server';
import { accountMarker, type AccountUser } from '../lib/auth-config';
import { ROOM_PROTOCOL, ROOM_PROTOCOL_HEADER } from '../lib/room-protocol';
import { applyAction, publicRoom } from '../lib/rummy';
import type { RoomState } from '../lib/types';

// Real PostgreSQL constraints, transactions and SQL. Session resolution alone
// uses synthetic already-authenticated identities; no production accounts.
const pg = new PGlite();
function connection(target: Pick<PGlite | Transaction, 'query'>): SqlConnection {
  return { async query<T extends QueryResultRow>(sql: string, values?: unknown[]) {
    const result = await target.query<T>(sql, values);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  } };
}
const db: SqlDatabase = { ...connection(pg), transaction: work => pg.transaction(tx => work(connection(tx))) };
const ladder = new LadderRepository(db), records = new RecordsRepository(db), rooms = new PostgresRoomRepository(db);
const security = new PostgresRequestSecurity(db);
const NOW = Date.now();
let clock = NOW, requestCount = 0;
const api = (user: AccountUser | null) => createLadderHandlers({ ladder, security, resolveSession: async () => user, now: () => clock, enabled: true });
function request(user: AccountUser | null, body?: unknown, options: { pin?: string; origin?: string | null; path?: string; headers?: Record<string, string> } = {}) {
  return new Request(`https://game.test${options.path ?? '/api/ladder'}`, {
    method: body === undefined ? 'GET' : 'POST', headers: {
      'Content-Type': 'application/json', 'x-nf-client-connection-ip': `192.0.2.${++requestCount % 240 + 1}`,
      ...(options.origin === null ? {} : { Origin: options.origin ?? 'https://game.test' }),
      'X-Parkes-Identity': options.pin ?? (user ? accountMarker(user.id) : 'guest'),
      [ROOM_PROTOCOL_HEADER]: ROOM_PROTOCOL, ...(user ? { Authorization: `Bearer ${accountMarker(user.id)}` } : {}), ...options.headers,
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function response(result: Promise<Response>) { const value = await result; return { status: value.status, headers: value.headers, data: await value.json() }; }
const post = (user: AccountUser | null, body: unknown) => response(api(user).mutate(request(user, body)));
const snapshot = (user: AccountUser) => response(api(user).snapshot(request(user)));
async function account(label: string, email?: string): Promise<AccountUser> {
  const user: AccountUser = { id: crypto.randomUUID(), name: `Private Google ${label}`, email: email ?? `${crypto.randomUUID()}@example.test`, image: null };
  await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)', [user.id, user.name, user.email]);
  await records.updateProfile(user.id, `Player ${label}`.slice(0, 24), []);
  return user;
}
async function friends(first: AccountUser, second: AccountUser): Promise<string> {
  const profile = await records.profile(second.id);
  await records.requestFriend(first.id, profile.friendCode);
  const incoming = (await records.friends(second.id)).incoming[0];
  await records.friendAction(second.id, 'acceptFriend', incoming.id);
  return incoming.id;
}
async function pair(label: string) {
  const first = await account(`${label}A`), second = await account(`${label}B`);
  const friendId = await friends(first, second);
  return { first, second, friendId };
}
async function start(pairing: Awaited<ReturnType<typeof pair>>) {
  const invited = await post(pairing.first, { action: 'invite', friendId: pairing.friendId, consent: true });
  assert.equal(invited.status, 201, JSON.stringify(invited.data));
  const accepted = await post(pairing.second, { action: 'accept', matchId: invited.data.match.id, consent: true });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
  return accepted.data.match as Awaited<ReturnType<LadderRepository['match']>>;
}
function roomApi(user: AccountUser | null) {
  return createRoomHandlers({
    repository: rooms, security, resolveSession: async () => user, configured: () => true,
    captureRecords: true,
    entitlements: async () => ({ removeAds: false, premiumFonts: false, premiumSymbols: false, voiceChat: false, originalRules: false }),
    profile: async () => ({ font: 'default', symbol: 'initials' }),
    rankedAccess: (room, accountId, action) => ladder.assertAccess(room, accountId, action),
    rankedHeartbeat: (room, accountId) => ladder.heartbeat(accountId, room.ranked?.matchId),
  });
}
async function finalFixture(code: string, firstScore = 100, secondScore = 5) {
  const saved = (await rooms.load(code))!;
  const room = structuredClone(saved.room);
  // Synthetic pre-final state followed by the real authoritative discard action.
  // Public APIs never accept this state or the supplied fixture scores.
  room.players[0].ruleNumber = 10; room.players[0].score = firstScore; room.players[0].down = true;
  room.players[0].hand = [{ id: crypto.randomUUID(), rank: 5, suit: 'H' }];
  room.players[1].ruleNumber = 10; room.players[1].score = secondScore; room.players[1].down = true;
  room.players[1].hand = [{ id: crypto.randomUUID(), rank: 5, suit: 'C' }];
  room.turnPlayerId = room.players[0].id; room.phase = 'play'; room.turnDeadline = Date.now() + 90_000;
  room.version++; room.updatedAt = Date.now();
  assert.equal(await rooms.save(room, saved.version, undefined, { membershipUnchanged: true }), true);
  const ended = applyAction(room, room.players[0].id, { type: 'discard', cardId: room.players[0].hand[0].id });
  return { room, ended };
}
before(async () => { await pg.query(await readFile(new URL('../db/schema-editor.sql', import.meta.url), 'utf8')); await ladder.ensure(); });
beforeEach(async () => { clock = NOW; await db.query('DELETE FROM ladder_queue'); });
after(async () => { await pg.close(); });

test('ranked schema is additive, repeatable and matches its provisioning file', async () => {
  await db.query(LADDER_SCHEMA);
  assert.ok((await readFile(new URL('../db/ladder-migration.sql', import.meta.url), 'utf8')).includes(LADDER_SCHEMA));
});

test('real session, identity pin, legitimate origin and private caching protect ladder data', async () => {
  const user = await account('Privacy'), outsider = await account('Outsider');
  assert.equal((await api(null).snapshot(request(null))).status, 401);
  assert.equal((await api(user).snapshot(request(user, undefined, { pin: accountMarker(outsider.id) }))).status, 401);
  assert.equal((await api(user).mutate(request(user, { action: 'joinQueue', consent: true }, { origin: null }))).status, 403);
  assert.equal((await api(user).mutate(request(user, { action: 'joinQueue', consent: true }, { origin: 'https://evil.test' }))).status, 403);
  assert.equal((await api(user).snapshot(request(user, undefined, { headers: { 'Sec-Fetch-Site': 'cross-site' } }))).status, 403);
  const value = await response(api(user).snapshot(request(user, undefined, { path: `/api/ladder?userId=${outsider.id}` })));
  assert.equal(value.status, 200);
  assert.equal(value.data.player.rating, 1000);
  assert.equal(value.data.player.ratedGames, 0);
  const json = JSON.stringify(value.data);
  for (const secret of [user.email, user.name, user.id, outsider.email, outsider.id]) assert.ok(!json.includes(secret));
  assert.match(value.headers.get('Cache-Control')!, /private.*no-store/);
  assert.equal(value.headers.get('Netlify-CDN-Cache-Control'), 'no-store');
});

test('preview routes fail closed before snapshot creation or ranked mutations', async () => {
  const pairing = await pair('Preview'), newcomer = await account('PreviewNew');
  const match = await start(pairing);
  const before = await db.query('SELECT state FROM rooms WHERE code=$1', [match.roomCode]);
  const preview = (user: AccountUser) => createLadderHandlers({ ladder, security, resolveSession: async () => user, now: () => clock, enabled: false });
  assert.equal((await preview(newcomer).snapshot(request(newcomer))).status, 409);
  assert.equal((await db.query('SELECT user_id FROM ladder_players WHERE user_id=$1', [newcomer.id])).rows.length, 0);
  for (const body of [
    { action: 'joinQueue', consent: true }, { action: 'invite', friendId: pairing.friendId, consent: true },
    { action: 'forfeit', matchId: match.id }, { action: 'claimForfeit', matchId: match.id },
    { action: 'heartbeat', matchId: match.id }, { action: 'leaveQueue' },
  ]) {
    const result = await response(preview(pairing.first).mutate(request(pairing.first, body)));
    assert.equal(result.status, 409); assert.match(result.data.error, /Preview deployments/);
  }
  assert.deepEqual((await db.query('SELECT state FROM rooms WHERE code=$1', [match.roomCode])).rows, before.rows);
  assert.equal((await ladder.match(pairing.first.id, match.id, clock)).state, 'active');
  assert.equal((await db.query('SELECT game_id FROM ladder_results WHERE match_id=$1', [match.id])).rows.length, 0);
  assert.equal((await db.query('SELECT user_id FROM ladder_queue WHERE user_id=$1', [pairing.first.id])).rows.length, 0);
});

test('friend invitation needs both explicit consents; concurrent accepts create one private game', async () => {
  const pairing = await pair('Consent'), outsider = await account('Uninvited');
  assert.equal((await post(pairing.first, { action: 'invite', friendId: pairing.friendId })).status, 400);
  const invited = await post(pairing.first, { action: 'invite', friendId: pairing.friendId, consent: true });
  assert.equal(invited.status, 201);
  const matchId = invited.data.match.id;
  assert.equal(invited.data.match.roomCode, null);
  assert.equal((await db.query('SELECT * FROM rooms WHERE state::jsonb->\'ranked\'->>\'matchId\'=$1', [matchId])).rows.length, 0);
  assert.equal((await post(pairing.first, { action: 'accept', matchId, consent: true })).status, 403);
  assert.equal((await post(pairing.second, { action: 'accept', matchId, consent: false })).status, 400);
  assert.equal((await post(outsider, { action: 'accept', matchId, consent: true })).status, 404);
  const [left, right] = await Promise.all([post(pairing.second, { action: 'accept', matchId, consent: true }), post(pairing.second, { action: 'accept', matchId, consent: true })]);
  assert.equal(left.status, 200, JSON.stringify(left.data)); assert.equal(right.status, 200, JSON.stringify(right.data));
  assert.equal(left.data.roomCode, right.data.roomCode);
  const saved = (await rooms.load(left.data.roomCode))!;
  assert.equal(saved.room.game, 1); assert.equal(saved.room.quickPlay, undefined);
  assert.equal(saved.room.showMoveHints, false); assert.equal(saved.room.turnLimitSeconds, 90);
  assert.equal(saved.room.status, 'playing'); assert.equal(saved.room.players.length, 2);
  assert.ok(saved.room.players.every(player => !player.isBot && player.ready));
  assert.equal(saved.memberships.length, 2);
  const view = publicRoom(saved.room, saved.room.players[0].id);
  assert.deepEqual(view.ranked, { format: 'ranked-human-v1' });
  assert.ok(!JSON.stringify(view).includes(matchId));
  assert.ok(!JSON.stringify(view).includes(pairing.first.email));
  assert.equal((await records.allEvidence(pairing.first.id)).length, 1);
  assert.equal((await records.allEvidence(pairing.second.id)).length, 1);
});

test('withdrawn, expired and newly blocked invitations cannot start games', async () => {
  const pairing = await pair('Invite');
  const invited = await ladder.invite(pairing.first.id, pairing.friendId, true, clock);
  assert.equal((await post(pairing.second, { action: 'cancel', matchId: invited.id })).status, 403);
  await ladder.invitationAction(pairing.first.id, invited.id, 'cancel', clock);
  assert.equal((await post(pairing.second, { action: 'accept', matchId: invited.id, consent: true })).status, 410);
  const expired = await ladder.invite(pairing.first.id, pairing.friendId, true, clock);
  clock += 86_400_001;
  assert.equal((await post(pairing.second, { action: 'accept', matchId: expired.id, consent: true })).status, 410);
  const blocked = await ladder.invite(pairing.first.id, pairing.friendId, true, clock);
  await records.friendAction(pairing.first.id, 'blockFriend', pairing.friendId);
  assert.equal((await post(pairing.second, { action: 'accept', matchId: blocked.id, consent: true })).status, 403);
});

test('queue pairs only willing humans and concurrent joins reserve each account once', async () => {
  const first = await account('QueueA'), second = await account('QueueB'), third = await account('QueueC');
  assert.equal((await post(first, { action: 'joinQueue' })).status, 400);
  assert.equal((await post(first, { action: 'joinQueue', consent: true })).data.waiting, true);
  const [left, right] = await Promise.all([post(second, { action: 'joinQueue', consent: true }), post(third, { action: 'joinQueue', consent: true })]);
  assert.equal(left.status, 200, JSON.stringify(left.data)); assert.equal(right.status, 200, JSON.stringify(right.data));
  assert.equal([left, right].filter(value => value.data.match).length, 1);
  const matched = left.data.match ? left : right;
  const saved = (await rooms.load(matched.data.roomCode))!;
  assert.equal(saved.room.players.length, 2);
  assert.ok(saved.room.players.every(player => !player.isBot));
  const own = await ladder.snapshot(first.id, clock);
  assert.equal(own.player.activeMatchId, matched.data.match.id);
  assert.equal(own.queue.waiting, false);
  const again = await post(first, { action: 'joinQueue', consent: true });
  assert.equal(again.data.match.id, matched.data.match.id);
});

test('queue withdrawal, expiry and blocks prevent unwanted pairing', async () => {
  const pairing = await pair('QueueBlock');
  await ladder.joinQueue(pairing.first.id, true, clock);
  await ladder.leaveQueue(pairing.first.id);
  assert.equal((await ladder.snapshot(pairing.first.id, clock)).queue.waiting, false);
  await ladder.joinQueue(pairing.first.id, true, clock);
  clock += 121_000;
  const later = await ladder.joinQueue(pairing.second.id, true, clock);
  assert.equal(later.waiting, true);
  await ladder.leaveQueue(pairing.second.id);
  await records.friendAction(pairing.first.id, 'blockFriend', pairing.friendId);
  await ladder.joinQueue(pairing.first.id, true, clock);
  assert.equal((await ladder.joinQueue(pairing.second.id, true, clock)).waiting, true);
});

test('a queued player accepting a friend invite can enter only one concurrent ranked game', async () => {
  const pairing = await pair('QueueInvite'), newcomer = await account('QueueJoiner');
  const invited = await ladder.invite(pairing.first.id, pairing.friendId, true, clock);
  await ladder.joinQueue(pairing.second.id, true, clock);
  const [accept, join] = await Promise.all([
    post(pairing.second, { action: 'accept', matchId: invited.id, consent: true }),
    post(newcomer, { action: 'joinQueue', consent: true }),
  ]);
  assert.ok([200, 409].includes(accept.status), JSON.stringify(accept.data));
  assert.equal(join.status, 200, JSON.stringify(join.data));
  const active = await db.query<{ id: string }>("SELECT id FROM ladder_matches WHERE state='active' AND (first_user=$1 OR second_user=$1)", [pairing.second.id]);
  assert.equal(active.rows.length, 1);
  assert.equal((await ladder.snapshot(pairing.second.id, clock)).player.activeMatchId, active.rows[0].id);
  assert.equal((await db.query('SELECT user_id FROM ladder_queue WHERE user_id=$1', [pairing.second.id])).rows.length, 0);
});

test('authoritative lowest full-game score wins; concurrent completion and replay rate once', async () => {
  const pairing = await pair('Final'), match = await start(pairing);
  const { room, ended } = await finalFixture(match.roomCode!, 100, 5);
  assert.equal(ended.result!.winnerId, ended.players[0].id, 'First player goes out.');
  const attempts = await Promise.all([rooms.save(ended, room.version, undefined, { membershipUnchanged: true }), rooms.save(structuredClone(ended), room.version, undefined, { membershipUnchanged: true })]);
  assert.equal(attempts.filter(Boolean).length, 1);
  const first = (await ladder.snapshot(pairing.first.id)).player, second = (await ladder.snapshot(pairing.second.id)).player;
  assert.equal(first.rating, 984); assert.equal(second.rating, 1016);
  assert.equal(first.ratedGames, 1); assert.equal(second.ratedGames, 1);
  assert.equal((await ladder.match(pairing.first.id, match.id)).result!.result, 'loss');
  const replay = structuredClone(ended); replay.version++;
  assert.equal(await rooms.save(replay, ended.version, undefined, { membershipUnchanged: true }), true);
  assert.equal((await ladder.snapshot(pairing.first.id)).player.ratedGames, 1);
  assert.equal((await db.query('SELECT * FROM ladder_results WHERE match_id=$1', [match.id])).rows.length, 1);
});

test('tied full-game totals share the result and neither rating changes', async () => {
  const pairing = await pair('Tie'), match = await start(pairing);
  const { room, ended } = await finalFixture(match.roomCode!, 10, 5);
  await rooms.save(ended, room.version, undefined, { membershipUnchanged: true });
  const result = await ladder.match(pairing.first.id, match.id);
  assert.equal(result.result!.result, 'tie'); assert.equal(result.result!.ratingDelta, 0);
  const own = (await ladder.snapshot(pairing.first.id)).player;
  assert.equal(own.rating, 1000); assert.equal(own.ratedGames, 1);
});

test('failed rating persistence rolls back the final card and evidence together', async () => {
  const pairing = await pair('Rollback'), match = await start(pairing);
  const { room, ended } = await finalFixture(match.roomCode!);
  await db.query(`CREATE FUNCTION reject_ladder_fixture() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'synthetic ladder persistence failure'; END; $$ LANGUAGE plpgsql`);
  await db.query('CREATE TRIGGER reject_ladder_fixture BEFORE INSERT ON ladder_results FOR EACH ROW EXECUTE FUNCTION reject_ladder_fixture()');
  await assert.rejects(rooms.save(ended, room.version, undefined, { membershipUnchanged: true }), /synthetic ladder persistence/);
  await db.query('DROP TRIGGER reject_ladder_fixture ON ladder_results'); await db.query('DROP FUNCTION reject_ladder_fixture()');
  const saved = (await rooms.load(room.code))!;
  assert.equal(saved.version, room.version); assert.equal(saved.room.status, 'playing');
  assert.equal((await ladder.snapshot(pairing.first.id)).player.ratedGames, 0);
  assert.ok(ended.records!.events.length > 0);
  assert.equal(await rooms.save(ended, room.version, undefined, { membershipUnchanged: true }), true);
});

test('forged game or account ownership cannot transfer a rating result', async () => {
  const pairing = await pair('Ownership'), match = await start(pairing), outsider = await account('ForgedSeat');
  const { room, ended } = await finalFixture(match.roomCode!);
  await db.query('DELETE FROM room_memberships WHERE room_code=$1 AND user_id=$2', [room.code, pairing.first.id]);
  await db.query('INSERT INTO room_memberships(room_code,user_id,player_id) VALUES($1,$2,$3)', [room.code, outsider.id, room.players[0].id]);
  await assert.rejects(rooms.save(ended, room.version, undefined, { membershipUnchanged: true }), /account seats changed/);
  assert.equal((await rooms.load(room.code))!.version, room.version);
  assert.equal((await ladder.snapshot(pairing.first.id)).player.ratedGames, 0);
  assert.equal((await post(outsider, { action: 'forfeit', matchId: match.id, userId: pairing.first.id })).status, 404);
  assert.equal((await post(pairing.first, { action: 'finish', matchId: match.id, scores: [0, 999] })).status, 400);
});

test('explicit forfeit is owned, atomic and idempotent', async () => {
  const pairing = await pair('Forfeit'), match = await start(pairing), outsider = await account('ForfeitOut');
  assert.equal((await post(outsider, { action: 'forfeit', matchId: match.id })).status, 404);
  const [left, right] = await Promise.all([post(pairing.first, { action: 'forfeit', matchId: match.id }), post(pairing.first, { action: 'forfeit', matchId: match.id })]);
  assert.equal(left.status, 200, JSON.stringify(left.data)); assert.equal(right.status, 200, JSON.stringify(right.data));
  assert.equal(left.data.match.result.result, 'loss'); assert.equal(left.data.match.state, 'forfeited');
  assert.equal((await ladder.snapshot(pairing.first.id)).player.ratedGames, 1);
  assert.equal((await ladder.snapshot(pairing.first.id)).player.activeMatchId, null);
  const saved = (await rooms.load(match.roomCode!))!;
  assert.equal(saved.room.status, 'finished'); assert.equal(saved.room.result, null);
  assert.equal((await records.allEvidence(pairing.first.id))[0].status, 'abandoned');
  assert.equal((await records.allEvidence(pairing.second.id))[0].status, 'service-interrupted');
});

test('absence claims require five minutes of continuous claimant presence; both disconnecting never auto-loses', async () => {
  const pairing = await pair('Presence'), match = await start(pairing);
  assert.equal((await post(pairing.first, { action: 'claimForfeit', matchId: match.id })).status, 409);
  for (let step = 1; step <= 5; step++) { clock = NOW + step * 60_000; await ladder.heartbeat(pairing.first.id, match.id, clock); }
  const allowed = await post(pairing.first, { action: 'claimForfeit', matchId: match.id });
  assert.equal(allowed.status, 200, JSON.stringify(allowed.data)); assert.equal(allowed.data.match.result.result, 'win');
  const another = await pair('BothAway'), game = await start(another);
  clock += 2 * 3_600_000;
  assert.equal((await ladder.snapshot(another.first.id, clock)).player.ratedGames, 0);
  assert.equal((await post(another.first, { action: 'claimForfeit', matchId: game.id })).status, 409);
  await ladder.heartbeat(another.first.id, game.id, clock);
  assert.equal((await post(another.first, { action: 'claimForfeit', matchId: game.id })).status, 409);
  const returned = clock;
  for (let step = 1; step <= 5; step++) { clock = returned + step * 60_000; await ladder.heartbeat(another.first.id, game.id, clock); }
  assert.equal((await post(another.first, { action: 'claimForfeit', matchId: game.id })).status, 200);
});

test('only the verified Google owner voids a confirmed service failure; player claims do not', async () => {
  const pairing = await pair('Service'), match = await start(pairing);
  assert.equal((await post(pairing.first, { action: 'voidMatch', matchId: match.id, reason: 'Private incident report for synthetic outage.' })).status, 403);
  const spoof = { ...pairing.first, email: 'dan@ibdcollective.net' };
  assert.equal((await post(spoof, { action: 'voidMatch', matchId: match.id, reason: 'Private incident report for synthetic outage.' })).status, 403);
  const owner = await account('OwnerAdmin', 'dan@ibdcollective.net');
  await db.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [owner.id]);
  assert.equal((await post(owner, { action: 'voidMatch', matchId: match.id, reason: 'Private incident report for synthetic outage.' })).status, 403);
  await db.query('INSERT INTO "account"(id,"accountId","providerId","userId") VALUES($1,$2,$3,$4)', [crypto.randomUUID(), crypto.randomUUID(), 'google', owner.id]);
  const result = await post(owner, { action: 'voidMatch', matchId: match.id, reason: 'Private incident report for synthetic outage.' });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  const final = await ladder.match(pairing.first.id, match.id);
  assert.equal(final.state, 'void'); assert.equal(final.result!.rated, false);
  assert.equal((await ladder.snapshot(pairing.first.id)).player.ratedGames, 0);
  assert.equal((await records.allEvidence(pairing.second.id))[0].status, 'service-interrupted');
  assert.ok(!JSON.stringify(final).includes('Private incident report'));
});

test('same-pair farming counts at most two games each Sydney day', async () => {
  const pairing = await pair('PairCap');
  let secondRating = 1000;
  for (let index = 0; index < 3; index++) {
    const match = await start(pairing);
    const ended = await post(pairing.first, { action: 'forfeit', matchId: match.id });
    assert.equal(ended.status, 200, JSON.stringify(ended.data));
    assert.equal(ended.data.match.result.rated, index < 2);
    if (index === 1) secondRating = (await ladder.snapshot(pairing.second.id)).player.rating;
  }
  assert.equal((await ladder.snapshot(pairing.first.id)).player.ratedGames, 2);
  assert.equal((await ladder.snapshot(pairing.second.id)).player.rating, secondRating);
  clock += 86_400_000;
  const nextDay = await start(pairing);
  assert.equal((await post(pairing.first, { action: 'forfeit', matchId: nextDay.id })).data.match.result.rated, true);
  assert.equal((await ladder.snapshot(pairing.first.id)).player.ratedGames, 3);
});

test('account deletion cascades ranked data and closes the opponent game without a penalty or rating change', async () => {
  const pairing = await pair('Delete'), match = await start(pairing);
  const otherBefore = (await ladder.snapshot(pairing.second.id)).player;
  await db.query('DELETE FROM "user" WHERE id=$1', [pairing.first.id]);
  assert.equal((await db.query('SELECT * FROM ladder_matches WHERE id=$1', [match.id])).rows.length, 0);
  assert.equal((await db.query('SELECT * FROM ladder_players WHERE user_id=$1', [pairing.first.id])).rows.length, 0);
  assert.equal(await rooms.load(match.roomCode!), null);
  const other = (await ladder.snapshot(pairing.second.id)).player;
  assert.equal(other.rating, otherBefore.rating); assert.equal(other.ratedGames, 0); assert.equal(other.activeMatchId, null);
  assert.equal((await records.allEvidence(pairing.second.id))[0].status, 'service-interrupted');
});

test('existing room API enforces ranked settings and protects deletion while social games stay ordinary', async () => {
  const pairing = await pair('Guards'), match = await start(pairing);
  const API = roomApi(pairing.first);
  const before = (await rooms.load(match.roomCode!))!;
  for (const action of [{ type: 'addBot', difficulty: 'easy' }, { type: 'setMoveHints', enabled: true }, { type: 'setGame', game: 2 }, { type: 'setTurnLimit', seconds: 0 }, { type: 'rematch' }]) {
    const rejected = await response(API.actionRoomRequest(request(pairing.first, { action, requestId: crypto.randomUUID() }), match.roomCode!));
    assert.ok([400, 403, 409].includes(rejected.status), JSON.stringify(rejected.data));
  }
  const deleted = await response(API.deleteRoomRequest(request(pairing.first, { expectedVersion: before.version }), match.roomCode!));
  assert.equal(deleted.status, 409);
  assert.equal((await rooms.load(match.roomCode!))!.version, before.version);
  const read = await response(API.readRoomRequest(request(pairing.first), match.roomCode!));
  assert.equal(read.status, 200); assert.equal(read.data.room.hand.length, 10);
  const drawn = await response(API.actionRoomRequest(request(pairing.first, { action: { type: 'draw', source: 'stock' }, requestId: crypto.randomUUID() }), match.roomCode!));
  assert.equal(drawn.status, 200, JSON.stringify(drawn.data));
  assert.equal(drawn.data.room.hand.length, 11);
  assert.equal((await rooms.load(match.roomCode!))!.room.records!.current[before.room.players[0].id].timeline.at(-1)!.kind, 'draw');
  const created = await response(API.createRoomRequest(request(pairing.first, { name: 'Ordinary table' })));
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.room.ranked, undefined);
  const saved = (await rooms.load(created.data.room.code))!;
  await db.transaction(async connection => { await processRankedRoom(connection, saved.room); });
  assert.equal((await ladder.snapshot(pairing.first.id)).player.ratedGames, 0);
});

test('ranked invitation probes use real request limits and return retry guidance', async () => {
  const user = await account('Limits');
  let result: Awaited<ReturnType<typeof post>> | undefined;
  for (let attempt = 0; attempt < 16; attempt++) result = await post(user, { action: 'invite', friendId: crypto.randomUUID(), consent: true });
  assert.equal(result!.status, 429);
  assert.ok(Number(result!.headers.get('Retry-After')) > 0);
});
