import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Node's native TypeScript runner requires the explicit file extension.
import { GameError, applyAction, createPlayer, createRoom, publicRoom, roomPreview } from '../lib/rummy.ts';
import type { GameAction, RoomState } from '../lib/types';

function lobby(): RoomState {
  const host = createPlayer({ id: 'host', name: 'Host', tokenHash: 'host-secret', color: 0 });
  const room = createRoom('HINTS6', host);
  room.players.push(createPlayer({ id: 'guest', name: 'Guest', tokenHash: 'guest-secret', color: 1 }));
  return room;
}

function finishHand(room: RoomState): RoomState {
  const next = structuredClone(room);
  const player = next.players.find(candidate => candidate.id === next.turnPlayerId)!;
  next.stock.push(...player.hand.splice(1));
  next.phase = 'play';
  return applyAction(next, player.id, { type: 'discard', cardId: player.hand[0].id });
}

test('new rooms enable move hints and every public projection exposes the setting', () => {
  const room = lobby();
  assert.equal(room.showMoveHints, true);
  assert.equal(publicRoom(room, 'host').showMoveHints, true);
  assert.equal(publicRoom(room, 'guest').showMoveHints, true);
  assert.equal(roomPreview(room).showMoveHints, true);
});

test('the host switches move hints off and on in the lobby without mutating the previous state', () => {
  const original = lobby();
  const disabled = applyAction(original, 'host', { type: 'setMoveHints', enabled: false });
  assert.equal(original.showMoveHints, true);
  assert.equal(disabled.showMoveHints, false);
  assert.equal(disabled.version, original.version + 1);
  assert.equal(disabled.events.at(-1)?.type, 'settings');
  assert.equal(disabled.events.at(-1)?.text, 'Host turned move hints off.');
  assert.equal(disabled.events.at(-1)?.playerId, 'host');
  assert.equal(publicRoom(disabled, 'host').showMoveHints, false);
  assert.equal(publicRoom(disabled, 'guest').showMoveHints, false);
  assert.equal(roomPreview(disabled).showMoveHints, false);

  const enabled = applyAction(disabled, 'host', { type: 'setMoveHints', enabled: true });
  assert.equal(enabled.showMoveHints, true);
  assert.equal(enabled.events.at(-1)?.text, 'Host turned move hints on.');
  assert.equal(publicRoom(enabled, 'guest').showMoveHints, true);
  assert.equal(roomPreview(enabled).showMoveHints, true);
});

test('guests and absent players do not control move hints', () => {
  const room = lobby();
  const before = structuredClone(room);
  assert.throws(() => applyAction(room, 'guest', { type: 'setMoveHints', enabled: false }), /host/i);
  assert.throws(() => applyAction(room, 'outsider', { type: 'setMoveHints', enabled: false }), /rejoin/i);
  assert.deepEqual(room, before);
});

test('move hints only change in the lobby, including between hands and after the game', () => {
  const original = lobby();
  for (const status of ['playing', 'round-end', 'finished'] as const) {
    const room = { ...structuredClone(original), status };
    assert.throws(() => applyAction(room, 'host', { type: 'setMoveHints', enabled: false }), /lobby/i);
    assert.equal(room.showMoveHints, true);
    assert.equal(room.version, original.version);
  }
});

test('the engine strictly rejects non-boolean move-hints values', () => {
  const room = lobby();
  const before = structuredClone(room);
  for (const enabled of [undefined, null, 0, 1, '', 'true', 'false', [], {}]) {
    const malformed = { type: 'setMoveHints', enabled } as unknown as GameAction;
    assert.throws(() => applyAction(room, 'host', malformed), GameError);
    assert.deepEqual(room, before);
  }
});

test('legacy stored rooms without the field retain hints until the host changes the setting', () => {
  const legacy = lobby();
  delete legacy.showMoveHints;
  const restored = JSON.parse(JSON.stringify(legacy)) as RoomState;
  assert.equal(publicRoom(restored, 'host').showMoveHints, true);
  assert.equal(publicRoom(restored, 'guest').showMoveHints, true);
  assert.equal(roomPreview(restored).showMoveHints, true);
  assert.equal(Object.hasOwn(restored, 'showMoveHints'), false, 'Projection should not mutate a stored room');
  const changed = applyAction(restored, 'host', { type: 'setMoveHints', enabled: false });
  assert.equal(publicRoom(changed, 'guest').showMoveHints, false);
});

test('the chosen setting survives JSON storage, starting, the next hand and rematching', () => {
  let room = applyAction(lobby(), 'host', { type: 'setMoveHints', enabled: false });
  room = JSON.parse(JSON.stringify(room)) as RoomState;
  assert.equal(room.showMoveHints, false);
  room = applyAction(room, 'host', { type: 'start' });
  assert.equal(room.showMoveHints, false);
  room = finishHand(room);
  assert.equal(room.status, 'round-end');
  assert.equal(room.showMoveHints, false);
  room = applyAction(room, 'host', { type: 'nextHand' });
  assert.equal(room.round, 2);
  assert.equal(room.showMoveHints, false);
  room = finishHand(room);
  room = applyAction(room, 'host', { type: 'rematch' });
  assert.equal(room.status, 'lobby');
  assert.equal(room.showMoveHints, false);
  room = applyAction(room, 'host', { type: 'setMoveHints', enabled: true });
  assert.equal(room.showMoveHints, true);
});

test('hidden hints leave legal card placement and illegal-move checks unchanged', () => {
  let room = applyAction(lobby(), 'host', { type: 'setMoveHints', enabled: false });
  room = applyAction(room, 'host', { type: 'start' });
  room.phase = 'play';
  room.players[0].down = true;
  room.players[0].laidDownTurn = 0;
  room.players[0].hand = [{ id: 'fit', rank: 5, suit: 'H' }, { id: 'wrong', rank: 6, suit: 'S' }];
  room.melds = [{
    id: 'fives', ownerId: 'guest', kind: 'set', constraint: 'any',
    cards: ['C', 'D', 'S'].map((suit, index) => ({ id: `laid-${index}`, rank: 5, suit: suit as 'C' | 'D' | 'S' })),
  }];
  assert.throws(() => applyAction(room, 'host', { type: 'layoff', cardId: 'wrong', meldId: 'fives', end: 'end' }), GameError);
  const played = applyAction(room, 'host', { type: 'layoff', cardId: 'fit', meldId: 'fives', end: 'end' });
  assert.equal(played.showMoveHints, false);
  assert.equal(played.melds[0].cards.at(-1)?.id, 'fit');
  assert.deepEqual(played.players[0].hand.map(card => card.id), ['wrong']);
});
