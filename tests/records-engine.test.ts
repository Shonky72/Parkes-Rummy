import test from 'node:test';
import assert from 'node:assert/strict';
import {
  abandonRecords, applyAction, createPlayer, createRoom, enableRecords, findBotOpening,
  findOpeningMelds, getRuleExample, naturalOpeningEligible, observeRecordsAction,
  publicRoom, recordEvents, RULES,
} from '../lib/rummy';
import { aggregateRecords, ACHIEVEMENTS, cohortKey, compareOpeningRecords, headToHeadRecords } from '../lib/records';
import type { Card, GameType, Meld, RoomState, Suit } from '../lib/types';
import type { RecordEvidence } from '../lib/records-types';

let serial = 0;
const card = (rank: number, suit: Suit = 'H'): Card => ({ id: `records-test-${++serial}`, rank, suit });
const run = (from = 5, count = 5): Card[] => Array.from({ length: count }, (_, index) => card(from + index, (['C', 'D', 'H', 'S'] as Suit[])[index % 4]));
const dealtReady = () => [...run(), card(11), card(11, 'C'), card(12), card(13), card(14)];

/** Synthetic deals exercise the real accepted-action observer without relying on random draws. */
function fixture(hand: Card[], game: GameType = 1, ruleNumber = 1, options: { bots?: boolean; humans?: number; fullGame?: boolean; eligible?: boolean } = {}): RoomState {
  const host = createPlayer({ id: 'owner', name: 'Owner', tokenHash: 'owner-secret', color: 0 });
  const before = createRoom('RECD', host);
  for (let index = 1; index < (options.humans ?? 2); index++) before.players.push(createPlayer({ id: `other-${index}`, name: `Player ${index}`, tokenHash: 'guest-secret', color: index, isBot: options.bots === true }));
  before.game = game;
  if (!options.fullGame) before.quickPlay = { ruleNumber };
  const room = applyAction(before, 'owner', { type: 'start' });
  room.players[0].hand = hand;
  for (const player of room.players) player.ruleNumber = ruleNumber;
  room.stock = Array.from({ length: 60 }, () => card(14, 'C'));
  enableRecords(before, { eligible: options.eligible });
  room.records = structuredClone(before.records);
  observeRecordsAction(before, room, 'owner', { type: 'start' });
  return room;
}

function evidence(room: RoomState, playerId = 'owner'): RecordEvidence { return room.records!.current[playerId]; }
function draw(room: RoomState, picked = card(14, 'C'), playerId = 'owner'): RoomState {
  room.stock.push(picked);
  return applyAction(room, playerId, { type: 'draw', source: 'stock' });
}
function discard(room: RoomState, selected?: Card, playerId = 'owner'): RoomState {
  const held = room.players.find(player => player.id === playerId)!.hand;
  return applyAction(room, playerId, { type: 'discard', cardId: (selected ?? held.at(-1)!).id });
}
function returnTurn(room: RoomState): RoomState {
  for (let index = 0; room.turnPlayerId !== 'owner' && index < 8; index++) {
    const id = room.turnPlayerId;
    room = draw(room, card(14, 'C'), id);
    room = discard(room, undefined, id);
  }
  return room;
}
function firstTurn(room: RoomState): RoomState { return returnTurn(discard(draw(room))); }
function finishByOpponent(room: RoomState): RoomState {
  if (room.turnPlayerId === 'owner') room = discard(room);
  const actor = room.players.find(player => player.id === room.turnPlayerId)!;
  actor.hand = [card(5)]; actor.down = true; actor.laidDownTurn = 0; room.phase = 'play';
  return discard(room, undefined, actor.id);
}
function completedExample(game: GameType = 1, rule = 1, options: { bots?: boolean; fullGame?: boolean } = {}): RoomState {
  const opening = getRuleExample(game, rule).flatMap(meld => meld.cards).map(held => ({ ...held, id: `actual-${++serial}` }));
  const hand = [...opening];
  while (hand.length < 10) hand.push(card(14, 'S'));
  let room = firstTurn(fixture(hand, game, rule, options));
  room = draw(room);
  room = applyAction(room, 'owner', { type: 'goDown', cardIds: opening.map(held => held.id) });
  return room.status === 'playing' ? finishByOpponent(room) : room;
}

test('all 40 visual examples are exact engine openings with unique physical cards and two-pack availability', () => {
  for (const game of [1, 2, 3, 4] as const) for (let rule = 1; rule <= 10; rule++) {
    const example = getRuleExample(game, rule);
    const cards = example.flatMap(meld => meld.cards);
    assert.ok(findOpeningMelds(cards, game, rule), `${game}:${rule}`);
    assert.equal(cards.length, RULES[game][rule - 1].requirements.reduce((sum, group) => sum + group.count, 0));
    assert.equal(new Set(cards.map(held => held.id)).size, cards.length);
    const printed = new Map<string, number>();
    for (const held of cards) printed.set(`${held.rank}${held.suit}`, (printed.get(`${held.rank}${held.suit}`) ?? 0) + 1);
    assert.ok([...printed.values()].every(count => count <= 2), `${game}:${rule}: only two packs needed`);
    example[0].cards[0].rank = 99;
    assert.notEqual(getRuleExample(game, rule)[0].cards[0].rank, 99, 'callers never mutate the cache');
  }
});

test('deal readiness, first-draw readiness and first legal own turn remain distinct', () => {
  let room = fixture(dealtReady());
  assert.equal(evidence(room).firstReady?.turn, 0);
  assert.equal(evidence(room).readyFromDeal, true);
  room = draw(room);
  assert.equal(evidence(room).firstDrawReady, true);
  assert.equal(evidence(room).firstDrawCompletedOpening, false);
  assert.equal(evidence(room).firstLegal, null);
  const opening = findBotOpening(room.players[0].hand, 1, 1)!;
  assert.throws(() => applyAction(room, 'owner', { type: 'goDown', cardIds: opening.flatMap(meld => meld.cards.map(held => held.id)) }), /first turn/);
  room = discard(room);
  assert.equal(evidence(room).firstDiscardSurvived, true);
  assert.equal(evidence(room).opportunitiesPassed, 0);
  room = draw(returnTurn(room));
  assert.equal(evidence(room).firstLegal?.turn, 2);
  room = applyAction(room, 'owner', { type: 'goDown', cardIds: opening.flatMap(meld => meld.cards.map(held => held.id)) });
  assert.equal(evidence(room).actualOpening?.turn, 2);
  assert.ok(evidence(room).achievements.includes('first-chance'));
  assert.equal(evidence(room).opportunitiesPassed, 0);
  assert.equal(recordEvents(room).length, 2, 'only start snapshots are queued while play continues');
});

test('a first pickup opening lost to the compulsory discard is not legal readiness on turn two', () => {
  const initial = [...run(5, 4), card(11), card(11, 'C'), card(12), card(12, 'C'), card(13), card(14)];
  let room = fixture(initial);
  assert.equal(evidence(room).readyFromDeal, false);
  room = draw(room, card(9));
  assert.equal(evidence(room).firstDrawCompletedOpening, true);
  assert.ok(evidence(room).achievements.includes('chomping-at-the-bit'));
  room = discard(room, initial.find(held => held.rank === 7));
  assert.equal(evidence(room).firstDiscardSurvived, false);
  assert.equal(evidence(room).readinessLostOnDiscard, 1);
  room = draw(returnTurn(room));
  assert.equal(evidence(room).firstLegal, null);
  room = discard(room);
  room = draw(returnTurn(room), card(7));
  assert.equal(evidence(room).firstLegal?.turn, 3);
  const opening = findBotOpening(room.players[0].hand, 1, 1)!;
  room = applyAction(room, 'owner', { type: 'goDown', cardIds: opening.flatMap(meld => meld.cards.map(held => held.id)) });
  assert.equal(evidence(room).opportunitiesPassed, 0);
  assert.ok(evidence(room).achievements.includes('first-chance'));
});

test('discontinuous legal opportunities count eligible ended turns, not a turn-number difference', () => {
  let room = firstTurn(fixture(dealtReady()));
  room = draw(room);
  room = discard(room, room.players[0].hand.find(held => held.rank === 7));
  assert.equal(evidence(room).opportunitiesPassed, 1);
  room = draw(returnTurn(room));
  room = discard(room);
  assert.equal(evidence(room).opportunitiesPassed, 1, 'turn three had no full opening');
  room = draw(returnTurn(room), card(7));
  room = discard(room, room.players[0].hand.find(held => held.rank === 14));
  assert.equal(evidence(room).opportunitiesPassed, 2);
  room = draw(returnTurn(room));
  const opening = findBotOpening(room.players[0].hand, 1, 1)!;
  room = applyAction(room, 'owner', { type: 'goDown', cardIds: opening.flatMap(meld => meld.cards.map(held => held.id)) });
  assert.equal(evidence(room).firstLegal?.turn, 2);
  assert.equal(evidence(room).actualOpening?.turn, 5);
  assert.equal(evidence(room).opportunitiesPassed, 2);
  assert.ok(!evidence(room).achievements.includes('first-chance'));
});

test('natural opening awards use the accepted cards even when a different natural partition was available', () => {
  const natural = run();
  const wild = card(2, 'D');
  let room = firstTurn(fixture([...natural, wild, card(12), card(12, 'C'), card(14), card(14, 'C')]));
  room = draw(room);
  assert.ok(findBotOpening(room.players[0].hand.filter(held => held.rank !== 2), 1, 1));
  room = applyAction(room, 'owner', { type: 'goDown', cardIds: [...natural.slice(0, 4), wild].map(held => held.id) });
  assert.equal(evidence(room).wildcardCount, 1);
  assert.equal(evidence(room).actualOpening?.opening.flatMap(meld => meld.cards).filter(held => held.rank === 2).length, 1);
  assert.ok(!evidence(room).achievements.includes('natural-talent'));
  assert.ok(evidence(completedExample()).achievements.includes('natural-talent'));
});

test('compound readiness never reuses a physical card across the set and run', () => {
  const sevens = [card(7, 'C'), card(7, 'D'), card(7, 'H')];
  const initial = [...sevens, ...run(8, 3), card(12), card(12, 'C'), card(14), card(14, 'C')];
  let room = fixture(initial, 1, 3);
  assert.equal(evidence(room).readyFromDeal, false);
  room = draw(room, card(7, 'S'));
  assert.equal(evidence(room).firstDrawReady, true);
  const ids = evidence(room).firstReady!.opening.flatMap(meld => meld.cards.map(held => held.id));
  assert.equal(ids.length, 7);
  assert.equal(new Set(ids).size, 7);
});

test('Original Rules readiness uses exact special validators and optional-natural exclusions', () => {
  const broadRun = [...run(5, 5).map(held => ({ ...held, suit: 'H' as const })), ...run(5, 5).map(held => ({ ...held, suit: 'C' as const }))];
  const room = fixture(broadRun, 4, 6);
  assert.equal(evidence(room).readyFromDeal, false, 'a suited 5–9 run is not the Royal Flush');
  for (const [game, rule] of [[2, 5], [3, 5], [4, 2], [4, 3], [4, 4]] as const) assert.equal(naturalOpeningEligible(game, rule), false);
  assert.equal(naturalOpeningEligible(3, 10), true, 'wildcards remain optional in the eight-card set');
});

test('named mastery badges require the whole accepted opening for the named engine rule', () => {
  for (const [game, rule, badge] of [[4, 6, 'royal-appointment'], [4, 10, 'heart-of-parkes'], [2, 7, 'six-of-the-best'], [3, 8, 'suit-yourself']] as const) {
    const row = evidence(completedExample(game, rule));
    assert.ok(row.achievements.includes(badge), badge);
    assert.equal(row.actualOpening!.opening.flatMap(meld => meld.cards).length, RULES[game][rule - 1].requirements.reduce((sum, group) => sum + group.count, 0));
  }
});

test('finishing another player’s exposed 5-through-Ace run awards both layoff achievements', () => {
  let room = firstTurn(fixture(dealtReady()));
  room = draw(room);
  const opening = findBotOpening(room.players[0].hand, 1, 1)!;
  room = applyAction(room, 'owner', { type: 'goDown', cardIds: opening.flatMap(meld => meld.cards.map(held => held.id)) });
  room = draw(returnTurn(discard(room)));
  const ace = card(14);
  room.players[0].hand = [ace];
  const otherRun: Meld = { id: 'other-run', ownerId: 'other-1', kind: 'run', constraint: 'any', cards: run(5, 9) };
  room.melds.push(otherRun);
  room = applyAction(room, 'owner', { type: 'layoff', meldId: otherRun.id, cardId: ace.id, end: 'end' });
  const row = evidence(room);
  assert.equal(row.status, 'completed');
  assert.equal(row.wentOut, true);
  assert.equal(row.closingTurns, 1);
  assert.ok(row.achievements.includes('runway-closed'));
  assert.ok(row.achievements.includes('borrowed-space'));
  assert.equal(recordEvents(room).filter(event => event.type === 'hand-end').length, 2);
});

function fullGameFinal(tied = false, equalAfterThree = false): RoomState {
  const opening = getRuleExample(1, 10).flatMap(meld => meld.cards);
  const room = fixture([...opening, card(14), card(14)], 1, 10, { fullGame: true, humans: 4 });
  room.round = 10;
  room.players[0].hand = opening; room.players[0].completedTurns = 1; room.players[0].score = 100;
  room.phase = 'play';
  for (const [index, player] of room.players.entries()) if (index > 0) {
    player.hand = [card(5)]; player.score = index === 1 ? tied ? 95 : 100 : 110 + index * 5;
  }
  room.history = Array.from({ length: 9 }, (_, index) => ({
    round: index + 1, winnerId: 'owner', winnerName: 'Owner', scores: room.players.map((player, seat) => ({
      playerId: player.id, name: player.name, penalty: 0,
      total: index === 2 ? equalAfterThree ? 100 : seat === 0 || seat === 1 ? 100 : 70 : player.score,
      cards: [], ruleNumber: index + 1, melded: true,
    })),
  }));
  return applyAction(room, 'owner', { type: 'goDown', cardIds: opening.map(held => held.id) });
}

test('full-game badges separate personal progression, outright victory, five-point margin and highest-score ties', () => {
  const row = evidence(fullGameFinal());
  for (const badge of ['clean-sweep', 'comeback-kid', 'by-a-whisker', 'against-the-table'] as const) assert.ok(row.achievements.includes(badge), badge);
  assert.equal(row.gameOutcome?.winnerIds.length, 1);
  const tied = evidence(fullGameFinal(true));
  assert.ok(tied.achievements.includes('clean-sweep'));
  assert.ok(!tied.achievements.includes('comeback-kid'));
  assert.ok(!tied.achievements.includes('by-a-whisker'));
  assert.ok(!tied.achievements.includes('against-the-table'));
  assert.ok(!evidence(fullGameFinal(false, true)).achievements.includes('comeback-kid'));
});

test('accepted duplicate observation and rejected action never duplicate an award or outbox snapshot', () => {
  let room = firstTurn(fixture(dealtReady()));
  const before = room;
  room = draw(room);
  const saved = structuredClone(room.records);
  observeRecordsAction(before, room, 'owner', { type: 'draw', source: 'stock' });
  assert.deepEqual(room.records, saved);
  assert.throws(() => applyAction(room, 'owner', { type: 'draw', source: 'stock' }), /already drawn/);
  assert.deepEqual(room.records, saved);
  const finished = completedExample();
  const events = recordEvents(finished);
  events[0].evidence.achievements.length = 0;
  assert.ok(recordEvents(finished)[0].evidence.achievements.includes('born-ready'), 'outbox read is isolated');
  const aggregate = aggregateRecords([...recordEvents(finished).map(event => event.evidence), ...recordEvents(finished).map(event => event.evidence)].filter(row => row.playerId === 'owner'));
  assert.equal(aggregate.summary.attempts, 1);
  assert.equal(aggregate.achievements.find(badge => badge.id === 'first-chance')?.count, 1);
});

test('pending evidence never exposes readiness, private combinations, bests or lucky badges through aggregates', () => {
  const room = fixture(dealtReady());
  const aggregate = aggregateRecords([evidence(room)]);
  assert.equal(aggregate.summary.pending, 1);
  assert.equal(aggregate.summary.attempts, 0);
  assert.equal(aggregate.recent.length, 0);
  assert.equal(aggregate.rules[0].best, null);
  assert.equal(aggregate.rules[0].dealtReadyRate.denominator, 0);
  assert.ok(aggregate.achievements.every(badge => badge.count === 0));
  const payload = JSON.stringify(publicRoom(room, 'other-1'));
  for (const forbidden of ['records', 'firstReady', 'firstLegal', 'opportunitiesPassed', room.records!.handId!, room.records!.gameId, 'owner-secret']) assert.ok(!payload.includes(forbidden), forbidden);
});

test('withdrawal retains poor deals and held penalty; confirmed service errors and practice are separate', () => {
  const abandoned = fixture(dealtReady());
  abandonRecords(abandoned, 'owner');
  const originalEvents = recordEvents(abandoned).length;
  abandonRecords(abandoned, 'owner');
  assert.equal(recordEvents(abandoned).length, originalEvents);
  assert.equal(evidence(abandoned).status, 'abandoned');
  assert.ok(evidence(abandoned).penalty! > 0);
  const interrupted = fixture(dealtReady());
  abandonRecords(interrupted, 'owner', 'service-interruption');
  const practice = completedExample();
  evidence(practice).eligible = false; evidence(practice).exclusionReason = 'practice';
  const result = aggregateRecords([evidence(abandoned), evidence(interrupted), evidence(practice)]);
  assert.equal(result.summary.attempts, 1);
  assert.equal(result.summary.abandoned, 1);
  assert.equal(result.summary.serviceInterrupted, 1);
  assert.equal(result.rules[0].successRate.denominator, 1);
  assert.equal(result.rules[0].successRate.count, 0);
  assert.equal(result.rules[0].cohorts[0].averagePenalty, evidence(abandoned).penalty);
  const untracked = createRoom('TUTR', createPlayer({ id: 'tutorial', name: 'Tutorial', tokenHash: '', color: 0 }));
  assert.equal(untracked.records, undefined, 'tutorial/client games never opt in automatically');
  const disabled = fixture(dealtReady(), 1, 1, { eligible: false });
  abandonRecords(disabled);
  assert.equal(aggregateRecords(Object.values(disabled.records!.current)).summary.attempts, 0);
});

test('statistics give exact denominators, medians, optional-natural rates and comparable cohorts', () => {
  const success = evidence(completedExample());
  const other = structuredClone(success); other.handId += '-two'; other.gameId += '-two'; other.actualOpening!.turn = 5; other.firstLegal!.turn = 3; other.opportunitiesPassed = 1;
  other.wildcardCount = 1; other.readyFromDeal = false; other.firstDrawReady = false;
  const fail = structuredClone(success); fail.handId += '-fail'; fail.gameId += '-fail'; fail.actualOpening = null; fail.completed = false; fail.firstLegal = null; fail.readyFromDeal = false; fail.firstDrawReady = false;
  const result = aggregateRecords([success, other, fail]);
  const rule = result.rules[0];
  assert.deepEqual(rule.successRate, { count: 2, denominator: 3, rate: 2 / 3 });
  assert.deepEqual(rule.firstChanceRate, { count: 1, denominator: 2, rate: .5 });
  assert.deepEqual(rule.naturalRate, { count: 1, denominator: 2, rate: .5 });
  assert.equal(rule.medianOpeningTurn, 3.5);
  const renamed = structuredClone(success);
  renamed.conditions.roster[0].name = 'Friend'; renamed.conditions.roster[0].playerId = 'friend';
  assert.equal(cohortKey(success.conditions), cohortKey(renamed.conditions));
  renamed.finishedAt! += 100000;
  assert.equal(compareOpeningRecords(success, renamed), 0, 'milliseconds never break an equally early record');
  renamed.conditions.hints = !success.conditions.hints;
  assert.equal(compareOpeningRecords(success, renamed), null);
  for (const key of ['format', 'engineVersion', 'timerSeconds', 'startingSeat'] as const) {
    const changed = structuredClone(success);
    if (key === 'format') changed.conditions.format = 'challenge';
    else if (key === 'engineVersion') changed.conditions.engineVersion = 'different';
    else changed.conditions[key] = (changed.conditions[key] ?? 0) + 1;
    assert.notEqual(cohortKey(success.conditions), cohortKey(changed.conditions), key);
  }
});

test('all-rounder is the 30 free-rule collection and ignores duplicate evidence', () => {
  const sample = evidence(completedExample());
  const rows = ([1, 2, 3] as GameType[]).flatMap(game => Array.from({ length: 10 }, (_, index) => ({
    ...structuredClone(sample), game, ruleNumber: index + 1, ruleId: `${game}:${index + 1}`, handId: `mastery-${game}-${index + 1}`,
  })));
  assert.equal(aggregateRecords(rows.slice(1)).achievements.find(badge => badge.id === 'all-rounder')?.count, 0);
  const result = aggregateRecords([...rows, ...rows]);
  assert.equal(result.summary.masteredRules, 30);
  assert.equal(result.summary.originalRules, 0);
  assert.equal(result.achievements.find(badge => badge.id === 'all-rounder')?.count, 1);
  assert.equal(ACHIEVEMENTS.length, 16);
});

test('Quick Play streaks survive service interruptions and reset on withdrawals, losses or pending gaps', () => {
  const base = evidence(completedExample(1, 1, { bots: true }));
  const occurrence = (index: number, status: RecordEvidence['status'] = 'completed', wentOut = true): RecordEvidence => ({
    ...structuredClone(base), gameId: `qp-game-${index}`, handId: `qp-hand-${index}`, startedAt: index * 1000,
    finishedAt: index * 1000 + 100, status, wentOut, eligible: status !== 'service-interrupted',
  });
  const earned = aggregateRecords([occurrence(1), occurrence(2), occurrence(3), occurrence(4, 'service-interrupted')]);
  assert.equal(earned.achievements.find(badge => badge.id === 'on-a-roll')?.count, 1);
  assert.equal(earned.summary.quickPlayStreak, 3);
  for (const status of ['abandoned', 'started'] as const) {
    const blocked = aggregateRecords([occurrence(1), occurrence(2, status), occurrence(3), occurrence(4)]);
    assert.equal(blocked.achievements.find(badge => badge.id === 'on-a-roll')?.count, 0);
    assert.equal(blocked.summary.quickPlayStreak, 2);
  }
  const loss = aggregateRecords([occurrence(1), occurrence(2, 'completed', false), occurrence(3), occurrence(4)]);
  assert.equal(loss.achievements.find(badge => badge.id === 'on-a-roll')?.count, 0);
  const five = aggregateRecords(Array.from({ length: 5 }, (_, index) => occurrence(index + 1)));
  assert.equal(five.achievements.find(badge => badge.id === 'first-chance')?.tier, 'bronze');
});

test('timeout and bot sub-actions use the same private telemetry without changing game responses', () => {
  let room = fixture(dealtReady(), 1, 1, { bots: true });
  room.turnDeadline = Date.now() - 1;
  room = applyAction(room, 'owner', { type: 'timeout' });
  assert.equal(evidence(room).ownTurns, 1);
  assert.equal(evidence(room).opportunitiesPassed, 0);
  assert.deepEqual(evidence(room).timeline.slice(0, 3).map(entry => entry.kind), ['deal', 'draw', 'discard']);
  room = applyAction(room, 'owner', { type: 'botStep' });
  assert.equal(evidence(room, 'other-1').ownTurns, 1);
  assert.equal(evidence(room, 'other-1').eligible, false);
  const plain = structuredClone(room); delete plain.records;
  const nextCard = room.players[1].hand.at(-1)!;
  const action = { type: 'discard' as const, cardId: nextCard.id };
  const trackedResult = publicRoom(applyAction(room, 'other-1', action), 'owner');
  const plainResult = publicRoom(applyAction(plain, 'other-1', action), 'owner');
  trackedResult.updatedAt = plainResult.updatedAt;
  trackedResult.lastMoveAt = plainResult.lastMoveAt;
  trackedResult.events = trackedResult.events.map((event, index) => ({ ...event, at: plainResult.events[index].at }));
  assert.deepEqual(trackedResult, plainResult);
});

test('timeline stays bounded while milestones survive long hands and rematches obtain new identities', () => {
  let room = fixture(dealtReady());
  const gameId = room.records!.gameId;
  for (let index = 0; index < 65; index++) room = returnTurn(discard(draw(room)));
  assert.equal(evidence(room).timeline.length, 120);
  assert.equal(evidence(room).timeline[0].kind, 'deal');
  assert.equal(evidence(room).timelineTruncated, true);
  assert.equal(evidence(room).firstReady?.turn, 0);
  const ended = completedExample(1, 1, { fullGame: true });
  const oldGame = ended.records!.gameId; const oldHand = ended.records!.handId;
  const newHand = applyAction(ended, 'owner', { type: 'nextHand' });
  assert.equal(newHand.records!.gameId, oldGame);
  assert.notEqual(newHand.records!.handId, oldHand);
  const reset = applyAction(ended, 'owner', { type: 'rematch' });
  const restarted = applyAction(reset, 'owner', { type: 'start' });
  assert.notEqual(restarted.records!.gameId, oldGame);
  assert.equal(room.records!.gameId, gameId);
});

test('first-discard evidence records the surviving physical opening, including a changed partition', () => {
  const opening = run(5, 10);
  let room = fixture(opening);
  room = draw(room, card(14));
  room = discard(room, opening.at(-1)!);
  const row = evidence(room);
  assert.equal(row.firstDiscardSurvived, true);
  const surviving = row.timeline.find(entry => entry.kind === 'discard')!.opening!;
  const cards = surviving.flatMap(meld => meld.cards);
  assert.ok(cards.every(held => held.id !== opening.at(-1)!.id));
  assert.ok(findOpeningMelds(cards, 1, 1));
});

test('Runway Closed counts distinct completed runs and remains idempotent on replayed observation', () => {
  let room = firstTurn(fixture(dealtReady()));
  room = draw(room);
  const opening = findBotOpening(room.players[0].hand, 1, 1)!;
  room = applyAction(room, 'owner', { type: 'goDown', cardIds: opening.flatMap(meld => meld.cards.map(held => held.id)) });
  room = draw(returnTurn(discard(room)));
  const aces = [card(14), card(14, 'C')];
  room.players[0].hand = [...aces, card(5)];
  for (let index = 0; index < 2; index++) room.melds.push({ id: `runway-${index}`, ownerId: 'other-1', kind: 'run', constraint: 'any', cards: run(5, 9) });
  for (let index = 0; index < 2; index++) {
    const before = room;
    const action = { type: 'layoff' as const, meldId: `runway-${index}`, cardId: aces[index].id, end: 'end' as const };
    room = applyAction(room, 'owner', action);
    observeRecordsAction(before, room, 'owner', action);
  }
  room = discard(room);
  assert.equal(evidence(room).achievementCounts?.['runway-closed'], 2);
  assert.equal(aggregateRecords([evidence(room)]).achievements.find(badge => badge.id === 'runway-closed')?.count, 2);
  assert.ok(!evidence(room).achievements.includes('borrowed-space'), 'the final card was discarded');
});

test('recent opening and penalty improvements require two five-result samples in one cohort', () => {
  const base = evidence(completedExample());
  const rows = Array.from({ length: 10 }, (_, index) => {
    const row = structuredClone(base); row.handId = `improvement-${index}`; row.finishedAt = index * 1000;
    row.actualOpening!.turn = index < 5 ? 6 : 3; row.penalty = index < 5 ? 75 : 25;
    return row;
  });
  const complete = aggregateRecords(rows).rules[0].cohorts[0];
  assert.equal(complete.recentOpeningImprovement, 3);
  assert.equal(complete.recentPenaltyImprovement, 50);
  assert.deepEqual(complete.openingImprovementSamples, { recent: 5, previous: 5 });
  assert.equal(aggregateRecords(rows.slice(1)).rules[0].cohorts[0].recentOpeningImprovement, null);
  rows.at(-1)!.conditions.hints = !base.conditions.hints;
  assert.ok(aggregateRecords(rows).rules[0].cohorts.every(cohort => cohort.recentOpeningImprovement === null));
});

test('head-to-head distinguishes hand winners, rule completion and full-game winners on shared tables', () => {
  const quick = completedExample();
  const full = fullGameFinal();
  const unrelated = structuredClone(evidence(quick, 'other-1')); unrelated.handId = 'unrelated-table';
  const summary = headToHeadRecords([evidence(quick), evidence(full), evidence(full)], [evidence(quick, 'other-1'), evidence(full, 'other-1'), unrelated]);
  assert.equal(summary.completedHands, 2);
  assert.equal(summary.ownHandsWon, 1);
  assert.equal(summary.friendHandsWon, 1);
  assert.equal(summary.ownRulesCompleted, 2);
  assert.equal(summary.friendRulesCompleted, 0);
  assert.equal(summary.quickPlayHands, 1);
  assert.equal(summary.friendQuickPlayWins, 1);
  assert.equal(summary.fullGames, 1);
  assert.equal(summary.ownFullGameWins, 1);
});
