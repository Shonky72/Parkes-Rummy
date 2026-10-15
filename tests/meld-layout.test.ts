import test from 'node:test';
import assert from 'node:assert/strict';
import { isCompleteRun, meldSpread, pendingMoveText } from '../lib/meld-layout';
import type { Meld } from '../lib/types';
import { PostgresRoomRepository } from '../db/room-repository';
import type { SqlDatabase } from '../db';
import { createPlayer, createRoom } from '../lib/rummy';

const run: Meld = { id: 'run', ownerId: 'player', kind: 'run', constraint: 'any', cards: Array.from({ length: 10 }, (_, n) => ({ id: String(n), rank: n + 5, suit: 'H' })) };
test('Only a complete 5-through-Ace run is closed, including represented wildcards', () => {
  assert.equal(isCompleteRun(run), true);
  assert.equal(isCompleteRun({ ...run, cards: run.cards.slice(0, 9) }), false);
  assert.equal(isCompleteRun({ ...run, kind: 'set' }), false);
  const wild = structuredClone(run); wild.cards[9].rank = 2; wild.cards[9].asRank = 14;
  assert.equal(isCompleteRun(wild), true);
  const invalid = structuredClone(run); invalid.cards[4].rank = 5;
  assert.equal(isCompleteRun(invalid), false);
});
test('A growing meld overlaps without hiding rank corners or requiring horizontal scroll', () => {
  for (const width of [90, 120, 180, 210, 280, 500]) for (const count of [2, 4, 5, 7, 9, 12, 25]) {
    const spread = meldSpread(count, width, 48);
    const step = 48 - spread.overlap;
    assert.ok(step >= 25 || spread.columns === 1);
    assert.ok((spread.columns - 1) * step + 48 <= width + .01);
    assert.ok(spread.columns >= 1 && spread.columns <= count);
  }
  assert.ok(meldSpread(7, 500, 48).overlap > 0, 'More cards begin overlapping even before overflow');
});
test('Feedback acknowledges a request without inventing a result', () => {
  assert.equal(pendingMoveText('draw'), 'Drawing a card…');
  assert.equal(pendingMoveText('discard'), 'Discarding your card…');
  assert.equal(pendingMoveText(''), null);
});

test('Unchanged game membership uses one conditional write; membership changes retain transactions', async () => {
  const sql: string[] = []; let transactions = 0;
  const query: SqlDatabase['query'] = async statement => { sql.push(statement); return { rows: [], rowCount: 1 }; };
  const db: SqlDatabase = { query, transaction: async work => { transactions++; return work({ query }); } };
  const repository = new PostgresRoomRepository(db);
  const room = createRoom('FAST', createPlayer({ id: 'host', name: 'Dan', color: 0, tokenHash: '' }));
  room.version++;
  assert.equal(await repository.save(room, 1, undefined, { membershipUnchanged: true }), true);
  assert.equal(transactions, 0); assert.equal(sql.length, 1);
  assert.match(sql[0], /WHERE code = \$4 AND version = \$5/);
  sql.length = 0;
  assert.equal(await repository.save(room, 1), true);
  assert.equal(transactions, 1); assert.equal(sql.length, 2);
  assert.match(sql[1], /DELETE FROM room_memberships/);
  const denied: SqlDatabase = { ...db, query: async () => ({ rows: [], rowCount: 0 }) };
  assert.equal(await new PostgresRoomRepository(denied).save(room, 1, undefined, { membershipUnchanged: true }), false, 'Stale versions never overwrite newer moves');
});
