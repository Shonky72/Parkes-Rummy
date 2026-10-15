import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import type { QueryResultRow } from 'pg';
import { PostgresRoomRepository } from '../db/room-repository';
import type { SqlConnection, SqlDatabase } from '../db';
import { createRoomHandlers } from '../lib/room-server';
import { ROOM_PROTOCOL, ROOM_PROTOCOL_HEADER } from '../lib/room-protocol';
import { applyAction, createPlayer, createRoom } from '../lib/rummy';

const pg = new PGlite();
function connection(target: Pick<PGlite | Transaction, 'query'>): SqlConnection {
  return { async query<T extends QueryResultRow>(sql: string, values?: unknown[]) {
    const result = await target.query<T>(sql, values);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  } };
}
const db: SqlDatabase = { ...connection(pg), transaction: work => pg.transaction(tx => work(connection(tx))) };
const repository = new PostgresRoomRepository(db);
const api = createRoomHandlers({ repository, resolveSession: async () => null, configured: () => true });
before(async () => { await pg.query(await readFile(new URL('../db/schema-editor.sql', import.meta.url), 'utf8')); });
after(async () => { await pg.close(); });
const token = 'a'.repeat(64);
async function savedTable(code: string, due = 0) {
  let room = createRoom(code, createPlayer({ id: 'human', name: 'Dan', color: 0, tokenHash: createHash('sha256').update(token).digest('hex') }));
  room = applyAction(room, 'human', { type: 'setGame', game: 4 });
  room = applyAction(room, 'human', { type: 'addBot', difficulty: 'medium' });
  room = applyAction(room, 'human', { type: 'start' });
  room.turnPlayerId = room.players[1].id;
  room.players[1].completedTurns = 1;
  room.phase = 'play'; room.botDueAt = due;
  room.players[1].hand = ['H','D','C','S'].map((suit, i) => ({ id: `${code}-${i}`, rank: 10, suit: suit as 'H'|'D'|'C'|'S' }));
  room.players[1].hand.push({ id: `${code}-extra`, rank: 13, suit: 'D' });
  assert.equal(await repository.insert(room), true);
  return room;
}
async function step(code: string, requestId: string, bearer = token) {
  const response = await api.actionRoomRequest(new Request(`https://game.test/api/rooms/${code}/action`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://game.test', [ROOM_PROTOCOL_HEADER]: ROOM_PROTOCOL, 'X-Parkes-Identity': 'guest', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ action: { type: 'botStep' }, requestId }),
  }), code);
  return { status: response.status, body: await response.json() };
}

test('A persisted five-minute-old Original Rules turn recovers once under concurrent retries', async () => {
  const original = await savedTable('TNFG', Date.now() - 300_000);
  const [a,b] = await Promise.all([step('TNFG','same-retry'),step('TNFG','same-retry')]);
  assert.equal(a.status,200,JSON.stringify(a.body)); assert.equal(b.status,200,JSON.stringify(b.body));
  const saved = (await repository.load('TNFG'))!.room;
  assert.equal(saved.turnPlayerId,'human'); assert.equal(saved.version,original.version+1);
  assert.equal(saved.players[1].hand.length,4);
  assert.deepEqual(saved.players[0].hand,original.players[0].hand);
  assert.equal(saved.events.filter(e=>e.type==='discard').length,1);
  assert.equal((await step('TNFG','same-retry')).status,200);
  assert.equal((await repository.load('TNFG'))!.version,saved.version);
});
test('Not-due and unauthorized bot requests do not mutate the table', async () => {
  const original = await savedTable('WAIT', Date.now()+60_000);
  // Database JSON omits optional undefined fields. Compare persisted state to
  // persisted state so this assertion measures mutation, not JSON encoding.
  const before = (await repository.load('WAIT'))!.room;
  assert.equal((await step('WAIT','too-early')).status,200);
  assert.equal((await repository.load('WAIT'))!.version,original.version);
  assert.equal((await step('WAIT','outsider','b'.repeat(64))).status,403);
  assert.deepEqual((await repository.load('WAIT'))!.room,before);
});
