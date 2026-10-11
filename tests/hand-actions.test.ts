import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Node's native TypeScript runner requires the explicit file extension.
import { getHandDiscardAction, getHandLayoffAction, getHandLayoffGroupAction } from '../lib/hand-actions.ts';
import type { Card, LayoffTarget, Meld, PublicPlayer, PublicRoom } from '../lib/types';

const high: Card = { id: 'held-jack', rank: 11, suit: 'H' };
const low: Card = { id: 'held-five', rank: 5, suit: 'C' };
const wild: Card = { id: 'held-wild', rank: 2, suit: 'S' };
const ownEnd: Pick<LayoffTarget, 'meldId' | 'end'> = { meldId: 'own-run', end: 'end' };

function player(id: string): PublicPlayer {
  return { id, name: id, color: 0, handCount: 3, score: 0, down: true, completedTurns: 2,
    laidDownTurn: 1, isBot: false, difficulty: 'medium', ready: true };
}

function run(id: string, ownerId: string): Meld {
  return { id, ownerId, kind: 'run', constraint: 'any', cards: Array.from({ length: 5 }, (_, index) =>
    ({ id: `${id}-${index}`, rank: index + 6, suit: 'H' })) };
}

function room(): PublicRoom {
  return {
    code: 'RUMMY6', hostId: 'you', game: 1, round: 1, status: 'playing',
    players: [player('you'), player('friend')], hand: [{ ...high }, { ...low }, { ...wild }],
    youId: 'you', melds: [run('own-run', 'you'), run('other-run', 'friend')],
    turnPlayerId: 'you', phase: 'play', turnNumber: 5, stockCount: 40, discard: null,
    turnLimitSeconds: 0, turnDeadline: null, result: null, history: [], events: [], version: 10, botDueAt: 0,
  };
}

test('No current room produces no play action', () => {
  assert.equal(getHandLayoffAction(null, high.id, ownEnd), null);
  assert.equal(getHandDiscardAction(null, high.id), null);
});

test('A held card may be added to either your own or another player’s legal meld', () => {
  const current = room();
  const before = structuredClone(current);
  for (const meldId of ['own-run', 'other-run']) {
    assert.deepEqual(getHandLayoffAction(current, high.id, { meldId, end: 'end' }),
      { type: 'layoff', cardId: high.id, meldId, end: 'end' });
    assert.deepEqual(getHandLayoffAction(current, low.id, { meldId, end: 'start' }),
      { type: 'layoff', cardId: low.id, meldId, end: 'start' });
  }
  assert.deepEqual(current, before, 'Preparing a move must not remove cards or mutate the server snapshot');
});

test('A wild card preserves the chosen start or end instead of choosing an arbitrary valid end', () => {
  const current = room();
  for (const end of ['start', 'end'] as const) {
    assert.deepEqual(getHandLayoffAction(current, wild.id, { meldId: 'own-run', end }),
      { type: 'layoff', cardId: wild.id, meldId: 'own-run', end });
  }
});

test('A natural card rejects the wrong end and a removed meld rejects an old highlight', () => {
  const current = room();
  assert.equal(getHandLayoffAction(current, high.id, { meldId: 'own-run', end: 'start' }), null);
  current.melds = current.melds.filter(meld => meld.id !== ownEnd.meldId);
  assert.equal(getHandLayoffAction(current, high.id, ownEnd), null);
});

test('A target is recomputed when an intervening update extends the run', () => {
  const current = room();
  assert.ok(getHandLayoffAction(current, high.id, ownEnd));
  current.melds[0].cards.push({ id: 'another-jack', rank: 11, suit: 'D' });
  current.version++;
  assert.equal(getHandLayoffAction(current, high.id, ownEnd), null);
  assert.ok(getHandLayoffAction(current, wild.id, ownEnd), 'The new endpoint remains available to a wild');
});

test('A card removed from the latest hand cannot be played by an old selection or drag', () => {
  const current = room();
  assert.ok(getHandDiscardAction(current, high.id));
  current.hand = current.hand.filter(card => card.id !== high.id);
  assert.equal(getHandLayoffAction(current, high.id, ownEnd), null);
  assert.equal(getHandDiscardAction(current, high.id), null);
  assert.equal(getHandDiscardAction(current, current.melds[0].cards[0].id), null);
});

test('An intervening turn change blocks both tap and drop actions', () => {
  const current = room();
  current.turnPlayerId = 'friend';
  current.turnNumber++;
  assert.equal(getHandLayoffAction(current, high.id, ownEnd), null);
  assert.equal(getHandDiscardAction(current, high.id), null);
});

test('Drawing must finish before either laying off or discarding', () => {
  const current = room();
  current.phase = 'draw';
  assert.equal(getHandLayoffAction(current, high.id, ownEnd), null);
  assert.equal(getHandDiscardAction(current, high.id), null);
});

test('Lobby, completed-hand, and finished-game snapshots reject all hand plays', () => {
  for (const status of ['lobby', 'round-end', 'finished'] as const) {
    const current = room();
    current.status = status;
    assert.equal(getHandLayoffAction(current, high.id, ownEnd), null, status);
    assert.equal(getHandDiscardAction(current, high.id), null, status);
  }
});

test('First-lap players may discard after drawing, but cannot add to exposed melds', () => {
  const current = room();
  current.players[0].completedTurns = 0;
  current.players[0].down = false;
  current.players[0].laidDownTurn = null;
  assert.equal(getHandLayoffAction(current, high.id, ownEnd), null);
  assert.deepEqual(getHandDiscardAction(current, high.id), { type: 'discard', cardId: high.id });
});

test('Going down requires waiting for the next turn to add, while discard remains legal', () => {
  const current = room();
  current.players[0].laidDownTurn = current.turnNumber;
  assert.equal(getHandLayoffAction(current, high.id, ownEnd), null);
  assert.deepEqual(getHandDiscardAction(current, high.id), { type: 'discard', cardId: high.id });
  current.turnNumber += current.players.length;
  assert.ok(getHandLayoffAction(current, high.id, ownEnd));
});

test('Opening suit metadata leaves rank-valid placements available while changed run edges invalidate stale targets', () => {
  const current = room();
  assert.ok(getHandLayoffAction(current, high.id, ownEnd));
  current.melds[0].constraint = 'same-suit';
  current.melds[0].cards = current.melds[0].cards.map(card => ({ ...card, suit: 'S' }));
  assert.deepEqual(getHandLayoffAction(current, high.id, ownEnd),
    { type: 'layoff', cardId: high.id, meldId: ownEnd.meldId, end: 'end' });
  assert.ok(getHandLayoffAction(current, wild.id, ownEnd));
  current.melds[0].cards.push({ id: 'intervening-jack', rank: 11, suit: 'D' });
  current.version++;
  assert.equal(getHandLayoffAction(current, high.id, ownEnd), null, 'The current run endpoint still controls placement');
  assert.ok(getHandLayoffAction(current, wild.id, ownEnd));
});

test('The screenshot’s black five adds to red fives through the shared tap/drop helper with hints on or off', () => {
  for (const showMoveHints of [true, false]) {
    for (const ownerId of ['you', 'friend']) {
      const current = room();
      current.game = 2;
      current.players[0].ruleNumber = 2;
      current.showMoveHints = showMoveHints;
      current.melds = [{
        id: 'red-fives', ownerId, kind: 'set', constraint: 'red', wildsMatch: true,
        cards: [
          { id: 'five-diamonds', rank: 5, suit: 'D' },
          { id: 'five-hearts', rank: 5, suit: 'H' },
          { id: 'two-hearts', rank: 2, suit: 'H', asRank: 5, asSuit: 'H' },
        ],
      }];
      assert.deepEqual(getHandLayoffAction(current, low.id, { meldId: 'red-fives', end: 'end' }),
        { type: 'layoff', cardId: low.id, meldId: 'red-fives', end: 'end' });
      assert.equal(getHandLayoffAction(current, high.id, { meldId: 'red-fives', end: 'end' }), null,
        'Ignoring opening colour must not allow a different rank');
    }
  }
});

test('Opening-only natural and wildcard suit restrictions do not block a later wild-card placement', () => {
  const current = room();
  current.showMoveHints = false;
  Object.assign(current.melds[0], { constraint: 'same-suit', naturalOnly: true, wildsMatch: true });
  current.players[0].laidDownTurn = current.turnNumber;
  assert.equal(getHandLayoffAction(current, wild.id, ownEnd), null, 'The opening turn still requires waiting');
  current.turnNumber += current.players.length;
  assert.deepEqual(getHandLayoffAction(current, wild.id, ownEnd),
    { type: 'layoff', cardId: wild.id, meldId: ownEnd.meldId, end: 'end' });
});

test('Grouped tap or drop returns placement order while one card retains the existing action', () => {
  const current = room();
  const queen: Card = { id: 'held-queen', rank: 12, suit: 'S' };
  current.hand.push(queen);
  const before = structuredClone(current);
  assert.deepEqual(getHandLayoffGroupAction(current, [queen.id, high.id], ownEnd),
    { type: 'layoffMany', cardIds: [high.id, queen.id], meldId: ownEnd.meldId, end: 'end' });
  assert.deepEqual(getHandLayoffGroupAction(current, [high.id], ownEnd), getHandLayoffAction(current, high.id, ownEnd));
  assert.deepEqual(current, before);
});

test('Grouped hand actions recheck every selected card and latest endpoint before submitting', () => {
  const current = room();
  const ids = [wild.id, high.id];
  assert.ok(getHandLayoffGroupAction(current, ids, ownEnd));
  assert.equal(getHandLayoffGroupAction(null, ids, ownEnd), null);
  assert.equal(getHandLayoffGroupAction(current, [], ownEnd), null);
  assert.equal(getHandLayoffGroupAction(current, [high.id, high.id], ownEnd), null);
  assert.equal(getHandLayoffGroupAction(current, [...ids, 'missing-card'], ownEnd), null);
  assert.equal(getHandLayoffGroupAction(current, Array(12).fill(high.id), ownEnd), null);
  current.melds[0].cards.push({ id: 'intervening-jack', rank: 11, suit: 'C' });
  assert.equal(getHandLayoffGroupAction(current, ids, ownEnd), null);
  current.melds[0].cards.pop();
  current.hand = current.hand.filter(card => card.id !== wild.id);
  assert.equal(getHandLayoffGroupAction(current, ids, ownEnd), null);
});

test('Grouped moves obey turn, draw, opening-turn and down guards with hints disabled', () => {
  for (const mutate of [
    (current: PublicRoom) => { current.turnPlayerId = 'friend'; },
    (current: PublicRoom) => { current.phase = 'draw'; },
    (current: PublicRoom) => { current.players[0].down = false; },
    (current: PublicRoom) => { current.players[0].laidDownTurn = current.turnNumber; },
    (current: PublicRoom) => { current.status = 'round-end'; },
  ]) {
    const current = room();
    current.showMoveHints = false;
    assert.ok(getHandLayoffGroupAction(current, [high.id, wild.id], ownEnd));
    mutate(current);
    assert.equal(getHandLayoffGroupAction(current, [high.id, wild.id], ownEnd), null);
  }
});
