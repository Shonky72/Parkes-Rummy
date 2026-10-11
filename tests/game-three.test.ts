import assert from 'node:assert/strict';
import test from 'node:test';
import type { Card, Difficulty, Meld, RoomState, Suit } from '../lib/types';

const {
  RULES, applyAction, chooseBotAction, createPlayer, createRoom, findOpeningMelds,
  getLayoffTargets, publicRoom, roomPreview,
} = await import(new URL('../lib/rummy.ts', import.meta.url).href) as typeof import('../lib/rummy');

let serial = 0;
const card = (rank: number, suit: Suit = 'C'): Card => ({ id: `game-three-${++serial}`, rank, suit });
const cards = (values: readonly (readonly [number, Suit])[]): Card[] => values.map(([rank, suit]) => card(rank, suit));
const set = (rank: number, suits: Suit[]): Card[] => suits.map(suit => card(rank, suit));
const run = (start: number, suits: Suit[]): Card[] => suits.map((suit, index) => card(start + index, suit));
const rankOf = (held: Card & { asRank?: number }): number => held.asRank ?? held.rank;
const red = (suit: Suit): boolean => suit === 'D' || suit === 'H';

// Every natural fixture is possible using the ordinary two-pack deck, including
// the two distinct physical queens of hearts needed for the final opening.
const openings = (): Card[][] => [
  run(5, ['H', 'C', 'D', 'S']),
  [...set(8, ['H', 'D', 'H', 'D']), ...set(12, ['C', 'S', 'C'])],
  run(5, ['S', 'S', 'S', 'S', 'S']),
  [...run(5, ['H', 'C', 'D', 'S', 'H', 'C', 'D']), ...set(13, ['H', 'S'])],
  [...set(6, ['C', 'D', 'H']), ...set(12, ['C', 'D', 'H', 'S', 'C'])],
  [...set(6, ['H', 'D', 'H']), ...set(9, ['C', 'S', 'C']), ...set(14, ['H', 'D', 'C'])],
  [...set(10, ['C', 'D', 'H', 'S', 'C', 'D']), ...set(7, ['H', 'S'])],
  run(5, ['S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S']),
  [...set(6, ['C', 'D', 'H', 'S']), ...set(10, ['C', 'D', 'H', 'S']), ...set(14, ['H', 'S'])],
  [...set(8, ['C', 'D', 'H', 'S', 'C', 'D', 'H', 'S']), ...set(12, ['H', 'H'])],
];

const expectedGroups: [Meld['kind'], number][][] = [
  [['run', 4]], [['set', 4], ['set', 3]], [['run', 5]],
  [['run', 7], ['set', 2]], [['set', 3], ['set', 5]],
  [['set', 3], ['set', 3], ['set', 3]], [['set', 6], ['set', 2]],
  [['run', 9]], [['set', 4], ['set', 4], ['set', 2]], [['set', 8], ['set', 2]],
];

function assertTwoPackHand(hand: Card[]): void {
  const copies = new Map<string, number>();
  for (const held of hand) {
    const key = `${held.rank}:${held.suit}`;
    copies.set(key, (copies.get(key) ?? 0) + 1);
    assert.ok(copies.get(key)! <= 2, `Fixture exceeds two printed copies of ${key}`);
  }
  assert.equal(new Set(hand.map(held => held.id)).size, hand.length);
}

function lobby(count = 2): RoomState {
  const room = createRoom('GME3', createPlayer({ id: 'host', name: 'Dan', color: 0, tokenHash: 'host-secret' }));
  for (let index = 1; index < count; index++) {
    room.players.push(createPlayer({ id: `guest-${index}`, name: `Guest ${index}`, color: index, tokenHash: `guest-${index}-secret` }));
  }
  return room;
}

function playing(ruleNumber: number, count = 2): RoomState {
  let room = applyAction(lobby(count), 'host', { type: 'setGame', game: 3 });
  room = applyAction(room, 'host', { type: 'start' });
  room.phase = 'play';
  room.turnNumber = count + 1;
  room.turnPlayerId = 'host';
  for (const player of room.players) {
    player.completedTurns = 1;
    player.ruleNumber = ruleNumber;
  }
  return room;
}

test('Game 3 is host-selectable in the lobby, survives previews and deals, and exposes ten numbered contracts', () => {
  const before = lobby();
  assert.throws(() => applyAction(before, 'guest-1', { type: 'setGame', game: 3 }), /host/i);
  const selected = applyAction(before, 'host', { type: 'setGame', game: 3 });
  assert.equal(before.game, 1, 'Selecting a game preserves the original state object');
  assert.equal(selected.game, 3);
  assert.equal(roomPreview(selected).game, 3);
  const room = applyAction(selected, 'host', { type: 'start' });
  assert.equal(room.game, 3);
  assert.deepEqual(RULES[3].map(rule => rule.number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(room.players.every(player => player.hand.length === 10 && player.ruleNumber === 1));
  assert.deepEqual(publicRoom(room, 'host').currentRule, RULES[3][0]);
  assert.throws(() => applyAction(room, 'host', { type: 'setGame', game: 1 }), /lobby/i);
});

for (let ruleNumber = 1; ruleNumber <= 10; ruleNumber++) {
  test(`Game 3, rule ${ruleNumber}: its exact opening uses every physical card once, in any hand order`, () => {
    const hand = openings()[ruleNumber - 1];
    assertTwoPackHand(hand);
    assert.ok(hand.length <= 10);
    const before = structuredClone(hand);
    const reordered = [...hand.filter((_, index) => index % 2), ...hand.filter((_, index) => !(index % 2))].reverse();
    for (const order of [hand, reordered]) {
      const melds = findOpeningMelds(order, 3, ruleNumber);
      assert.ok(melds, `Rule ${ruleNumber} rejected its approved natural opening`);
      assert.deepEqual(melds.map(meld => [meld.kind, meld.cards.length]), expectedGroups[ruleNumber - 1]);
      const usedIds = melds.flatMap(meld => meld.cards.map(held => held.id));
      assert.equal(new Set(usedIds).size, hand.length);
      assert.deepEqual(new Set(usedIds), new Set(hand.map(held => held.id)));
    }
    assert.deepEqual(hand, before, 'Validation must not rearrange or modify cards in the hand');
    assert.equal(findOpeningMelds([...hand, card(14, 'D')], 3, ruleNumber), null, 'Extra opening cards are rejected');
    assert.equal(findOpeningMelds(hand.slice(1), 3, ruleNumber), null, 'Missing opening cards are rejected');
    assert.equal(findOpeningMelds(hand.map((held, index) => index === 1 ? hand[0] : held), 3, ruleNumber), null, 'A duplicated physical card never satisfies two positions');
  });
}

test('Game 3, rule 1 requires both alternating colours and all four printed suits, starting with either colour', () => {
  assert.ok(findOpeningMelds(run(5, ['C', 'H', 'S', 'D']), 3, 1));
  assert.equal(findOpeningMelds(run(5, ['H', 'D', 'C', 'S']), 3, 1), null, 'Four distinct suits alone are insufficient');
  assert.equal(findOpeningMelds(run(5, ['H', 'C', 'H', 'S']), 3, 1), null, 'Alternation alone is insufficient');
  assert.equal(findOpeningMelds(cards([[5, 'H'], [6, 'C'], [7, 'D'], [2, 'C']]), 3, 1), null, 'A two cannot replace a missing printed suit');
  const opening = findOpeningMelds(cards([[2, 'S'], [7, 'D'], [2, 'C'], [5, 'H']]), 3, 1)!;
  assert.ok(opening, 'The solver must allocate the two black wilds to separate rank positions');
  assert.deepEqual(opening[0].cards.map(rankOf), [5, 6, 7, 8]);
  assert.equal(new Set(opening[0].cards.map(held => held.asSuit ?? held.suit)).size, 4);
  assert.ok(opening[0].cards.filter(held => held.rank === 2).every(held => held.asSuit === held.suit));
  assert.deepEqual(opening[0].cards.map(held => red(held.asSuit ?? held.suit)), [true, false, true, false]);
});

for (const fourColour of ['red', 'black'] as const) {
  test(`Game 3, rule 2 accepts four ${fourColour} cards and three of the opposite colour, with printed-colour wilds`, () => {
    const four: Suit[] = fourColour === 'red' ? ['H', 'D', 'H', 'D'] : ['C', 'S', 'C', 'S'];
    const three: Suit[] = fourColour === 'red' ? ['C', 'S', 'C'] : ['H', 'D', 'H'];
    const hand = [...set(8, four), ...set(12, three)];
    assertTwoPackHand(hand);
    const melds = findOpeningMelds(hand, 3, 2)!;
    assert.ok(melds);
    assert.deepEqual(melds.map(meld => [meld.cards.length, red(meld.cards[0].suit)]), [[4, fourColour === 'red'], [3, fourColour !== 'red']]);
    const matchingWild = [...hand];
    matchingWild[3] = card(2, four[3]);
    assert.ok(findOpeningMelds(matchingWild, 3, 2));
    matchingWild[3] = card(2, three[0]);
    const reallocated = findOpeningMelds(matchingWild, 3, 2)!;
    assert.ok(reallocated, 'A wild of the opposite colour completes the other triple as a group of four');
    assert.equal(red(reallocated[0].cards[0].suit), fourColour !== 'red');
    const wrongTripleWild = [...hand];
    wrongTripleWild[6] = card(2, four[0]);
    assert.equal(findOpeningMelds(wrongTripleWild, 3, 2), null, 'A group with only two cards of the required colour cannot use the opposite-colour two');
  });
}

test('Game 3, rule 2 rejects equal-colour groups and mixed-colour four-of-a-kind', () => {
  assert.equal(findOpeningMelds([...set(8, ['H', 'D', 'H', 'D']), ...set(12, ['H', 'D', 'H'])], 3, 2), null);
  assert.equal(findOpeningMelds([...set(8, ['H', 'D', 'H', 'C']), ...set(12, ['C', 'S', 'C'])], 3, 2), null);
});

test('Game 3, rule 3 needs five of one suit and retains the printed suit of each two', () => {
  const base = run(5, ['H', 'H', 'H', 'H']);
  assert.ok(findOpeningMelds([...base, card(2, 'H')], 3, 3));
  assert.equal(findOpeningMelds([...base, card(2, 'D')], 3, 3), null, 'Matching colour without matching suit is insufficient');
  assert.equal(findOpeningMelds([...base, card(9, 'D')], 3, 3), null);
});

test('Game 3, rule 4 alternates printed colours in the run but allows any wild in the separate pair', () => {
  const partial = cards([[5, 'H'], [7, 'D'], [8, 'S'], [9, 'H'], [10, 'C'], [11, 'D']]);
  assert.ok(findOpeningMelds([...partial, card(2, 'C'), ...set(13, ['H', 'S'])], 3, 4));
  assert.equal(findOpeningMelds([...partial, card(2, 'H'), ...set(13, ['H', 'S'])], 3, 4), null);
  const allocated = findOpeningMelds([...partial, card(13, 'C'), card(2, 'H'), card(2, 'S')], 3, 4)!;
  assert.ok(allocated, 'Keep the black wild for the missing black run position and use the red wild in the pair');
  assert.equal(allocated[0].cards.find(held => held.rank === 2)?.suit, 'S');
  assert.equal(allocated[1].cards.find(held => held.rank === 2)?.suit, 'H');
  assert.equal(findOpeningMelds([...run(5, ['H', 'C', 'D', 'S', 'H', 'C', 'D']), card(13, 'H'), card(14, 'S')], 3, 4), null, 'The final group must be a matching pair');
});

test('Game 3, rule 5 rejects twos in either of its natural-only sets', () => {
  for (const index of [0, 7]) {
    const hand = openings()[4];
    hand[index] = card(2, hand[index].suit);
    assert.equal(findOpeningMelds(hand, 3, 5), null);
  }
});

test('Game 3, rule 6 assigns coloured twos to the correct triples and leaves the third triple unrestricted', () => {
  const hand = cards([[6, 'H'], [6, 'D'], [2, 'C'], [9, 'C'], [9, 'S'], [2, 'H'], [14, 'H'], [14, 'D'], [2, 'S']]);
  assertTwoPackHand(hand);
  const melds = findOpeningMelds(hand, 3, 6)!;
  assert.ok(melds);
  assert.ok(melds[0].cards.every(held => red(held.suit)), 'The first triple is red, including its two');
  assert.ok(melds[1].cards.every(held => !red(held.suit)), 'The second triple is black, including its two');
  assert.ok(melds[2].cards.some(held => held.rank === 2 && !red(held.suit)), 'The unrestricted third triple accepts a black two alongside red naturals');
  assert.equal(findOpeningMelds([...set(6, ['H', 'D']), card(2, 'S'), ...set(9, ['C', 'S', 'C']), ...set(14, ['H', 'D', 'C'])], 3, 6), null);
  assert.equal(findOpeningMelds([...set(6, ['C', 'S', 'C']), ...set(9, ['C', 'S', 'C']), ...set(14, ['H', 'D', 'C'])], 3, 6), null, 'Three triples without a red triple are insufficient');
});

test('Game 3, rules 7 and 9 accept unrestricted wilds across all of their separate groups', () => {
  assert.ok(findOpeningMelds([...set(10, ['C', 'D', 'H', 'S', 'C']), card(2, 'H'), card(7, 'H'), card(2, 'S')], 3, 7));
  const hand = cards([[6, 'C'], [6, 'D'], [6, 'H'], [2, 'S'], [10, 'C'], [10, 'D'], [10, 'H'], [2, 'H'], [14, 'H'], [2, 'C']]);
  assertTwoPackHand(hand);
  const melds = findOpeningMelds(hand, 3, 9)!;
  assert.ok(melds);
  assert.ok(melds.every(meld => meld.cards.some(held => held.rank === 2)));
});

test('Game 3, rule 8 allows a two from any printed suit to complete a nine-card suited run', () => {
  const base = run(5, ['S', 'S', 'S', 'S', 'S', 'S', 'S', 'S']);
  const melds = findOpeningMelds([...base, card(2, 'H')], 3, 8)!;
  assert.ok(melds);
  assert.deepEqual(melds[0].cards.map(rankOf), [5, 6, 7, 8, 9, 10, 11, 12, 13]);
  const wild = melds[0].cards.find(held => held.rank === 2)!;
  assert.equal(wild.suit, 'H');
  assert.equal(wild.asSuit, 'S');
  assert.equal(findOpeningMelds([...base, card(13, 'H')], 3, 8), null, 'Only a wild represents a different printed suit');
  assert.ok(findOpeningMelds(run(6, ['H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H']), 3, 8), 'An ace completes the high end');
  assert.equal(findOpeningMelds([...run(7, ['H', 'H', 'H', 'H', 'H', 'H', 'H', 'H']), card(5, 'H')], 3, 8), null, 'The run never wraps from ace to five');
});

test('Game 3, rule 10 allows wilds in the eight-of-a-kind but requires two natural matching hearts', () => {
  const hand = openings()[9];
  hand[0] = card(2, 'D');
  assert.ok(findOpeningMelds(hand, 3, 10));
  for (const replacement of [card(2, 'H'), card(2, 'S'), card(12, 'D'), card(11, 'H')]) {
    const invalid = openings()[9];
    invalid[9] = replacement;
    assert.equal(findOpeningMelds(invalid, 3, 10), null, 'The pair must consist of two natural hearts of the same rank');
  }
  const twosAsPair = [...openings()[9].slice(0, 8), ...set(2, ['H', 'H'])];
  const reallocated = findOpeningMelds(twosAsPair, 3, 10)!;
  assert.ok(reallocated, 'Use the two natural eight-of-hearts copies as the pair and place both twos in the large set');
  assert.ok(reallocated[1].cards.every(held => held.rank === 8 && held.suit === 'H'));
  assert.equal(reallocated[0].cards.filter(held => held.rank === 2).length, 2);
  const withoutNaturalHearts = [...set(8, ['C', 'D', 'S', 'C', 'D', 'S']), ...set(2, ['H', 'H', 'C', 'S'])];
  assertTwoPackHand(withoutNaturalHearts);
  assert.equal(findOpeningMelds(withoutNaturalHearts, 3, 10), null, 'Printed twos are excluded from the natural pair even when two printed hearts are present');
});

for (const fixture of [
  { number: 1, group: 0, rank: 9, suit: 'S' },
  { number: 2, group: 0, rank: 8, suit: 'S' },
  { number: 3, group: 0, rank: 10, suit: 'H' },
  { number: 4, group: 0, rank: 12, suit: 'H' },
  { number: 5, group: 0, rank: 6, suit: 'S' },
  { number: 6, group: 0, rank: 6, suit: 'C' },
  { number: 8, group: 0, rank: 14, suit: 'H' },
  { number: 10, group: 1, rank: 12, suit: 'C' },
] as const) {
  test(`Game 3, rule ${fixture.number}: opening restrictions do not limit later matching-rank additions or ordinary wilds`, () => {
    const room = playing(fixture.number);
    room.melds = findOpeningMelds(openings()[fixture.number - 1], 3, fixture.number)!;
    room.melds.forEach(meld => { meld.ownerId = 'guest-1'; });
    const meld = room.melds[fixture.group];
    const before = structuredClone(meld);
    room.players[0].down = true;
    room.players[0].laidDownTurn = room.turnNumber - 2;
    for (const rank of [fixture.rank, 2]) {
      const addition = card(rank, fixture.suit);
      room.players[0].hand = [addition, card(7, 'D')];
      const target = getLayoffTargets(addition, [meld]).find(candidate => candidate.end === 'end');
      assert.ok(target);
      const next = applyAction(room, 'host', { type: 'layoff', cardId: addition.id, meldId: meld.id, end: 'end' });
      const updated = next.melds[fixture.group];
      assert.deepEqual(updated.cards.slice(0, -1), before.cards, 'Existing cards and assigned wilds stay unchanged');
      assert.equal(updated.constraint, before.constraint);
      assert.equal(updated.naturalOnly, before.naturalOnly);
      assert.equal(updated.wildsMatch, before.wildsMatch);
      assert.equal(rankOf(updated.cards.at(-1)!), fixture.rank);
      assert.equal(next.players[0].hand.length, 1);
    }
  });
}

for (const difficulty of ['easy', 'medium', 'hard'] as Difficulty[]) {
  test(`Game 3 ${difficulty} AI opens either colour allocation of its own rule 2`, () => {
    for (const fourSuits of [['H', 'D', 'H', 'D'], ['C', 'S', 'C', 'S']] as Suit[][]) {
      const room = playing(2);
      room.round = 14;
      room.players[1].ruleNumber = 9;
      const bot = room.players[0];
      bot.isBot = true;
      bot.difficulty = difficulty;
      const opposite: Suit[] = red(fourSuits[0]) ? ['C', 'S', 'C'] : ['H', 'D', 'H'];
      const opening = [...set(8, fourSuits), ...set(12, opposite)];
      bot.hand = [...opening, ...cards([[5, 'H'], [6, 'D'], [7, 'C'], [14, 'S']])];
      assertTwoPackHand(bot.hand);
      const action = chooseBotAction(publicRoom(room, bot.id), difficulty);
      assert.equal(action.type, 'goDown');
      if (action.type !== 'goDown') assert.fail('Expected an opening');
      assert.equal(action.expectedRuleNumber, 2);
      assert.deepEqual(new Set(action.cardIds), new Set(opening.map(held => held.id)));
      const next = applyAction(room, 'guest-1', { type: 'botStep' });
      assert.equal(next.players[0].down, true);
      assert.equal(next.players[0].hand.length, 4);
    }
  });

  test(`Game 3 ${difficulty} AI rejects the Game 2 wild-heart-pair shortcut for rule 10`, () => {
    const room = playing(10);
    const bot = room.players[0];
    bot.hand = openings()[9];
    bot.hand[9] = card(2, 'H');
    bot.hand.push(card(5, 'C'));
    assert.equal(chooseBotAction(publicRoom(room, bot.id), difficulty).type, 'discard');
  });
}

for (const difficulty of ['medium', 'hard'] as Difficulty[]) {
  test(`Game 3 ${difficulty} AI takes a discard completing the black-four/red-three alternative`, () => {
    const room = playing(2);
    room.phase = 'draw';
    const bot = room.players[0];
    bot.hand = [...set(8, ['C', 'S', 'C', 'S']), ...set(12, ['H', 'D']), ...cards([[5, 'C'], [7, 'D'], [10, 'S'], [14, 'C']])];
    room.discardPile = [card(12, 'H')];
    assert.deepEqual(chooseBotAction(publicRoom(room, bot.id), difficulty), { type: 'draw', source: 'discard' });
  });

  test(`Game 3 ${difficulty} AI keeps a completed alternative opening while discarding on its first turn`, () => {
    const room = playing(2);
    const bot = room.players[0];
    bot.completedTurns = 0;
    const opening = [...set(8, ['C', 'S', 'C', 'S']), ...set(12, ['H', 'D', 'H'])];
    const deadwood = cards([[5, 'C'], [7, 'D'], [10, 'S'], [14, 'C']]);
    bot.hand = [...opening, ...deadwood];
    const action = chooseBotAction(publicRoom(room, bot.id), difficulty);
    assert.equal(action.type, 'discard');
    if (action.type !== 'discard') assert.fail('The first turn requires a discard');
    assert.ok(deadwood.some(held => held.id === action.cardId), 'The bot must keep the seven cards satisfying the alternative opening');
  });
}

test('Game 3 uses each player’s own rule, retains the next-turn layoff delay, and advances only players who melded', () => {
  let room = playing(2, 3);
  room.round = 14;
  room.players[1].ruleNumber = 6;
  room.players[2].ruleNumber = 9;
  room.players[1].down = true;
  room.players[1].laidDownTurn = 1;
  for (const player of room.players.slice(1)) player.hand = cards([[14, 'H'], [2, 'D'], [7, 'C']]);
  const opening = [...set(8, ['C', 'S', 'C', 'S']), ...set(12, ['H', 'D', 'H'])];
  const last = card(8, 'D');
  room.players[0].hand = [...opening, last];
  assert.deepEqual(publicRoom(room, 'host').currentRule, RULES[3][1]);
  assert.deepEqual(publicRoom(room, 'guest-1').currentRule, RULES[3][5]);
  room = applyAction(room, 'host', { type: 'goDown', cardIds: opening.map(held => held.id), expectedRuleNumber: 2 });
  assert.throws(() => applyAction(room, 'host', { type: 'layoff', cardId: last.id, meldId: room.melds[0].id, end: 'end' }), /next turn/i);
  room = applyAction(room, 'host', { type: 'discard', cardId: last.id });
  assert.equal(room.status, 'round-end');
  assert.deepEqual(room.result!.scores.map(row => [row.ruleNumber, row.melded, row.nextRuleNumber, row.penalty]), [
    [2, true, 3, 0], [6, true, 7, 45], [9, false, 9, 45],
  ]);
  const next = applyAction(room, 'host', { type: 'nextHand' });
  assert.equal(next.game, 3);
  assert.equal(next.round, 15);
  assert.deepEqual(next.players.map(player => player.ruleNumber), [3, 7, 9]);
  assert.ok(next.players.every(player => player.hand.length === 10 && !player.down));
  assert.deepEqual(publicRoom(next, 'host').currentRule, RULES[3][2]);
});

test('Game 3 completes the match after the natural-heart final opening and preserves its game choice on rematch', () => {
  let room = playing(10);
  const opening = openings()[9];
  const last = card(5, 'C');
  room.players[0].hand = [...opening, last];
  room.players[1].ruleNumber = 3;
  room.players[1].hand = cards([[14, 'H'], [2, 'S'], [7, 'D']]);
  room = applyAction(room, 'host', { type: 'goDown', cardIds: opening.map(held => held.id), expectedRuleNumber: 10 });
  room = applyAction(room, 'host', { type: 'discard', cardId: last.id });
  assert.equal(room.status, 'finished');
  assert.deepEqual(room.result!.scores.map(row => [row.ruleNumber, row.completed, row.penalty]), [[10, true, 0], [3, false, 45]]);
  const reset = applyAction(room, 'host', { type: 'rematch' });
  assert.equal(reset.status, 'lobby');
  assert.equal(reset.game, 3);
  assert.ok(reset.players.every(player => player.ruleNumber === 1 && player.score === 0 && !player.hand.length));
});
