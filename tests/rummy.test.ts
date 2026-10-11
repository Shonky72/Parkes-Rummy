import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Node's native TypeScript runner requires the explicit file extension.
import { RULES, GameError, applyAction, canGoDown, canLayoff, cardPoints, chooseBotAction, createPlayer, createRoom, findOpeningMelds, getLayoffTargets, handPoints, publicRoom } from '../lib/rummy.ts';
import type { Card, Difficulty, RoomState, Suit } from '../lib/types';

let serial = 0;
const suits: Suit[] = ['C', 'D', 'H', 'S'];
const card = (rank: number, suit: Suit = 'H'): Card => ({ id: `test-${++serial}`, rank, suit });
const sequence = (start: number, count: number, pattern: Suit[] = suits): Card[] => Array.from({ length: count }, (_, index) => card(start + index, pattern[index % pattern.length]));
const same = (rank: number, count: number, pattern: Suit[] = suits): Card[] => Array.from({ length: count }, (_, index) => card(rank, pattern[index % pattern.length]));

// Game 3's stricter contracts and wild rules have a dedicated regression suite.
const fixtures = (): Record<1 | 2, Card[][]> => ({
  1: [
    sequence(5, 5), [...same(5, 3), ...same(9, 3)], [...same(7, 3), ...sequence(8, 4)],
    sequence(6, 7), [...same(6, 4), ...same(11, 4)], [...same(8, 4), ...sequence(9, 5)],
    sequence(7, 8), [...same(5, 2), ...same(14, 5)], sequence(5, 9), [...same(7, 3), ...same(12, 5)],
  ],
  2: [
    sequence(5, 4), [...same(8, 3, ['C', 'S']), ...same(12, 3, ['D', 'H'])], sequence(6, 6, ['D', 'H']),
    sequence(7, 7, ['H', 'S']), [...same(8, 2), ...same(12, 5)], [...same(6, 3), ...same(9, 3), ...same(14, 3)],
    same(10, 6), sequence(5, 8, ['S']), [...same(5, 4), ...same(9, 3), ...same(13, 2)], [...same(13, 8), ...same(8, 2, ['H'])],
  ],
});

function twoPlayers(): RoomState {
  const host = createPlayer({ id: 'dan', name: 'Dan', tokenHash: 'secret-host', color: 0 });
  const room = createRoom('RUMMY6', host);
  room.players.push(createPlayer({ id: 'karen', name: 'Karen', tokenHash: 'secret-guest', color: 1 }));
  return room;
}

for (const game of [1, 2] as const) {
  for (let round = 1; round <= 10; round++) {
    test(`Game ${game}, rule ${round}: exact contract partitions every card`, () => {
      const cards = fixtures()[game][round - 1];
      const shuffledOrder = [...cards.filter((_, index) => index % 2), ...cards.filter((_, index) => !(index % 2))].reverse();
      const melds = findOpeningMelds(shuffledOrder, game, round);
      assert.ok(melds, RULES[game][round - 1].title);
      assert.deepEqual(melds.map(meld => meld.kind), RULES[game][round - 1].requirements.map(requirement => requirement.kind));
      assert.deepEqual(new Set(melds.flatMap(meld => meld.cards.map(laid => laid.id))), new Set(cards.map(held => held.id)));
      assert.equal(findOpeningMelds([...cards, card(5)], game, round), null, 'Opening extras must be rejected');
      assert.equal(findOpeningMelds(cards.slice(1), game, round), null, 'Missing opening cards must be rejected');
      assert.equal(findOpeningMelds(cards.map((held, index) => index === 1 ? cards[0] : held), game, round), null, 'A physical card must never count twice');
    });

    if (game !== 2 || round !== 5) {
      test(`Game ${game}, rule ${round}: a suited wild substitutes inside the exact contract`, () => {
        const cards = fixtures()[game][round - 1];
        const replaced = cards[cards.length - 1];
        cards[cards.length - 1] = card(2, replaced.suit);
        const melds = findOpeningMelds(cards, game, round);
        assert.ok(melds);
        const wild = melds.flatMap(meld => meld.cards).find(held => held.rank === 2)!;
        assert.ok(wild.asRank && wild.asRank >= 5 && wild.asRank <= 14);
        assert.ok(wild.asSuit);
      });
    }
  }
}

test('Wild allocation solves non-greedy printed colours in alternating runs', () => {
  const cards = [card(5, 'H'), card(7, 'H'), card(9, 'H'), card(11, 'H'), card(2, 'S'), card(2, 'C'), card(2, 'S')];
  const melds = findOpeningMelds(cards, 2, 4);
  assert.ok(melds);
  assert.deepEqual(melds[0].cards.map(held => held.asRank ?? held.rank), [5, 6, 7, 8, 9, 10, 11]);
  assert.equal(melds[0].cards.filter(held => held.rank === 2).every(held => held.asSuit === held.suit), true);
});

test('Partition solver splits ambiguous duplicate ranks between a set and a run', () => {
  const cards = [card(7, 'C'), card(7, 'D'), card(7, 'H'), card(7, 'S'), card(8), card(9), card(10)];
  const melds = findOpeningMelds(cards, 1, 3);
  assert.ok(melds);
  assert.equal(melds[0].cards.length, 3);
  assert.deepEqual(melds[1].cards.map(held => held.asRank ?? held.rank), [7, 8, 9, 10]);
});

test('Printed ace remains high, with no low run or wraparound', () => {
  assert.ok(findOpeningMelds(sequence(10, 5), 1, 1));
  assert.equal(findOpeningMelds([card(14), card(5), card(6), card(7), card(8)], 1, 1), null);
  assert.equal(findOpeningMelds([card(12), card(13), card(14), card(5), card(6)], 1, 1), null);
  const meld = findOpeningMelds(sequence(10, 5), 1, 1)!;
  assert.equal(getLayoffTargets(card(2), meld).some(target => target.end === 'end'), false);
});

test('Point values use remaining printed cards, including laid wildcard representation', () => {
  for (const rank of [5, 6, 7]) assert.equal(cardPoints(card(rank)), 5);
  for (const rank of [8, 9, 10, 11, 12, 13]) assert.equal(cardPoints(card(rank)), 10);
  for (const rank of [1, 2, 14]) assert.equal(cardPoints(card(rank)), 20);
  assert.equal(handPoints([card(5), card(7), card(13), card(14), card(2)]), 60);
  assert.throws(() => cardPoints(card(3)), GameError);
  assert.throws(() => cardPoints(card(4)), GameError);
});

test('First lap, exact opening, next-turn delay, and laying off on another player all follow the house rules', () => {
  let room = applyAction(twoPlayers(), 'dan', { type: 'start' });
  room.players[0].hand = [...sequence(5, 5), card(10), card(11), card(12), card(13), card(14)];
  const openingIds = room.players[0].hand.slice(0, 5).map(held => held.id);
  room = applyAction(room, 'dan', { type: 'draw', source: 'stock' });
  assert.equal(canGoDown(publicRoom(room, 'dan')), false);
  assert.throws(() => applyAction(room, 'dan', { type: 'goDown', cardIds: openingIds }), /first turn/);
  room = applyAction(room, 'dan', { type: 'discard', cardId: room.players[0].hand.at(-1)!.id });
  room = applyAction(room, 'karen', { type: 'draw', source: 'stock' });
  room = applyAction(room, 'karen', { type: 'discard', cardId: room.players[1].hand.at(-1)!.id });
  room = applyAction(room, 'dan', { type: 'draw', source: 'stock' });
  assert.equal(canGoDown(publicRoom(room, 'dan')), true);
  assert.throws(() => applyAction(room, 'dan', { type: 'goDown', cardIds: [...openingIds, room.players[0].hand[5].id] }), /exactly/);
  room = applyAction(room, 'dan', { type: 'goDown', cardIds: openingIds });
  assert.equal(room.melds[0].ownerId, 'dan');
  assert.equal(canLayoff(publicRoom(room, 'dan')), false);
  const ten = room.players[0].hand.find(held => held.rank === 10)!;
  assert.throws(() => applyAction(room, 'dan', { type: 'layoff', cardId: ten.id, meldId: room.melds[0].id, end: 'end' }), /next turn/);
  room = applyAction(room, 'dan', { type: 'discard', cardId: room.players[0].hand.at(-1)!.id });
  room = applyAction(room, 'karen', { type: 'draw', source: 'stock' });
  room = applyAction(room, 'karen', { type: 'discard', cardId: room.players[1].hand.at(-1)!.id });
  room = applyAction(room, 'dan', { type: 'draw', source: 'stock' });
  assert.equal(canLayoff(publicRoom(room, 'dan')), true);
  room.melds[0].ownerId = 'karen';
  room = applyAction(room, 'dan', { type: 'layoff', cardId: ten.id, meldId: room.melds[0].id, end: 'end' });
  assert.equal(room.melds[0].cards.at(-1)!.rank, 10);
});

test('Discard reshuffle retains its visible top and never creates new cards', () => {
  let room = applyAction(twoPlayers(), 'dan', { type: 'start' });
  room.stock = [];
  const buried = [card(5), card(6), card(7)];
  const top = card(14);
  room.discardPile = [...buried, top];
  const beforeHand = room.players[0].hand.length;
  room = applyAction(room, 'dan', { type: 'draw', source: 'stock' });
  assert.equal(room.discardPile.length, 1);
  assert.equal(room.discardPile[0].id, top.id);
  assert.equal(room.stock.length, 2);
  assert.equal(room.players[0].hand.length, beforeHand + 1);
  assert.deepEqual(new Set([...room.stock, room.players[0].hand.at(-1)!].map(held => held.id)), new Set(buried.map(held => held.id)));
});

test('Ten completed rules accumulate deadwood once, finish the match and reset in the lobby', () => {
  let room = applyAction(twoPlayers(), 'dan', { type: 'start' });
  for (let round = 1; round <= 10; round++) {
    assert.equal(room.round, round);
    assert.equal(room.players.every(player => player.ruleNumber === round), true);
    assert.equal(room.players.every(player => player.completedTurns === 0 && player.hand.length === 10), true);
    const winner = room.players.find(player => player.id === room.turnPlayerId)!;
    const other = room.players.find(player => player.id !== winner.id)!;
    winner.hand = [card(5)]; winner.down = true; winner.laidDownTurn = 0;
    other.hand = [card(14), card(2), card(7)]; other.down = true;
    room.phase = 'play';
    room = applyAction(room, winner.id, { type: 'discard', cardId: winner.hand[0].id });
    assert.equal(room.status, round === 10 ? 'finished' : 'round-end');
    assert.equal(room.result!.scores.find(row => row.playerId === other.id)!.penalty, 45);
    assert.equal(room.result!.scores.find(row => row.playerId === winner.id)!.penalty, 0);
    assert.equal(room.history.length, round);
    if (round < 10) room = applyAction(room, 'dan', { type: 'nextHand' });
  }
  assert.equal(room.players[0].score, 225);
  assert.equal(room.players[1].score, 225);
  assert.match(room.events.findLast(event => event.type === 'game-end')!.text, /Dan and Karen/);
  assert.throws(() => applyAction(room, 'dan', { type: 'nextHand' }), GameError);
  room = applyAction(room, 'dan', { type: 'rematch' });
  assert.equal(room.status, 'lobby');
  assert.equal(room.round, 1);
  assert.equal(room.history.length, 0);
  assert.equal(room.players.every(player => player.ruleNumber === 1 && player.score === 0 && !player.hand.length && player.ready), true);
});

for (const difficulty of ['easy', 'medium', 'hard'] as Difficulty[]) {
  test(`${difficulty} AI completes opening and obeys the delay before laying off`, () => {
    let room = applyAction(twoPlayers(), 'dan', { type: 'start' });
    const bot = room.players[0];
    bot.isBot = true; bot.difficulty = difficulty; bot.completedTurns = 1;
    bot.hand = [...sequence(5, 5), card(10), card(14)];
    room.phase = 'play'; room.turnNumber = 3;
    const action = chooseBotAction(publicRoom(room, bot.id), difficulty);
    assert.equal(action.type, 'goDown');
    room = applyAction(room, 'karen', { type: 'botStep' });
    assert.equal(room.players[0].down, true);
    assert.equal(room.players[0].hand.length, 2);
    assert.equal(chooseBotAction(publicRoom(room, bot.id), difficulty).type, 'discard');
    room = applyAction(room, 'karen', { type: 'botStep' });
    assert.equal(room.turnPlayerId, 'karen');
    assert.equal(room.players[0].hand.length, 1);
    assert.ok(getLayoffTargets(room.players[0].hand[0], room.melds).length, 'The bot keeps a card which fits its exposed run');
  });
}

test('BotStep acts only for the current bot and redacted state never contains hidden hands', () => {
  let room = twoPlayers();
  room = applyAction(room, 'dan', { type: 'addBot', difficulty: 'hard' });
  room = applyAction(room, 'dan', { type: 'start' });
  assert.throws(() => applyAction(room, 'dan', { type: 'botStep' }), /human/);
  const bot = room.players[2];
  room.turnPlayerId = bot.id;
  const view = publicRoom(room, bot.id);
  const serialized = JSON.stringify(view);
  for (const hidden of [...room.players[0].hand, ...room.players[1].hand, ...room.stock]) assert.equal(serialized.includes(hidden.id), false);
  assert.equal(serialized.includes('secret-host'), false);
  assert.equal(serialized.includes('secret-guest'), false);
  room = applyAction(room, 'dan', { type: 'botStep' });
  assert.equal(room.phase, 'play');
  assert.equal(room.players[2].hand.length, 11);
});

test('Turn timer sets one deadline for the whole turn and expires with a single legal pass', () => {
  let room = applyAction(twoPlayers(), 'dan', { type: 'setTurnLimit', seconds: 30 });
  room = applyAction(room, 'dan', { type: 'start' });
  const deadline = room.turnDeadline;
  assert.ok(deadline && deadline > Date.now());
  assert.throws(() => applyAction(room, 'karen', { type: 'timeout' }), /still has time/);
  room = applyAction(room, 'dan', { type: 'draw', source: 'stock' });
  assert.equal(room.turnDeadline, deadline);
  const previousVersion = room.version;
  room.turnDeadline = Date.now() - 1;
  room = applyAction(room, 'karen', { type: 'timeout' });
  assert.equal(room.version, previousVersion + 1);
  assert.equal(room.players[0].hand.length, 10);
  assert.equal(room.players[0].completedTurns, 1);
  assert.equal(room.turnPlayerId, 'karen');
  assert.equal(room.phase, 'draw');
  assert.ok(room.turnDeadline && room.turnDeadline > Date.now());
  assert.equal(room.events.at(-1)!.type, 'timeout');
});

test('An expired draw phase draws and discards, while a late opening is never accepted', () => {
  let room = applyAction(twoPlayers(), 'dan', { type: 'setTurnLimit', seconds: 30 });
  room = applyAction(room, 'dan', { type: 'start' });
  room.players[0].hand = [...sequence(5, 5), ...same(13, 5)];
  room.players[0].completedTurns = 1;
  room.turnDeadline = Date.now() - 10;
  room = applyAction(room, 'dan', { type: 'goDown', cardIds: room.players[0].hand.slice(0, 5).map(held => held.id) });
  assert.equal(room.players[0].hand.length, 10);
  assert.equal(room.players[0].down, false);
  assert.equal(room.melds.length, 0);
  assert.equal(room.turnPlayerId, 'karen');
  assert.equal(room.events.at(-1)!.type, 'timeout');
});

test('Unlimited time has no deadline and only the host selects a valid limit in the lobby', () => {
  let room = twoPlayers();
  assert.equal(room.turnLimitSeconds, 0);
  assert.equal(room.turnDeadline, null);
  assert.throws(() => applyAction(room, 'karen', { type: 'setTurnLimit', seconds: 30 }), /host/);
  for (const seconds of [-1, 1, 14, 301, 1.5, NaN]) assert.throws(() => applyAction(room, 'dan', { type: 'setTurnLimit', seconds }), GameError);
  room = applyAction(room, 'dan', { type: 'start' });
  assert.equal(room.turnDeadline, null);
  assert.throws(() => applyAction(room, 'dan', { type: 'timeout' }), /still has time/);
  assert.throws(() => applyAction(room, 'dan', { type: 'setTurnLimit', seconds: 60 }), /lobby/);
});
