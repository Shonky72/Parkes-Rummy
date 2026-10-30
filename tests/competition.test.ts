import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlayer, publicRoom as socialPublicRoom } from '../lib/rummy';
import {
  applyChallengeAction, challengeVersionSupported, createChallengeRoom, frozenChallengeRule, publicChallengeRoom,
  validateChallengeConfig,
} from '../lib/challenge-engine/v1';
import { createFrozenEngine } from '../lib/challenge-engine/v1/rummy';
import { createSeededRuntime } from '../lib/challenge-engine/v1/runtime';
import {
  calculateElo, challengePoints, compareChallengeScores, compareChallengeTotals, competitionCalendar,
  consistencyBoard, LADDER_FORMAT, newLadderPlayer, rateHumanLadder, ratedPairDayKey, rankWithTies,
  ruleOfTheWeek, shiftCalendarDay, sydneyDayBounds, sydneyDayKey, sydneyWeekKey, threeDealTotal,
  totalChallengeScores, weeklyBestFive,
} from '../lib/competition';
import { CHALLENGE_ENGINE_VERSION } from '../lib/competition-types';
import type {
  ChallengeConfig, ChallengeRoom, ChallengeScore, ConsistencyAttempt, DailyChallengeResult, LadderEligibility,
} from '../lib/competition-types';
import type { GameAction } from '../lib/types';

const NOW = Date.parse('2026-10-20T02:00:00.000Z');
const CONFIG: ChallengeConfig = {
  id: 'synthetic-deal-a', engineVersion: CHALLENGE_ENGINE_VERSION, seed: 'private-synthetic-seed-00000000001',
  game: 1, ruleNumber: 1, humanSeat: 0, startingSeat: 0, difficulties: ['easy', 'medium'], showMoveHints: false,
};
const human = (id = 'synthetic-human') => createPlayer({ id, name: 'Synthetic Player', tokenHash: 'synthetic-seat-secret', color: 0 });
const create = (config: ChallengeConfig = CONFIG, id = 'synthetic-human') => createChallengeRoom(config, 'SYNT', human(id), { now: NOW });
const frozen = createFrozenEngine(createSeededRuntime('synthetic-policy-source-0000000001', 0, NOW));
function publicGameplay(room: ChallengeRoom): ReturnType<typeof publicChallengeRoom> {
  // Public comparisons use the actual JSON wire shape, including optional fields.
  const view = JSON.parse(JSON.stringify(publicChallengeRoom(room, room.challenge.humanPlayerId))) as ReturnType<typeof publicChallengeRoom>;
  // Completion IDs identify each attempt's evidence, not the deterministic deal.
  for (const completion of [view.completedRecord, view.completedPlay]) {
    if (!completion) continue;
    assert.equal(completion.handId, room.records!.current[room.challenge.humanPlayerId].handId);
    assert.equal(completion.handId, room.records!.handId);
    completion.handId = 'synthetic-per-attempt-record';
  }
  return view;
}
function nextPolicyAction(room: ChallengeRoom): GameAction {
  if (room.turnPlayerId !== room.challenge.humanPlayerId) return { type: 'botStep' };
  return frozen.chooseBotAction(publicGameplay(room), 'medium');
}

test('frozen challenge deck, card IDs, AI decisions and reconnect trajectory reproduce', () => {
  let first = create();
  let second = create();
  const initial = structuredClone(first);
  assert.deepEqual(publicGameplay(first), publicGameplay(second));
  assert.deepEqual(first.stock, second.stock);
  let actions = 0;
  for (; actions < 140 && first.status === 'playing'; actions++) {
    const action = nextPolicyAction(first);
    first = applyChallengeAction(first, first.challenge.humanPlayerId, action, NOW + actions * 1000);
    // Serialised storage roundtrip must be sufficient to resume all RNG state.
    second = JSON.parse(JSON.stringify(second)) as ChallengeRoom;
    second = applyChallengeAction(second, second.challenge.humanPlayerId, action, NOW + actions * 1000);
    assert.deepEqual(publicGameplay(first), publicGameplay(second), `Action ${actions}: ${action.type}`);
    assert.deepEqual(first.stock, second.stock);
    assert.equal(first.challenge.randomCursor, second.challenge.randomCursor);
  }
  assert.ok(actions >= 10, 'Exercise a meaningful multi-turn trajectory.');
  for (const room of [first, second]) {
    assert.equal(room.status, 'finished', 'Exercise the completion projections.');
    const view = publicGameplay(room);
    assert.ok(view.completedRecord, 'The finished attempt exposes its record.');
    assert.ok(view.completedPlay, 'The finished attempt exposes its play completion.');
  }
  assert.notEqual(first.records!.handId, second.records!.handId, 'Independent attempts retain distinct hand IDs.');
  assert.equal(initial.challenge.randomCursor, create().challenge.randomCursor, 'Saved input was not mutated.');
});

test('different choices produce their own repeatable path and scoped entropy does not alter globals', () => {
  const originalRandom = Math.random;
  const originalCrypto = globalThis.crypto.getRandomValues;
  const originalUuid = globalThis.crypto.randomUUID;
  const room = create();
  const stock = applyChallengeAction(room, 'synthetic-human', { type: 'draw', source: 'stock' }, NOW + 1000);
  const discard = applyChallengeAction(room, 'synthetic-human', { type: 'draw', source: 'discard' }, NOW + 1000);
  assert.notDeepEqual(stock.players[0].hand, discard.players[0].hand);
  assert.deepEqual(publicGameplay(stock), publicGameplay(applyChallengeAction(create(), 'synthetic-human', { type: 'draw', source: 'stock' }, NOW + 1000)));
  assert.deepEqual(publicGameplay(discard), publicGameplay(applyChallengeAction(create(), 'synthetic-human', { type: 'draw', source: 'discard' }, NOW + 1000)));
  assert.equal(Math.random, originalRandom);
  assert.equal(globalThis.crypto.getRandomValues, originalCrypto);
  assert.equal(globalThis.crypto.randomUUID, originalUuid);
  assert.notDeepEqual(create({ ...CONFIG, seed: 'private-synthetic-seed-00000000002' }).stock.map(card => [card.rank, card.suit]), room.stock.map(card => [card.rank, card.suit]));
});

test('the same fixed seat receives the same cards across account names and room instances', () => {
  const config = { ...CONFIG, humanSeat: 1, startingSeat: 2 };
  const first = create(config, 'friend-one');
  const second = create(config, 'friend-two');
  assert.deepEqual(first.players[1].hand, second.players[1].hand);
  assert.deepEqual(first.stock, second.stock);
  assert.equal(first.turnPlayerId, first.players[2].id);
  assert.equal(first.players[1].isBot, false);
  assert.deepEqual(first.players.filter(player => player.isBot).map(player => player.difficulty), config.difficulties);
  assert.equal(first.turnLimitSeconds, 0);
  assert.equal(first.records!.current['friend-one'].conditions.engineVersion, CHALLENGE_ENGINE_VERSION);
  assert.equal(first.records!.current['friend-one'].conditions.seat, 1);
  assert.equal(first.records!.current['friend-one'].conditions.startingSeat, 2);
  assert.ok(first.records!.events.every(event => event.evidence.conditions.startingSeat === 2));
  assert.equal(first.records!.current['friend-one'].conditions.format, 'challenge');
});

test('public views omit seeds, future stock, credentials, random counters and private observations', () => {
  const room = create();
  for (const view of [publicGameplay(room), socialPublicRoom(room, 'synthetic-human')]) {
    const json = JSON.stringify(view);
    assert.ok(!json.includes(CONFIG.seed));
    assert.ok(!json.includes('synthetic-seat-secret'));
    for (const key of ['"seed"', '"randomCursor"', '"tokenHash"', '"records"', '"stock"']) assert.ok(!json.includes(key), key);
    for (const card of room.stock.slice(0, 6)) assert.ok(!json.includes(card.id), 'Unseen future card IDs stay private.');
    for (const card of room.players[1].hand) assert.ok(!json.includes(card.id), 'AI hand stays private.');
  }
  assert.throws(() => publicChallengeRoom(room, 'another-account'), /another player/);
});

test('unknown versions fail closed and frozen challenge conditions cannot be changed', () => {
  assert.equal(challengeVersionSupported('parkes-challenge-v0'), false);
  const unknown = { ...CONFIG, engineVersion: 'parkes-challenge-v0' } as unknown as ChallengeConfig;
  assert.throws(() => create(unknown), /version is unavailable/);
  const room = create();
  room.challenge.config.engineVersion = 'parkes-challenge-v999' as typeof CHALLENGE_ENGINE_VERSION;
  assert.throws(() => applyChallengeAction(room, 'synthetic-human', { type: 'draw', source: 'stock' }), /version is unavailable/);
  assert.throws(() => applyChallengeAction(create(), 'synthetic-human', { type: 'setMoveHints', enabled: true }), /fixed/);
  assert.throws(() => applyChallengeAction(create(), 'synthetic-human', { type: 'rematch' }), /fixed/);
  assert.throws(() => applyChallengeAction(create(), 'outsider', { type: 'botStep' }), /own challenge/);
  const changed = create(); changed.players[1].difficulty = 'hard';
  assert.throws(() => applyChallengeAction(changed, 'synthetic-human', { type: 'draw', source: 'stock' }), /frozen definition/);
});

test('fixed challenge setup rejects invalid seats, rules and excess hard AI', () => {
  assert.throws(() => validateChallengeConfig({ ...CONFIG, humanSeat: 4 }), /seat/);
  assert.throws(() => validateChallengeConfig({ ...CONFIG, ruleNumber: 11 }), /complete challenge rule/);
  assert.throws(() => validateChallengeConfig({ ...CONFIG, difficulties: ['hard', 'hard'] }), /at most one Hard/);
  assert.equal(Object.values(frozen.RULES).flat().length, 40);
  assert.deepEqual(frozenChallengeRule(CONFIG), frozen.RULES[1][0]);
  const definition = frozenChallengeRule(CONFIG);
  definition.title = 'Untrusted display mutation';
  assert.equal(frozenChallengeRule(CONFIG).title, frozen.RULES[1][0].title);
  assert.throws(() => frozenChallengeRule({ ...CONFIG, engineVersion: 'unavailable-version' } as unknown as ChallengeConfig), /version is unavailable/);
});

test('a bot request finishes one bounded turn, retains evidence, and does not play the next seat', () => {
  const room = create({ ...CONFIG, humanSeat: 2, startingSeat: 0 });
  const original = structuredClone(room);
  const next = applyChallengeAction(room, 'synthetic-human', { type: 'botStep' }, NOW + 1000);
  assert.deepEqual(room, original);
  assert.equal(next.version, room.version + 1);
  assert.equal(next.turnPlayerId, next.players[1].id);
  assert.equal(next.players[0].completedTurns, 1);
  assert.equal(next.players[1].completedTurns, 0);
  assert.equal(next.players[2].completedTurns, 0);
  assert.deepEqual(next.players[2].hand, room.players[2].hand);
  assert.ok(next.records!.current[next.players[0].id].timeline.some(entry => entry.kind === 'draw'));
  assert.ok(next.records!.current[next.players[0].id].timeline.some(entry => entry.kind === 'discard'));
});

test('discard-pile replenishment consumes the persisted private stream deterministically', () => {
  const room = create();
  room.discardPile = room.stock.splice(0, 12);
  room.stock = [];
  const top = room.discardPile.at(-1)!;
  const first = applyChallengeAction(room, 'synthetic-human', { type: 'draw', source: 'stock' }, NOW + 1000);
  const second = applyChallengeAction(structuredClone(room), 'synthetic-human', { type: 'draw', source: 'stock' }, NOW + 1000);
  assert.deepEqual(first.stock, second.stock);
  assert.deepEqual(first.players[0].hand, second.players[0].hand);
  assert.deepEqual(first.discardPile, [top]);
  assert.ok(first.challenge.randomCursor > room.challenge.randomCursor);
});

test('practice replays keep the same deal while excluded from normal achievements and competition', () => {
  const scored = create();
  const practice = createChallengeRoom(CONFIG, 'SYNT', human(), { now: NOW, practice: true, attemptId: 'synthetic-practice' });
  assert.deepEqual(scored.stock, practice.stock);
  assert.deepEqual(scored.players[0].hand, practice.players[0].hand);
  assert.equal(publicGameplay(practice).challenge.practice, true);
  assert.equal(practice.records!.eligible, false);
  assert.ok(Object.values(practice.records!.current).every(record => !record.eligible));
});

test('server-assigned close time blocks late challenge actions without consuming cards', () => {
  const room = createChallengeRoom(CONFIG, 'SYNT', human(), { now: NOW, deadlineAt: NOW + 1000 });
  const prior = structuredClone(room);
  assert.equal(publicGameplay(room).challenge.deadlineAt, NOW + 1000);
  assert.throws(() => applyChallengeAction(room, 'synthetic-human', { type: 'draw', source: 'stock' }, NOW + 1000), /attempt has closed/);
  assert.deepEqual(room, prior);
});

const score = (overrides: Partial<ChallengeScore> = {}): ChallengeScore => ({
  completed: true, openingTurn: 4, wentOut: false, closingTurns: null, penalty: 20, outcome: 'completed', ...overrides,
});
const daily = (day: string, entryScore = score(), overrides: Partial<DailyChallengeResult> = {}): DailyChallengeResult => ({
  day, challengeId: `daily-${day}`, accountId: 'synthetic-account', firstAttempt: true, score: entryScore, ...overrides,
});

test('challenge ordering respects every priority and points preserve the same order', () => {
  const ordered = [
    score({ openingTurn: 2, penalty: 220 }),
    score({ openingTurn: 3, wentOut: true, closingTurns: 0, penalty: 0 }),
    score({ openingTurn: 3, wentOut: true, closingTurns: 1, penalty: 0 }),
    score({ openingTurn: 3, penalty: 0 }),
    score({ openingTurn: 3, penalty: 20 }),
    score({ openingTurn: 9_999, penalty: 220 }),
    score({ completed: false, openingTurn: null, penalty: 0 }),
    score({ completed: false, openingTurn: null, penalty: 220 }),
    score({ outcome: 'abandoned', completed: false, openingTurn: null, penalty: 0 }),
  ];
  for (let index = 1; index < ordered.length; index++) {
    assert.ok(compareChallengeScores(ordered[index - 1], ordered[index]) < 0, `Priority pair ${index}`);
    assert.ok(challengePoints(ordered[index - 1])! > challengePoints(ordered[index])!, `Points pair ${index}`);
  }
  assert.equal(challengePoints(score({ outcome: 'service-interrupted' })), null);
  assert.equal(challengePoints(score({ outcome: 'abandoned' })), -1);
  assert.ok(Number.isSafeInteger(challengePoints(score({ openingTurn: 2, wentOut: true, closingTurns: 0, penalty: 0 }))! * 7));
  assert.throws(() => challengePoints(score({ openingTurn: 1 })), /legal completed opening/);
});

test('equal results and equal weekly totals share ranks, with no device timestamp tiebreak', () => {
  const first = { name: 'A', score: score(), milliseconds: 1 };
  const second = { name: 'B', score: score(), milliseconds: 9999 };
  const third = { name: 'C', score: score({ openingTurn: 5 }), milliseconds: 0 };
  assert.equal(compareChallengeScores(first.score, second.score), 0);
  assert.deepEqual(rankWithTies([third, second, first], (a, b) => compareChallengeScores(a.score, b.score)).map(entry => entry.rank), [1, 1, 3]);
  const total = totalChallengeScores([first.score]);
  assert.equal(compareChallengeTotals(total, { ...total }), 0);
});

test('Sydney dates and Monday weeks cross midnight, year boundaries and DST correctly', () => {
  assert.equal(sydneyDayKey('2026-10-18T12:59:59Z'), '2026-10-18');
  assert.equal(sydneyDayKey('2026-10-18T13:00:00Z'), '2026-10-19');
  assert.equal(sydneyWeekKey('2026-10-18T12:59:59Z'), '2026-10-12');
  assert.equal(sydneyWeekKey('2026-10-18T13:00:00Z'), '2026-10-19');
  assert.equal(sydneyWeekKey('2027-01-01'), '2026-12-28');
  assert.equal(sydneyDayKey('2026-04-04T13:30:00Z'), '2026-04-05');
  const autumn = sydneyDayBounds('2026-04-05');
  const spring = sydneyDayBounds('2026-10-04');
  assert.equal(autumn.end - autumn.start, 25 * 60 * 60 * 1000);
  assert.equal(spring.end - spring.start, 23 * 60 * 60 * 1000);
  assert.equal(new Date(spring.start).toISOString(), '2026-10-03T14:00:00.000Z');
  assert.deepEqual(competitionCalendar('2026-10-25').weekDays, ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
  assert.equal(shiftCalendarDay('2028-02-28', 1), '2028-02-29');
  assert.throws(() => sydneyDayKey('2026-02-29'), /Invalid calendar/);
});

test('weekly best five count first attempts once, tolerate missing days, and ignore practice', () => {
  const days = competitionCalendar('2026-10-20').weekDays;
  const results = days.map((day, index) => daily(day, score({ openingTurn: index + 2 })));
  const best = weeklyBestFive(results, '2026-10-20');
  assert.equal(best.attempts, 5);
  assert.deepEqual(best.countedDays, days.slice(0, 5));
  assert.equal(best.points, totalChallengeScores(results.slice(0, 5).map(entry => entry.score)).points);
  assert.equal(weeklyBestFive([results[0], results[0]], '2026-10-20').attempts, 1);
  const practice = daily(days[5], score({ openingTurn: 2 }), { firstAttempt: false, practice: true });
  assert.equal(weeklyBestFive([...results, practice], '2026-10-20').points, best.points);
  const incomplete = weeklyBestFive([results[0], results[1]], '2026-10-20');
  assert.equal(incomplete.attempts, 2);
  assert.equal(incomplete.points, totalChallengeScores([results[0].score, results[1].score]).points);
  assert.throws(() => weeklyBestFive([results[0], daily(days[0], score({ openingTurn: 8 }))], '2026-10-20'), /More than one first/);
  assert.equal(weeklyBestFive([daily(days[0], score({ outcome: 'abandoned' }))], '2026-10-20').points, -1);
  const interrupted = daily(days[0], score({ outcome: 'service-interrupted' }));
  assert.equal(weeklyBestFive([interrupted, interrupted], '2026-10-20').serviceInterrupted, 1);
});

test('three-deal totals require all assigned first attempts and settle tied scores as ties', () => {
  const ids = ['duel-one', 'duel-two', 'duel-three'] as const;
  const results = ids.map(challengeId => daily('2026-10-20', score(), { challengeId }));
  assert.equal(threeDealTotal(results.slice(0, 2), ids).complete, false);
  const final = threeDealTotal(results, ids);
  assert.equal(final.complete, true);
  assert.equal(final.completedDeals, 3);
  assert.equal(final.points, 3 * challengePoints(score())!);
  assert.equal(compareChallengeTotals(final, threeDealTotal([...results].reverse(), ids)), 0);
  assert.equal(threeDealTotal([...results, results[0]], ids).completedDeals, 3);
  assert.equal(threeDealTotal([daily('2026-10-20', score(), { challengeId: 'unrelated' })], ids).completedDeals, 0);
  assert.equal(threeDealTotal([results[0], results[1], { ...results[2], score: score({ outcome: 'abandoned' }) }], ids).complete, true);
  assert.equal(threeDealTotal([results[0], results[1], { ...results[2], score: score({ outcome: 'service-interrupted' }) }], ids).complete, false);
  const interrupted = { ...results[2], score: score({ outcome: 'service-interrupted' }) };
  assert.equal(threeDealTotal([interrupted, interrupted], ids).serviceInterrupted, 1);
});

test('rule-of-week rotation visits all 30 free requirements and remains stable within each week', () => {
  const seen = new Set<string>();
  for (let index = 0; index < 30; index++) {
    const monday = shiftCalendarDay('2026-10-19', index * 7);
    const rule = ruleOfTheWeek(monday);
    seen.add(rule.ruleId);
    assert.ok([1, 2, 3].includes(rule.game));
    assert.deepEqual(rule, ruleOfTheWeek(shiftCalendarDay(monday, 6)));
  }
  assert.equal(seen.size, 30);
  assert.equal(ruleOfTheWeek(shiftCalendarDay('2026-10-19', 30 * 7)).ruleId, ruleOfTheWeek('2026-10-19').ruleId);
});

const consistency = (accountId: string, count: number, completed: number, overrides: Partial<ConsistencyAttempt> = {}): ConsistencyAttempt[] => Array.from({ length: count }, (_, index) => ({
  accountId, displayName: accountId, ruleId: '1:1', cohortKey: 'synthetic-fixed-cohort',
  completed: index < completed, openingTurn: index < completed ? 3 : null, penalty: 20,
  eligible: true, status: 'completed', ...overrides,
}));

test('consistency samples include withdrawals, exclude practice/errors, and retain ties within cohorts', () => {
  const rows = [
    ...consistency('A', 20, 16), ...consistency('B', 40, 32), ...consistency('C', 20, 15),
    ...consistency('provisional', 19, 19), ...consistency('other-rule', 20, 20, { ruleId: '2:1' }),
    ...consistency('other-cohort', 20, 20, { cohortKey: 'different-hints' }),
    ...consistency('practice', 30, 30, { eligible: false }),
    ...consistency('service-error', 30, 30, { status: 'service-interrupted' }),
  ];
  const board = consistencyBoard(rows, { ruleId: '1:1', cohortKey: 'synthetic-fixed-cohort' });
  assert.deepEqual(board.map(entry => [entry.accountId, entry.rank, entry.provisional]), [['A', 1, false], ['B', 1, false], ['C', 3, false], ['provisional', 4, true]]);
  assert.equal(board[0].minimumAttempts, 20);
  const withdrawal = consistencyBoard([...consistency('withdrawal', 19, 19), ...consistency('withdrawal', 1, 1, { status: 'abandoned' })])[0];
  assert.equal(withdrawal.attempts, 20);
  assert.equal(withdrawal.completed, 19);
  assert.equal(withdrawal.abandoned, 1);
  assert.equal(withdrawal.completionRate, 0.95);
  const pending = consistencyBoard([...consistency('pending', 19, 19), ...consistency('pending', 1, 0, { status: 'started' })])[0];
  assert.equal(pending.attempts, 20);
  assert.equal(pending.pending, 1);
  assert.equal(pending.completionRate, 0.95);
  assert.equal(consistencyBoard(rows).find(entry => entry.accountId === 'other-cohort')!.rank, 1);
});

const ELIGIBILITY: LadderEligibility = {
  format: LADDER_FORMAT, playerCount: 2, humanCount: 2, bothOptedIn: true,
  showMoveHints: false, pairRatedGamesToday: 0, outcome: 'completed',
};

test('two-human Elo is zero-sum, handles ties, and exits provisional status after ten games', () => {
  const initial = newLadderPlayer();
  const win = rateHumanLadder(initial, initial, 'first', ELIGIBILITY);
  assert.equal(win.rated, true);
  assert.equal(win.first.rating, 1016);
  assert.equal(win.second.rating, 984);
  assert.equal(win.first.delta + win.second.delta, 0);
  assert.equal(win.first.provisional, true);
  const tie = rateHumanLadder({ rating: 1000, ratedGames: 9 }, { rating: 1000, ratedGames: 9 }, 'tie', ELIGIBILITY);
  assert.equal(tie.first.rating, 1000);
  assert.equal(tie.second.rating, 1000);
  assert.equal(tie.first.provisional, false);
  assert.equal(tie.first.ratedGames, 10);
  const unequalTie = calculateElo(1200, 1000, 0.5);
  assert.ok(unequalTie.firstDelta < 0);
  assert.equal(unequalTie.firstDelta + unequalTie.secondDelta, 0);
});

test('social games, AI, hints, missing consent, service errors and repeated reciprocal farming do not rate', () => {
  const first = { rating: 1040, ratedGames: 12 };
  const second = { rating: 990, ratedGames: 2 };
  for (const changed of [
    { format: 'full-game' }, { humanCount: 1 }, { playerCount: 4 }, { showMoveHints: true },
    { bothOptedIn: false }, { outcome: 'service-interrupted' as const }, { pairRatedGamesToday: 2 },
  ]) {
    const update = rateHumanLadder(first, second, 'first', { ...ELIGIBILITY, ...changed });
    assert.equal(update.rated, false);
    assert.equal(update.first.rating, first.rating);
    assert.equal(update.first.ratedGames, first.ratedGames);
  }
  assert.equal(rateHumanLadder(first, second, 'first', { ...ELIGIBILITY, pairRatedGamesToday: 1, outcome: 'forfeit' }).rated, true);
  assert.equal(rateHumanLadder(first, second, 'tie', { ...ELIGIBILITY, outcome: 'forfeit' }).rated, false);
  assert.equal(ratedPairDayKey('A', 'B', '2026-10-20T12:59:59Z'), ratedPairDayKey('B', 'A', '2026-10-20T12:59:59Z'));
  assert.notEqual(ratedPairDayKey('A', 'B', '2026-10-20T12:59:59Z'), ratedPairDayKey('A', 'B', '2026-10-20T13:00:00Z'));
  assert.throws(() => ratedPairDayKey('A', 'A'), /two different accounts/);
});
