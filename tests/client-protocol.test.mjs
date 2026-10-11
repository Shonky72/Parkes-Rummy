import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Exercise the actual client request/reload code without a browser preview.
const directory = path.resolve('.sites-runtime/client-protocol');
await fs.mkdir(directory, { recursive: true });
for (const name of ['client', 'room-protocol', 'room-code', 'client-identity', 'account-client']) {
  const source = await fs.readFile(`lib/${name}.ts`, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText.replaceAll("'./room-protocol'", "'./room-protocol.mjs'").replaceAll('"./room-protocol"', '"./room-protocol.mjs"')
    .replaceAll("'./room-code'", "'./room-code.mjs'").replaceAll('"./room-code"', '"./room-code.mjs"')
    .replaceAll("'./client-identity'", "'./client-identity.mjs'").replaceAll('"./client-identity"', '"./client-identity.mjs"')
    .replaceAll("'./account-client'", "'./account-client.mjs'").replaceAll('"./account-client"', '"./account-client.mjs"');
  await fs.writeFile(path.join(directory, `${name}.mjs`), output);
}
const protocol = await import(pathToFileURL(path.join(directory, 'room-protocol.mjs')).href);
const futureProtocol = 'individual-rules-v3';
const TOKEN_A = '0123456789abcdef'.repeat(4);
const TOKEN_B = 'fedcba9876543210'.repeat(4);
const TOKEN_C = 'aabbccddeeff0011'.repeat(4);
const SEATS_KEY = 'parkes-rummy:seats';
const LAST_KEY = 'parkes-rummy:last-room';
const HAND_KEY = 'parkes-rummy:hand-order';
let imports = 0;
function storage(initial = new Map()) {
  return { values: initial, getItem: key => initial.get(key) ?? null, setItem: (key, value) => initial.set(key, value) };
}
async function withClient(work, options = {}) {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const local = options.local ?? storage();
  const session = options.session ?? storage();
  const navigations = [];
  const calls = [];
  const events = new EventTarget();
  let url = new URL(options.url ?? 'https://game.test/join/JT482T?view=table#cards');
  const location = {
    get href() { return url.href; },
    get pathname() { return url.pathname; },
    replace: target => { navigations.push(target); url = new URL(target); },
  };
  globalThis.window = {
    localStorage: local, sessionStorage: session, location, setTimeout, clearTimeout,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  };
  let reply = () => new Response(JSON.stringify({ room: { code: 'JT482T', currentRule: { number: 5, title: '2 × 4 of a kind' } } }), {
    headers: { [protocol.ROOM_PROTOCOL_HEADER]: protocol.ROOM_PROTOCOL },
  });
  globalThis.fetch = async (...args) => { calls.push(args); return reply(...args); };
  try {
    const client = await import(`${pathToFileURL(path.join(directory, 'client.mjs')).href}?case=${++imports}`);
    return await work({
      client, local, session, location, navigations, calls,
      replyWith: callback => { reply = callback; },
      dispatchStorage: (key, newValue = key === null ? null : local.values?.get(key) ?? null) => {
        const event = new Event('storage');
        Object.defineProperties(event, { key: { value: key }, newValue: { value: newValue } });
        events.dispatchEvent(event);
      },
    });
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
  }
}

const mismatch = () => new Response(JSON.stringify({ room: { code: 'JT482T' } }), {
  headers: { [protocol.ROOM_PROTOCOL_HEADER]: futureProtocol },
});

test('saved sorting mode persists independently of direction and defaults to numbers for missing, invalid or unavailable storage', async () => {
  const local = storage(new Map([['parkes-rummy:sort', 'ascending']]));
  await withClient(async ({ client }) => {
    assert.equal(client.getSortMode(), 'number', 'Existing players without a mode keep number sorting');
    for (const value of ['', 'rank', 'color', 'ascending']) {
      local.values.set('parkes-rummy:sort-mode', value);
      assert.equal(client.getSortMode(), 'number');
    }
    for (const mode of ['number', 'colour', 'suit']) {
      client.rememberSortMode(mode);
      assert.equal(client.getSortMode(), mode);
      assert.equal(local.values.get('parkes-rummy:sort-mode'), mode);
      assert.equal(client.getSort(), 'ascending', 'Selecting a grouping never changes the saved direction');
    }
  }, { local });
  await withClient(async ({ client }) => {
    assert.equal(client.getSortMode(), 'suit', 'A fresh client reads the saved grouping');
    client.rememberSort('descending');
    assert.equal(client.getSortMode(), 'suit', 'Changing direction never changes the saved grouping');
  }, { local });
  const unavailable = { getItem() { throw new Error('Storage denied'); }, setItem() { throw new Error('Storage denied'); } };
  await withClient(async ({ client }) => {
    assert.equal(client.getSortMode(), 'number');
    assert.doesNotThrow(() => client.rememberSortMode('colour'));
  }, { local: unavailable });
});

test('current client identifies its contract on reads and writes and receives the server-owned rule', async () => {
  await withClient(async ({ client, calls, navigations }) => {
    const view = await client.roomApi.get('JT482T', TOKEN_A);
    assert.equal(view.room.currentRule.number, 5);
    await client.roomApi.action('JT482T', TOKEN_A, { type: 'goDown', cardIds: ['one'], expectedRuleNumber: 5 }, 'one-request');
    assert.equal(calls.length, 2);
    for (const [, options] of calls) {
      assert.equal(options.headers[protocol.ROOM_PROTOCOL_HEADER], protocol.ROOM_PROTOCOL);
      assert.equal(options.headers.Authorization, `Bearer ${TOKEN_A}`);
      assert.equal(options.cache, 'no-store');
    }
    assert.equal(JSON.parse(calls[1][1].body).action.expectedRuleNumber, 5);
    assert.equal(navigations.length, 0);
  });
});

test('a differing server contract reloads the same room once and preserves the saved seat and manual hand order', async () => {
  const local = storage(new Map([
    ['parkes-rummy:seats', JSON.stringify({ JT482T: TOKEN_A })],
    ['parkes-rummy:hand-order', JSON.stringify({ key: 'JT482T:1:6:host', ids: ['nine', 'two', 'seven'] })],
    ['parkes-rummy:last-room', 'JT482T'],
  ]));
  const before = [...local.values];
  await withClient(async ({ client, replyWith, navigations, calls }) => {
    replyWith(mismatch);
    await assert.rejects(client.roomApi.get('JT482T', TOKEN_A), error => error.status === 426);
    await assert.rejects(client.roomApi.get('JT482T', TOKEN_A), error => error.status === 426);
    assert.equal(navigations.length, 1);
    const target = new URL(navigations[0]);
    assert.equal(target.origin, 'https://game.test');
    assert.equal(target.pathname, '/join/JT482T');
    assert.equal(target.searchParams.get('view'), 'table');
    assert.equal(target.searchParams.get(protocol.ROOM_RELOAD_PARAM), futureProtocol);
    assert.equal(target.hash, '#cards');
    assert.ok(!navigations[0].includes(TOKEN_A));
    assert.deepEqual([...local.values], before);
    const priorCalls = calls.length;
    await assert.rejects(client.roomApi.action('JT482T', TOKEN_A, { type: 'discard', cardId: 'nine' }, 'do-not-replay'), error => error.status === 426);
    assert.equal(calls.length, priorCalls, 'No mutation or blind action replay while an update reload is pending');
  }, { local });
});

test('the session guard prevents another reload if a cached client returns without its URL marker', async () => {
  const session = storage();
  await withClient(async ({ client, replyWith, navigations }) => {
    replyWith(mismatch);
    await assert.rejects(client.roomApi.get('JT482T', TOKEN_A), error => error.status === 426);
    assert.equal(navigations.length, 1);
  }, { session });
  await withClient(async ({ client, replyWith, navigations }) => {
    replyWith(mismatch);
    await assert.rejects(client.roomApi.get('JT482T', TOKEN_A), error => error.status === 426);
    assert.equal(navigations.length, 0);
  }, { session });
});

test('the public URL marker prevents a reload loop when session storage is blocked', async () => {
  const unavailable = { getItem() { throw new Error('Storage denied'); }, setItem() { throw new Error('Storage denied'); } };
  let target;
  await withClient(async ({ client, replyWith, navigations }) => {
    replyWith(mismatch);
    await assert.rejects(client.roomApi.get('JT482T', TOKEN_A), error => error.status === 426);
    assert.equal(navigations.length, 1);
    target = navigations[0];
  }, { session: unavailable });
  await withClient(async ({ client, replyWith, navigations }) => {
    replyWith(mismatch);
    await assert.rejects(client.roomApi.get('JT482T', TOKEN_A), error => error.status === 426);
    assert.equal(navigations.length, 0);
  }, { session: unavailable, url: target });
});

test('a rejected outdated mutation refreshes once without resubmitting the action', async () => {
  await withClient(async ({ client, replyWith, calls, navigations }) => {
    replyWith(() => new Response(JSON.stringify({ error: protocol.ROOM_UPDATE_MESSAGE }), {
      status: 426, headers: { [protocol.ROOM_PROTOCOL_HEADER]: futureProtocol },
    }));
    await assert.rejects(client.roomApi.action('JT482T', TOKEN_A, { type: 'goDown', cardIds: ['one'], expectedRuleNumber: 6 }, 'stale-one'), error => error.status === 426);
    assert.equal(calls.length, 1);
    assert.equal(navigations.length, 1);
    await assert.rejects(client.roomApi.action('JT482T', TOKEN_A, { type: 'goDown', cardIds: ['one'], expectedRuleNumber: 6 }, 'stale-one'), error => error.status === 426);
    assert.equal(calls.length, 1);
  });
});

test('an authoritative rule conflict reaches the UI with its snapshot and never replays the opening', async () => {
  await withClient(async ({ client, replyWith, calls, navigations }) => {
    const room = { code: 'JT482T', youId: 'host', version: 27, currentRule: { number: 5, title: '2 × 4 of a kind' } };
    replyWith(() => new Response(JSON.stringify({ error: 'Your current rule is Rule 5: 2 × 4 of a kind.', room }), {
      status: 409, headers: { [protocol.ROOM_PROTOCOL_HEADER]: protocol.ROOM_PROTOCOL },
    }));
    await assert.rejects(client.roomApi.action('JT482T', TOKEN_A, { type: 'goDown', cardIds: ['one'], expectedRuleNumber: 6 }, 'stale-view'), error => {
      assert.ok(error instanceof client.RoomError);
      assert.equal(error.status, 409);
      assert.deepEqual(error.room, room);
      return true;
    });
    assert.equal(calls.length, 1);
    assert.equal(navigations.length, 0, 'A changed rule needs a fresh selection, not a page reload or retry');
  });
});

test('joining and returning to multiple games preserves every saved seat across a fresh client', async () => {
  const local = storage();
  await withClient(async ({ client }) => {
    client.rememberSeat(' a b c d ', TOKEN_A);
    client.rememberSeat('efgh', TOKEN_B);
    client.rememberSeat('jt482t', TOKEN_C);
    assert.deepEqual(client.getSeats(), { ABCD: TOKEN_A, EFGH: TOKEN_B, JT482T: TOKEN_C });
    assert.equal(client.seatToken('a b c d'), TOKEN_A);
    assert.equal(client.lastRoom(), 'JT482T');

    client.rememberSeat('abcd', TOKEN_C);
    assert.deepEqual(client.getSeats(), { ABCD: TOKEN_C, EFGH: TOKEN_B, JT482T: TOKEN_C });
    assert.equal(client.lastRoom(), 'ABCD', 'Returning to one seat changes the resume target without dropping other games');
    client.forgetSeat('e f g h');
    assert.deepEqual(client.getSeats(), { ABCD: TOKEN_C, JT482T: TOKEN_C });
    assert.equal(client.lastRoom(), 'ABCD', 'Leaving another game preserves the current resume target');
  }, { local });
  await withClient(async ({ client }) => {
    assert.deepEqual(client.getSeats(), { ABCD: TOKEN_C, JT482T: TOKEN_C });
    assert.equal(client.lastRoom(), 'ABCD');
    client.forgetSeat('abcd');
    assert.deepEqual(client.getSeats(), { JT482T: TOKEN_C });
    assert.equal(client.lastRoom(), '', 'Leaving the current game clears its resume target');
  }, { local });
});

test('late join responses neither replace newer credentials nor restore an explicitly removed seat', async () => {
  const local = storage();
  const setItem = local.setItem;
  let writes = 0;
  local.setItem = (key, value) => { writes++; return setItem(key, value); };
  await withClient(async ({ client }) => {
    let events = 0;
    const unsubscribe = client.subscribeSavedSeats(() => { events++; });
    try {
      assert.equal(client.rememberSeat('ABCD', TOKEN_A), true);
      const startingToken = client.seatToken('ABCD');
      assert.equal(client.rememberSeat('ABCD', TOKEN_B), true, 'A newer successful join has already replaced the original seat');
      client.rememberSeat('EFGH', TOKEN_C);
      const beforeLateReply = { values: [...local.values], writes, events };
      assert.equal(client.rememberSeat('a b c d', TOKEN_C, { visit: false, expectedToken: startingToken }), false);
      assert.deepEqual({ values: [...local.values], writes, events }, beforeLateReply, 'A failed comparison performs no writes or notifications');
      assert.equal(client.seatToken('ABCD'), TOKEN_B);
      assert.equal(client.lastRoom(), 'EFGH');

      client.forgetSeat('ABCD');
      const afterRemoval = { values: [...local.values], writes, events };
      assert.equal(client.rememberSeat('ABCD', TOKEN_A, { visit: false, expectedToken: TOKEN_B }), false);
      assert.deepEqual({ values: [...local.values], writes, events }, afterRemoval, 'A removed seat invalidates the pending response’s expected credential');
      assert.equal(client.seatToken('ABCD'), undefined);
      assert.equal(client.lastRoom(), 'EFGH');
    } finally { unsubscribe(); }
  }, { local });
});

test('a late successful join saves a previously unseen game without replacing the last visited room', async () => {
  const local = storage();
  await withClient(async ({ client }) => {
    client.rememberSeat('ABCD', TOKEN_A);
    let events = 0;
    const unsubscribe = client.subscribeSavedSeats(() => { events++; });
    try {
      assert.equal(client.rememberSeat('efgh', TOKEN_B, { visit: false, expectedToken: null }), true);
      assert.deepEqual(client.getSeats(), { ABCD: TOKEN_A, EFGH: TOKEN_B });
      assert.equal(client.lastRoom(), 'ABCD', 'The game opened after the request remains the resume target');
      assert.equal(events, 1, 'The newly saved table still reaches the games list');
      const saved = [...local.values];
      assert.equal(client.rememberSeat('EFGH', TOKEN_C, { visit: false, expectedToken: null }), false);
      assert.deepEqual([...local.values], saved, 'Another response expecting an absent seat cannot overwrite the completed join');
      assert.equal(events, 1);
    } finally { unsubscribe(); }
  }, { local });
  await withClient(async ({ client }) => {
    assert.deepEqual(client.getSeats(), { ABCD: TOKEN_A, EFGH: TOKEN_B });
    assert.equal(client.lastRoom(), 'ABCD', 'The background completion persists without stealing the visit after refresh');
    assert.equal(client.rememberSeat('EFGH', TOKEN_B), true);
    assert.equal(client.lastRoom(), 'EFGH', 'An intentional later visit still updates the resume target normally');
  }, { local });
});

test('deleting a saved game removes every arrangement for that room while preserving other games and preferences', async () => {
  const removedHands = { 'ABCD:1:2:me': ['old-a-2', 'old-a-1'], 'ABCD:3:6:me': ['a-3', 'a-1', 'a-2'] };
  const retainedHands = { 'EFGH:2:4:me': ['b-2', 'b-1'], 'ABCDXY:1:8:me': ['c-2', 'c-1'] };
  const local = storage(new Map([
    [SEATS_KEY, JSON.stringify({ ABCD: TOKEN_A, EFGH: TOKEN_B, ABCDXY: TOKEN_C })],
    [LAST_KEY, 'ABCD'], [HAND_KEY, JSON.stringify({ version: 2, hands: { ...removedHands, ...retainedHands } })],
    ['parkes-rummy:name', 'Shonky'], ['parkes-rummy:sort', 'ascending'], ['parkes-rummy:sort-mode', 'suit'],
  ]));
  await withClient(async ({ client }) => {
    const updates = [];
    const unsubscribe = client.subscribeSavedSeats(() => {
      updates.push({ seats: client.getSeats(), last: client.lastRoom(), hands: JSON.parse(local.values.get(HAND_KEY)).hands });
    });
    try {
      assert.equal(client.forgetSeat(' a b c d ', { expectedToken: TOKEN_A }), true);
      assert.deepEqual(client.getSeats(), { EFGH: TOKEN_B, ABCDXY: TOKEN_C });
      assert.equal(client.lastRoom(), '');
      for (const [key, ids] of Object.entries(removedHands)) assert.equal(client.savedHandOrder(key, ids), null);
      for (const [key, ids] of Object.entries(retainedHands)) assert.deepEqual(client.savedHandOrder(key, [...ids].reverse()), ids);
      assert.deepEqual(JSON.parse(local.values.get(HAND_KEY)), { version: 2, hands: retainedHands });
      assert.equal(client.storedName(), 'Shonky');
      assert.equal(client.getSort(), 'ascending');
      assert.equal(client.getSortMode(), 'suit');
      assert.deepEqual(updates, [{ seats: { EFGH: TOKEN_B, ABCDXY: TOKEN_C }, last: '', hands: retainedHands }], 'One notification follows the complete local cleanup');
    } finally { unsubscribe(); }
  }, { local });
  await withClient(async ({ client }) => {
    assert.deepEqual(client.getSeats(), { EFGH: TOKEN_B, ABCDXY: TOKEN_C });
    assert.equal(client.savedHandOrder('ABCD:3:6:me', ['a-1', 'a-2', 'a-3']), null);
    assert.deepEqual(client.savedHandOrder('ABCDXY:1:8:me', ['c-1', 'c-2']), ['c-2', 'c-1'], 'A longer room code sharing the prefix survives refresh');
    assert.equal(client.storedName(), 'Shonky');
    assert.equal(client.getSortMode(), 'suit');
  }, { local });
});

test('stale deletion confirmations and invalid room codes perform no writes, cleanup or notifications', async () => {
  const local = storage();
  const setItem = local.setItem;
  let writes = 0;
  local.setItem = (key, value) => { writes++; return setItem(key, value); };
  await withClient(async ({ client }) => {
    client.rememberSeat('ABCD', TOKEN_A);
    client.rememberSeat('ABCD', TOKEN_B);
    client.rememberHandOrder('ABCD:3:1:me', ['a-2', 'a-1']);
    client.rememberSeat('EFGH', TOKEN_C);
    client.rememberHandOrder('EFGH:1:6:me', ['b-2', 'b-1']);
    let updates = 0;
    const unsubscribe = client.subscribeSavedSeats(() => { updates++; });
    try {
      const before = { values: [...local.values], writes, updates };
      assert.equal(client.forgetSeat('abcd', { expectedToken: TOKEN_A }), false, 'The confirmation’s original token no longer owns the saved seat');
      assert.equal(client.forgetSeat('ABCD', { expectedToken: null }), false, 'An absent-seat expectation must not delete a newly joined seat');
      for (const code of ['', 'ABC', 'ABCDE', 'AB0D', 'AB!D']) assert.equal(client.forgetSeat(code), false);
      assert.deepEqual({ values: [...local.values], writes, updates }, before);
      assert.equal(client.seatToken('ABCD'), TOKEN_B);
      assert.deepEqual(client.savedHandOrder('ABCD:3:1:me', ['a-1', 'a-2']), ['a-2', 'a-1']);

      assert.equal(client.forgetSeat('ABCD', { expectedToken: TOKEN_B }), true);
      assert.equal(updates, 1);
      assert.equal(client.lastRoom(), 'EFGH', 'Removing another game leaves the current resume target intact');
      assert.deepEqual(client.getSeats(), { EFGH: TOKEN_C });
      assert.deepEqual(client.savedHandOrder('EFGH:1:6:me', ['b-1', 'b-2']), ['b-2', 'b-1']);
      const after = { values: [...local.values], writes, updates };
      assert.equal(client.forgetSeat('ABCD', { expectedToken: TOKEN_B }), false, 'A second pending confirmation becomes invalid after removal');
      assert.deepEqual({ values: [...local.values], writes, updates }, after);
    } finally { unsubscribe(); }
  }, { local });
});

test('removing an absent seat cleans its legacy arrangement and normalised resume target without rewriting another room’s legacy data', async () => {
  for (const legacyRoom of ['JT482T', 'EFGH']) {
    const legacyKey = `${legacyRoom}:1:6:me`;
    const legacy = JSON.stringify({ key: legacyKey, ids: ['legacy-2', 'legacy-1'] });
    const local = storage(new Map([
      [SEATS_KEY, JSON.stringify({ EFGH: TOKEN_B })], [LAST_KEY, ' j t 4 8 2 t '], [HAND_KEY, legacy],
    ]));
    await withClient(async ({ client }) => {
      assert.equal(client.forgetSeat(' j t 4 8 2 t ', { expectedToken: null }), true);
      assert.deepEqual(client.getSeats(), { EFGH: TOKEN_B });
      assert.equal(client.lastRoom(), '');
      if (legacyRoom === 'JT482T') {
        assert.equal(client.savedHandOrder(legacyKey, ['legacy-1', 'legacy-2']), null);
        assert.deepEqual(JSON.parse(local.values.get(HAND_KEY)), { version: 2, hands: {} });
      } else {
        assert.deepEqual(client.savedHandOrder(legacyKey, ['legacy-1', 'legacy-2']), ['legacy-2', 'legacy-1']);
        assert.equal(local.values.get(HAND_KEY), legacy, 'An unrelated legacy arrangement retains its exact stored representation');
      }
    }, { local });
  }
});

for (const readsBlocked of [false, true]) {
  test(`saved-game cleanup persists in page memory when storage ${readsBlocked ? 'reads and writes are blocked' : 'writes fail but stale reads succeed'}`, async () => {
    const backing = new Map([
      [SEATS_KEY, JSON.stringify({ ABCD: TOKEN_A, EFGH: TOKEN_B })], [LAST_KEY, 'ABCD'],
      [HAND_KEY, JSON.stringify({ version: 2, hands: { 'ABCD:3:1:me': ['a-2', 'a-1'], 'EFGH:1:4:me': ['b-2', 'b-1'] } })],
    ]);
    const local = {
      getItem(key) { if (readsBlocked) throw new Error('Read denied'); return backing.get(key) ?? null; },
      setItem() { throw new Error('Write denied'); },
    };
    await withClient(async ({ client }) => {
      client.rememberName('Shonky');
      client.rememberSeat('ABCD', TOKEN_A);
      client.rememberSeat('EFGH', TOKEN_B);
      client.rememberSeat('ABCD', TOKEN_A);
      client.rememberHandOrder('ABCD:3:1:me', ['a-2', 'a-1']);
      client.rememberHandOrder('EFGH:1:4:me', ['b-2', 'b-1']);
      client.rememberSort('ascending');
      client.rememberSortMode('colour');
      assert.equal(client.forgetSeat(' a b c d ', { expectedToken: TOKEN_A }), true);
      assert.deepEqual(client.getSeats(), { EFGH: TOKEN_B });
      assert.equal(client.lastRoom(), '');
      assert.equal(client.savedHandOrder('ABCD:3:1:me', ['a-1', 'a-2']), null);
      assert.deepEqual(client.savedHandOrder('EFGH:1:4:me', ['b-1', 'b-2']), ['b-2', 'b-1']);
      assert.equal(client.storedName(), 'Shonky');
      assert.equal(client.getSort(), 'ascending');
      assert.equal(client.getSortMode(), 'colour');
      assert.equal(JSON.parse(backing.get(SEATS_KEY)).ABCD, TOKEN_A, 'Backing storage stays stale while the active page honours deletion');
      assert.equal(client.forgetSeat('ABCD', { expectedToken: TOKEN_A }), false);
    }, { local });
  });
}

test('saved seats normalise valid room codes and filter malformed records without accepting invalid credentials', async () => {
  const raw = {
    ' a b c d ': TOKEN_A, 'j t 4 8 2 t': TOKEN_B,
    AB0D: TOKEN_A, ABC1: TOKEN_A, ABCDE: TOKEN_A, 'AB!D': TOKEN_A, '': TOKEN_A,
    EFGH: null, IJKL: 123, MNOP: [], QRST: TOKEN_A.toUpperCase(),
    UVWX: TOKEN_A.slice(1), YZAB: `${TOKEN_A.slice(1)}g`, CDEF: { token: TOKEN_A },
  };
  const local = storage(new Map([[SEATS_KEY, JSON.stringify(raw)]]));
  await withClient(async ({ client }) => {
    assert.deepEqual(client.getSeats(), { ABCD: TOKEN_A, JT482T: TOKEN_B });
    assert.equal(client.seatToken(' jt482t '), TOKEN_B);
    assert.equal(client.seatToken('missing'), undefined);
    client.rememberSeat('efgh', TOKEN_C);
    const before = [...local.values];
    for (const [code, token] of [
      ['AB0D', TOKEN_A], ['ABCDE', TOKEN_A], ['AB!D', TOKEN_A],
      ['ABCD', TOKEN_A.toUpperCase()], ['ABCD', ''], ['ABCD', TOKEN_A.slice(1)],
    ]) client.rememberSeat(code, token);
    assert.deepEqual([...local.values], before, 'Invalid writes neither replace seats nor change the last game');
    assert.deepEqual(JSON.parse(local.values.get(SEATS_KEY)), { ABCD: TOKEN_A, JT482T: TOKEN_B, EFGH: TOKEN_C });
  }, { local });
});

test('malformed saved-seat JSON recovers to an empty list and accepts a new valid seat', async () => {
  const local = storage();
  await withClient(async ({ client }) => {
    for (const malformed of ['{bad JSON', 'null', 'true', '42', '"text"', '[]', '[{"ABCD":"old"}]']) {
      local.values.set(SEATS_KEY, malformed);
      assert.deepEqual(client.getSeats(), {}, malformed);
      client.rememberSeat('ABCD', TOKEN_A);
      assert.deepEqual(client.getSeats(), { ABCD: TOKEN_A }, 'A damaged value must not prevent joining a game');
    }
  }, { local });
});

test('fully blocked storage retains seats, card arrangements and sort preferences for the active page', async () => {
  const denied = { getItem() { throw new Error('Storage denied'); }, setItem() { throw new Error('Storage denied'); } };
  await withClient(async ({ client }) => {
    client.rememberName('  Shonky  ');
    client.rememberSeat('ABCD', TOKEN_A);
    client.rememberSeat('EFGH', TOKEN_B);
    client.rememberSort('ascending');
    client.rememberSortMode('suit');
    client.rememberHandOrder('ABCD:1:1:me', ['a-3', 'a-1', 'a-2']);
    client.rememberHandOrder('EFGH:2:1:me', ['b-2', 'b-1']);
    assert.equal(client.storedName(), 'Shonky');
    assert.deepEqual(client.getSeats(), { ABCD: TOKEN_A, EFGH: TOKEN_B });
    assert.equal(client.lastRoom(), 'EFGH');
    assert.equal(client.getSort(), 'ascending');
    assert.equal(client.getSortMode(), 'suit');
    assert.deepEqual(client.savedHandOrder('ABCD:1:1:me', ['a-1', 'a-2', 'a-3']), ['a-3', 'a-1', 'a-2']);
    assert.deepEqual(client.savedHandOrder('EFGH:2:1:me', ['b-1', 'b-2']), ['b-2', 'b-1']);
    client.forgetSeat('ABCD');
    assert.deepEqual(client.getSeats(), { EFGH: TOKEN_B });
  }, { local: denied });
});

test('write-denied storage retains new seats and preferences without reverting to stale readable values', async () => {
  const initial = new Map([
    [SEATS_KEY, JSON.stringify({ ABCD: TOKEN_A })],
    [LAST_KEY, 'ABCD'], ['parkes-rummy:sort', 'descending'],
    [HAND_KEY, JSON.stringify({ key: 'ABCD:1:1:me', ids: ['a-2', 'a-1'] })],
  ]);
  const deniedWrites = { getItem: key => initial.get(key) ?? null, setItem() { throw new Error('Quota exceeded'); } };
  await withClient(async ({ client }) => {
    assert.deepEqual(client.getSeats(), { ABCD: TOKEN_A });
    client.rememberSeat('EFGH', TOKEN_B);
    client.rememberSeat('JT482T', TOKEN_C);
    assert.deepEqual(client.getSeats(), { ABCD: TOKEN_A, EFGH: TOKEN_B, JT482T: TOKEN_C });
    assert.equal(client.lastRoom(), 'JT482T');
    client.rememberSort('ascending');
    client.rememberSortMode('colour');
    assert.equal(client.getSort(), 'ascending');
    assert.equal(client.getSortMode(), 'colour');
    client.rememberHandOrder('EFGH:2:1:me', ['b-2', 'b-1']);
    assert.deepEqual(client.savedHandOrder('ABCD:1:1:me', ['a-1', 'a-2']), ['a-2', 'a-1']);
    assert.deepEqual(client.savedHandOrder('EFGH:2:1:me', ['b-1', 'b-2']), ['b-2', 'b-1']);
    client.forgetSeat('ABCD');
    assert.deepEqual(client.getSeats(), { EFGH: TOKEN_B, JT482T: TOKEN_C });
    assert.equal(initial.get(LAST_KEY), 'ABCD', 'The assertions use page memory while backing storage stays unchanged');
  }, { local: deniedWrites });
});

test('saved-seat subscriptions update for joins, departures and other tabs, then detach cleanly', async () => {
  await withClient(async ({ client, local, dispatchStorage }) => {
    let updates = 0;
    const unsubscribe = client.subscribeSavedSeats(() => { updates++; });
    client.rememberSeat('ABCD', TOKEN_A);
    client.rememberSeat('EFGH', TOKEN_B);
    client.forgetSeat('ABCD');
    assert.equal(updates, 3);
    dispatchStorage('parkes-rummy:sort');
    assert.equal(updates, 3, 'Unrelated preference changes do not refetch the game list');
    local.values.set(SEATS_KEY, JSON.stringify({ JT482T: TOKEN_C }));
    dispatchStorage(SEATS_KEY);
    assert.equal(updates, 4);
    assert.deepEqual(client.getSeats(), { JT482T: TOKEN_C });
    local.values.delete(SEATS_KEY);
    dispatchStorage(null);
    assert.equal(updates, 5);
    assert.deepEqual(client.getSeats(), {}, 'A storage clear in another tab removes stale seats from memory');
    unsubscribe();
    client.rememberSeat('ABCD', TOKEN_A);
    dispatchStorage(SEATS_KEY);
    assert.equal(updates, 5, 'Unmounted lists retain no local or cross-tab subscriptions');
  });
});

test('cross-tab changes and restored writes release stale unsaved storage while preserving unrelated page data', async () => {
  const backing = new Map([[SEATS_KEY, JSON.stringify({ ABCD: TOKEN_A })]]);
  let writesBlocked = true;
  let readsBlocked = false;
  const local = {
    getItem(key) { if (readsBlocked) throw new Error('Read denied'); return backing.get(key) ?? null; },
    setItem(key, value) { if (writesBlocked) throw new Error('Quota exceeded'); backing.set(key, value); },
  };
  await withClient(async ({ client, dispatchStorage }) => {
    const unsubscribe = client.subscribeSavedSeats(() => {});
    try {
      client.rememberSeat('EFGH', TOKEN_B);
      client.rememberSort('ascending');
      client.rememberHandOrder('EFGH:3:1:me', ['b-2', 'b-1']);
      dispatchStorage('parkes-rummy:sort-mode', 'suit');
      assert.deepEqual(client.getSeats(), { ABCD: TOKEN_A, EFGH: TOKEN_B }, 'An unrelated storage update preserves pending seats');

      const external = JSON.stringify({ JT482T: TOKEN_C });
      backing.set(SEATS_KEY, external);
      dispatchStorage(SEATS_KEY, external);
      assert.deepEqual(client.getSeats(), { JT482T: TOKEN_C }, 'The other tab’s saved-seat value replaces a pending local fallback');
      assert.equal(client.getSort(), 'ascending', 'Only the changed storage key loses its pending value');
      assert.deepEqual(client.savedHandOrder('EFGH:3:1:me', ['b-1', 'b-2']), ['b-2', 'b-1']);

      readsBlocked = true;
      dispatchStorage(SEATS_KEY, JSON.stringify({ ABCD: TOKEN_A }));
      assert.deepEqual(client.getSeats(), { ABCD: TOKEN_A }, 'The event supplies the fresh value even when storage reads fail');
      backing.clear();
      dispatchStorage(null);
      assert.deepEqual(client.getSeats(), {});
      assert.equal(client.getSort(), 'descending');
      assert.equal(client.savedHandOrder('EFGH:3:1:me', ['b-1', 'b-2']), null);

      readsBlocked = false;
      client.rememberSeat('ABCD', TOKEN_A);
      writesBlocked = false;
      client.rememberSeat('EFGH', TOKEN_B);
      assert.deepEqual(JSON.parse(backing.get(SEATS_KEY)), { ABCD: TOKEN_A, EFGH: TOKEN_B }, 'Restored writes preserve seats from the pending fallback');
      backing.set(SEATS_KEY, external);
      assert.deepEqual(client.getSeats(), { JT482T: TOKEN_C }, 'A successful write returns future reads to persistent storage');
    } finally { unsubscribe(); }
  }, { local });
});

test('manual card order survives switching games and replaces only the same room’s older hand', async () => {
  const local = storage();
  const roomA = 'ABCD:1:2:alice';
  const roomB = 'EFGH:3:8:alice';
  const similarCode = 'ABCDXY:2:4:alice';
  const nextHand = 'ABCD:1:3:alice';
  await withClient(async ({ client }) => {
    client.rememberHandOrder(roomA, ['a-3', 'a-1', 'a-2']);
    client.rememberHandOrder(roomB, ['b-2', 'b-1']);
    client.rememberHandOrder(similarCode, ['c-2', 'c-1']);
    assert.deepEqual(client.savedHandOrder(roomA, ['a-1', 'a-2', 'a-3']), ['a-3', 'a-1', 'a-2']);
    assert.deepEqual(client.savedHandOrder(roomB, ['b-1', 'b-2']), ['b-2', 'b-1']);
    client.rememberHandOrder(nextHand, ['next-2', 'next-1']);
    assert.equal(client.savedHandOrder(roomA, ['a-1', 'a-2', 'a-3']), null);
    assert.deepEqual(client.savedHandOrder(nextHand, ['next-1', 'next-2']), ['next-2', 'next-1']);
    assert.deepEqual(client.savedHandOrder(roomB, ['b-1', 'b-2']), ['b-2', 'b-1']);
    assert.deepEqual(client.savedHandOrder(similarCode, ['c-1', 'c-2']), ['c-2', 'c-1'], 'A room code beginning with another code is a separate game');
  }, { local });
  await withClient(async ({ client }) => {
    assert.deepEqual(client.savedHandOrder(nextHand, ['next-1', 'next-2']), ['next-2', 'next-1']);
    assert.deepEqual(client.savedHandOrder(roomB, ['b-1', 'b-2']), ['b-2', 'b-1']);
    assert.deepEqual(client.savedHandOrder(similarCode, ['c-1', 'c-2']), ['c-2', 'c-1']);
  }, { local });
});

test('the legacy single-hand arrangement migrates without losing the original table’s card order', async () => {
  const legacyKey = 'JT482T:1:6:host';
  const local = storage(new Map([[HAND_KEY, JSON.stringify({ key: legacyKey, ids: ['old-3', 'old-1', 'old-2'] })]]));
  await withClient(async ({ client }) => {
    assert.deepEqual(client.savedHandOrder(legacyKey, ['old-1', 'old-2', 'old-3']), ['old-3', 'old-1', 'old-2']);
    client.rememberHandOrder('ABCD:3:1:host', ['new-2', 'new-1']);
    assert.deepEqual(client.savedHandOrder(legacyKey, ['old-1', 'old-2', 'old-3']), ['old-3', 'old-1', 'old-2']);
    assert.deepEqual(client.savedHandOrder('ABCD:3:1:host', ['new-1', 'new-2']), ['new-2', 'new-1']);
    assert.equal(JSON.parse(local.values.get(HAND_KEY)).version, 2);
  }, { local });
  await withClient(async ({ client }) => {
    assert.deepEqual(client.savedHandOrder(legacyKey, ['old-1', 'old-2', 'old-3']), ['old-3', 'old-1', 'old-2']);
    assert.deepEqual(client.savedHandOrder('ABCD:3:1:host', ['new-1', 'new-2']), ['new-2', 'new-1']);
  }, { local });
});

test('fresh deal IDs reject an old arrangement even when a rematch reuses the same room, game and rule', async () => {
  await withClient(async ({ client }) => {
    const key = 'ABCD:3:1:me';
    client.rememberHandOrder(key, ['deal-one-3', 'deal-one-1', 'deal-one-2']);
    assert.deepEqual(client.savedHandOrder(key, ['deal-one-1', 'newly-drawn']), ['deal-one-3', 'deal-one-1', 'deal-one-2'], 'Surviving cards keep the arrangement during ordinary play');
    assert.equal(client.savedHandOrder(key, ['deal-two-1', 'deal-two-2']), null, 'A new deal starts from the player’s sort preference');
    assert.equal(client.savedHandOrder(key, []), null);
    client.rememberHandOrder(key, ['deal-two-2', 'deal-two-1']);
    assert.deepEqual(client.savedHandOrder(key, ['deal-two-1', 'deal-two-2']), ['deal-two-2', 'deal-two-1']);
  });
});

test('game summaries post seat credentials only in the body and include the current protocol without caching', async () => {
  await withClient(async ({ client, calls, replyWith, navigations }) => {
    const seats = [{ code: 'ABCD', token: TOKEN_A }, { code: 'EFGH', token: TOKEN_B }];
    const responseBody = { summaries: [
      { code: 'ABCD', status: 200, summary: { code: 'ABCD', game: 3, status: 'playing', turnPlayerName: 'Shonky', isYourTurn: true, lastMoveAt: 1720000000000 } },
      { code: 'EFGH', status: 404, error: 'This table has closed.' },
    ] };
    replyWith(() => new Response(JSON.stringify(responseBody), { headers: { [protocol.ROOM_PROTOCOL_HEADER]: protocol.ROOM_PROTOCOL } }));
    assert.deepEqual(await client.roomApi.summaries(seats), responseBody);
    assert.equal(calls.length, 1);
    const [requestPath, options] = calls[0];
    assert.equal(requestPath, '/api/rooms/summaries');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { seats });
    assert.equal(options.headers[protocol.ROOM_PROTOCOL_HEADER], protocol.ROOM_PROTOCOL);
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.headers.Authorization, undefined);
    for (const token of [TOKEN_A, TOKEN_B]) {
      assert.ok(!requestPath.includes(token));
      assert.ok(!JSON.stringify(options.headers).includes(token), 'Summary credentials never enter a header or URL');
    }
    assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(navigations, []);
  });
});

for (const alreadyAborted of [false, true]) {
  test(`game-summary requests honour ${alreadyAborted ? 'pre-aborted' : 'in-flight'} cancellation without retries or navigation`, async () => {
    await withClient(async ({ client, calls, replyWith, navigations }) => {
      const cancellation = new AbortController();
      replyWith((_path, options) => new Promise((_resolve, reject) => {
        const abort = () => reject(new DOMException('The request was aborted.', 'AbortError'));
        if (options.signal.aborted) abort();
        else options.signal.addEventListener('abort', abort, { once: true });
      }));
      if (alreadyAborted) cancellation.abort();
      const pending = client.roomApi.summaries([{ code: 'ABCD', token: TOKEN_A }], cancellation.signal);
      if (!alreadyAborted) cancellation.abort();
      await assert.rejects(pending, error => error instanceof client.RoomError && error.status === 0);
      assert.equal(calls.length, 1, 'Cancelled game-list reads are never replayed');
      assert.equal(calls[0][1].signal.aborted, true);
      assert.deepEqual(navigations, []);
      replyWith(() => new Response('{"summaries":[]}', { headers: { [protocol.ROOM_PROTOCOL_HEADER]: protocol.ROOM_PROTOCOL } }));
      assert.deepEqual(await client.roomApi.summaries([]), { summaries: [] }, 'A cancelled list does not poison the next refresh');
      assert.equal(calls.length, 2);
    });
  });
}
