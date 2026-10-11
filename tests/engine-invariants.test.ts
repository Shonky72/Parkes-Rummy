import assert from 'node:assert/strict';
import test from 'node:test';
import type { Card, Difficulty, GameAction, GameType, PublicRoom, RoomState, Suit } from '../lib/types';

// Use Node's native TypeScript loader without changing the application's tsconfig.
const {
  applyAction, canGoDown, canLayoff, cardPoints, chooseBotAction, createDeck,
  createPlayer, createRoom, findOpeningMelds, GameError, getLayoffTargets,
  handPoints, publicRoom, roomPreview,
} = await import(new URL('../lib/rummy.ts', import.meta.url).href) as typeof import('../lib/rummy');

let serial = 0;
function card(rank: number, suit: Suit = 'C'): Card {
  return { id: `fixture-${++serial}-${rank}-${suit}`, rank, suit };
}
function cards(values: [number, Suit][]): Card[] {
  return values.map(([rank, suit]) => card(rank, suit));
}
function lobby(count = 2): RoomState {
  const host = createPlayer({ id: 'host', name: 'Dan', color: 0, tokenHash: 'secret-host-token-hash' });
  const room = createRoom('TEST2A', host);
  for (let index = 1; index < count; index++) {
    room.players.push(createPlayer({
      id: `guest-${index}`, name: `Guest ${index}`, color: index,
      tokenHash: `secret-guest-${index}-token-hash`,
    }));
  }
  return room;
}
function playing(game: GameType = 1, round = 1): RoomState {
  const room = lobby();
  room.game = game;
  room.round = round;
  room.status = 'playing';
  room.turnNumber = 3;
  room.turnPlayerId = 'host';
  room.phase = 'play';
  room.turnLimitSeconds = 0;
  room.turnDeadline = null;
  room.players.forEach(player => { player.completedTurns = 1; player.ruleNumber = round; });
  room.players[0].hand = cards([[5, 'C'], [6, 'D'], [7, 'H'], [8, 'S'], [9, 'C'], [10, 'H'], [13, 'D']]);
  room.players[1].hand = cards([[14, 'H'], [2, 'S'], [5, 'D'], [8, 'H']]);
  room.stock = cards([[11, 'H'], [12, 'S'], [6, 'C']]);
  room.discardPile = cards([[7, 'D'], [10, 'C']]);
  return room;
}
function rejectsWithoutMutation(room: RoomState, actorId: string, action: unknown, message?: RegExp): void {
  const before = structuredClone(room);
  assert.throws(() => applyAction(room, actorId, action as GameAction), error => {
    assert.ok(error instanceof GameError, `Expected GameError, received ${String(error)}`);
    if (message) assert.match(error.message, message);
    return true;
  });
  assert.deepEqual(room, before, 'Rejected actions must not change authoritative state');
}

test('eight players receive ten unique physical cards, with no threes or fours anywhere', () => {
  const before = lobby(8);
  const original = structuredClone(before);
  const room = applyAction(before, 'host', { type: 'start' });
  assert.deepEqual(before, original);
  assert.equal(room.players.length, 8);
  assert.ok(room.players.every(player => player.hand.length === 10));
  assert.equal(room.discardPile.length, 1);
  assert.ok(room.stock.length > 0);
  const all = [...room.stock, ...room.discardPile, ...room.players.flatMap(player => player.hand)];
  assert.equal(new Set(all.map(item => item.id)).size, all.length);
  assert.ok(all.every(item => [2, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].includes(item.rank)));
  for (const size of [2, 4, 6, 8]) {
    const deck = createDeck(size);
    assert.ok(deck.length > size * 10);
    assert.ok(deck.every(item => item.rank !== 3 && item.rank !== 4));
  }
});

test('scoring follows the three penalty bands and rejects removed ranks', () => {
  for (const rank of [5, 6, 7]) assert.equal(cardPoints(card(rank)), 5);
  for (const rank of [8, 9, 10, 11, 12, 13]) assert.equal(cardPoints(card(rank)), 10);
  for (const rank of [1, 2, 14]) assert.equal(cardPoints(card(rank)), 20);
  assert.equal(handPoints(cards([[5, 'C'], [7, 'D'], [8, 'H'], [13, 'S'], [14, 'H'], [2, 'C']])), 70);
  assert.throws(() => cardPoints(card(3)), GameError);
  assert.throws(() => cardPoints(card(4)), GameError);
});

test('opening selection requires exact cardinality and unique physical card IDs', () => {
  const room = playing();
  const opening = room.players[0].hand.slice(0, 5);
  assert.ok(findOpeningMelds(opening, 1, 1));
  assert.equal(findOpeningMelds(room.players[0].hand.slice(0, 6), 1, 1), null);
  assert.equal(findOpeningMelds([...opening.slice(0, 4), opening[0]], 1, 1), null);
  rejectsWithoutMutation(room, 'host', { type: 'goDown', cardIds: room.players[0].hand.slice(0, 6).map(item => item.id) }, /exactly/i);
  rejectsWithoutMutation(room, 'host', { type: 'goDown', cardIds: [...opening.map(item => item.id), opening[0].id] }, /once/i);
});

test('first turn blocks an opening even when the correct cards are held', () => {
  const room = playing();
  room.turnNumber = 1;
  room.players.forEach(player => { player.completedTurns = 0; });
  assert.equal(canGoDown(publicRoom(room, 'host')), false);
  rejectsWithoutMutation(room, 'host', { type: 'goDown', cardIds: room.players[0].hand.slice(0, 5).map(item => item.id) }, /first turn/i);
});

test('going down blocks every layoff until a later turn, including additions to own cards', () => {
  const room = playing();
  const down = applyAction(room, 'host', { type: 'goDown', cardIds: room.players[0].hand.slice(0, 5).map(item => item.id) });
  const extra = down.players[0].hand.find(item => item.rank === 10)!;
  const target = down.melds[0];
  assert.equal(canLayoff(publicRoom(down, 'host')), false);
  rejectsWithoutMutation(down, 'host', { type: 'layoff', cardId: extra.id, meldId: target.id, end: 'end' }, /next turn/i);
  const later = structuredClone(down);
  later.turnNumber += later.players.length;
  assert.equal(canLayoff(publicRoom(later, 'host')), true);
  const added = applyAction(later, 'host', { type: 'layoff', cardId: extra.id, meldId: target.id, end: 'end' });
  assert.equal(added.melds[0].cards.at(-1)?.id, extra.id);
  assert.equal(added.players[0].hand.length, later.players[0].hand.length - 1);
});

test('an unexposed player must not add a card to another player’s meld', () => {
  const room = playing();
  const [meld] = findOpeningMelds(cards([[5, 'H'], [6, 'D'], [7, 'C'], [8, 'H'], [9, 'S']]), 1, 1)!;
  meld.id = 'other-meld';
  meld.ownerId = room.players[1].id;
  room.melds = [meld];
  const extra = room.players[0].hand.find(item => item.rank === 10)!;
  rejectsWithoutMutation(room, 'host', { type: 'layoff', cardId: extra.id, meldId: meld.id, end: 'end' }, /go down/i);
});

test('aces extend kings, never wrap below fives or above aces', () => {
  const high = cards([[10, 'H'], [11, 'D'], [12, 'S'], [13, 'C'], [14, 'H']]);
  assert.ok(findOpeningMelds(high, 1, 1));
  assert.ok(findOpeningMelds([...high.slice(0, 4), card(1, 'H')], 1, 1));
  assert.equal(findOpeningMelds(cards([[14, 'H'], [5, 'D'], [6, 'S'], [7, 'C'], [8, 'H']]), 1, 1), null);
  assert.equal(findOpeningMelds(cards([[12, 'H'], [13, 'D'], [14, 'S'], [5, 'C'], [6, 'H']]), 1, 1), null);
  const melds = findOpeningMelds(high, 1, 1)!;
  assert.deepEqual(getLayoffTargets(card(5, 'S'), melds), []);
  assert.ok(getLayoffTargets(card(2, 'S'), melds).every(target => target.asRank <= 14));
  assert.ok(getLayoffTargets(card(2, 'S'), melds).every(target => target.end === 'start'));
});

test('Game 2 rule 1 rejects duplicate suits and a wild from the wrong printed suit', () => {
  assert.equal(findOpeningMelds(cards([[5, 'C'], [6, 'D'], [7, 'H'], [8, 'H']]), 2, 1), null);
  assert.equal(findOpeningMelds(cards([[5, 'C'], [6, 'D'], [7, 'H'], [2, 'H']]), 2, 1), null);
  const valid = findOpeningMelds(cards([[5, 'C'], [6, 'D'], [7, 'H'], [2, 'S']]), 2, 1);
  assert.ok(valid);
  assert.equal(valid[0].cards.at(-1)?.asRank, 8);
  assert.equal(valid[0].cards.at(-1)?.asSuit, 'S');
});

test('Game 2 rule 2 rejects a red wild filling a black set', () => {
  assert.equal(findOpeningMelds(cards([[8, 'C'], [8, 'S'], [2, 'D'], [9, 'D'], [9, 'H'], [9, 'D']]), 2, 2), null);
  assert.ok(findOpeningMelds(cards([[8, 'C'], [8, 'S'], [2, 'C'], [9, 'D'], [9, 'H'], [9, 'D']]), 2, 2));
});

test('Game 2 rule 3 rejects mixed colours, including a wrong-colour wild', () => {
  assert.equal(findOpeningMelds(cards([[5, 'H'], [6, 'D'], [7, 'H'], [8, 'S'], [9, 'H'], [10, 'D']]), 2, 3), null);
  assert.equal(findOpeningMelds(cards([[5, 'H'], [6, 'D'], [7, 'H'], [8, 'D'], [9, 'H'], [2, 'C']]), 2, 3), null);
  assert.ok(findOpeningMelds(cards([[5, 'H'], [6, 'D'], [7, 'H'], [8, 'D'], [9, 'H'], [2, 'D']]), 2, 3));
});

test('Game 2 rule 4 enforces each alternating position on natural and wild cards', () => {
  assert.equal(findOpeningMelds(cards([[5, 'H'], [6, 'D'], [7, 'D'], [8, 'S'], [9, 'H'], [10, 'C'], [11, 'D']]), 2, 4), null);
  assert.equal(findOpeningMelds(cards([[5, 'H'], [6, 'C'], [7, 'D'], [8, 'S'], [9, 'H'], [2, 'H'], [11, 'D']]), 2, 4), null);
  assert.ok(findOpeningMelds(cards([[5, 'H'], [6, 'C'], [7, 'D'], [8, 'S'], [9, 'H'], [2, 'C'], [11, 'D']]), 2, 4));
});

test('Game 2 rule 5 rejects twos in the opening but allows later wild additions', () => {
  const pair = cards([[5, 'H'], [5, 'C']]);
  const five = cards([[8, 'H'], [8, 'D'], [8, 'S'], [8, 'C'], [8, 'H']]);
  const opening = findOpeningMelds([...pair, ...five], 2, 5);
  assert.ok(opening);
  assert.equal(findOpeningMelds([...pair, ...five.slice(0, 4), card(2, 'H')], 2, 5), null);
  assert.equal(findOpeningMelds([pair[0], card(2, 'C'), ...five], 2, 5), null);
  assert.deepEqual(getLayoffTargets(card(2, 'D'), opening).map(target => target.asRank).sort((a, b) => a - b), [5, 8]);
  assert.ok(getLayoffTargets(card(8, 'D'), opening).length > 0);
});

test('Game 2 rule 8 enforces one represented suit while allowing an unrestricted two', () => {
  const base = cards([[5, 'C'], [6, 'C'], [7, 'C'], [8, 'C'], [9, 'C'], [10, 'C'], [11, 'C']]);
  assert.equal(findOpeningMelds([...base, card(12, 'S')], 2, 8), null);
  const opening = findOpeningMelds([...base, card(2, 'S')], 2, 8);
  assert.ok(opening);
  assert.equal(opening[0].cards.at(-1)?.asSuit, 'C');
  assert.equal(opening[0].cards.at(-1)?.asRank, 12);
});

test('Game 2 rule 10 rejects a non-heart natural pair', () => {
  const eight = cards([[5, 'C'], [5, 'D'], [5, 'H'], [5, 'S'], [5, 'C'], [5, 'D'], [5, 'H'], [5, 'S']]);
  assert.equal(findOpeningMelds([...eight, ...cards([[9, 'C'], [9, 'D']])], 2, 10), null);
  assert.ok(findOpeningMelds([...eight, ...cards([[9, 'H'], [9, 'H']])], 2, 10));
});

test('exposed colour requirements allow later matching ranks and wilds of either colour', () => {
  const opening = findOpeningMelds(cards([[8, 'C'], [8, 'S'], [8, 'C'], [9, 'D'], [9, 'H'], [9, 'D']]), 2, 2)!;
  const black = opening.find(meld => meld.constraint === 'black')!;
  assert.equal(getLayoffTargets(card(8, 'H'), [black]).length, 1);
  assert.equal(getLayoffTargets(card(2, 'H'), [black]).length, 1);
  assert.equal(getLayoffTargets(card(8, 'C'), [black]).length, 1);
  assert.equal(getLayoffTargets(card(2, 'S'), [black]).length, 1);
  assert.deepEqual(getLayoffTargets(card(9, 'C'), [black]), []);
});

test('screenshot regression: a black five joins the exposed red fives after drawing on the next turn', () => {
  let room = playing(2, 2);
  const opening = cards([[6, 'C'], [6, 'S'], [2, 'S'], [5, 'D'], [5, 'H'], [2, 'H']]);
  const extra = card(5, 'C');
  const discard = card(12, 'S');
  room.players[0].hand = [...opening, extra, discard, card(11, 'D')];
  room = applyAction(room, 'host', { type: 'goDown', cardIds: opening.map(item => item.id), expectedRuleNumber: 2 });
  const red = room.melds.find(meld => meld.constraint === 'red')!;
  const exposed = structuredClone(red);
  assert.equal(red.cards.find(item => item.rank === 2)?.asRank, 5);
  assert.equal(red.cards.find(item => item.rank === 2)?.asSuit, 'H');
  const layoff: GameAction = { type: 'layoff', cardId: extra.id, meldId: red.id, end: 'end' };
  rejectsWithoutMutation(room, 'host', layoff, /next turn/i);
  room = applyAction(room, 'host', { type: 'discard', cardId: discard.id });
  rejectsWithoutMutation(room, 'host', layoff, /turn/i);
  room = applyAction(room, 'guest-1', { type: 'draw', source: 'stock' });
  room = applyAction(room, 'guest-1', { type: 'discard', cardId: room.players[1].hand[0].id });
  rejectsWithoutMutation(room, 'host', layoff, /draw/i);
  room = applyAction(room, 'host', { type: 'draw', source: 'stock' });
  const before = structuredClone(room);
  const after = applyAction(room, 'host', layoff);
  assert.deepEqual(room, before);
  assert.deepEqual(after.melds.find(meld => meld.id === red.id)?.cards, [...exposed.cards, extra]);
  assert.equal(after.melds.find(meld => meld.id === red.id)?.constraint, 'red');
  assert.equal(after.melds.find(meld => meld.id === red.id)?.wildsMatch, true);
  assert.equal(after.players[0].hand.length, before.players[0].hand.length - 1);
  assert.deepEqual(after.players.map(player => [player.score, player.ruleNumber]), before.players.map(player => [player.score, player.ruleNumber]));
  assert.equal(after.events.at(-1)?.cardId, extra.id);
  rejectsWithoutMutation(after, 'host', layoff, /own hand/i);
});

for (const fixture of [
  { number: 1, name: 'one of each suit', values: [[6, 'C'], [7, 'D'], [8, 'H'], [9, 'S']], start: 6, end: 9 },
  { number: 3, name: 'one colour', values: [[6, 'H'], [7, 'D'], [8, 'H'], [9, 'D'], [10, 'H'], [11, 'D']], start: 6, end: 11 },
  { number: 4, name: 'alternating colours', values: [[6, 'H'], [7, 'C'], [8, 'D'], [9, 'S'], [10, 'H'], [11, 'C'], [12, 'D']], start: 6, end: 12 },
  { number: 8, name: 'one suit with an assigned wild', values: [[6, 'C'], [7, 'C'], [8, 'C'], [9, 'C'], [10, 'C'], [11, 'C'], [2, 'H'], [13, 'C']], start: 6, end: 13 },
] as { number: number; name: string; values: [number, Suit][]; start: number; end: number }[]) {
  test(`a run opened with ${fixture.name} accepts later adjacent ranks in every suit`, () => {
    const opening = findOpeningMelds(cards(fixture.values), 2, fixture.number)!;
    assert.ok(opening);
    const meld = opening[0];
    meld.ownerId = 'guest-1';
    const before = structuredClone(meld);
    for (const suit of ['C', 'D', 'H', 'S'] as Suit[]) {
      assert.deepEqual(getLayoffTargets(card(fixture.start - 1, suit), [meld]), [{ meldId: meld.id, end: 'start', asRank: fixture.start - 1, asSuit: suit }]);
      assert.deepEqual(getLayoffTargets(card(fixture.end + 1, suit), [meld]), [{ meldId: meld.id, end: 'end', asRank: fixture.end + 1, asSuit: suit }]);
      assert.deepEqual(getLayoffTargets(card(2, suit), [meld]), [
        { meldId: meld.id, end: 'start', asRank: fixture.start - 1, asSuit: suit },
        { meldId: meld.id, end: 'end', asRank: fixture.end + 1, asSuit: suit },
      ]);
      assert.deepEqual(getLayoffTargets(card(fixture.start, suit), [meld]), [], 'Repeated ranks do not extend a run');
    }
    assert.deepEqual(meld, before, 'Target discovery preserves exposed cards and opening metadata');
    const room = playing(2, fixture.number);
    room.melds = [meld];
    room.players[0].down = true;
    room.players[0].laidDownTurn = 1;
    const low = card(fixture.start - 1, 'S');
    const high = card(fixture.end + 1, 'H');
    room.players[0].hand = [low, high, card(9, 'D')];
    rejectsWithoutMutation(room, 'host', { type: 'layoff', cardId: high.id, meldId: meld.id, end: 'start' }, /does not fit/i);
    const prefixed = applyAction(room, 'host', { type: 'layoff', cardId: low.id, meldId: meld.id, end: 'start' });
    const extended = applyAction(prefixed, 'host', { type: 'layoff', cardId: high.id, meldId: meld.id, end: 'end' });
    assert.deepEqual(extended.melds[0], { ...before, cards: [low, ...before.cards, high] });
  });
}

test('a pair opened as hearts accepts matching ranks and wilds of any suit without changing existing wilds', () => {
  const eight = cards([[5, 'C'], [5, 'D'], [5, 'H'], [5, 'S'], [5, 'C'], [5, 'D'], [5, 'H'], [5, 'S']]);
  const opening = findOpeningMelds([...eight, card(9, 'H'), card(2, 'S')], 2, 10)!;
  const hearts = opening.find(meld => meld.constraint === 'hearts')!;
  const before = structuredClone(hearts);
  assert.deepEqual(hearts.cards.find(item => item.rank === 2)?.asSuit, 'H');
  for (const suit of ['C', 'D', 'H', 'S'] as Suit[]) {
    assert.deepEqual(getLayoffTargets(card(9, suit), [hearts]), [{ meldId: hearts.id, end: 'end', asRank: 9, asSuit: suit }]);
    assert.deepEqual(getLayoffTargets(card(2, suit), [hearts]), [{ meldId: hearts.id, end: 'end', asRank: 9, asSuit: suit }]);
    assert.deepEqual(getLayoffTargets(card(10, suit), [hearts]), []);
  }
  assert.deepEqual(hearts, before);
});

test('bots use ordinary wild twos after a natural-only opening without rewriting saved metadata', () => {
  const room = playing(2, 5);
  const opening = cards([[5, 'H'], [5, 'C'], [8, 'H'], [8, 'D'], [8, 'S'], [8, 'C'], [8, 'H']]);
  room.melds = findOpeningMelds(opening, 2, 5)!;
  room.melds.forEach(meld => { meld.ownerId = 'host'; });
  room.players[0].down = true;
  room.players[0].laidDownTurn = 1;
  const wild = card(2, 'D');
  room.players[0].hand = [wild, card(13, 'S')];
  for (const difficulty of ['easy', 'medium', 'hard'] as Difficulty[]) {
    const action = chooseBotAction(publicRoom(room, 'host'), difficulty);
    assert.equal(action.type, 'layoff');
    if (action.type !== 'layoff') continue;
    assert.equal(action.cardId, wild.id);
    const after = applyAction(room, 'host', action);
    const updated = after.melds.find(meld => meld.id === action.meldId)!;
    const original = room.melds.find(meld => meld.id === action.meldId)!;
    assert.equal(updated.naturalOnly, true, 'The saved opening provenance survives a new layoff');
    assert.deepEqual(updated.cards.slice(0, -1), original.cards);
    assert.deepEqual(updated.cards.at(-1), { ...wild, asRank: original.cards[0].rank, asSuit: wild.suit });
  }
});

test('rank-only additions keep run gaps and the five-to-ace boundaries closed', () => {
  const [meld] = findOpeningMelds(cards([[6, 'H'], [7, 'D'], [8, 'H'], [9, 'D'], [10, 'H'], [11, 'D']]), 2, 3)!;
  assert.deepEqual(getLayoffTargets(card(13, 'S'), [meld]), []);
  assert.deepEqual(getLayoffTargets(card(14, 'C'), [meld]), []);
  const full = { ...meld, cards: cards([[5, 'H'], [6, 'S'], [7, 'C'], [8, 'D'], [9, 'C'], [10, 'S'], [11, 'D'], [12, 'C'], [13, 'H'], [14, 'S']]) };
  for (const rank of [1, 2, 3, 4, 5, 14, 15]) assert.deepEqual(getLayoffTargets(card(rank, 'D'), [full]), []);
  assert.deepEqual(getLayoffTargets(meld.cards[0], [meld]), [], 'An exposed physical card is not available to play again');
});

test('a one-colour opening still rejects duplicate nines instead of a consecutive ten', () => {
  const selected = cards([[5, 'C'], [6, 'C'], [7, 'C'], [8, 'C'], [9, 'S'], [9, 'C']]);
  assert.equal(findOpeningMelds(selected, 2, 3), null);
  assert.ok(findOpeningMelds([...selected.slice(0, 5), card(10, 'S')], 2, 3));
});

test('public room reveals only the requesting player’s hand, exposed cards and discard top', () => {
  const room = playing();
  room.recentActions = ['private-request-key'];
  const view = publicRoom(room, 'host');
  const wire = JSON.stringify(view);
  assert.deepEqual(view.hand, room.players[0].hand);
  assert.equal(view.stockCount, room.stock.length);
  assert.deepEqual(view.discard, room.discardPile.at(-1));
  for (const player of room.players) {
    assert.ok(!wire.includes(player.tokenHash));
    assert.equal(view.players.find(item => item.id === player.id)?.handCount, player.hand.length);
  }
  for (const hidden of [...room.players[1].hand, ...room.stock, ...room.discardPile.slice(0, -1)]) {
    assert.ok(!wire.includes(hidden.id), `Hidden physical card ID leaked: ${hidden.id}`);
  }
  assert.ok(!wire.includes('private-request-key'));
  for (const player of view.players) {
    assert.ok(!Object.hasOwn(player, 'hand'));
    assert.ok(!Object.hasOwn(player, 'tokenHash'));
  }
  for (const forbidden of ['stock', 'discardPile', 'recentActions', 'tokenHash']) assert.ok(!Object.hasOwn(view, forbidden));
  assert.deepEqual(publicRoom(room, 'unknown-viewer').hand, []);
});

test('public projection and lobby preview do not retain mutable private references', () => {
  const room = playing();
  const original = structuredClone(room);
  const view = publicRoom(room, 'host');
  view.hand[0].rank = 14;
  view.players[0].name = 'Edited client label';
  view.events[0].text = 'Edited client message';
  if (view.discard) view.discard.suit = 'S';
  const preview = roomPreview(room);
  preview.players[0].name = 'Edited preview label';
  assert.deepEqual(room, original);
  const previewWire = JSON.stringify(preview);
  for (const player of room.players) {
    assert.ok(!previewWire.includes(player.tokenHash));
    for (const hidden of player.hand) assert.ok(!previewWire.includes(hidden.id));
  }
  for (const hidden of room.stock) assert.ok(!previewWire.includes(hidden.id));
});

test('forged card ownership, out-of-turn actions and double draws fail without mutations', () => {
  const room = playing();
  rejectsWithoutMutation(room, 'unknown-player', { type: 'discard', cardId: room.players[0].hand[0].id }, /rejoin/i);
  rejectsWithoutMutation(room, room.players[1].id, { type: 'discard', cardId: room.players[1].hand[0].id }, /turn/i);
  rejectsWithoutMutation(room, 'host', { type: 'discard', cardId: room.players[1].hand[0].id }, /own hand/i);
  const stolen = room.players[0].hand.slice(0, 4).map(item => item.id).concat(room.players[1].hand[0].id);
  rejectsWithoutMutation(room, 'host', { type: 'goDown', cardIds: stolen }, /own hand/i);
  const drawPhase = structuredClone(room);
  drawPhase.phase = 'draw';
  rejectsWithoutMutation(drawPhase, 'host', { type: 'discard', cardId: drawPhase.players[0].hand[0].id }, /draw/i);
  const drawn = applyAction(drawPhase, 'host', { type: 'draw', source: 'stock' });
  rejectsWithoutMutation(drawn, 'host', { type: 'draw', source: 'stock' }, /already drawn/i);
});

test('guests must not start a game or change host settings', () => {
  const room = lobby();
  for (const action of [
    { type: 'start' }, { type: 'setGame', game: 2 }, { type: 'addBot', difficulty: 'hard' },
    { type: 'removePlayer', playerId: 'host' }, { type: 'setTurnLimit', seconds: 30 },
  ]) rejectsWithoutMutation(room, room.players[1].id, action, /host/i);
});

test('malformed JSON actions fail cleanly without mutating private state', () => {
  const room = playing();
  for (const action of [
    null, undefined, 7, 'discard', [], {}, { type: 'unknown-action' },
    { type: 'goDown', cardIds: null }, { type: 'goDown', cardIds: 'five cards' },
    { type: 'goDown', cardIds: [null, {}, 5] }, { type: 'discard', cardId: {} },
    { type: 'layoff', cardId: room.players[0].hand[0].id, meldId: null, end: 'middle' },
  ]) rejectsWithoutMutation(room, 'host', action);
});

test('bot decisions cannot depend on hidden hands, authentication or stock order', () => {
  const room = playing();
  room.phase = 'draw';
  room.discardPile.push(card(7, 'S'));
  const other = structuredClone(room);
  other.players[1].hand = other.players[1].hand.map(() => card(2, 'H'));
  other.players[0].tokenHash = 'different-private-host-hash';
  other.players[1].tokenHash = 'different-private-guest-hash';
  other.stock = other.stock.map(() => card(14, 'D'));
  other.recentActions = ['invisible-action-history'];
  const a = publicRoom(room, 'host');
  const b = publicRoom(other, 'host');
  assert.deepEqual(a, b, 'Equivalent visible tables must produce identical bot inputs');
  for (const difficulty of ['easy', 'medium', 'hard'] as Difficulty[]) {
    const before = structuredClone(a);
    assert.deepEqual(chooseBotAction(a, difficulty), chooseBotAction(b, difficulty));
    assert.deepEqual(a, before, `${difficulty} AI changed the visible input`);
    const trapped = new Proxy(a, {
      get(target, property, receiver) {
        if (['stock', 'discardPile', 'tokenHash', 'recentActions'].includes(String(property))) {
          throw new Error(`Bot attempted a private-state read: ${String(property)}`);
        }
        return Reflect.get(target, property, receiver);
      },
    }) as PublicRoom;
    assert.doesNotThrow(() => chooseBotAction(trapped, difficulty));
  }
});

test('a player who melds advances through ten rules while unmelded opponents keep their rule and accrue penalties once', () => {
  let room = applyAction(lobby(3), 'host', { type: 'start' });
  for (let round = 1; round <= 10; round++) {
    assert.equal(room.round, round);
    assert.deepEqual(room.players.map(player => player.ruleNumber), [round, 1, 1]);
    room.turnLimitSeconds = 0;
    room.turnDeadline = null;
    room.turnPlayerId = 'host';
    room.phase = 'play';
    room.players[0].hand = [card(5, 'C')];
    room.players[0].down = true;
    room.players[1].hand = cards([[5, 'D'], [8, 'S'], [14, 'H'], [2, 'C']]);
    room.players[2].hand = cards([[7, 'C'], [13, 'D']]);
    room = applyAction(room, 'host', { type: 'discard', cardId: room.players[0].hand[0].id });
    assert.equal(room.players[0].score, 0);
    assert.equal(room.players[1].score, 55 * round);
    assert.equal(room.players[2].score, 15 * round);
    assert.equal(room.history.length, round);
    assert.equal(room.result?.scores[1].penalty, 55);
    assert.equal(room.result?.scores[2].penalty, 15);
    if (round < 10) {
      assert.equal(room.status, 'round-end');
      const oldScores = room.players.map(player => player.score);
      room = applyAction(room, 'host', { type: 'nextHand' });
      assert.equal(room.round, round + 1);
      assert.ok(room.players.every(player => player.hand.length === 10 && !player.down && player.completedTurns === 0));
      assert.deepEqual(room.players.map(player => player.score), oldScores);
      assert.equal(room.result, null);
    }
  }
  assert.equal(room.status, 'finished');
  assert.equal(room.history.length, 10);
  rejectsWithoutMutation(room, 'host', { type: 'nextHand' });
  rejectsWithoutMutation(room, 'host', { type: 'discard', cardId: 'already-played' });
});

function withClock<T>(timestamp: number, callback: (advance: (milliseconds: number) => void) => T): T {
  const originalNow = Date.now;
  let now = timestamp;
  Date.now = () => now;
  try {
    return callback(milliseconds => { now += milliseconds; });
  } finally {
    Date.now = originalNow;
  }
}

test('the host timer applies to a whole turn and cannot be renewed by drawing or opening', () => {
  withClock(2_000_000_000_000, advance => {
    let room = applyAction(lobby(), 'host', { type: 'setTurnLimit', seconds: 30 });
    room = applyAction(room, 'host', { type: 'start' });
    const deadline = room.turnDeadline;
    assert.equal(deadline, Date.now() + 30_000);
    advance(8_000);
    room = applyAction(room, 'host', { type: 'draw', source: 'stock' });
    assert.equal(room.turnDeadline, deadline);
    room.players[0].completedTurns = 1;
    room.players[0].hand = cards([[5, 'C'], [6, 'D'], [7, 'H'], [8, 'S'], [9, 'C'], [10, 'D'], [13, 'S']]);
    advance(7_000);
    room = applyAction(room, 'host', { type: 'goDown', cardIds: room.players[0].hand.slice(0, 5).map(item => item.id) });
    assert.equal(room.turnDeadline, deadline);
    room = applyAction(room, 'host', { type: 'discard', cardId: room.players[0].hand[0].id });
    assert.equal(room.turnDeadline, Date.now() + 30_000);
    assert.equal(room.turnPlayerId, 'guest-1');
  });
});

test('neither a player nor another guest may skip a turn before the deadline', () => {
  withClock(2_000_000_000_000, () => {
    const room = playing();
    room.turnLimitSeconds = 30;
    room.turnDeadline = Date.now() + 1;
    rejectsWithoutMutation(room, 'host', { type: 'timeout' }, /still has time/i);
    rejectsWithoutMutation(room, 'guest-1', { type: 'timeout' }, /still has time/i);
    rejectsWithoutMutation(room, 'host', { type: 'setTurnLimit', seconds: 0 }, /lobby/i);
  });
});

test('an expired draw phase draws once, discards once and passes the turn with one state version', () => {
  withClock(2_000_000_000_000, () => {
    const room = playing();
    room.phase = 'draw';
    room.turnLimitSeconds = 30;
    room.turnDeadline = Date.now();
    const original = structuredClone(room);
    const handCount = room.players[0].hand.length;
    const next = applyAction(room, 'guest-1', { type: 'timeout' });
    assert.deepEqual(room, original);
    assert.equal(next.players[0].hand.length, handCount);
    assert.equal(next.players[0].completedTurns, room.players[0].completedTurns + 1);
    assert.equal(next.stock.length, room.stock.length - 1);
    assert.equal(next.discardPile.length, room.discardPile.length + 1);
    assert.equal(next.turnPlayerId, 'guest-1');
    assert.equal(next.turnNumber, room.turnNumber + 1);
    assert.equal(next.phase, 'draw');
    assert.equal(next.turnDeadline, Date.now() + 30_000);
    assert.equal(next.version, room.version + 1);
    assert.deepEqual(next.events.slice(-3).map(event => event.type), ['draw', 'discard', 'timeout']);
    rejectsWithoutMutation(next, 'host', { type: 'timeout' }, /still has time/i);
  });
});

test('a late opening request enforces expiry instead of laying down after the deadline', () => {
  withClock(2_000_000_000_000, () => {
    const room = playing();
    room.turnLimitSeconds = 30;
    room.turnDeadline = Date.now() - 1;
    const original = structuredClone(room);
    const next = applyAction(room, 'host', { type: 'goDown', cardIds: room.players[0].hand.slice(0, 5).map(item => item.id) });
    assert.deepEqual(room, original);
    assert.equal(next.players[0].down, false);
    assert.equal(next.melds.length, 0);
    assert.equal(next.players[0].hand.length, room.players[0].hand.length - 1);
    assert.equal(next.turnPlayerId, 'guest-1');
    assert.equal(next.stock.length, room.stock.length);
    assert.equal(next.events.at(-1)?.type, 'timeout');
  });
});

test('expiry immediately after going down only discards, without adding fitting cards or drawing again', () => {
  withClock(2_000_000_000_000, advance => {
    let room = playing();
    room.turnLimitSeconds = 15;
    room.turnDeadline = Date.now() + 15_000;
    room = applyAction(room, 'host', { type: 'goDown', cardIds: room.players[0].hand.slice(0, 5).map(item => item.id) });
    const beforeMelds = structuredClone(room.melds);
    const stockCount = room.stock.length;
    const handCount = room.players[0].hand.length;
    advance(15_000);
    const next = applyAction(room, 'host', { type: 'timeout' });
    assert.deepEqual(next.melds, beforeMelds);
    assert.equal(next.players[0].down, true);
    assert.equal(next.players[0].hand.length, handCount - 1);
    assert.equal(next.stock.length, stockCount);
    assert.equal(next.turnPlayerId, 'guest-1');
    assert.deepEqual(next.events.slice(-2).map(event => event.type), ['discard', 'timeout']);
  });
});

test('unlimited turns never expire and timer values must stay within the permitted range', () => {
  withClock(2_000_000_000_000, advance => {
    const room = playing();
    assert.equal(room.turnLimitSeconds, 0);
    assert.equal(room.turnDeadline, null);
    advance(365 * 24 * 60 * 60 * 1000);
    rejectsWithoutMutation(room, 'host', { type: 'timeout' }, /still has time/i);
    const next = applyAction(room, 'host', { type: 'goDown', cardIds: room.players[0].hand.slice(0, 5).map(item => item.id) });
    assert.equal(next.players[0].down, true);
    assert.equal(next.turnDeadline, null);
    const setup = lobby();
    for (const seconds of [-1, 1, 14, 301, 30.5, Number.NaN, Number.POSITIVE_INFINITY, '30', null]) {
      rejectsWithoutMutation(setup, 'host', { type: 'setTurnLimit', seconds });
    }
    for (const seconds of [0, 15, 30, 60, 300]) {
      assert.equal(applyAction(setup, 'host', { type: 'setTurnLimit', seconds }).turnLimitSeconds, seconds);
    }
  });
});
