import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Node's native TypeScript runner requires the explicit file extension.
import { getLayoffGroupTargets, getLayoffTargets } from '../lib/rummy.ts';
import type { Card, Meld, Suit } from '../lib/types';

let serial = 0;
const card = (rank: number, suit: Suit = 'C'): Card => ({ id: `group-${++serial}`, rank, suit });
const run = (ranks: number[]): Meld => ({ id: 'run', ownerId: 'other', kind: 'run', constraint: 'same-suit', naturalOnly: true, wildsMatch: true, cards: ranks.map(rank => card(rank, 'H')) });
const shown = (cards: (Card & { asRank?: number })[]) => cards.map(card => card.asRank ?? (card.rank === 1 ? 14 : card.rank));
const permutations = <T,>(values: T[]): T[][] => values.length < 2 ? [values] : values.flatMap((value, index) =>
  permutations(values.filter((_, i) => i !== index)).map(rest => [value, ...rest]));

test('All selection orders extend below an eight in nearest-end placement order', () => {
  const meld = run([8, 9, 10, 11, 12]);
  const selected = [card(5, 'S'), card(7, 'D'), card(6, 'C')];
  const before = structuredClone({ meld, selected });
  for (const order of permutations(selected)) {
    const targets = getLayoffGroupTargets(order, [meld]);
    assert.equal(targets.length, 1);
    assert.equal(targets[0].end, 'start');
    assert.equal(targets[0].asRank, 7);
    assert.equal(targets[0].asSuit, 'D');
    assert.deepEqual(shown(targets[0].cards), [7, 6, 5]);
    assert.deepEqual(targets[0].cards.map(card => card.id), [selected[1].id, selected[2].id, selected[0].id]);
  }
  assert.deepEqual({ meld, selected }, before);
});

test('Upper runs reserve naturals and use wilds for exact interior gaps in any order', () => {
  const meld = run([5, 6, 7, 8]);
  const selected = [card(11, 'H'), card(2, 'D'), card(9, 'S')];
  for (const order of permutations(selected)) {
    const [target] = getLayoffGroupTargets(order, [meld]);
    assert.equal(target.end, 'end');
    assert.deepEqual(shown(target.cards), [9, 10, 11]);
    assert.deepEqual(target.cards.map(card => card.id), [selected[2].id, selected[1].id, selected[0].id]);
    assert.deepEqual(target.cards[1], { ...selected[1], asRank: 10, asSuit: 'D' });
  }
});

test('Lower wild additions fill gaps without reassigning an exposed endpoint wild', () => {
  const meld = run([8, 9, 10]);
  meld.cards[0] = { ...card(2, 'H'), asRank: 8, asSuit: 'H' };
  const oldCards = structuredClone(meld.cards);
  const [target] = getLayoffGroupTargets([card(5, 'D'), card(2, 'S'), card(7, 'C')], [meld]);
  assert.deepEqual(shown(target.cards), [7, 6, 5]);
  assert.deepEqual(meld.cards, oldCards);
  assert.equal(getLayoffGroupTargets([card(8), card(7)], [meld]).length, 0, 'An exposed wild cannot be reclaimed or shifted');
});

test('All-wild selections can choose either run end but cannot wrap past five or ace', () => {
  const selected = [card(2), card(2, 'D')];
  const targets = getLayoffGroupTargets(selected, [run([7, 8, 9, 10, 11, 12])]);
  assert.deepEqual(targets.map(target => [target.end, shown(target.cards)]), [['start', [6, 5]], ['end', [13, 14]]]);
  assert.equal(getLayoffGroupTargets([...selected, card(2)], [run([7, 8, 9, 10, 11, 12])]).length, 0);
  const aceTarget = getLayoffGroupTargets([card(1), card(13)], [run([8, 9, 10, 11, 12])]);
  assert.deepEqual(shown(aceTarget[0].cards), [13, 14]);
});

test('Sets accept several physical copies of the same rank and wilds regardless of opening restrictions', () => {
  const meld: Meld = { id: 'set', ownerId: 'other', kind: 'set', constraint: 'red', naturalOnly: true, wildsMatch: true, cards: [card(5, 'H'), card(5, 'D'), { ...card(2, 'H'), asRank: 5, asSuit: 'H' }] };
  const selected = [card(2, 'S'), card(5, 'C'), card(5, 'C')];
  const [target] = getLayoffGroupTargets(selected, [meld]);
  assert.equal(target.end, 'end');
  assert.deepEqual(shown(target.cards), [5, 5, 5]);
  assert.deepEqual(new Set(target.cards.map(card => card.id)), new Set(selected.map(card => card.id)));
  assert.equal(getLayoffGroupTargets([card(5), card(6)], [meld]).length, 0);
});

test('A selection is rejected entirely for gaps, duplicate run ranks, duplicate identities or exposed cards', () => {
  const meld = run([8, 9, 10]);
  const duplicate = card(7);
  for (const selected of [[card(7), card(5)], [card(7), card(7, 'H')], [duplicate, duplicate], [card(7), meld.cards[0]], [card(3), card(4)], []]) {
    assert.deepEqual(getLayoffGroupTargets(selected, [meld]), []);
  }
  assert.deepEqual(getLayoffGroupTargets([card(7), card(11)], [meld]), [], 'One action cannot split across both ends');
});

test('The selection bound is eleven and legacy one-card target metadata is preserved', () => {
  const meld: Meld = { id: 'set', ownerId: 'other', kind: 'set', constraint: 'any', cards: [card(5), card(5, 'D')] };
  const selected = Array.from({ length: 11 }, () => card(5));
  assert.equal(getLayoffGroupTargets(selected, [meld])[0].cards.length, 11);
  assert.deepEqual(getLayoffGroupTargets([...selected, card(5)], [meld]), []);
  const wild = card(2, 'S');
  const groups = getLayoffGroupTargets([wild], [meld, run([7, 8, 9])]);
  assert.deepEqual(getLayoffTargets(wild, [meld, run([7, 8, 9])]), groups.map(({ meldId, end, asRank, asSuit }) => ({ meldId, end, asRank, asSuit })));
});
