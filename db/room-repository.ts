import { database, type SqlConnection, type SqlDatabase } from './index';
import type { RoomState } from '../lib/types';
import { abandonRecords, recordEvents } from '../lib/rummy';
import { RecordsRepository, recordsWriteCtes, recordEventValues } from './records';
import { ensureLadderSchema, processRankedRoom } from './ladder';

export interface Membership { userId: string; playerId: string; hidden: boolean }
export interface RoomRecord { room: RoomState; version: number; memberships: Membership[] }
export interface NewMembership { userId: string; playerId: string }
export interface SaveOptions { /** Set only after comparing the old and new player IDs and bot flags. */ membershipUnchanged?: boolean }
export interface RoomRepository {
  load(code: string): Promise<RoomRecord | null>;
  insert(room: RoomState, membership?: NewMembership): Promise<boolean>;
  save(room: RoomState, expectedVersion: number, membership?: NewMembership, options?: SaveOptions): Promise<boolean>;
  delete(code: string, expectedVersion: number): Promise<boolean>;
  listForAccount(userId: string): Promise<RoomRecord[]>;
  setHidden(code: string, userId: string, hidden: boolean, playerId?: string): Promise<boolean>;
  consumeCreationLimit(key: string, now: number): Promise<boolean>;
}
class RetryWrite extends Error {}
type JoinedRow = { code: string; state: string; version: number; user_id: string | null; player_id: string | null; hidden: boolean | null };
const joinedColumns = 'r.code, r.state, r.version, m.user_id, m.player_id, m.hidden';
const updateStateSql = 'UPDATE rooms SET state = $1, version = $2, updated_at = $3 WHERE code = $4 AND version = $5 RETURNING code';
function records(rows: JoinedRow[]): RoomRecord[] {
  const byCode = new Map<string, RoomRecord>();
  for (const row of rows) {
    let record = byCode.get(row.code);
    if (!record) {
      record = { room: JSON.parse(row.state) as RoomState, version: row.version, memberships: [] };
      byCode.set(row.code, record);
    }
    if (row.user_id && row.player_id) record.memberships.push({ userId: row.user_id, playerId: row.player_id, hidden: row.hidden === true });
  }
  return [...byCode.values()];
}
async function addMembership(connection: SqlConnection, code: string, membership: NewMembership) {
  const result = await connection.query('INSERT INTO room_memberships (room_code, user_id, player_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING player_id', [code, membership.userId, membership.playerId]);
  if (result.rowCount !== 1) throw new RetryWrite();
}
export class PostgresRoomRepository implements RoomRepository {
  private readonly records: RecordsRepository;
  constructor(private readonly db: SqlDatabase = database) { this.records=new RecordsRepository(db); }
  async load(code: string) {
    const result = await this.db.query<JoinedRow>(`SELECT ${joinedColumns} FROM rooms r LEFT JOIN room_memberships m ON m.room_code = r.code WHERE r.code = $1`, [code]);
    return records(result.rows)[0] ?? null;
  }
  async insert(room: RoomState, membership?: NewMembership) {
    if(room.ranked)await ensureLadderSchema(this.db);
    const events=recordEvents(room);
    if(events.length)await this.records.ensure();
    const savedState=JSON.stringify(room.records?{...room,records:{...room.records,events:[]}}:room);
    try {
      const saved=await this.db.transaction(async connection => {
        const result = await connection.query('INSERT INTO rooms (code, state, version, created_at, updated_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING code', [room.code, savedState, room.version, room.createdAt, room.updatedAt]);
        if (result.rowCount !== 1) return false;
        if (membership) await addMembership(connection, room.code, membership);
        if(events.length)await connection.query(`WITH changed AS (SELECT code FROM rooms WHERE code=$1)${recordsWriteCtes(2)} SELECT code FROM changed`,[room.code,recordEventValues(events)]);
        if(room.ranked&&room.status==='finished')await processRankedRoom(connection,room);
        return true;
      });
      if(saved&&room.records)room.records.events=[];
      return saved;
    } catch (error) { if (error instanceof RetryWrite) return false; throw error; }
  }
  async save(room: RoomState, expectedVersion: number, membership?: NewMembership, options?: SaveOptions) {
    const rankedFinish=!!room.ranked&&room.status==='finished';
    if(rankedFinish)await ensureLadderSchema(this.db);
    const events=recordEvents(room);
    if(events.length)await this.records.ensure();
    const state=JSON.stringify(room.records?{...room,records:{...room.records,events:[]}}:room);
    const values:unknown[] = [state, room.version, room.updatedAt, room.code, expectedVersion];
    const sql=events.length?`WITH changed AS (${updateStateSql})${recordsWriteCtes(6)} SELECT code FROM changed`:updateStateSql;
    if(events.length)values.push(recordEventValues(events));
    // A single conditional UPDATE is already atomic. Card moves do not change
    // membership, so BEGIN, membership DELETE and COMMIT add no protection here.
    // Leave/join/removal still use the full transaction below.
    // UPDATE uses the affected-row contract. The evidence CTE ends in SELECT;
    // its returned changed code is authoritative even when a driver reports
    // zero affected rows for that SELECT (as PGlite does).
    if (!membership && options?.membershipUnchanged === true && !rankedFinish) {
      const result=await this.db.query(sql, values);
      const saved=(events.length?result.rows.length:result.rowCount)===1;
      if(saved&&room.records)room.records.events=[];
      return saved;
    }
    try {
      const saved=await this.db.transaction(async connection => {
        const result = await connection.query(sql, values);
        if ((events.length?result.rows.length:result.rowCount)!==1) return false;
        await connection.query('DELETE FROM room_memberships WHERE room_code = $1 AND NOT (player_id = ANY($2::text[]))', [room.code, room.players.filter(player => !player.isBot).map(player => player.id)]);
        if (membership) await addMembership(connection, room.code, membership);
        if(rankedFinish)await processRankedRoom(connection,room);
        return true;
      });
      if(saved&&room.records)room.records.events=[];
      return saved;
    } catch (error) { if (error instanceof RetryWrite) return false; throw error; }
  }
  async delete(code: string, expectedVersion: number) {
    // Only the host chose this withdrawal. Other players lose their table
    // involuntarily, so unfinished metrics are marked as interrupted.
    const current=await this.load(code);
    if(!current||current.version!==expectedVersion)return false;
    abandonRecords(current.room,current.room.hostId,'withdrawal');
    for(const player of current.room.players)if(player.id!==current.room.hostId)abandonRecords(current.room,player.id,'table-closed');
    const events=recordEvents(current.room);
    if(!events.length)return (await this.db.query('DELETE FROM rooms WHERE code = $1 AND version = $2 RETURNING code', [code, expectedVersion])).rowCount===1;
    await this.records.ensure();
    return (await this.db.query(`WITH changed AS (DELETE FROM rooms WHERE code=$1 AND version=$2 RETURNING code)${recordsWriteCtes(3)} SELECT code FROM changed`,[code,expectedVersion,recordEventValues(events)])).rows.length===1;
  }
  async listForAccount(userId: string) {
    const result = await this.db.query<JoinedRow>(`SELECT ${joinedColumns} FROM rooms r JOIN room_memberships m ON m.room_code = r.code WHERE m.user_id = $1 AND m.hidden = false ORDER BY r.updated_at DESC LIMIT 128`, [userId]);
    return records(result.rows);
  }
  async setHidden(code: string, userId: string, hidden: boolean, playerId?: string) {
    const result = await this.db.query('UPDATE room_memberships SET hidden = $1 WHERE room_code = $2 AND user_id = $3 AND ($4::text IS NULL OR player_id = $4) RETURNING player_id', [hidden, code, userId, playerId ?? null]);
    return result.rowCount === 1;
  }
  async consumeCreationLimit(key: string, now: number) {
    const result = await this.db.query<{ count: number }>(`INSERT INTO room_creation_limits (key, window_start, count) VALUES ($1, $2, 1)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN room_creation_limits.window_start <= $2 - 300000 THEN 1 ELSE room_creation_limits.count + 1 END,
         window_start = CASE WHEN room_creation_limits.window_start <= $2 - 300000 THEN $2 ELSE room_creation_limits.window_start END
       RETURNING count`, [key, now]);
    return result.rows[0].count <= 15;
  }
}
