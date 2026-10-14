import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseQuickPlaySetup } from '../lib/quick-play';

test('Quick Play never grants the locked Original Rules set', () => {
  for (let n = 0; n < 100; n++) {
    const plan = chooseQuickPlaySetup(false, max => (n + max - 1) % max);
    assert.ok([1, 2, 3].includes(plan.game));
    assert.ok(plan.difficulties.length >= 1 && plan.difficulties.length <= 7);
    assert.ok(plan.difficulties.every(value => ['easy', 'medium', 'hard'].includes(value)));
    assert.ok(plan.difficulties.filter(value => value === 'hard').length <= 1);
  }
});

test('Unblocked accounts are eligible for all four rule sets, up to seven AI seats', () => {
  const plan = chooseQuickPlaySetup(true, max => max - 1);
  assert.equal(plan.game, 4);
  assert.equal(plan.difficulties.length, 7);
  assert.equal(plan.difficulties.filter(d => d === 'hard').length, 1);
  assert.deepEqual(plan.difficulties.slice(1), Array(6).fill('medium'));
});

test('One easy AI is the valid minimum', () => {
  const plan = chooseQuickPlaySetup(false, () => 0);
  assert.deepEqual(plan, { game: 1, difficulties: ['easy'] });
});

test('Out-of-range supplied randomness is rejected rather than creating a malformed table', () => {
  assert.throws(() => chooseQuickPlaySetup(false, max => max), RangeError);
});
