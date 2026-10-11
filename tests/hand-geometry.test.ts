import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Node's native TypeScript runner requires the explicit file extension.
import { handInsertionAt, handVerticalNeighbour, type HandCardRect } from '../lib/hand-geometry.ts';
// @ts-expect-error Node's native TypeScript runner requires the explicit file extension.
import { moveCard } from '../lib/hand-order.ts';

const grid = (count: number, columns: number, selected: readonly string[] = []): HandCardRect[] =>
  Array.from({ length: count }, (_, index) => ({
    id: String(index + 1),
    left: 11 + index % columns * 65,
    top: 500 + Math.floor(index / columns) * 84 - (selected.includes(String(index + 1)) ? 2 : 0),
    width: 59,
    height: 76,
  }));

const drop = (cards: HandCardRect[], draggedId: string, x: number, y: number) => {
  const insertion = handInsertionAt(cards, draggedId, { x, y });
  assert.ok(insertion);
  return { ...insertion, order: moveCard(cards.map(card => card.id), draggedId, insertion.beforeId) };
};

test('A matching x coordinate selects different insertion slots in the two mobile rows', () => {
  const cards = grid(10, 5);
  assert.equal(drop(cards, '10', 98, 540).beforeId, '2');
  assert.equal(drop(cards, '10', 98, 625).beforeId, '7');
  assert.deepEqual(drop(cards, '10', 98, 625).order, ['1', '2', '3', '4', '5', '6', '10', '7', '8', '9']);
});

test('Dropping after row one inserts before row two instead of appending to the whole hand', () => {
  const result = drop(grid(10, 5), '9', 337, 540);
  assert.equal(result.beforeId, '6');
  assert.deepEqual(result.order, ['1', '2', '3', '4', '5', '9', '6', '7', '8', '10']);
  assert.equal(result.marker.top, 500);
});

test('A top-row card moves to the end of the second row', () => {
  const result = drop(grid(10, 5), '2', 337, 625);
  assert.equal(result.beforeId, null);
  assert.deepEqual(result.order, ['1', '3', '4', '5', '6', '7', '8', '9', '10', '2']);
  assert.equal(result.marker.top, 584);
});

test('Returning the held card to its existing slot preserves its order', () => {
  const cards = grid(10, 5);
  for (const card of cards) {
    assert.deepEqual(drop(cards, card.id, card.left + card.width / 2, card.top + card.height / 2).order,
      cards.map(held => held.id));
  }
});

test('The sixth top-row slot and five lower-row slots remain reachable after drawing card eleven', () => {
  const cards = grid(11, 6);
  assert.equal(drop(cards, '11', 372, 540).beforeId, '7', 'After the last top-row card goes before the lower row');
  assert.equal(drop(cards, '1', 337, 625).beforeId, null, 'The lower-row trailing space means the end of the hand');
  assert.equal(drop(cards, '1', 33, 625).beforeId, '7');
});

test('Selected cards lifted two pixels are grouped with their neighbouring row', () => {
  const cards = grid(10, 5, ['1', '3', '6', '8', '10']);
  assert.equal(drop(cards, '2', 98, 625).beforeId, '7');
  assert.equal(drop(cards, '9', 337, 540).beforeId, '6');
  assert.equal(handVerticalNeighbour(cards, '3', 1), '8');
});

test('A pointer in the row gap uses the nearest row and does not jump to the last card', () => {
  const cards = grid(10, 5);
  assert.equal(drop(cards, '10', 33, 577).beforeId, '1');
  assert.equal(drop(cards, '10', 33, 583).beforeId, '6');
});

test('The insertion marker follows the destination card rather than the dock bottom', () => {
  const result = drop(grid(10, 5), '9', 98, 540);
  assert.deepEqual(result.marker, { left: 73, top: 500, height: 76 });
});

test('Desktop single-row insertion keeps existing before-card and end-of-hand behaviour', () => {
  const cards = grid(10, 10);
  assert.equal(drop(cards, '10', 98, 540).beforeId, '2');
  assert.equal(drop(cards, '2', 710, 540).beforeId, null);
  assert.equal(handVerticalNeighbour(cards, '3', 1), null);
});

test('An otherwise empty hand accepts its single held card without adding or losing cards', () => {
  assert.equal(handInsertionAt([], '1', { x: 1, y: 1 }), null);
  assert.deepEqual(drop(grid(1, 5), '1', 50, 540).order, ['1']);
});

test('Keyboard up/down ordering targets the same column in the adjacent row', () => {
  const cards = grid(10, 5);
  for (let index = 1; index <= 5; index++) {
    assert.equal(handVerticalNeighbour(cards, String(index), 1), String(index + 5));
    assert.equal(handVerticalNeighbour(cards, String(index + 5), -1), String(index));
  }
  assert.equal(handVerticalNeighbour(cards, '1', -1), null);
  assert.equal(handVerticalNeighbour(cards, '10', 1), null);
  assert.equal(handVerticalNeighbour(cards, 'missing', 1), null);
});

test('The sixth column moves to the nearest lower card when the last row contains five', () => {
  const cards = grid(11, 6);
  assert.equal(handVerticalNeighbour(cards, '6', 1), '11');
  assert.equal(handVerticalNeighbour(cards, '11', -1), '5');
});

test('Every row insertion preserves each physical card once and surrounding relative order', () => {
  for (const [count, columns] of [[10, 5], [11, 6]] as const) {
    const cards = grid(count, columns);
    const order = cards.map(card => card.id);
    for (const held of cards) {
      for (const target of cards) {
        for (const offset of [1, target.width - 1]) {
          const result = drop(cards, held.id, target.left + offset, target.top + target.height / 2).order;
          assert.equal(result.length, count);
          assert.deepEqual(new Set(result), new Set(order));
          assert.deepEqual(result.filter(id => id !== held.id), order.filter(id => id !== held.id));
        }
      }
    }
    assert.deepEqual(cards, grid(count, columns));
  }
});
