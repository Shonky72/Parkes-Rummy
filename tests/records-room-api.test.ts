import test from 'node:test';
import assert from 'node:assert/strict';
import type { Membership, NewMembership, RoomRecord, RoomRepository, SaveOptions } from '../db/room-repository';
import { SecurityError } from '../db/security';
import { createRoomHandlers, recordsCollectionAllowed } from '../lib/room-server';
import { applyAction, createPlayer, createRoom, enableRecords, publicRoom } from '../lib/rummy';
import { applyChallengeAction, createChallengeRoom } from '../lib/challenge-engine/v1';
import { CHALLENGE_ENGINE_VERSION } from '../lib/competition-types';
import { accountMarker, type AccountUser } from '../lib/auth-config';
import { ROOM_PROTOCOL, ROOM_PROTOCOL_HEADER } from '../lib/room-protocol';
import type { GameAction, RoomState } from '../lib/types';

/** Dependency-injected storage: no production database or authenticated accounts. */
class MemoryRooms implements RoomRepository {
  rows = new Map<string, RoomRecord>();
  put(room: RoomState, memberships: Membership[] = []) { this.rows.set(room.code, structuredClone({ room, version: room.version, memberships })); }
  async load(code: string) { return structuredClone(this.rows.get(code) ?? null); }
  async insert(room: RoomState, membership?: NewMembership) {
    if (this.rows.has(room.code)) return false;
    this.put(room, membership ? [{ ...membership, hidden: false }] : []); return true;
  }
  async save(room: RoomState, expectedVersion: number, membership?: NewMembership, _options?: SaveOptions) {
    const old = this.rows.get(room.code);
    if (!old || old.version !== expectedVersion) return false;
    const memberships = old.memberships.filter(member => room.players.some(player => player.id === member.playerId));
    if (membership) memberships.push({ ...membership, hidden: false });
    this.put(room, memberships); return true;
  }
  async delete(code: string, expectedVersion: number) { if (this.rows.get(code)?.version !== expectedVersion) return false; return this.rows.delete(code); }
  async listForAccount(userId: string) { return structuredClone([...this.rows.values()].filter(record => record.memberships.some(member => member.userId === userId && !member.hidden))); }
  async setHidden(code: string, userId: string, hidden: boolean, playerId?: string) {
    const member = this.rows.get(code)?.memberships.find(row => row.userId === userId && (!playerId || row.playerId === playerId));
    if (!member) return false; member.hidden = hidden; return true;
  }
  async consumeCreationLimit() { return true; }
}

const owner: AccountUser = { id: 'synthetic-owner-account', name: 'Owner', email: 'owner@example.test', image: null };
const friend: AccountUser = { id: 'synthetic-friend-account', name: 'Friend', email: 'friend@example.test', image: null };
const sessions = new Map([['owner-session', owner], ['friend-session', friend]]);
const security = { check: async () => {} };
const userSession = (user: AccountUser) => user.id === owner.id ? 'owner-session' : 'friend-session';
function setup(captureRecords = true, repository = new MemoryRooms(), extras: Partial<Parameters<typeof createRoomHandlers>[0]> = {}) {
  const api = createRoomHandlers({ repository, captureRecords, security,
    resolveSession: async request => sessions.get(request.headers.get('Cookie')?.replace('session=', '') ?? '') ?? null,
    configured: () => true,
    entitlements: async () => ({ removeAds: false, premiumFonts: false, premiumSymbols: false, voiceChat: false, originalRules: false }),
    profile: async () => ({ font: 'default', symbol: 'initials' }),
    ...extras,
  });
  return { api, repository };
}
function request(path: string, body?: unknown, user?: AccountUser, token?: string, pin?: string) {
  return new Request(`https://game.test${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://game.test', [ROOM_PROTOCOL_HEADER]: ROOM_PROTOCOL,
      'X-Parkes-Identity': pin ?? (user ? accountMarker(user.id) : 'guest'),
      ...(user ? { Cookie: `session=${userSession(user)}`, Authorization: `Bearer ${accountMarker(user.id)}` } : token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
type Api = ReturnType<typeof createRoomHandlers>;
async function result(response: Promise<Response>) { const value = await response; return { status: value.status, body: await value.json() }; }
async function create(api: Api, user?: AccountUser, quickPlay = false) {
  const response = await result(api.createRoomRequest(request('/api/rooms', { name: user?.name ?? 'Guest', quickPlay }, user)));
  assert.equal(response.status, 201, JSON.stringify(response.body)); return response.body;
}
async function action(api: Api, code: string, value: GameAction, user?: AccountUser, token?: string, requestId = crypto.randomUUID()) {
  return result(api.actionRoomRequest(request(`/api/rooms/${code}/action`, { action: value, requestId }, user, token), code));
}

test('collection defaults to production only, with no preview or unset-context fallback', () => {
  assert.equal(recordsCollectionAllowed('production'), true);
  for (const context of ['deploy-preview', 'branch-deploy', 'dev', '', 'preview', 'Production']) assert.equal(recordsCollectionAllowed(context), false);
});

test('signed-in Quick Play queues evidence at its authoritative deal; anonymous and preview games do not', async () => {
  const { api, repository } = setup();
  const signed = await create(api, owner, true);
  const saved = (await repository.load(signed.room.code))!.room;
  assert.equal(saved.records?.events.filter(event => event.type === 'hand-start').length, saved.players.length);
  assert.equal(saved.records?.current[saved.hostId].eligible, true);
  assert.equal(saved.records?.current[saved.hostId].conditions.format, 'quick-play');
  assert.equal(signed.room.completedRecord, undefined);
  assert.equal(signed.room.records, undefined);
  const guest = await create(api, undefined, true);
  assert.equal((await repository.load(guest.room.code))!.room.records, undefined);
  const preview = setup(false);
  const untracked = await create(preview.api, owner, true);
  assert.equal((await preview.repository.load(untracked.room.code))!.room.records, undefined);
});

test('normal starts capture account memberships, preserve guest gameplay and deduplicate accepted requests', async () => {
  const { api, repository } = setup();
  const table = await create(api);
  let record = (await repository.load(table.room.code))!;
  const participant = createPlayer({ id: 'friend-seat', name: 'Friend', color: 1, tokenHash: 'server-account-token' });
  record.room.players.push(participant);
  repository.put(record.room, [{ userId: friend.id, playerId: participant.id, hidden: false }]);
  const first = await action(api, table.room.code, { type: 'start' }, undefined, table.token, 'same-start');
  assert.equal(first.status, 200, JSON.stringify(first.body));
  record = (await repository.load(table.room.code))!;
  assert.equal(record.room.records!.current[table.room.youId].eligible, false, 'unregistered guest plays without an unpersisted account badge');
  assert.equal(record.room.records!.current[participant.id].eligible, true);
  const version = record.version; const handId = record.room.records!.handId;
  const retried = await action(api, table.room.code, { type: 'start' }, undefined, table.token, 'same-start');
  assert.equal(retried.status, 200);
  const unchanged = (await repository.load(table.room.code))!;
  assert.equal(unchanged.version, version); assert.equal(unchanged.room.records!.handId, handId);
  assert.equal(first.body.room.players.length, 2);
});

test('legacy active hands are not backfilled; collection starts at the next real deal with partial-game provenance', async () => {
  const { api, repository } = setup();
  const table = await create(api, owner);
  await action(api, table.room.code, { type: 'addBot', difficulty: 'easy' }, owner);
  const original = (await repository.load(table.room.code))!;
  let oldRoom = applyAction(original.room, original.room.hostId, { type: 'start' });
  delete oldRoom.records;
  repository.put(oldRoom, original.memberships);
  const moved = await action(api, table.room.code, { type: 'draw', source: 'stock' }, owner);
  assert.equal(moved.status, 200);
  assert.equal((await repository.load(table.room.code))!.room.records, undefined);
  oldRoom = (await repository.load(table.room.code))!.room;
  oldRoom.players[0].hand = [{ id: 'legacy-final-card', rank: 5, suit: 'H' }];
  oldRoom.players[0].down = true; oldRoom.players[0].laidDownTurn = 0;
  oldRoom = applyAction(oldRoom, oldRoom.hostId, { type: 'discard', cardId: 'legacy-final-card' });
  repository.put(oldRoom, original.memberships);
  const next = await action(api, table.room.code, { type: 'nextHand' }, owner);
  assert.equal(next.status, 200, JSON.stringify(next.body));
  const tracked = (await repository.load(table.room.code))!.room;
  assert.equal(tracked.records?.completeGameObserved, false);
  assert.equal(tracked.records?.current[tracked.hostId].handNumber, 2);
  assert.equal(tracked.records?.current[tracked.hostId].ruleNumber, 2);
  assert.equal(tracked.records?.events.filter(event => event.type === 'hand-start').length, 2);
});

test('preview reads retain seat authorization but cannot mutate or delete tracked production evidence', async () => {
  const { api, repository } = setup();
  const table = await create(api, owner, true);
  const before = (await repository.load(table.room.code))!;
  const preview = setup(false, repository).api;
  const read = await result(preview.readRoomRequest(request(`/api/rooms/${table.room.code}`, undefined, owner), table.room.code));
  assert.equal(read.status, 200);
  assert.equal(read.body.room.records, undefined);
  const move = await action(preview, table.room.code, { type: 'draw', source: 'stock' }, owner);
  assert.equal(move.status, 409);
  assert.match(move.body.error, /production records/);
  const deleted = await result(preview.deleteRoomRequest(request(`/api/rooms/${table.room.code}`, { expectedVersion: before.version }, owner), table.room.code));
  assert.equal(deleted.status, 409);
  assert.deepEqual(await repository.load(table.room.code), before);
});

function fixedRoom(code = 'FIXD') {
  const room = createChallengeRoom({ id: 'synthetic-fixed-deal', seed: 'server-private-seed-for-api-fixture', engineVersion: CHALLENGE_ENGINE_VERSION,
    game: 1, ruleNumber: 1, humanSeat: 0, startingSeat: 0, difficulties: ['easy'], showMoveHints: false,
  }, code, createPlayer({ id: 'challenge-owner-seat', name: 'Owner', tokenHash: 'private-account-marker', color: 0 }));
  return room;
}

test('challenge requests use frozen state for draw recycling and redact private attempt ownership', async () => {
  const { api, repository } = setup();
  const room = fixedRoom();
  room.discardPile = room.stock.slice(0, 10); room.stock = [];
  repository.put(room, [{ userId: owner.id, playerId: room.hostId, hidden: false }]);
  const expected = applyChallengeAction(room, room.hostId, { type: 'draw', source: 'stock' });
  const response = await action(api, room.code, { type: 'draw', source: 'stock' }, owner);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const saved = (await repository.load(room.code))!.room;
  assert.deepEqual(saved.stock, expected.stock);
  assert.deepEqual(saved.players[0].hand, expected.players[0].hand);
  assert.equal(response.body.room.challenge.engineVersion, CHALLENGE_ENGINE_VERSION);
  assert.equal(response.body.room.completedRecord, undefined);
  for (const secret of [room.challenge.config.seed, 'randomCursor', 'private-account-marker', owner.id, 'records']) assert.ok(!JSON.stringify(response.body).includes(secret), secret);
  const outsider = await result(api.readRoomRequest(request(`/api/rooms/${room.code}`, undefined, friend), room.code));
  assert.equal(outsider.status, 403);
});

test('challenge settings, new seats, active deletion and hiding stay behind the competition lifecycle', async () => {
  const { api, repository } = setup();
  const room = fixedRoom('LOCK');
  repository.put(room, [{ userId: owner.id, playerId: room.hostId, hidden: false }]);
  for (const value of [{ type: 'rematch' }, { type: 'setGame', game: 2 }, { type: 'setMoveHints', enabled: true }, { type: 'setTurnLimit', seconds: 60 }, { type: 'addBot', difficulty: 'hard' }, { type: 'timeout' }] as GameAction[]) {
    const rejected = await action(api, room.code, value, owner);
    assert.equal(rejected.status, 409, value.type);
  }
  const join = await result(api.joinRoomRequest(request(`/api/rooms/${room.code}/join`, { name: 'Friend' }, friend), room.code));
  assert.equal(join.status, 409);
  const remove = await result(api.deleteRoomRequest(request(`/api/rooms/${room.code}`, { expectedVersion: room.version }, owner), room.code));
  assert.equal(remove.status, 409);
  const hide = await result(api.removeAccountGameRequest(request(`/api/account/games/${room.code}`, {}, owner), room.code));
  assert.equal(hide.status, 409);
  assert.equal((await repository.load(room.code))!.version, room.version);
  assert.equal((await repository.load(room.code))!.memberships[0].hidden, false);
});

function rankedRoom() {
  let room = createRoom('RANK', createPlayer({ id: 'ranked-owner-seat', name: 'Owner', tokenHash: 'private-owner-rank', color: 0 }));
  room.players.push(createPlayer({ id: 'ranked-friend-seat', name: 'Friend', tokenHash: 'private-friend-rank', color: 1 }));
  room = applyAction(room, room.hostId, { type: 'setMoveHints', enabled: false });
  room = applyAction(room, room.hostId, { type: 'setTurnLimit', seconds: 90 });
  room.ranked = { format: 'ranked-human-v1', matchId: 'private-rank-match' };
  return room;
}

test('ranked starts require both consents and immutable account seats; public metadata excludes match IDs', async () => {
  let accepted = false; let accessCalls = 0; let heartbeats = 0;
  const { api, repository } = setup(true, new MemoryRooms(), {
    rankedAccess: async (_room, userId, type) => {
      accessCalls++; assert.ok([owner.id, friend.id].includes(userId));
      if (type === 'start' && !accepted) throw new SecurityError('Both players must accept.', 409);
    },
    rankedHeartbeat: async () => { heartbeats++; },
  });
  const room = rankedRoom();
  repository.put(room, [
    { userId: owner.id, playerId: room.players[0].id, hidden: false },
    { userId: friend.id, playerId: room.players[1].id, hidden: false },
  ]);
  assert.equal((await action(api, room.code, { type: 'start' }, owner)).status, 409);
  assert.equal((await repository.load(room.code))!.room.status, 'lobby');
  accepted = true;
  const started = await action(api, room.code, { type: 'start' }, owner);
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.deepEqual(started.body.room.ranked, { format: 'ranked-human-v1' });
  assert.ok(!JSON.stringify(started.body.room).includes(room.ranked!.matchId));
  assert.equal((await repository.load(room.code))!.room.records!.current[room.hostId].conditions.format, 'ranked');
  const read = await result(api.readRoomRequest(request(`/api/rooms/${room.code}`, undefined, friend), room.code));
  assert.equal(read.status, 200);
  assert.ok(accessCalls >= 3 && heartbeats >= 2);
  for (const value of [{ type: 'rematch' }, { type: 'setReady', ready: false }, { type: 'setGame', game: 2 }, { type: 'setMoveHints', enabled: true }, { type: 'setTurnLimit', seconds: 30 }, { type: 'addBot', difficulty: 'easy' }, { type: 'leave' }] as GameAction[]) {
    assert.equal((await action(api, room.code, value, owner)).status, 409, value.type);
  }
  const deleted = await result(api.deleteRoomRequest(request(`/api/rooms/${room.code}`, { expectedVersion: started.body.room.version }, owner), room.code));
  assert.equal(deleted.status, 409);
});

test('ranked structural tampering fails before game mutation or a client-supplied identity claim', async () => {
  const { api, repository } = setup(true, new MemoryRooms(), { rankedAccess: async () => {}, rankedHeartbeat: async () => {} });
  const room = rankedRoom(); room.showMoveHints = true;
  repository.put(room, [{ userId: owner.id, playerId: room.players[0].id, hidden: false }, { userId: friend.id, playerId: room.players[1].id, hidden: false }]);
  const rejected = await action(api, room.code, { type: 'start' }, owner);
  assert.equal(rejected.status, 409); assert.match(rejected.body.error, /controlled format/);
  const forged = await result(api.readRoomRequest(request(`/api/rooms/${room.code}`, undefined, friend, undefined, accountMarker(owner.id)), room.code));
  assert.equal(forged.status, 401);
});

test('preview ranked reads never write heartbeat, and ranked lobbies cannot be mutated or hidden', async () => {
  let heartbeats = 0;
  const { api, repository } = setup(false, new MemoryRooms(), { rankedAccess: async () => {}, rankedHeartbeat: async () => { heartbeats++; } });
  const room = rankedRoom();
  repository.put(room, [{ userId: owner.id, playerId: room.players[0].id, hidden: false }, { userId: friend.id, playerId: room.players[1].id, hidden: false }]);
  const before = await repository.load(room.code);
  const read = await result(api.readRoomRequest(request(`/api/rooms/${room.code}`, undefined, owner), room.code));
  assert.equal(read.status, 200); assert.equal(heartbeats, 0);
  assert.equal((await action(api, room.code, { type: 'start' }, owner)).status, 409);
  const resume = await result(api.joinRoomRequest(request(`/api/rooms/${room.code}/join`, {}, owner), room.code));
  assert.equal(resume.status, 409);
  const hide = await result(api.removeAccountGameRequest(request(`/api/account/games/${room.code}`, {}, owner), room.code));
  assert.equal(hide.status, 409);
  assert.deepEqual(await repository.load(room.code), before);
});

test('minimal completed highlights belong to the requested eligible player and never expose active observations', () => {
  let room = createRoom('DONE', createPlayer({ id: 'owner-seat', name: 'Owner', tokenHash: 'secret', color: 0 }));
  room.players.push(createPlayer({ id: 'guest-seat', name: 'Guest', tokenHash: 'guest-secret', color: 1 }));
  enableRecords(room, { eligiblePlayerIds: ['owner-seat'] });
  room = applyAction(room, 'owner-seat', { type: 'start' });
  assert.equal(publicRoom(room, 'owner-seat').completedRecord, undefined);
  room.players[0].hand = [{ id: 'closing-card', rank: 5, suit: 'H' }];
  room.players[0].down = true; room.players[0].laidDownTurn = 0; room.phase = 'play';
  room = applyAction(room, 'owner-seat', { type: 'discard', cardId: 'closing-card' });
  const own = publicRoom(room, 'owner-seat');
  assert.equal(own.completedRecord?.handId, room.records!.handId);
  assert.deepEqual(Object.keys(own.completedRecord!).sort(), ['handId', 'openingTurn', 'firstLegalTurn', 'opportunitiesPassed', 'achievements'].sort());
  assert.equal(publicRoom(room, 'guest-seat').completedRecord, undefined);
  assert.equal(publicRoom(room, 'outsider').completedRecord, undefined);
  assert.equal('records' in own, false);
});
