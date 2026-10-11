import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Node's native TypeScript runner requires the explicit file extension.
import { createTurnAlertLedger, ownTurnAlertKey, setTurnVibrationEnabled, stopTurnVibration, vibrateForTurn } from '../lib/turn-alerts.ts';
import type { PublicRoom, RoomEvent } from '../lib/types';

const event = (id: number, type: RoomEvent['type']): RoomEvent => ({ id, type, at: id * 1000, text: '' });
const room: Pick<PublicRoom, 'code' | 'game' | 'round' | 'turnNumber' | 'youId' | 'turnPlayerId' | 'status' | 'events'> = {
  code: 'ABCD', game: 3, round: 4, turnNumber: 6, youId: 'me', turnPlayerId: 'me', status: 'playing',
  events: [event(10, 'start'), event(19, 'discard')],
};

test('A turn alert belongs only to an active own turn', () => {
  assert.equal(ownTurnAlertKey(null), null);
  assert.equal(ownTurnAlertKey({ ...room, turnPlayerId: 'friend' }), null);
  for (const status of ['lobby', 'round-end', 'finished'] as const) assert.equal(ownTurnAlertKey({ ...room, status }), null);
  assert.ok(ownTurnAlertKey(room));
});

test('Drawing, melding, additions and repeated polls retain one turn identity', () => {
  const start = ownTurnAlertKey(room);
  const events = [...room.events];
  for (const type of ['draw', 'meld', 'layoff', 'layoff', 'settings'] as const) {
    events.push(event(events.at(-1)!.id + 1, type));
    assert.equal(ownTurnAlertKey({ ...room, events: [...events] }), start);
  }
  assert.equal(ownTurnAlertKey(JSON.parse(JSON.stringify(room))), start);
});

test('Separate tables, players, turns, deals and rematches have distinct identities', () => {
  const original = ownTurnAlertKey(room);
  for (const patch of [
    { code: 'EFGH' }, { game: 2 as const }, { round: 5 }, { turnNumber: 10 },
    { youId: 'other-seat', turnPlayerId: 'other-seat' },
    { events: [event(35, 'start')] },
  ]) assert.notEqual(ownTurnAlertKey({ ...room, ...patch }), original);
  assert.notEqual(ownTurnAlertKey({ ...room, round: 1, turnNumber: 1, events: [event(10, 'start')] }),
    ownTurnAlertKey({ ...room, round: 1, turnNumber: 1, events: [event(300, 'start')] }));
});

test('One delivered turn alert survives repeat polls, switching tables and refreshes', () => {
  const saved = new Map<string, string>();
  const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); } };
  const first = ownTurnAlertKey(room)!;
  const second = ownTurnAlertKey({ ...room, code: 'EFGH' })!;
  const alerts = createTurnAlertLedger(storage);
  assert.equal(alerts.claim(first), true);
  assert.equal(alerts.claim(first), false);
  assert.equal(alerts.claim(second), true);
  assert.equal(alerts.claim(first), false);
  const afterRefresh = createTurnAlertLedger(storage);
  assert.equal(afterRefresh.claim(first), false);
  assert.equal(afterRefresh.claim(second), false);
  assert.equal(afterRefresh.claim(ownTurnAlertKey({ ...room, turnNumber: 10 })), true);
});

test('Blocked or malformed storage still keeps a working in-memory duplicate guard', () => {
  for (const storage of [
    { getItem: () => { throw new Error('Blocked'); }, setItem: () => { throw new Error('Blocked'); } },
    { getItem: () => '{bad JSON', setItem: () => {} },
    { getItem: () => '{"wrong":"shape"}', setItem: () => {} },
  ]) {
    const alerts = createTurnAlertLedger(storage);
    assert.equal(alerts.claim(null), false);
    assert.equal(alerts.claim('turn-1'), true);
    assert.equal(alerts.claim('turn-1'), false);
  }
});

test('A long-running game keeps the recent alert ledger bounded', () => {
  let stored = '';
  const alerts = createTurnAlertLedger({ getItem: () => '[]', setItem: (_key: string, value: string) => { stored = value; } });
  for (let turn = 0; turn < 200; turn++) assert.equal(alerts.claim(`turn-${turn}`), true);
  assert.equal(JSON.parse(stored).length, 128);
  assert.equal(alerts.claim('turn-199'), false);
});

test('Haptics wait for a visible activated page, honour the setting and never repeat a turn', () => {
  const names = ['window', 'document', 'navigator'] as const;
  const original = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  const pulses: number[] = [];
  const saved = new Map<string, string>();
  const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); } };
  const page = { hidden: true };
  const device = { userActivation: { hasBeenActive: false }, vibrate: (duration: number) => { pulses.push(duration); return true; } };
  Object.defineProperties(globalThis, {
    window: { value: { localStorage: storage, sessionStorage: storage, dispatchEvent: () => true }, configurable: true },
    document: { value: page, configurable: true },
    navigator: { value: device, configurable: true },
  });
  try {
    setTurnVibrationEnabled(true);
    assert.equal(vibrateForTurn('haptic-turn-1'), false, 'Hidden tabs remain quiet');
    page.hidden = false;
    assert.equal(vibrateForTurn('haptic-turn-1'), false, 'A fresh page waits for user activation');
    assert.deepEqual(pulses, []);
    device.userActivation.hasBeenActive = true;
    assert.equal(vibrateForTurn('haptic-turn-1'), true);
    assert.deepEqual(pulses, [80]);
    for (let poll = 0; poll < 5; poll++) assert.equal(vibrateForTurn('haptic-turn-1'), false);
    assert.deepEqual(pulses, [80]);
    setTurnVibrationEnabled(false);
    assert.deepEqual(pulses, [80, 0], 'Disabling vibration cancels any current pulse');
    assert.equal(vibrateForTurn('haptic-turn-2'), false);
    setTurnVibrationEnabled(true);
    assert.equal(vibrateForTurn('haptic-turn-2'), true, 'A disabled attempt did not consume the new turn');
    stopTurnVibration();
    assert.deepEqual(pulses, [80, 0, 80, 0]);

    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
    assert.equal(vibrateForTurn('unsupported'), false);
    assert.doesNotThrow(stopTurnVibration);
    let attempts = 0;
    Object.defineProperty(globalThis, 'navigator', { value: { vibrate: () => { attempts++; throw new Error('Policy blocked'); } }, configurable: true });
    assert.equal(vibrateForTurn('blocked'), false);
    assert.equal(vibrateForTurn('blocked'), false);
    assert.equal(attempts, 1, 'A blocked device never receives repeated requests from polls or taps');
  } finally {
    for (const [name, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
