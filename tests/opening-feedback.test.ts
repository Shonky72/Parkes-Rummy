import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Node's native TypeScript runner requires the explicit file extension.
import { getOpeningSelectionFeedback } from '../lib/opening-feedback.ts';
// @ts-expect-error Node's native TypeScript runner requires the explicit file extension.
import { RULES, findOpeningMelds } from '../lib/rummy.ts';
import type { Card, GameType, RuleDefinition, Suit } from '../lib/types';

let serial = 0;
const card = (rank: number, suit: Suit = 'C'): Card => ({ id: `feedback-${++serial}`, rank, suit });
const run = (ranks: number[], suit: Suit = 'C'): Card[] => ranks.map(rank => card(rank, suit));
const sameColourRule = RULES[2][2];

// The UI only asks for error feedback after the authoritative matcher rejects
// the selection. A valid opening, including an unsorted one, keeps its ready UI.
const feedback = (cards: Card[], game: GameType, ruleNumber: number): string =>
  findOpeningMelds(cards, game, ruleNumber) ? '' : getOpeningSelectionFeedback(cards, RULES[game][ruleNumber - 1]);

test('the screenshot selection identifies the two nines instead of asking for six cards again', () => {
  const selected = [...run([5, 6, 7, 8]), card(9, 'S'), card(9, 'C')];
  assert.equal(findOpeningMelds(selected, 2, 3), null);
  assert.equal(feedback(selected, 2, 3), 'A run needs different numbers. Two 9s are selected.');
});

test('replacing one nine with the ten of spades produces a valid opening in any hand order', () => {
  const selected = [card(10, 'S'), card(7), card(9, 'S'), card(5), card(8), card(6)];
  assert.ok(findOpeningMelds(selected, 2, 3));
  assert.equal(feedback(selected, 2, 3), '');
});

test('under- and over-selection receive the required count and the selected count', () => {
  for (const count of [0, 1, 5, 7]) {
    assert.equal(getOpeningSelectionFeedback(run(Array.from({ length: count }, (_, index) => index + 5)), sameColourRule),
      `Your opening needs 6 cards. ${count} ${count === 1 ? 'is' : 'are'} selected.`);
  }
});

test('mixed natural colours and a wrong-colour wild are explained for the one-colour opening', () => {
  const naturalMix = [...run([5, 6, 7, 8, 9]), card(10, 'H')];
  assert.equal(feedback(naturalMix, 2, 3), 'This run needs one colour: all red or all black.');
  const wrongWild = [...run([5, 6, 7, 8, 9]), card(2, 'H')];
  assert.equal(feedback(wrongWild, 2, 3), 'This run needs one colour: all red or all black. Wild twos must match the colour too.');
});

test('multiple wild twos are not diagnosed as repeated run numbers', () => {
  const selected = [card(9), card(2, 'S'), card(5), card(8), card(2), card(6)];
  assert.ok(findOpeningMelds(selected, 2, 3));
  assert.equal(feedback(selected, 2, 3), '');
});

test('gaps beyond the selected run length are distinguished from suit restrictions', () => {
  assert.match(feedback(run([5, 6, 7, 8, 9, 11]), 2, 3), /too far apart for a run of 6/);
});

test('one-of-each-suit counts a wild by its printed suit only when required', () => {
  const selected = [card(5), card(6, 'D'), card(7, 'H'), card(2)];
  assert.equal(feedback(selected, 2, 1), 'Use one club, diamond, heart and spade. Twos count as their printed suit.');
  selected[3] = card(2, 'S');
  assert.equal(feedback(selected, 2, 1), '');
});

test('same-suit feedback rejects mixed naturals while allowing another printed suit on a flexible wild', () => {
  const selected = [...run([5, 6, 7, 8, 9, 10, 11], 'H'), card(12, 'S')];
  assert.equal(feedback(selected, 2, 8), 'This run needs every card in the same suit.');
  selected[7] = card(2, 'S');
  assert.ok(findOpeningMelds(selected, 2, 8));
  assert.equal(feedback(selected, 2, 8), '');
});

test('alternation uses rank order, with wild gaps, instead of the selected hand order', () => {
  const valid = [card(11, 'H'), card(2, 'S'), card(7, 'H'), card(2), card(5, 'H'), card(9, 'H'), card(2, 'S')];
  assert.ok(findOpeningMelds(valid, 2, 4));
  assert.equal(feedback(valid, 2, 4), '');
  const wrongNatural = [card(11, 'H'), card(2, 'S'), card(7, 'S'), card(2), card(5, 'H'), card(9, 'H'), card(2, 'S')];
  assert.match(feedback(wrongNatural, 2, 4), /selected colours do not alternate/);
});

test('alternating-colour feedback respects the printed colour of wild twos', () => {
  const selected = [card(5, 'H'), card(7, 'H'), card(9, 'H'), card(11, 'H'), card(2, 'H'), card(2), card(2, 'S')];
  assert.equal(findOpeningMelds(selected, 2, 4), null);
  assert.match(feedback(selected, 2, 4), /balanced red and black cards.*Twos keep their printed colour/);
});

test('multiple melds get a rule description instead of a false duplicate-run diagnosis', () => {
  const invalid = [...run([5, 5, 5, 6, 6, 7])];
  assert.equal(feedback(invalid, 1, 2), 'These cards do not match 2 × 3 of a kind.');
  const valid = [...run([5, 5, 5, 6, 6, 6])];
  assert.equal(feedback(valid, 1, 2), '');
  const setAndRun = run([7, 7, 7, 7, 8, 9, 10]);
  assert.equal(feedback(setAndRun, 1, 3), '');
});

test('natural-only openings explain the wildcard restriction across all required melds', () => {
  assert.equal(feedback(run([8, 8, 12, 12, 12, 12, 2]), 2, 5), 'This opening needs natural cards only. Twos are not allowed.');
});

test('a single set with different ranks receives a matching-number explanation', () => {
  assert.equal(feedback(run([9, 9, 9, 9, 9, 10]), 2, 7), 'A set needs matching numbers. Different numbers are selected.');
});

test('ace aliases and face-card repeats use clear names without mutating the selection', () => {
  const selected = run([10, 11, 12, 13, 14, 1]);
  const before = structuredClone(selected);
  assert.equal(getOpeningSelectionFeedback(selected, sameColourRule), 'A run needs different numbers. Two aces are selected.');
  assert.deepEqual(selected, before);
});

test('mixed multi-meld natural restrictions do not wrongly ban every wildcard', () => {
  const mixed: RuleDefinition = { number: 1, title: 'Natural pair + run of four', description: '', requirements: [
    { kind: 'set', count: 2, naturalOnly: true }, { kind: 'run', count: 4 },
  ] };
  assert.equal(getOpeningSelectionFeedback(run([7, 8, 9, 10, 11, 2]), mixed), 'These cards do not match Natural pair + run of four.');
});

test('Game 3 four-suit run explains suit duplication and colour order separately', () => {
  const duplicateSuit = [card(5, 'H'), card(6, 'C'), card(7, 'H'), card(8, 'S')];
  assert.match(feedback(duplicateSuit, 3, 1), /one club, diamond, heart and spade/);
  const wrongOrder = [card(5, 'H'), card(6, 'D'), card(7, 'C'), card(8, 'S')];
  assert.match(feedback(wrongOrder, 3, 1), /alternate red and black in number order/);
  const valid = [card(8, 'S'), card(6, 'C'), card(7, 'D'), card(5, 'H')];
  assert.equal(feedback(valid, 3, 1), '');
});

test('Game 3 five-card suited run explains printed-suit twos', () => {
  const selected = [...run([5, 6, 7, 8], 'H'), card(2, 'D')];
  assert.match(feedback(selected, 3, 3), /same suit.*Twos count as their printed suit/);
  selected[4] = card(2, 'H');
  assert.equal(feedback(selected, 3, 3), '');
});

test('Game 3 finale distinguishes a natural heart pair from allowed wilds in the large set', () => {
  const largeSet = [...(['C', 'C', 'D', 'D', 'S', 'S'] as Suit[]).map(suit => card(13, suit)), card(2, 'C'), card(2, 'D')];
  const invalid = [...largeSet, card(12, 'H'), card(2, 'S')];
  assert.match(feedback(invalid, 3, 10), /two natural hearts of the same number.*eight-card set only/);
  const valid = [...largeSet, card(12, 'H'), card(12, 'H')];
  assert.equal(feedback(valid, 3, 10), '');
});
