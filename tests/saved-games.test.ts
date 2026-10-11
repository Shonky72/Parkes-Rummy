import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Node's native TypeScript runner requires the explicit file extension.
import { backgroundGameAction, formatLastMove, mergeGameSummaries, reconcileSavedGameSeats, splitSavedGames, summaryFromRoom } from '../lib/saved-games.ts';
import type { PublicPlayer, PublicRoom, RoomSummary, RoomSummaryResult } from '../lib/types';
import type { SavedGameEntry } from '../lib/saved-games';

const player = (id: string, name: string, extra: Partial<PublicPlayer> = {}): PublicPlayer => ({
  id, name, color: 0, handCount: 10, score: 25, ruleNumber: 2, down: false,
  completedTurns: 0, laidDownTurn: null, isBot: false, difficulty: 'medium', ready: true, ...extra,
});
function room(extra: Partial<PublicRoom> = {}): PublicRoom {
  return {
    code: 'ABCD', hostId: 'own-seat', youId: 'own-seat', game: 1, round: 4, status: 'playing',
    players: [player('own-seat', 'Dan'), player('other-seat', 'Karen', { color: 1, ruleNumber: 3 })],
    hand: [{ id: 'private-card-identity', rank: 13, suit: 'H' }], melds: [],
    currentRule: { number: 2, title: 'Current rule', description: 'Current requirement', requirements: [] },
    turnPlayerId: 'own-seat', phase: 'draw', turnNumber: 3, stockCount: 40, discard: null,
    turnLimitSeconds: 30, turnDeadline: 40_000, result: null, history: [],
    events: [{ id: 1, type: 'draw', text: 'Drew a card', at: 10_000 }],
    version: 5, updatedAt: 10_100, lastMoveAt: 10_000, botDueAt: 0, ...extra,
  };
}
const summary = (extra: Partial<RoomSummary> = {}): RoomSummary => ({ ...summaryFromRoom(room()), ...extra });
const success = (value: RoomSummary): RoomSummaryResult => ({ code: value.code, status: 200, summary: value });
const entry = (value: RoomSummary): SavedGameEntry => ({ code: value.code, summary: value });
const failure = (code: string, status: 400 | 401 | 403 | 404 | 500 | 503): RoomSummaryResult => ({ code, status, error: `Failure ${status}` });

test('saved-game metadata reflects each game and player without carrying private cards', () => {
  for (const game of [1, 2, 3] as const) {
    const publicRoom = room({ game });
    const before = structuredClone(publicRoom);
    const own = summaryFromRoom(publicRoom);
    assert.equal(own.game, game);
    assert.equal(own.yourRuleNumber, 2);
    assert.equal(own.round, 4);
    assert.equal(own.yourPlayerId, 'own-seat');
    assert.equal(own.yourName, 'Dan');
    assert.equal(own.hostName, 'Dan');
    assert.equal(own.isHost, true);
    assert.deepEqual(own.playerNames, ['Dan', 'Karen']);
    assert.equal(own.playerCount, 2);
    assert.equal(own.turnPlayerId, 'own-seat');
    assert.equal(own.turnPlayerName, 'Dan');
    assert.equal(own.isYourTurn, true);
    assert.equal(own.lastMoveAt, 10_000);
    assert.equal(own.updatedAt, 10_100);
    for (const key of ['hand', 'melds', 'stock', 'events', 'history', 'token', 'tokenHash']) assert.equal(Object.hasOwn(own, key), false);
    assert.equal(JSON.stringify(own).includes('private-card-identity'), false);
    assert.deepEqual(publicRoom, before);
  }
});

test('host status follows the authorized seat identity, including equal player names and host changes', () => {
  assert.equal(summaryFromRoom(room()).isHost, true);
  const otherHost = room({ hostId: 'other-seat', players: [player('own-seat', 'Dan'), player('other-seat', 'Dan')] });
  assert.equal(summaryFromRoom(otherHost).isHost, false);
  assert.equal(summaryFromRoom({ ...otherHost, youId: 'other-seat' }).isHost, true);
});

test('a finished-only collection has zero active games and keeps every finished entry', () => {
  const finished = [entry(summary({ status: 'finished', isYourTurn: false })), entry(summary({ code: 'EFGH', status: 'finished', isYourTurn: false }))];
  const result = splitSavedGames(finished);
  assert.deepEqual(result.active, []);
  assert.deepEqual(result.finished, finished);
  assert.deepEqual(splitSavedGames([]), { active: [], finished: [] });
});

test('a completed hand remains active while only fully finished games move to the archive', () => {
  const playing = entry(summary({ code: 'PLAY' }));
  const roundEnd = entry(summary({ code: 'HAND', status: 'round-end', isYourTurn: false }));
  const lobby = entry(summary({ code: 'LOBB', status: 'lobby', isYourTurn: false }));
  const finished = entry(summary({ code: 'DONE', status: 'finished', isYourTurn: false }));
  const pending = { code: 'WAIT' };
  const unavailable = { code: 'GONE', unavailable: true, stale: true, error: 'Missing seat' };
  const result = splitSavedGames([playing, finished, roundEnd, lobby, pending, unavailable]);
  assert.deepEqual(result.active, [playing, roundEnd, lobby, pending, unavailable]);
  assert.deepEqual(result.finished, [finished]);
});

test('stale and unavailable finished rows stay archived until fresh metadata reports a new game', () => {
  const finished = entry(summary({ status: 'finished', isYourTurn: false }));
  for (const status of [401, 404, 500, 503] as const) {
    const failed = mergeGameSummaries([finished], [failure('ABCD', status)], ['ABCD']);
    const result = splitSavedGames(failed);
    assert.equal(result.active.length, 0);
    assert.equal(result.finished.length, 1);
    assert.equal(result.finished[0].stale, true);
    assert.equal(result.finished[0].error, `Failure ${status}`);
  }
});

test('an accepted rematch returns its lobby to the active list and older finished polls do not rearchive it', () => {
  const finished = summary({ status: 'finished', isYourTurn: false, version: 30 });
  const rematch = summary({ status: 'lobby', isYourTurn: false, round: 1, yourRuleNumber: 1, lastMoveAt: null, version: 31 });
  const reopened = mergeGameSummaries([entry(finished)], [success(rematch)], ['ABCD']);
  const result = splitSavedGames(reopened);
  assert.deepEqual(result.finished, []);
  assert.equal(result.active[0].summary?.status, 'lobby');
  const delayed = splitSavedGames(mergeGameSummaries(reopened, [success(finished)], ['ABCD']));
  assert.deepEqual(delayed, result);
});

test('splitting saved games preserves row identity and ordering without mutating the input', () => {
  const rows = [entry(summary({ code: 'AAAA', status: 'finished' })), entry(summary({ code: 'BBBB', status: 'round-end' })), entry(summary({ code: 'CCCC', status: 'finished' })), entry(summary({ code: 'DDDD', status: 'playing' }))];
  const before = structuredClone(rows);
  Object.freeze(rows);
  rows.forEach(Object.freeze);
  const result = splitSavedGames(rows);
  assert.deepEqual(rows, before);
  assert.equal(result.finished[0], rows[0]);
  assert.equal(result.finished[1], rows[2]);
  assert.equal(result.active[0], rows[1]);
  assert.equal(result.active[1], rows[3]);
  assert.notEqual(result.active, rows);
  assert.notEqual(result.finished, rows);
});

test('summary fallback uses gameplay timestamps, respects a rematch reset and clamps legacy rule numbers', () => {
  const events: PublicRoom['events'] = [
    { id: 1, type: 'start', text: 'Dealt', at: 1000 },
    { id: 2, type: 'discard', text: 'Played', at: 2000 },
    { id: 3, type: 'settings', text: 'Setting changed', at: 3000 },
    { id: 4, type: 'join', text: 'Joined', at: 4000 },
  ];
  const legacy = room({ events, updatedAt: undefined, lastMoveAt: undefined, currentRule: undefined,
    round: 13, players: [player('own-seat', 'Dan', { ruleNumber: undefined })] });
  assert.equal(summaryFromRoom(legacy).lastMoveAt, 2000);
  assert.equal(summaryFromRoom(legacy).updatedAt, 4000);
  assert.equal(summaryFromRoom(legacy).yourRuleNumber, 10);
  assert.equal(summaryFromRoom({ ...legacy, status: 'lobby' }).yourRuleNumber, 1);
  assert.equal(summaryFromRoom({ ...legacy, lastMoveAt: null }).lastMoveAt, null);
  assert.equal(summaryFromRoom({ ...legacy, events: [events[2], events[3]] }).lastMoveAt, null);
  assert.equal(summaryFromRoom({ ...legacy, lastMoveAt: 5000 }).lastMoveAt, 5000);
});

test('inactive summaries clear turn and bot scheduling metadata while active bot turns retain deadlines', () => {
  const publicRoom = room({ players: [player('own-seat', 'Dan'), player('other-seat', 'Alex', { isBot: true })],
    turnPlayerId: 'other-seat', botDueAt: 12_000 });
  const bot = summaryFromRoom(publicRoom);
  assert.equal(bot.currentPlayerIsBot, true);
  assert.equal(bot.botDueAt, 12_000);
  assert.equal(bot.turnDeadline, 40_000);
  assert.equal(bot.isYourTurn, false);
  for (const status of ['lobby', 'round-end', 'finished'] as const) {
    const inactive = summaryFromRoom({ ...publicRoom, status });
    assert.equal(inactive.turnPlayerId, null);
    assert.equal(inactive.turnPlayerName, null);
    assert.equal(inactive.isYourTurn, false);
    assert.equal(inactive.currentPlayerIsBot, false);
    assert.equal(inactive.botDueAt, 0);
    assert.equal(inactive.turnDeadline, null);
  }
  const human = summaryFromRoom({ ...publicRoom, turnPlayerId: 'own-seat' });
  assert.equal(human.currentPlayerIsBot, false);
  assert.equal(human.botDueAt, 0);
});

test('changing saved credentials clears the old player metadata without touching other games', () => {
  const own = entry(summary());
  const other = entry(summary({ code: 'EFGH', yourPlayerId: 'other-table-seat' }));
  const oldSeats = { ABCD: 'old-token', EFGH: 'stable-token', JKLM: 'forgotten-token' };
  const newSeats = { ABCD: 'new-token', EFGH: 'stable-token', NPQR: 'added-token' };
  const previous = [own, other, entry(summary({ code: 'JKLM' }))];
  const before = structuredClone(previous);
  const result = reconcileSavedGameSeats(previous, oldSeats, newSeats);
  assert.deepEqual(result.find(value => value.code === 'ABCD'), { code: 'ABCD' });
  assert.deepEqual(result.find(value => value.code === 'EFGH'), other);
  assert.deepEqual(result.find(value => value.code === 'NPQR'), { code: 'NPQR' });
  assert.equal(result.some(value => value.code === 'JKLM'), false);
  assert.equal(JSON.stringify(result).includes('token'), false, 'Saved credentials must stay outside display entries');
  assert.deepEqual(previous, before);
});

test('older room polls preserve newer metadata but a new seat accepts its own lower version', () => {
  const recent = summary({ version: 20, lastMoveAt: 20_000, isYourTurn: true });
  const earlier = summary({ version: 19, lastMoveAt: 19_000, isYourTurn: false });
  assert.deepEqual(mergeGameSummaries([entry(recent)], [success(earlier)], ['ABCD']), [entry(recent)]);
  const newSeat = summary({ yourPlayerId: 'new-seat', yourName: 'New player', version: 1, lastMoveAt: null, status: 'lobby', isYourTurn: false });
  const result = mergeGameSummaries([entry(recent)], [success(newSeat)], ['ABCD']);
  assert.equal(result[0].summary?.yourPlayerId, 'new-seat');
  assert.equal(result[0].summary?.version, 1);
  assert.equal(result[0].summary?.yourName, 'New player');
});

test('obsolete errors never override a newer active-table response during a summary poll', () => {
  const baseline = [entry(summary({ version: 5 }))];
  const changed = [entry(summary({ version: 6 }))];
  for (const status of [403, 404, 500, 503] as const) {
    assert.deepEqual(mergeGameSummaries(changed, [failure('ABCD', status)], ['ABCD'], baseline), changed);
  }
  const newerSeat = [entry(summary({ yourPlayerId: 'new-seat', version: 1 }))];
  assert.deepEqual(mergeGameSummaries(newerSeat, [failure('ABCD', 403)], ['ABCD'], baseline), newerSeat);
  assert.deepEqual(mergeGameSummaries(changed, [failure('ABCD', 503)], ['ABCD'], []), changed);
  const currentError = mergeGameSummaries(baseline, [failure('ABCD', 403)], ['ABCD'], baseline)[0];
  assert.equal(currentError.unavailable, true, 'A current authorization failure is still shown');
});

test('transient errors retain the last known row and successful refreshes clear the warning', () => {
  const previous = [entry(summary())];
  for (const status of [500, 503] as const) {
    const failed = mergeGameSummaries(previous, [failure('ABCD', status)], ['ABCD']);
    assert.deepEqual(failed[0].summary, previous[0].summary);
    assert.equal(failed[0].stale, true);
    assert.equal(failed[0].unavailable, false);
    const restored = mergeGameSummaries(failed, [success(summary())], ['ABCD']);
    assert.equal(restored[0].stale, false);
    assert.equal(restored[0].error, undefined);
    assert.equal(restored[0].unavailable, undefined);
  }
  for (const status of [400, 401, 403, 404] as const) {
    const failed = mergeGameSummaries(previous, [failure('ABCD', status)], ['ABCD']);
    assert.equal(failed[0].unavailable, true);
    assert.equal(failed[0].code, 'ABCD', 'Unavailable games remain reviewable until explicitly removed');
  }
  const other = summary({ code: 'EFGH', version: 1, isYourTurn: false });
  const mixed = mergeGameSummaries([...previous, entry(other)], [failure('ABCD', 500), success({ ...other, version: 2 })], ['ABCD', 'EFGH']);
  assert.equal(mixed.find(value => value.code === 'EFGH')?.summary?.version, 2, 'One failed batch must not discard successful metadata from another');
  assert.equal(mixed.find(value => value.code === 'ABCD')?.stale, true);
});

test('summary merges keep only saved codes, deduplicate rows and prioritise the player’s turn', () => {
  const waiting = summary({ code: 'WAIT', isYourTurn: false, lastMoveAt: 90_000 });
  const own = summary({ code: 'YOUR', isYourTurn: true, lastMoveAt: 10_000 });
  const later = summary({ code: 'NEXT', isYourTurn: false, lastMoveAt: 100_000 });
  const lobby = summary({ code: 'LOBB', status: 'lobby', isYourTurn: false, lastMoveAt: null });
  const result = mergeGameSummaries([entry(summary({ code: 'GONE' }))], [success(waiting), success(own), success(later), success(lobby), success(summary({ code: 'DROP' }))], ['WAIT', 'YOUR', 'YOUR', 'NEXT', 'LOBB']);
  assert.deepEqual(result.map(value => value.code), ['YOUR', 'NEXT', 'WAIT', 'LOBB']);
});

test('background scheduling only requests due computer steps or expired turns', () => {
  const human = summary({ currentPlayerIsBot: false, turnDeadline: null });
  assert.equal(backgroundGameAction(human, 1_000_000), null);
  assert.equal(backgroundGameAction({ ...human, isYourTurn: false }, 1_000_000), null);
  const bot = summary({ currentPlayerIsBot: true, botDueAt: 10_000, turnDeadline: null });
  assert.equal(backgroundGameAction(bot, 10_079), null);
  const step = backgroundGameAction(bot, 10_080);
  assert.deepEqual(step?.action, { type: 'botStep' });
  assert.equal(step?.requestId, 'bot-ABCD-4-3-5');
  assert.deepEqual(backgroundGameAction(bot, 10_080), step, 'Repeated scheduling uses the same idempotency key');
  const timed = { ...bot, turnDeadline: 10_000 };
  assert.deepEqual(backgroundGameAction(timed, 10_099)?.action, { type: 'botStep' });
  assert.deepEqual(backgroundGameAction(timed, 10_100)?.action, { type: 'timeout' });
  assert.equal(backgroundGameAction(timed, 10_100)?.requestId, 'timeout-ABCD-4-3-5');
  assert.deepEqual(backgroundGameAction({ ...human, turnDeadline: 10_000 }, 10_100)?.action, { type: 'timeout' });
  for (const status of ['lobby', 'round-end', 'finished'] as const) assert.equal(backgroundGameAction({ ...timed, status }, 1_000_000), null);
  for (const [key, value] of [['code', 'EFGH'], ['round', 5], ['turnNumber', 4], ['version', 6]] as const) {
    assert.notEqual(backgroundGameAction({ ...bot, [key]: value }, 10_080)?.requestId, step?.requestId);
  }
});

test('last-move labels cover missing timestamps, clock skew and elapsed periods', () => {
  assert.equal(formatLastMove(null, 1000), 'No move recorded');
  assert.equal(formatLastMove(NaN, 1000), 'No move recorded');
  assert.equal(formatLastMove(1001, 1000), 'Moments ago');
  assert.equal(formatLastMove(1000, 10_999), 'Moments ago');
  assert.equal(formatLastMove(1000, 11_000), '10s ago');
  assert.equal(formatLastMove(1000, 61_000), '1 min ago');
  assert.equal(formatLastMove(1000, 3_601_000), '1 hour ago');
  assert.equal(formatLastMove(1000, 7_201_000), '2 hours ago');
  assert.equal(formatLastMove(1000, 86_401_000), '1 day ago');
  assert.equal(formatLastMove(1000, 172_801_000), '2 days ago');
});
