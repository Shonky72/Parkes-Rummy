import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseQuickPlaySetup } from '../lib/quick-play';
import { applyAction, createPlayer, createRoom, publicRoom } from '../lib/rummy';
import type { GameType } from '../lib/types';

test('Quick Play samples all ten rules and never grants locked Original Rules', () => {
  const seen = new Set<number>();
  for (let n = 0; n < 100; n++) {
    const plan = chooseQuickPlaySetup(false, max => (n + max - 1) % max);
    assert.ok([1, 2, 3].includes(plan.game));
    assert.ok(plan.ruleNumber >= 1 && plan.ruleNumber <= 10);
    seen.add(plan.ruleNumber);
    assert.ok(plan.difficulties.length >= 1 && plan.difficulties.length <= 3);
    assert.ok(plan.difficulties.every(value => ['easy', 'medium', 'hard'].includes(value)));
    assert.ok(plan.difficulties.filter(value => value === 'hard').length <= 1);
  }
  assert.equal(seen.size, 10);
});
test('Owned Original Rules includes Rule 10 and still caps the whole table at four players', () => {
  const plan = chooseQuickPlaySetup(true, max => max - 1);
  assert.deepEqual(plan, { game: 4, ruleNumber: 10, difficulties: ['hard', 'medium', 'medium'] });
});
test('One easy AI and Rule 1 remain possible, not compulsory', () => {
  assert.deepEqual(chooseQuickPlaySetup(false, () => 0), { game: 1, ruleNumber: 1, difficulties: ['easy'] });
  assert.throws(() => chooseQuickPlaySetup(false, max => max), RangeError);
});

for (const game of [1, 2, 3, 4] as GameType[]) for (let ruleNumber = 1; ruleNumber <= 10; ruleNumber++) {
  test(`Quick Game ${game}, Rule ${ruleNumber}: everyone starts on the drawn rule and the first hand is final`, () => {
    let room = createRoom('QUIC', createPlayer({ id: 'host', name: 'Dan', tokenHash: '', color: 0 }));
    room.quickPlay = { ruleNumber };
    room = applyAction(room, 'host', { type: 'setGame', game });
    room = applyAction(room, 'host', { type: 'addBot', difficulty: 'medium' });
    room = applyAction(room, 'host', { type: 'start' });
    assert.equal(room.round, 1);
    assert.ok(room.players.every(player => player.ruleNumber === ruleNumber));
    assert.equal(publicRoom(room, 'host').currentRule!.number, ruleNumber);
    assert.deepEqual(publicRoom(room, 'host').quickPlay, { ruleNumber });
    room.phase = 'play'; room.players[0].down = true;
    room.players[0].hand = [{ id: 'last', rank: 14, suit: 'H' }];
    const old = structuredClone(room);
    const finished = applyAction(room, 'host', { type: 'discard', cardId: 'last' });
    assert.deepEqual(room, old, 'No mutation of the stored input');
    assert.equal(finished.status, 'finished'); assert.equal(finished.history.length, 1);
    assert.equal(finished.result!.scores[0].nextRuleNumber, ruleNumber);
    assert.throws(() => applyAction(finished, 'host', { type: 'nextHand' }), /Quick Play/);
    assert.throws(() => applyAction(finished, 'host', { type: 'rematch' }), /Quick Play/);
    assert.ok(finished.players.every(player => player.ruleNumber === ruleNumber));
  });
}
test('Existing normal games still deal Rule 1 and advance after a hand', () => {
  let room = createRoom('NORM', createPlayer({ id: 'host', name: 'Dan', tokenHash: '', color: 0 }));
  room = applyAction(room, 'host', { type: 'addBot', difficulty: 'easy' });
  room = applyAction(room, 'host', { type: 'start' });
  assert.equal(room.players[0].ruleNumber, 1);
  room.phase = 'play'; room.players[0].down = true;
  room.players[0].hand = [{ id: 'last', rank: 14, suit: 'H' }];
  room = applyAction(room, 'host', { type: 'discard', cardId: 'last' });
  assert.equal(room.status, 'round-end');
  room = applyAction(room, 'host', { type: 'nextHand' });
  assert.equal(room.round, 2); assert.equal(room.players[0].ruleNumber, 2);
});
