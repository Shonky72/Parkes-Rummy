import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Execute real client modules against controllable requests. Each case gets an
// isolated module graph so no account or pending response leaks between cases.
let count = 0;
async function withClient(work) {
  const directory = path.resolve(`.sites-runtime/account-client/${++count}`);
  await fs.mkdir(directory, { recursive: true });
  const modules = ['client', 'room-protocol', 'room-code', 'client-identity', 'account-client'];
  for (const name of modules) {
    const source = await fs.readFile(`lib/${name}.ts`, 'utf8');
    let output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    for (const dependency of modules) output = output.replaceAll(`'./${dependency}'`, `'./${dependency}.mjs'`).replaceAll(`"./${dependency}"`, `"./${dependency}.mjs"`);
    await fs.writeFile(path.join(directory, `${name}.mjs`), output);
  }
  const before = { window: globalThis.window, fetch: globalThis.fetch, document: globalThis.document };
  const values = new Map();
  const events = new EventTarget();
  const pageEvents = new EventTarget();
  const navigations = [];
  globalThis.window = {
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    sessionStorage: { getItem: () => null, setItem() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    location: { pathname: '/join/ABCD', origin: 'https://parkesrummy.com', href: 'https://parkesrummy.com/join/ABCD', assign: value => navigations.push(value) },
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events),
  };
  globalThis.document = { hidden: false, addEventListener: pageEvents.addEventListener.bind(pageEvents), removeEventListener: pageEvents.removeEventListener.bind(pageEvents) };
  const calls = [];
  let handler = () => Response.json({ configured: true, user: null });
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return handler(url, options); };
  const client = await import(pathToFileURL(path.join(directory, 'client.mjs')).href);
  const identity = await import(pathToFileURL(path.join(directory, 'client-identity.mjs')).href);
  const account = await import(pathToFileURL(path.join(directory, 'account-client.mjs')).href);
  try { await work({ client, identity, account, values, calls, navigations, events, reply: next => { handler = next; } }); }
  finally {
    identity.setClientIdentity(null, false);
    for (const [key, value] of Object.entries(before)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  }
}
const guestToken = 'a'.repeat(64);
const person = id => ({ id, name: `Player ${id}`, email: `${id}@example.test`, image: null });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('guest credentials, account memberships and private card order stay isolated', async () => {
  await withClient(async ({ client, identity, values }) => {
    client.rememberSeat('ABCD', guestToken);
    client.rememberName('Guest player');
    client.rememberHandOrder('ABCD:1:1:guest', ['guest-card-H-7']);
    identity.setClientIdentity('a');
    assert.deepEqual(client.getSeats(), {});
    assert.equal(client.storedName(), '');
    assert.equal(client.rememberSeat('ABCD', guestToken), false);
    assert.equal(client.rememberSeat('EFGH', 'account:b'), false);
    assert.equal(client.rememberSeat('EFGH', 'account:a'), true);
    client.rememberName('Account A');
    client.rememberHandOrder('EFGH:1:1:account-a', ['private-account-A-H-13']);
    assert.deepEqual(client.savedHandOrder('EFGH:1:1:account-a', ['private-account-A-H-13']), ['private-account-A-H-13']);
    assert.equal(JSON.stringify([...values.values()]).includes('account:a'), false, 'No membership marker is persisted');
    assert.equal(JSON.stringify([...values.values()]).includes('private-account-A-H-13'), false, 'No account hand is persisted');
    identity.setClientIdentity('b');
    assert.deepEqual(client.getSeats(), {});
    assert.equal(client.savedHandOrder('EFGH:1:1:account-a', ['private-account-A-H-13']), null);
    assert.equal(client.storedName(), '');
    identity.setClientIdentity('a');
    assert.deepEqual(client.getSeats(), {}, 'Returning to an account must rediscover server memberships');
    assert.equal(client.savedHandOrder('EFGH:1:1:account-a', ['private-account-A-H-13']), null, 'Private order was erased on the account transition');
    identity.setClientIdentity(null);
    assert.deepEqual(client.getSeats(), { ABCD: guestToken });
    assert.equal(client.storedName(), 'Guest player');
    assert.deepEqual(client.savedHandOrder('ABCD:1:1:guest', ['guest-card-H-7']), ['guest-card-H-7']);
  });
});

test('all account requests carry a nonsecret expected identity and a same-origin cookie policy', async () => {
  await withClient(async ({ client, identity, calls, reply }) => {
    identity.setClientIdentity('a');
    reply(() => Response.json({ room: { code: 'ABCD' }, token: 'account:a', games: [] }));
    await client.roomApi.create('A');
    await client.roomApi.join('ABCD', 'A');
    await client.roomApi.get('ABCD', 'account:a');
    await client.roomApi.accountGames();
    await client.roomApi.removeAccountGame('ABCD');
    for (const { options } of calls) {
      assert.equal(options.headers['X-Parkes-Identity'], 'account:a');
      assert.equal(options.headers.Authorization, 'Bearer account:a');
      assert.equal(options.credentials, 'same-origin');
      assert.equal(options.cache, 'no-store');
    }
    identity.setClientIdentity(null);
    await client.roomApi.create('Guest');
    assert.equal(calls.at(-1).options.headers['X-Parkes-Identity'], 'guest');
    assert.equal(calls.at(-1).options.headers.Authorization, undefined);
  });
});

test('late private responses are discarded even when a transport ignores cancellation', async () => {
  await withClient(async ({ client, identity, calls, reply }) => {
    identity.setClientIdentity('a');
    const network = deferred();
    reply(() => network.promise);
    const pending = client.roomApi.get('ABCD', 'account:a');
    identity.setClientIdentity('b');
    assert.equal(calls[0].options.signal.aborted, true);
    network.resolve(Response.json({ room: { code: 'ABCD', hand: ['private-A-hand'] } }));
    await assert.rejects(pending, error => error.status === 401 && error.room === undefined && !error.message.includes('private-A-hand'));
    assert.deepEqual(client.getSeats(), {});
  });
});

test('expired guest seats do not trigger an identity reload loop', async () => {
  await withClient(async ({ client, identity, account, calls, reply }) => {
    reply(() => Response.json({ configured: true, user: null }));
    await account.refreshAccount();
    const before = identity.getClientIdentity();
    reply(() => Response.json({ error: 'Your saved seat is no longer available.' }, { status: 401 }));
    await assert.rejects(client.roomApi.get('ABCD', guestToken), error => error.status === 401);
    assert.equal(identity.getClientIdentity(), before);
    assert.equal(calls.filter(call => call.url === '/api/account/session').length, 1);
  });
});

test('sign-out closes private state and cancels pending actions before waiting for the server', async () => {
  await withClient(async ({ client, identity, account, reply, calls }) => {
    reply(() => Response.json({ configured: true, user: person('a') }));
    await account.refreshAccount();
    client.rememberSeat('ABCD', 'account:a');
    client.rememberHandOrder('ABCD:1:1:a', ['private-a-S-14']);
    const logout = deferred();
    const action = deferred();
    reply(url => url === '/api/auth/sign-out' ? logout.promise : url.endsWith('/action') ? action.promise : Response.json({ configured: true, user: null }));
    const pendingAction = client.roomApi.action('ABCD', 'account:a', { type: 'discard', cardId: 'private-a-S-14' });
    const pendingLogout = account.signOutAccount();
    assert.equal(account.getAccountSnapshot().status, 'checking');
    assert.equal(account.getAccountSnapshot().user, null);
    assert.equal(identity.getClientIdentity().ready, false);
    assert.deepEqual(client.getSeats(), {});
    assert.equal(calls.find(call => call.url.endsWith('/action')).options.signal.aborted, true);
    action.resolve(Response.json({ room: { hand: ['private-a-S-14'] } }));
    await assert.rejects(pendingAction, error => error.status === 401);
    logout.resolve(Response.json({ success: true }));
    await pendingLogout;
    assert.equal(account.getAccountSnapshot().status, 'ready');
    assert.equal(account.getAccountSnapshot().user, null);
    assert.equal(identity.getClientIdentity().key, 'guest');
  });
});

test('a failed sign-out keeps private account state closed until an explicit recheck', async () => {
  await withClient(async ({ account, identity, reply, calls }) => {
    reply(() => Response.json({ configured: true, user: person('a') }));
    await account.refreshAccount();
    reply(() => Response.json({ error: 'Service unavailable' }, { status: 503 }));
    await account.signOutAccount();
    assert.equal(account.getAccountSnapshot().status, 'error');
    assert.equal(account.getAccountSnapshot().user, null);
    assert.equal(identity.getClientIdentity().ready, false);
    const previousCalls = calls.length;
    reply(() => Response.json({ configured: true, user: person('a') }));
    await account.refreshAccount();
    await account.refreshAccount({ suspend: true });
    assert.equal(calls.length, previousCalls, 'Automatic focus, online, timer and broadcast rechecks stay blocked');
    assert.equal(account.getAccountSnapshot().user, null);
    await account.refreshAccount({ manual: true, suspend: true });
    assert.equal(account.getAccountSnapshot().user.id, 'a', 'The player explicitly checks the unresolved server session');
  });
});

test('an unconfirmed sign-out never publishes the old account as ready', async () => {
  await withClient(async ({ account, identity, reply }) => {
    reply(() => Response.json({ configured: true, user: person('a') }));
    await account.refreshAccount();
    const states = [];
    const unsubscribe = account.subscribeAccount(() => states.push(account.getAccountSnapshot()));
    reply(url => url === '/api/auth/sign-out' ? Response.json({ success: true }) : Response.json({ configured: true, user: person('a') }));
    await account.signOutAccount();
    unsubscribe();
    assert.equal(states.some(state => state.status === 'ready'), false);
    assert.equal(account.getAccountSnapshot().status, 'error');
    assert.equal(identity.getClientIdentity().ready, false);
  });
});

test('a session check started during a failed sign-out cannot reopen the old private account', async () => {
  await withClient(async ({ account, identity, reply }) => {
    reply(() => Response.json({ configured: true, user: person('a') }));
    await account.refreshAccount();
    const logout = deferred();
    const staleSession = deferred();
    reply(url => url === '/api/auth/sign-out' ? logout.promise : staleSession.promise);
    const signingOut = account.signOutAccount();
    const checking = account.refreshAccount();
    logout.resolve(Response.json({ error: 'Unavailable' }, { status: 503 }));
    await signingOut;
    staleSession.resolve(Response.json({ configured: true, user: person('a') }));
    await checking;
    assert.equal(account.getAccountSnapshot().status, 'error');
    assert.equal(account.getAccountSnapshot().user, null);
    assert.equal(identity.getClientIdentity().ready, false);
  });
});

test('a server identity mismatch clears the account before resolving an old response', async () => {
  await withClient(async ({ client, account, identity, reply }) => {
    reply(() => Response.json({ configured: true, user: person('a') }));
    await account.refreshAccount();
    const changedSession = deferred();
    reply(url => url === '/api/account/session' ? changedSession.promise : Response.json({ error: 'Account changed', code: 'ACCOUNT_IDENTITY_CHANGED' }, { status: 401 }));
    await assert.rejects(client.roomApi.get('ABCD', 'account:a'), error => error.status === 401);
    assert.equal(identity.getClientIdentity().ready, false);
    assert.equal(account.getAccountSnapshot().user, null);
    changedSession.resolve(Response.json({ configured: true, user: person('b') }));
    await account.refreshAccount();
    assert.equal(account.getAccountSnapshot().user.id, 'b');
    assert.deepEqual(client.getSeats(), {});
  });
});

test('Google sign-in returns to the current room using a server-issued Google URL', async () => {
  await withClient(async ({ account, identity, reply, calls, navigations }) => {
    reply(() => Response.json({ configured: true, user: null }));
    await account.refreshAccount();
    reply(() => Response.json({ url: 'https://accounts.google.com/o/oauth2/v2/auth?state=server-owned' }));
    await account.signInWithGoogle();
    assert.equal(identity.getClientIdentity().ready, false);
    assert.deepEqual(JSON.parse(calls.at(-1).options.body), { provider: 'google', callbackURL: '/join/ABCD' });
    assert.deepEqual(navigations, ['https://accounts.google.com/o/oauth2/v2/auth?state=server-owned']);
  });
});
