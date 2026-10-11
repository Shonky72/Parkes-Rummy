import assert from 'node:assert/strict';
import test from 'node:test';
import type { Card, Difficulty, GameType, RoomState, Suit } from '../lib/types';

const {
  applyAction, chooseBotAction, createPlayer, createRoom, findOpeningMelds,
  normalizeRoomProgression, publicRoom, ruleNumberFor,
} = await import(new URL('../lib/rummy.ts', import.meta.url).href) as typeof import('../lib/rummy');

let serial = 0;
const suits: Suit[] = ['C', 'D', 'H', 'S'];
const card = (rank: number, suit: Suit = 'C'): Card => ({ id: `progress-${++serial}`, rank, suit });
const set = (rank: number, count: number): Card[] => Array.from({ length: count }, (_, index) => card(rank, suits[index % 4]));
const run = (start: number, count: number): Card[] => Array.from({ length: count }, (_, index) => card(start + index, suits[index % 4]));

function start(count = 3, game: GameType = 1): RoomState {
  const room = createRoom('RULES2', createPlayer({ id: 'host', name: 'Dan', tokenHash: 'host-secret', color: 0 }));
  for (let index = 1; index < count; index++) {
    room.players.push(createPlayer({ id: `guest-${index}`, name: `Guest ${index}`, tokenHash: `guest-secret-${index}`, color: index }));
  }
  room.game = game;
  return applyAction(room, 'host', { type: 'start' });
}

/** A late-turn fixture, leaving the ordinary discard/finish/score transition under test. */
function finish(room: RoomState, winnerId: string, meldedIds: string[]): RoomState {
  room.turnPlayerId = winnerId;
  room.phase = 'play';
  room.turnNumber += room.players.length;
  for (const player of room.players) {
    player.down = meldedIds.includes(player.id);
    player.completedTurns = 2;
    player.laidDownTurn = player.down ? room.turnNumber - room.players.length : null;
    player.hand = player.id === winnerId ? [card(5)] : [card(14), card(2), card(7)];
  }
  const winner = room.players.find(player => player.id === winnerId)!;
  return applyAction(room, winnerId, { type: 'discard', cardId: winner.hand[0].id });
}

test('all players who meld advance once on the next deal, including a non-winner; unmelded players repeat their rule', () => {
  let room = start();
  room.round = 7;
  room.players.forEach(player => { player.ruleNumber = 4; });
  room = finish(room, 'host', ['host', 'guest-1']);
  assert.equal(room.status, 'round-end');
  assert.deepEqual(room.players.map(player => player.ruleNumber), [4, 4, 4], 'The result still displays the attempted rule');
  assert.deepEqual(room.result!.scores.map(row => [row.ruleNumber, row.melded, row.nextRuleNumber, row.completed]), [
    [4, true, 5, false], [4, true, 5, false], [4, false, 4, false],
  ]);
  assert.deepEqual(room.result!.scores.map(row => row.penalty), [0, 45, 45]);
  const recorded = structuredClone(room.history);
  room = applyAction(room, 'host', { type: 'nextHand' });
  assert.equal(room.round, 8);
  assert.deepEqual(room.players.map(player => player.ruleNumber), [5, 5, 4]);
  assert.deepEqual(room.players.map(player => player.score), [0, 45, 45]);
  assert.ok(room.players.every(player => player.hand.length === 10 && !player.down && player.completedTurns === 0));
  assert.deepEqual(room.history, recorded);
  assert.equal(room.result, null);
  assert.throws(() => applyAction(room, 'host', { type: 'nextHand' }), /current hand/i, 'A repeated next-hand action must not advance twice');

  room = finish(room, 'guest-2', ['guest-2']);
  room = applyAction(room, 'host', { type: 'nextHand' });
  assert.deepEqual(room.players.map(player => player.ruleNumber), [5, 5, 5], 'Down flags from the prior hand must not carry over');
});

test('human opening validation uses the actor’s current contract instead of the shared hand count or an opponent’s rule', () => {
  const room = start(2);
  room.round = 12;
  room.phase = 'play';
  room.players[0].ruleNumber = 2;
  room.players[1].ruleNumber = 7;
  room.players[0].completedTurns = 1;
  const opening = [...set(6, 3), ...set(12, 3)];
  room.players[0].hand = [...opening, card(14)];
  const original = structuredClone(room);
  const down = applyAction(room, 'host', { type: 'goDown', cardIds: opening.map(held => held.id) });
  assert.equal(down.players[0].down, true);
  assert.deepEqual(down.melds.map(meld => [meld.kind, meld.cards.length]), [['set', 3], ['set', 3]]);
  assert.equal(down.players[0].ruleNumber, 2);
  assert.deepEqual(room, original);

  room.players[0].hand = run(5, 8);
  assert.throws(() => applyAction(room, 'host', { type: 'goDown', cardIds: room.players[0].hand.map(held => held.id) }), /2 × 3 of a kind/);
});

test('each player’s Game 2 restrictions apply even while other players are on a different rule', () => {
  const room = start(2, 2);
  room.round = 3;
  room.phase = 'play';
  room.players[0].ruleNumber = 5;
  room.players[0].completedTurns = 1;
  const natural = [...set(8, 2), ...set(12, 5)];
  room.players[0].hand = [...natural, card(14)];
  assert.equal(applyAction(room, 'host', { type: 'goDown', cardIds: natural.map(held => held.id) }).players[0].down, true);
  room.players[0].hand[0] = card(2);
  assert.throws(() => applyAction(room, 'host', { type: 'goDown', cardIds: room.players[0].hand.slice(0, 7).map(held => held.id) }), /no twos/);
});

for (const difficulty of ['easy', 'medium', 'hard'] as Difficulty[]) {
  test(`${difficulty} AI opens its own rule after more than ten shared deals`, () => {
    const room = start(2);
    room.round = 14;
    room.phase = 'play';
    const bot = room.players[0];
    bot.isBot = true; bot.difficulty = difficulty; bot.ruleNumber = 2; bot.completedTurns = 1;
    bot.hand = [...set(5, 3), ...set(9, 3), card(14)];
    const view = publicRoom(room, bot.id);
    const action = chooseBotAction(view, difficulty);
    assert.equal(action.type, 'goDown');
    if (action.type !== 'goDown') assert.fail('Expected an opening');
    assert.ok(findOpeningMelds(bot.hand.filter(held => action.cardIds.includes(held.id)), 1, 2));
    const next = applyAction(room, 'guest-1', { type: 'botStep' });
    assert.equal(next.players[0].down, true);
    assert.equal(next.players[0].ruleNumber, 2);
  });
}

for (const difficulty of ['medium', 'hard'] as Difficulty[]) {
  test(`${difficulty} AI evaluates the visible discard against its own rule`, () => {
    const room = start(2);
    room.round = 7;
    room.players[0].ruleNumber = 2;
    room.players[0].hand = [...set(13, 2), ...set(11, 3), card(5), card(7), card(9), card(14), card(6)];
    room.discardPile = [card(13)];
    assert.deepEqual(chooseBotAction(publicRoom(room, 'host'), difficulty), { type: 'draw', source: 'discard' });

    room.players[0].hand = [...run(5, 4), ...run(10, 5), card(5)];
    room.discardPile = [card(9)];
    room.round = 1;
    assert.deepEqual(chooseBotAction(publicRoom(room, 'host'), difficulty), { type: 'draw', source: 'stock' }, 'A run completing the old shared rule must not override the player’s sets');
  });

  test(`${difficulty} AI retains cards useful for its own sets when choosing a discard`, () => {
    const room = start(2);
    room.round = 7;
    room.phase = 'play';
    room.players[0].ruleNumber = 2;
    room.players[0].completedTurns = 0;
    room.players[0].hand = [...set(5, 3), ...set(9, 2), card(6), card(7), card(8), card(10), card(11), card(12)];
    const action = chooseBotAction(publicRoom(room, 'host'), difficulty);
    assert.equal(action.type, 'discard');
    if (action.type !== 'discard') assert.fail('Expected a discard during the first turn');
    const discarded = room.players[0].hand.find(held => held.id === action.cardId)!;
    assert.ok(discarded.rank !== 5 && discarded.rank !== 9, 'Keep the completed set and the pair; a shared run objective would discard these duplicate ranks');
  });
}

test('the tenth shared deal does not end a match while the leaders still have rules to complete', () => {
  let room = start(2);
  room.round = 10;
  room.players[0].ruleNumber = 9;
  room.players[1].ruleNumber = 3;
  room = finish(room, 'host', ['host']);
  assert.equal(room.status, 'round-end');
  room = applyAction(room, 'host', { type: 'nextHand' });
  assert.equal(room.round, 11);
  assert.deepEqual(room.players.map(player => player.ruleNumber), [10, 3]);
  room = finish(room, 'guest-1', ['guest-1']);
  assert.equal(room.status, 'round-end', 'Reaching rule ten without melding it does not finish the match');
  room = applyAction(room, 'host', { type: 'nextHand' });
  assert.equal(room.round, 12);
  assert.deepEqual(room.players.map(player => player.ruleNumber), [10, 4]);
  assert.ok(!room.events.filter(event => event.type === 'start').some(event => event.text.includes('of 10')));
});

test('a non-winning player who melded Rule10 ends the match when the round finishes; the lowest total still wins', () => {
  let room = start();
  room.round = 15;
  room.players[0].ruleNumber = 10;
  room.players[0].score = 100;
  room.players[1].ruleNumber = 6;
  room.players[2].ruleNumber = 10;
  room = finish(room, 'guest-1', ['host', 'guest-1']);
  assert.equal(room.status, 'finished');
  assert.equal(room.result!.winnerId, 'guest-1');
  assert.deepEqual(room.result!.scores.map(row => [row.ruleNumber, row.completed]), [[10, true], [6, false], [10, false]]);
  assert.equal(room.result!.scores[0].nextRuleNumber, 10);
  assert.match(room.events.at(-1)!.text, /Guest 1 finished with the lowest score: 0/);
  assert.equal(room.turnDeadline, null);
  assert.throws(() => applyAction(room, 'host', { type: 'nextHand' }), /current hand/i);
  const reset = applyAction(room, 'host', { type: 'rematch' });
  assert.equal(reset.status, 'lobby');
  assert.deepEqual(reset.players.map(player => player.ruleNumber), [1, 1, 1]);
  assert.ok(reset.players.every(player => player.score === 0 && !player.down && !player.hand.length));
  reset.players.forEach(player => { player.ruleNumber = 8; });
  assert.deepEqual(applyAction(reset, 'host', { type: 'start' }).players.map(player => player.ruleNumber), [1, 1, 1]);
});

test('a legacy in-progress room adopts the existing shared rule without resetting cards, scores or the turn', () => {
  const room = start(2);
  room.round = 7;
  room.phase = 'play';
  room.players.forEach(player => { delete player.ruleNumber; player.score = 75; player.completedTurns = 2; });
  const opening = run(5, 8);
  room.players[0].hand = [...opening, card(14)];
  const original = structuredClone(room);
  const normalized = normalizeRoomProgression(room);
  assert.deepEqual(normalized.players.map(player => player.ruleNumber), [7, 7]);
  assert.deepEqual(normalized.players.map(player => player.hand), room.players.map(player => player.hand));
  assert.deepEqual(normalized.players.map(player => player.score), [75, 75]);
  assert.equal(normalized.version, room.version);
  assert.equal(normalized.turnNumber, room.turnNumber);
  assert.deepEqual(normalizeRoomProgression(normalized), normalized, 'Reading repeatedly must never advance anyone');
  assert.deepEqual(publicRoom(room, 'host').players.map(player => player.ruleNumber), [7, 7]);
  assert.deepEqual(room, original);
  assert.equal(applyAction(room, 'host', { type: 'goDown', cardIds: opening.map(held => held.id) }).players[0].down, true);
});

test('a legacy round-end reconstructs current qualification while preserving earlier history and scores', () => {
  let room = start();
  room.round = 4;
  room.players.forEach(player => { player.ruleNumber = 4; });
  room = finish(room, 'host', ['host', 'guest-2']);
  room.players.forEach(player => { delete player.ruleNumber; });
  const strip = (result: NonNullable<RoomState['result']>) => ({ ...result, scores: result.scores.map(({ ruleNumber, melded, nextRuleNumber, completed, ...old }) => old) });
  room.result = strip(room.result!);
  const earlier = { ...strip(room.history[0]), round: 3 };
  room.history = [earlier, structuredClone(room.result)];
  const original = structuredClone(room);
  const normalized = normalizeRoomProgression(room);
  assert.deepEqual(normalized.result!.scores.map(row => [row.ruleNumber, row.melded, row.nextRuleNumber]), [[4, true, 5], [4, false, 4], [4, true, 5]]);
  assert.deepEqual(normalized.history[0], earlier, 'Earlier down flags are unknown and must not be invented');
  assert.deepEqual(room, original);
  const next = applyAction(room, 'host', { type: 'nextHand' });
  assert.equal(next.round, 5);
  assert.deepEqual(next.players.map(player => player.ruleNumber), [5, 4, 5]);
  assert.deepEqual(next.players.map(player => player.score), room.players.map(player => player.score));
  assert.deepEqual(next.history[0], earlier);
});

test('legacy finished rooms remain finished and rule fallbacks stay inside the ten-rule list', () => {
  let room = start(2);
  room.round = 10;
  room.players.forEach(player => { player.ruleNumber = 10; });
  room = finish(room, 'host', ['host']);
  room.players.forEach(player => { delete player.ruleNumber; });
  assert.equal(normalizeRoomProgression(room).status, 'finished');
  assert.equal(publicRoom(room, 'host').status, 'finished');
  assert.throws(() => applyAction(room, 'host', { type: 'nextHand' }));
  for (const [player, fallback, expected] of [
    [undefined, 7, 7], [null, 99, 10], [{ ruleNumber: 3 }, 8, 3],
    [{ ruleNumber: 12 }, 4, 10], [{ ruleNumber: 0 }, 4, 1], [{ ruleNumber: Number.NaN }, 4, 4],
    [undefined, Number.NaN, 1], [undefined, -2, 1],
  ] as const) assert.equal(ruleNumberFor(player, fallback), expected);
});

test('public movement events identify a played card precisely and never reveal a hidden draw', () => {
  let room = start(2);
  room = applyAction(room, 'host', { type: 'draw', source: 'stock' });
  const drawn = room.players[0].hand.at(-1)!;
  assert.equal(Object.hasOwn(room.events.at(-1)!, 'cardId'), false);
  assert.equal(JSON.stringify(publicRoom(room, 'guest-1')).includes(drawn.id), false);
  room = applyAction(room, 'host', { type: 'discard', cardId: drawn.id });
  assert.equal(room.events.at(-1)!.cardId, drawn.id);

  room.turnPlayerId = 'host'; room.phase = 'play'; room.turnNumber += 3;
  room.players[0].down = true; room.players[0].laidDownTurn = 1;
  const [meld] = findOpeningMelds(run(5, 5), 1, 1)!;
  meld.id = 'public-run'; meld.ownerId = 'guest-1';
  room.melds = [meld];
  const last = card(10);
  room.players[0].hand = [last];
  room = applyAction(room, 'host', { type: 'layoff', cardId: last.id, meldId: meld.id, end: 'end' });
  assert.equal(room.events.findLast(event => event.type === 'layoff')!.cardId, last.id);
  assert.equal(room.result!.winnerId, 'host');
});
