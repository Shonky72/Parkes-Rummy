import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Node's native TypeScript runner requires the explicit file extension.
import { arrangeHand, insertDrawnCard, moveCard, sortCards } from '../lib/hand-order.ts';
import type { Card, Suit } from '../lib/types';

const card = (id: string, rank: number, suit: Suit = 'H'): Card => ({ id, rank, suit });
const ids = (cards: Card[]) => cards.map(held => held.id);
const hand = [card('ace', 14), card('five', 5), card('king', 13), card('wild', 2)];

test('Ascending and descending sorts both keep wild twos after all natural cards', () => {
  assert.deepEqual(ids(sortCards(hand, 'descending')), ['ace', 'king', 'five', 'wild']);
  assert.deepEqual(ids(sortCards(hand, 'ascending')), ['five', 'king', 'ace', 'wild']);
});

test('Equal ranks use the existing suit order, then distinguish physical cards by ID', () => {
  const cards = [card('club', 9, 'C'), card('heart-b', 9, 'H'), card('diamond', 9, 'D'), card('spade', 9, 'S'), card('heart-a', 9, 'H')];
  for (const direction of ['ascending', 'descending'] as const) {
    assert.deepEqual(ids(sortCards(cards, direction)), ['spade', 'heart-a', 'heart-b', 'diamond', 'club']);
    assert.deepEqual(ids(sortCards(cards.map(held => ({ ...held, rank: 2 })), direction)), ['spade', 'heart-a', 'heart-b', 'diamond', 'club']);
  }
});

test('Colour sorting keeps reds before blacks and sorts numbers within each colour in either direction', () => {
  const cards = [
    card('wild-spade', 2, 'S'), card('nine-diamond', 9, 'D'), card('king-club', 13, 'C'),
    card('five-heart', 5, 'H'), card('wild-heart', 2, 'H'), card('five-club', 5, 'C'),
    card('ace-spade', 14, 'S'), card('wild-diamond', 2, 'D'), card('wild-club', 2, 'C'),
    card('nine-heart', 9, 'H'), card('ace-diamond', 14, 'D'), card('five-spade', 5, 'S'),
  ];
  assert.deepEqual(ids(sortCards(cards, 'descending', 'colour')), [
    'ace-diamond', 'nine-heart', 'nine-diamond', 'five-heart', 'wild-heart', 'wild-diamond',
    'ace-spade', 'king-club', 'five-club', 'five-spade', 'wild-club', 'wild-spade',
  ]);
  assert.deepEqual(ids(sortCards(cards, 'ascending', 'colour')), [
    'five-heart', 'nine-heart', 'nine-diamond', 'ace-diamond', 'wild-heart', 'wild-diamond',
    'five-club', 'five-spade', 'king-club', 'ace-spade', 'wild-club', 'wild-spade',
  ]);
});

test('Suit sorting keeps hearts and diamonds together before clubs and spades, with twos last in each suit', () => {
  const cards = [
    card('wild-spade', 2, 'S'), card('ace-diamond', 14, 'D'), card('five-heart', 5, 'H'),
    card('ace-club', 14, 'C'), card('wild-heart', 2, 'H'), card('five-spade', 5, 'S'),
    card('wild-club', 2, 'C'), card('five-diamond', 5, 'D'), card('ace-heart', 14, 'H'),
    card('wild-diamond', 2, 'D'), card('five-club', 5, 'C'), card('ace-spade', 14, 'S'),
  ];
  assert.deepEqual(ids(sortCards(cards, 'descending', 'suit')), [
    'ace-heart', 'five-heart', 'wild-heart', 'ace-diamond', 'five-diamond', 'wild-diamond',
    'ace-club', 'five-club', 'wild-club', 'ace-spade', 'five-spade', 'wild-spade',
  ]);
  assert.deepEqual(ids(sortCards(cards, 'ascending', 'suit')), [
    'five-heart', 'ace-heart', 'wild-heart', 'five-diamond', 'ace-diamond', 'wild-diamond',
    'five-club', 'ace-club', 'wild-club', 'five-spade', 'ace-spade', 'wild-spade',
  ]);
});

test('Grouped sorts keep identical physical cards distinct and return a stable order after repeated sorting or polls', () => {
  const cards = [card('heart-b', 9, 'H'), card('spade', 9, 'S'), card('diamond', 9, 'D'), card('heart-a', 9, 'H'), card('club', 9, 'C')];
  const expected = ['heart-a', 'heart-b', 'diamond', 'club', 'spade'];
  for (const mode of ['colour', 'suit'] as const) {
    for (const direction of ['ascending', 'descending'] as const) {
      for (const held of [cards, cards.map(held => ({ ...held, rank: 2 }))]) {
        const sorted = sortCards(held, direction, mode);
        assert.deepEqual(ids(sorted), expected);
        assert.deepEqual(ids(sortCards(sorted, direction, mode)), expected);
        assert.deepEqual(ids(sortCards([...held].reverse(), direction, mode)), expected);
      }
    }
  }
});

test('Automatic arrangement follows the preference until a manual order exists', () => {
  assert.deepEqual(ids(arrangeHand(hand, null, 'descending')), ['ace', 'king', 'five', 'wild']);
  assert.deepEqual(ids(arrangeHand(hand, null, 'ascending')), ['five', 'king', 'ace', 'wild']);
  assert.deepEqual(ids(arrangeHand(hand, [], 'descending')), ids(hand), 'An empty saved arrangement is a manual order, not an automatic sort');
});

test('Automatic arrangement follows the selected grouping while the omitted mode preserves number sorting', () => {
  const cards = [card('black-nine', 9, 'C'), card('red-five', 5, 'D'), card('red-ace', 14, 'H'), card('black-wild', 2, 'S')];
  assert.deepEqual(ids(arrangeHand(cards, null, 'descending')), ['red-ace', 'black-nine', 'red-five', 'black-wild']);
  assert.deepEqual(ids(arrangeHand(cards, null, 'ascending', 'number')), ['red-five', 'black-nine', 'red-ace', 'black-wild']);
  assert.deepEqual(ids(arrangeHand(cards, null, 'ascending', 'colour')), ['red-five', 'red-ace', 'black-nine', 'black-wild']);
  assert.deepEqual(ids(arrangeHand(cards, null, 'ascending', 'suit')), ['red-ace', 'red-five', 'black-nine', 'black-wild']);
});

test('A player may freely arrange cards regardless of the saved sort preference', () => {
  const manual = ['king', 'wild', 'five', 'ace'];
  for (const mode of ['number', 'colour', 'suit'] as const) {
    for (const direction of ['ascending', 'descending'] as const) {
      assert.deepEqual(ids(arrangeHand(hand, manual, direction, mode)), manual);
    }
  }
});

test('Server polling and changed server card order preserve the manual arrangement', () => {
  const manual = ['five', 'ace', 'wild', 'king'];
  const freshServerHand = [...hand].reverse().map(held => ({ ...held }));
  const arranged = arrangeHand(freshServerHand, manual, 'descending');
  assert.deepEqual(ids(arranged), manual);
  assert.equal(arranged[0], freshServerHand.find(held => held.id === 'five'), 'Return current server card objects instead of stale saved cards');
});

test('Newly drawn cards append without disrupting existing groups', () => {
  const manual = ['wild', 'five', 'king', 'ace'];
  const drawnQueen = card('queen', 12, 'S');
  const drawnSix = card('six', 6, 'D');
  const serverHand = [drawnQueen, ...hand.slice().reverse(), drawnSix];
  for (const mode of ['number', 'colour', 'suit'] as const) {
    assert.deepEqual(ids(arrangeHand(serverHand, manual, 'ascending', mode)), [...manual, 'queen', 'six']);
  }
});

test('A confirmed draw inserts at the start, middle or end of an arbitrary manual hand', () => {
  const manual = ['king', 'wild', 'five', 'ace'];
  const cards = [card('drawn', 9), ...hand.slice().reverse()];
  assert.deepEqual(insertDrawnCard(cards, manual, ids(hand), 'king'), ['drawn', 'king', 'wild', 'five', 'ace']);
  assert.deepEqual(insertDrawnCard(cards, manual, ids(hand), 'five'), ['king', 'wild', 'drawn', 'five', 'ace']);
  assert.deepEqual(insertDrawnCard(cards, manual, ids(hand), null), ['king', 'wild', 'five', 'ace', 'drawn']);
});

test('Draw insertion preserves both preferred sort directions and every grouping without re-sorting', () => {
  const prior = [card('red-five', 5), card('black-king', 13, 'S'), card('red-ace', 14, 'D'), card('wild', 2, 'C')];
  for (const direction of ['ascending', 'descending'] as const) {
    for (const mode of ['number', 'colour', 'suit'] as const) {
      const order = ids(sortCards(prior, direction, mode));
      const expected = [...order.slice(0, 2), 'drawn', ...order.slice(2)];
      assert.deepEqual(insertDrawnCard([...prior].reverse().concat(card('drawn', 8)), order, ids(prior), order[2]), expected);
    }
  }
});

test('Draw insertion distinguishes a newly drawn physical card from an identical existing face', () => {
  const prior = [card('seven-a', 7), card('seven-b', 7)];
  assert.deepEqual(insertDrawnCard([...prior, card('seven-c', 7)], ['seven-b', 'seven-a'], ids(prior), 'seven-a'),
    ['seven-b', 'seven-c', 'seven-a']);
  assert.deepEqual(insertDrawnCard([card('only-card', 7)], [], [], null), ['only-card']);
});

test('Draw insertion rejects duplicate physical IDs in any snapshot', () => {
  const prior = [card('a', 7), card('b', 8)];
  assert.equal(insertDrawnCard([...prior, card('a', 9)], ['a', 'b'], ['a', 'b'], null), null);
  assert.equal(insertDrawnCard([...prior, card('new', 9)], ['a', 'a'], ['a', 'b'], null), null);
  assert.equal(insertDrawnCard([...prior, card('new', 9)], ['a', 'b'], ['a', 'a'], null), null);
});

test('Draw insertion rejects a missing old card, replacement deal or multiple incoming cards', () => {
  const prior = [card('a', 7), card('b', 8)];
  const order = ids(prior);
  assert.equal(insertDrawnCard(prior, order, order, null), null, 'No new card');
  assert.equal(insertDrawnCard([prior[0], card('new', 9)], order, order, null), null, 'An old card departed');
  assert.equal(insertDrawnCard([prior[0], card('new', 9), card('other', 10)], order, order, null), null, 'Two arrivals conceal a missing old card');
  assert.equal(insertDrawnCard([...prior, card('new', 9), card('other', 10)], order, order, null), null, 'More than one new card');
  assert.equal(insertDrawnCard([card('new-a', 7), card('new-b', 8), card('new-c', 9)], order, order, null), null, 'Another deal has new physical IDs');
});

test('Draw insertion rejects stale arrangements and anchors even when the returned hand is otherwise valid', () => {
  const cards = [card('a', 7), card('b', 8), card('new', 9)];
  for (const order of [['a'], ['a', 'missing'], ['a', 'b', 'missing'], ['a', 'new']]) {
    assert.equal(insertDrawnCard(cards, order, ['a', 'b'], null), null);
  }
  for (const anchor of ['departed', 'new']) {
    assert.equal(insertDrawnCard(cards, ['b', 'a'], ['a', 'b'], anchor), null);
  }
});

test('Draw insertion never mutates server cards, prior IDs or the manual arrangement', () => {
  const cards = [card('a', 7), card('b', 8), card('new', 9)].map(held => Object.freeze(held));
  Object.freeze(cards);
  const prior = Object.freeze(['a', 'b']);
  const order = Object.freeze(['b', 'a']);
  const before = JSON.stringify({ cards, prior, order });
  const inserted = insertDrawnCard(cards, order, prior, 'a');
  assert.deepEqual(inserted, ['b', 'new', 'a']);
  assert.notEqual(inserted, order);
  assert.equal(JSON.stringify({ cards, prior, order }), before);
});

test('Discarding or playing cards removes only departed cards from the manual arrangement', () => {
  const manual = ['king', 'wild', 'five', 'ace'];
  const afterPlay = hand.filter(held => held.id !== 'wild' && held.id !== 'five');
  assert.deepEqual(ids(arrangeHand(afterPlay, manual, 'ascending')), ['king', 'ace']);
  assert.deepEqual(arrangeHand([], manual, 'descending'), []);
});

test('Stale and duplicate saved IDs cannot duplicate a card or conceal an unlisted card', () => {
  const stale = ['departed', 'king', 'king', 'wild', 'unknown', 'wild'];
  const arranged = arrangeHand(hand, stale, 'ascending');
  assert.deepEqual(ids(arranged), ['king', 'wild', 'ace', 'five']);
  assert.deepEqual(new Set(ids(arranged)), new Set(ids(hand)));
  assert.equal(arranged.length, hand.length);
});

test('Sorting and reconciliation never mutate input arrays or card objects', () => {
  const frozenHand = hand.map(held => Object.freeze({ ...held }));
  Object.freeze(frozenHand);
  const manual = Object.freeze(['king', 'wild', 'five', 'ace']);
  const snapshot = JSON.stringify(frozenHand);
  for (const mode of ['number', 'colour', 'suit'] as const) {
    for (const direction of ['ascending', 'descending'] as const) {
      assert.notEqual(sortCards(frozenHand, direction, mode), frozenHand);
      assert.notEqual(arrangeHand(frozenHand, null, direction, mode), frozenHand);
      assert.notEqual(arrangeHand(frozenHand, manual, direction, mode), frozenHand);
    }
  }
  assert.equal(JSON.stringify(frozenHand), snapshot);
  assert.deepEqual(manual, ['king', 'wild', 'five', 'ace']);
});

test('Moving to earlier and later insertion slots preserves the surrounding order', () => {
  const order = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveCard(order, 'd', 'b'), ['a', 'd', 'b', 'c']);
  assert.deepEqual(moveCard(order, 'a', 'd'), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveCard(order, 'c', 'a'), ['c', 'a', 'b', 'd']);
  assert.deepEqual(moveCard(order, 'b', null), ['a', 'c', 'd', 'b']);
});

test('Before and after card slots behave consistently in either drag direction', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(moveCard(order, 'a', 'c'), ['b', 'a', 'c', 'd', 'e'], 'Drop before c');
  assert.deepEqual(moveCard(order, 'a', 'd'), ['b', 'c', 'a', 'd', 'e'], 'Drop after c using its following slot');
  assert.deepEqual(moveCard(order, 'e', 'b'), ['a', 'e', 'b', 'c', 'd'], 'Drop before b');
  assert.deepEqual(moveCard(order, 'e', 'c'), ['a', 'b', 'e', 'c', 'd'], 'Drop after b using its following slot');
});

test('Current-position slots, invalid destinations, and missing cards leave the hand intact', () => {
  const order = ['a', 'b', 'c'];
  for (const [moving, before] of [
    ['b', 'b'], ['b', 'c'], ['c', null], ['missing', 'a'], ['a', 'missing'],
  ] as const) {
    assert.deepEqual(moveCard(order, moving, before), order);
  }
  assert.deepEqual(moveCard([], 'a', null), []);
  assert.deepEqual(moveCard(['a'], 'a', null), ['a']);
});

test('Every valid insertion retains every physical card once and never mutates the source order', () => {
  for (let count = 1; count <= 12; count++) {
    const order = Object.freeze(Array.from({ length: count }, (_, index) => `card-${index}`));
    for (const moving of order) {
      for (const before of [...order, null]) {
        const result = moveCard(order, moving, before);
        assert.notEqual(result, order);
        assert.equal(result.length, count);
        assert.deepEqual(new Set(result), new Set(order));
        assert.deepEqual(result.filter(id => id !== moving), order.filter(id => id !== moving));
        if (before !== moving) {
          const slot = before === null ? result.length : result.indexOf(before);
          assert.equal(result.indexOf(moving), slot - 1);
        }
      }
    }
    assert.deepEqual(order, Array.from({ length: count }, (_, index) => `card-${index}`));
  }
});
