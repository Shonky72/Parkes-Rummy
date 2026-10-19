import { PostgresRequestSecurity } from '../db/security';
import { PostgresJoinRequests } from '../db/join-requests';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import type { QueryResultRow } from 'pg';
import { getAuthTables } from 'better-auth/db';
import { PostgresRoomRepository } from '../db/room-repository';
import type { SqlConnection, SqlDatabase } from '../db';
import { createRoomHandlers } from '../lib/room-server';
import { accountMarker, type AccountUser } from '../lib/auth-config';
import { ROOM_PROTOCOL, ROOM_PROTOCOL_HEADER } from '../lib/room-protocol';
import { createPlayer } from '../lib/rummy';
import type { GameAction } from '../lib/types';

// Real PostgreSQL SQL, transactions and constraints in-process. Only the already
// verified session boundary is substituted; Google OAuth needs live credentials.
const postgres = new PGlite();
function connection(target: Pick<PGlite | Transaction, 'query'>): SqlConnection {
  return { async query<T extends QueryResultRow>(sql: string, values?: unknown[]) {
    const result = await target.query<T>(sql, values);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  } };
}
const database: SqlDatabase = {
  ...connection(postgres),
  transaction: work => postgres.transaction(transaction => work(connection(transaction))),
};
const repository = new PostgresRoomRepository(database);
const sessions = new Map<string, AccountUser>();
const api = createRoomHandlers({
  repository, security:new PostgresRequestSecurity(database), joins:new PostgresJoinRequests(database),
  entitlements:async()=>({removeAds:false,premiumFonts:false,premiumSymbols:false,voiceChat:false,originalRules:false}),
  profile:async()=>({font:'default',symbol:'initials'}),
  resolveSession: async request => sessions.get(request.headers.get('Cookie')?.replace('fixture_session=', '') ?? '') ?? null,
  configured: () => true,
});
before(async () => { await postgres.query(await readFile(new URL('../db/schema-editor.sql', import.meta.url), 'utf8')); });
after(async () => { await postgres.close(); });

async function account(name: string) {
  const user: AccountUser = { id: crypto.randomUUID(), name, email: `${crypto.randomUUID()}@example.test`, image: null };
  await database.query('INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)', [user.id, user.name, user.email]);
  const device = crypto.randomUUID();
  sessions.set(device, user);
  return { user, device, token: accountMarker(user.id) };
}
type Seat = Awaited<ReturnType<typeof account>>;
let requestCounter=0;
const hosts=new Map<string,{seat?:Seat;token:string}>();
function request(path: string, options: { seat?: Seat; token?: string; body?: unknown; method?: string; pin?: string; origin?: string | null; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = {
    'x-nf-client-connection-ip':`192.0.2.${++requestCounter%250+1}`,
    'Content-Type': 'application/json', [ROOM_PROTOCOL_HEADER]: ROOM_PROTOCOL,
    'X-Parkes-Identity': options.pin ?? (options.seat ? options.seat.token : 'guest'),
    ...(options.origin === null ? {} : { Origin: options.origin ?? 'https://game.test' }),
    ...(options.seat ? { Cookie: `fixture_session=${options.seat.device}` } : {}),
    ...(options.token || options.seat ? { Authorization: `Bearer ${options.token ?? options.seat!.token}` } : {}),
    ...options.headers,
  };
  return new Request(`https://game.test${path}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'), headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}
async function result(response: Response | Promise<Response>) {
  const resolved = await response;
  return { status: resolved.status, data: await resolved.json(), headers: resolved.headers };
}
async function create(name: string, seat?: Seat) {
  const response = await result(api.createRoomRequest(request('/api/rooms', { seat, body: { name } })));
  assert.equal(response.status, 201, JSON.stringify(response.data));
  hosts.set(response.data.room.code,{seat,token:response.data.token});
  return response.data;
}
async function join(code: string, name: string, seat?: Seat, token?: string) {
  const proof=token??'0123456789abcdef'.repeat(4);
  let response=await result(api.joinRoomRequest(request(`/api/rooms/${code}/join`, { seat, body: { name, token, requestToken:proof } }), code));
  if(response.status===202){
    const host=hosts.get(code)!;
    const approved=await result(api.reviewJoinRequest(request(`/api/rooms/${code}/join-requests`,{seat:host.seat,token:host.token,body:{id:response.data.pending.id,decision:'approve'}}),code));
    assert.equal(approved.status,200,JSON.stringify(approved.data));
    response=await result(api.joinRoomRequest(request(`/api/rooms/${code}/join`, { seat, body: { name, token:proof } }), code));
  }
  return response;
}
async function action(code: string, value: GameAction, seat?: Seat, token?: string, requestId = crypto.randomUUID()) {
  return result(api.actionRoomRequest(request(`/api/rooms/${code}/action`, { seat, token, body: { action: value, requestId } }), code));
}
const read = (code: string, seat?: Seat, token?: string) => result(api.readRoomRequest(request(`/api/rooms/${code}`, { seat, token }), code));
const games = (seat: Seat) => result(api.accountGamesRequest(request('/api/account/games', { seat })));

test('both schema entry points are repeatable and include the installed Better Auth core fields', async () => {
  const editor = await readFile(new URL('../db/schema-editor.sql', import.meta.url), 'utf8');
  const cli = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
  assert.ok(editor.includes('CREATE TABLE IF NOT EXISTS'));
  // query() uses one prepared statement, as the Vercel/Neon SQL editor does.
  await postgres.query(editor);
  await postgres.exec(cli);
  for (const [table, definition] of Object.entries(getAuthTables({ rateLimit: { storage: 'database' } }))) {
    const columns = (await database.query<{ column_name: string }>('SELECT column_name FROM information_schema.columns WHERE table_name = $1', [table])).rows.map(row => row.column_name);
    for (const field of ['id', ...Object.values(definition.fields).map(field => field.fieldName!)]) assert.ok(columns.includes(field), `${table}.${field}`);
  }
});

test('Quick Play starts an atomic game with 1–7 computer players and no paid rules for guests', async () => {
  const reply = await result(api.createRoomRequest(request('/api/rooms', { body: { name: 'Quick Player', quickPlay: true } })));
  assert.equal(reply.status, 201, JSON.stringify(reply.data));
  const { room, token } = reply.data;
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(room.status, 'playing');
  assert.equal(room.round, 1);
  assert.ok([1, 2, 3].includes(room.game), 'Guest Quick Play must not get Original Rules');
  assert.ok(room.players.length >= 2 && room.players.length <= 8);
  assert.equal(room.players.filter((p: { isBot: boolean }) => p.isBot).length, room.players.length - 1);
  assert.ok(room.players.filter((p: { difficulty: string }) => p.difficulty === 'hard').length <= 1);
  assert.equal(room.hand.length, 10);
  const saved = (await repository.load(room.code))!;
  assert.equal(saved.room.status, 'playing');
  assert.equal(saved.room.players.length, room.players.length);
  assert.equal(saved.memberships.length, 0);
  assert.ok(saved.room.players.every(player => player.ready));
});

test('guest play keeps a random seat token and exposes only the caller’s cards', async () => {
  const host = await create('Guest host');
  assert.match(host.token, /^[a-f0-9]{64}$/);
  const guest = await join(host.room.code, 'Guest friend');
  assert.equal(guest.status, 200);
  assert.equal((await action(host.room.code, { type: 'start' }, undefined, host.token)).status, 200);
  const own = await read(host.room.code, undefined, host.token);
  assert.equal(own.status, 200);
  assert.equal(own.data.room.hand.length, 10);
  assert.ok(own.data.room.players.every((player: Record<string, unknown>) => !('hand' in player) && !('tokenHash' in player)));
  assert.equal(own.data.room.stock, undefined);
  assert.equal((await read(host.room.code, undefined, 'a'.repeat(64))).status, 403);
});

test('two device sessions discover and resume one account seat without token rotation', async () => {
  const owner = await account('Dan');
  const secondDevice = { ...owner, device: crypto.randomUUID() };
  sessions.set(secondDevice.device, owner.user);
  const host = await create('Dan', owner);
  await action(host.room.code, { type: 'addBot', difficulty: 'easy' }, owner);
  await action(host.room.code, { type: 'start' }, owner);
  const resumed = await join(host.room.code, 'Unused name', secondDevice);
  assert.equal(resumed.status, 200);
  assert.equal(resumed.data.room.youId, host.room.youId);
  assert.equal(resumed.data.token, owner.token);
  assert.deepEqual((await read(host.room.code, owner)).data.room.hand, resumed.data.room.hand);
  const listed = await games(secondDevice);
  assert.equal(listed.status, 200);
  assert.equal(listed.data.games[0].yourPlayerId, host.room.youId);
  assert.equal(listed.data.games[0].token, owner.token);
  assert.ok(!JSON.stringify(listed.data).includes('tokenHash'));
  assert.ok(!JSON.stringify(listed.data).includes(resumed.data.room.hand[0].id));
  assert.equal((await repository.load(host.room.code))!.memberships.length, 1);
});

test('markers, supplied user IDs and another player’s guest token never grant account authority', async () => {
  const owner = await account('Owner');
  const stranger = await account('Stranger');
  const host = await create('Owner', owner);
  const guest = await join(host.room.code, 'Guest');
  const spoof = await result(api.readRoomRequest(request(`/api/rooms/${host.room.code}`, { token: owner.token, pin: owner.token }), host.room.code));
  assert.equal(spoof.status, 401);
  assert.equal(spoof.data.code, 'ACCOUNT_IDENTITY_CHANGED');
  assert.equal((await read(host.room.code, stranger, guest.data.token)).status, 403);
  const accountRead = await read(host.room.code, owner, guest.data.token);
  assert.equal(accountRead.data.room.youId, host.room.youId, 'An account session uses its membership, never the guest token');
  const listed = await result(api.accountGamesRequest(request(`/api/account/games?userId=${owner.user.id}`, { seat: stranger })));
  assert.deepEqual(listed.data.games, []);
});

test('account A to B and guest to account races reject before create, join, read or mutation', async () => {
  const a = await account('Race A');
  const b = await account('Race B');
  const host = await create('Race A', a);
  await join(host.room.code, 'Race B', b);
  const before = await repository.load(host.room.code);
  for (const pin of [a.token, 'guest']) {
    const options = { seat: b, pin };
    for (const response of [
      api.createRoomRequest(request('/api/rooms', { ...options, body: { name: 'Stale' } })),
      api.joinRoomRequest(request(`/api/rooms/${host.room.code}/join`, { ...options, body: { name: 'Stale' } }), host.room.code),
      api.readRoomRequest(request(`/api/rooms/${host.room.code}`, options), host.room.code),
      api.actionRoomRequest(request(`/api/rooms/${host.room.code}/action`, { ...options, body: { action: { type: 'setReady', ready: false }, requestId: crypto.randomUUID() } }), host.room.code),
    ]) {
      const rejected = await result(response);
      assert.equal(rejected.status, 401);
      assert.equal(rejected.data.code, 'ACCOUNT_IDENTITY_CHANGED');
      assert.equal(rejected.data.room, undefined);
    }
  }
  assert.deepEqual(await repository.load(host.room.code), before);
});

test('simultaneous joins for one account create exactly one seat and membership', async () => {
  const host = await create('Concurrent host');
  const guest = await account('Concurrent guest');
  const [left, right] = await Promise.all([join(host.room.code, 'Concurrent guest', guest), join(host.room.code, 'Concurrent guest', guest)]);
  assert.equal(left.status, 200, JSON.stringify(left.data));
  assert.equal(right.status, 200, JSON.stringify(right.data));
  assert.equal(left.data.room.youId, right.data.room.youId);
  const record = (await repository.load(host.room.code))!;
  assert.equal(record.room.players.length, 2);
  assert.equal(record.memberships.length, 1);
  assert.equal(record.memberships[0].playerId, left.data.room.youId);
});

test('duplicate membership insertion rolls back the room mutation and preserves version CAS', async () => {
  const owner = await account('Atomic owner');
  const host = await create('Atomic owner', owner);
  const original = (await repository.load(host.room.code))!;
  const changed = structuredClone(original.room);
  const additional = createPlayer({ id: crypto.randomUUID(), name: 'Duplicate identity', color: 1, tokenHash: 'account:unused' });
  changed.players.push(additional);
  changed.version++;
  assert.equal(await repository.save(changed, original.version, { userId: owner.user.id, playerId: additional.id }), false);
  assert.deepEqual(await repository.load(host.room.code), original);
  const left = structuredClone(original.room); left.version++; left.game = 2;
  const right = structuredClone(original.room); right.version++; right.game = 3;
  const outcomes = await Promise.all([repository.save(left, original.version), repository.save(right, original.version)]);
  assert.equal(outcomes.filter(Boolean).length, 1);
  assert.equal((await repository.load(host.room.code))!.version, original.version + 1);
});

test('replayed and concurrent final draw requests consume exactly one card', async () => {
  const owner = await account('Draw owner');
  const host = await create('Draw owner', owner);
  await action(host.room.code, { type: 'addBot', difficulty: 'easy' }, owner);
  assert.equal((await action(host.room.code, { type: 'start' }, owner)).status, 200);
  const initial = (await repository.load(host.room.code))!;
  const requestId = crypto.randomUUID();
  const responses = await Promise.all([
    action(host.room.code, { type: 'draw', source: 'stock' }, owner, undefined, requestId),
    action(host.room.code, { type: 'draw', source: 'stock' }, owner, undefined, requestId),
  ]);
  assert.ok(responses.every(response => response.status === 200));
  const after = (await repository.load(host.room.code))!;
  assert.equal(after.room.stock.length, initial.room.stock.length - 1);
  assert.equal(after.room.players[0].hand.length, 11);
  assert.equal(after.version, initial.version + 1);
  assert.equal((await action(host.room.code, { type: 'draw', source: 'stock' }, owner)).status, 400);
});

test('hiding a game persists across devices and polling, while explicit join restores it', async () => {
  const owner = await account('List owner');
  const host = await create('List owner', owner);
  const hidden = await result(api.removeAccountGameRequest(request(`/api/account/games/${host.room.code}`, { seat: owner, method: 'DELETE' }), host.room.code));
  assert.equal(hidden.status, 200);
  assert.deepEqual((await games(owner)).data.games, []);
  assert.equal((await read(host.room.code, owner)).status, 200);
  assert.deepEqual((await games(owner)).data.games, [], 'Polling must not resurrect a hidden list entry');
  assert.equal((await join(host.room.code, 'Ignored', owner)).status, 200);
  assert.equal((await games(owner)).data.games.length, 1);
});

test('leaving and host removal clear memberships, rematch preserves surviving accounts', async () => {
  const owner = await account('Lifecycle host');
  const friend = await account('Lifecycle friend');
  const host = await create('Lifecycle host', owner);
  const joined = await join(host.room.code, 'Lifecycle friend', friend);
  await action(host.room.code, { type: 'removePlayer', playerId: joined.data.room.youId }, owner);
  assert.deepEqual((await games(friend)).data.games, []);
  assert.equal((await read(host.room.code, friend)).status, 403);
  await database.query('DELETE FROM join_requests WHERE room_code=$1 AND user_id=$2',[host.room.code,friend.user.id]);
  await join(host.room.code, 'Lifecycle friend', friend);
  const record = (await repository.load(host.room.code))!;
  record.room.status = 'finished'; record.room.version++; record.room.players.forEach(player => { player.score = 50; });
  assert.equal(await repository.save(record.room, record.version), true);
  assert.equal((await action(host.room.code, { type: 'rematch', expectedVersion: record.room.version }, friend)).status, 400);
  assert.equal((await action(host.room.code, { type: 'rematch', expectedVersion: record.room.version }, owner)).status, 200);
  assert.equal((await repository.load(host.room.code))!.memberships.length, 2);
  assert.equal((await read(host.room.code, friend)).data.room.status, 'lobby');
  await action(host.room.code, { type: 'leave' }, friend);
  assert.deepEqual((await games(friend)).data.games, []);
  await action(host.room.code, { type: 'leave' }, owner);
  assert.equal(await repository.load(host.room.code), null);
  assert.equal((await database.query('SELECT * FROM room_memberships WHERE room_code = $1', [host.room.code])).rows.length, 0);
});

test('whole-room deletion requires the host and the latest version', async () => {
  const owner = await account('Delete host');
  const friend = await account('Delete friend');
  const host = await create('Delete host', owner);
  await join(host.room.code, 'Delete friend', friend);
  const record = (await repository.load(host.room.code))!;
  const remove = (seat: Seat, expectedVersion: number) => result(api.deleteRoomRequest(request(`/api/rooms/${host.room.code}`, { seat, method: 'DELETE', body: { expectedVersion } }), host.room.code));
  assert.equal((await remove(friend, record.version)).status, 403);
  assert.equal((await remove(owner, record.version - 1)).status, 409);
  assert.equal((await remove(owner, record.version)).status, 200);
  assert.deepEqual((await games(friend)).data.games, []);
});

test('missing/cross-site origins and stale protocols do not mutate rooms', async () => {
  const owner = await account('Origin host');
  const host = await create('Origin host', owner);
  const before = await repository.load(host.room.code);
  for (const origin of [null, 'https://other.test']) {
    const rejected = await result(api.actionRoomRequest(request(`/api/rooms/${host.room.code}/action`, { seat: owner, origin, body: { action: { type: 'addBot', difficulty: 'easy' }, requestId: crypto.randomUUID() } }), host.room.code));
    assert.equal(rejected.status, 403);
  }
  const stale = await result(api.actionRoomRequest(request(`/api/rooms/${host.room.code}/action`, { seat: owner, headers: { [ROOM_PROTOCOL_HEADER]: 'old-version' }, body: { action: { type: 'addBot', difficulty: 'easy' }, requestId: crypto.randomUUID() } }), host.room.code));
  assert.equal(stale.status, 426);
  assert.deepEqual(await repository.load(host.room.code), before);
});
