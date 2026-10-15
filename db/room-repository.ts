import { database, type SqlConnection, type SqlDatabase } from './index';
import type { RoomState } from '../lib/types';

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
  constructor(private readonly db: SqlDatabase = database) {}
  async load(code: string) {
    const result = await this.db.query<JoinedRow>(`SELECT ${joinedColumns} FROM rooms r LEFT JOIN room_memberships m ON m.room_code = r.code WHERE r.code = $1`, [code]);
    return records(result.rows)[0] ?? null;
  }
  async insert(room: RoomState, membership?: NewMembership) {
    try {
      return await this.db.transaction(async connection => {
        const result = await connection.query('INSERT INTO rooms (code, state, version, created_at, updated_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING code', [room.code, JSON.stringify(room), room.version, room.createdAt, room.updatedAt]);
        if (result.rowCount !== 1) return false;
        if (membership) await addMembership(connection, room.code, membership);
        return true;
      });
    } catch (error) { if (error instanceof RetryWrite) return false; throw error; }
  }
  async save(room: RoomState, expectedVersion: number, membership?: NewMembership, options?: SaveOptions) {
    const values = [JSON.stringify(room), room.version, room.updatedAt, room.code, expectedVersion];
    // A single conditional UPDATE is already atomic. Card moves do not change
    // membership, so BEGIN, membership DELETE and COMMIT add no protection here.
    // Leave/join/removal still use the full transaction below.
    if (!membership && options?.membershipUnchanged === true) {
      return (await this.db.query(updateStateSql, values)).rowCount === 1;
    }
    try {
      return await this.db.transaction(async connection => {
        const result = await connection.query(updateStateSql, values);
        if (result.rowCount !== 1) return false;
        await connection.query('DELETE FROM room_memberships WHERE room_code = $1 AND NOT (player_id = ANY($2::text[]))', [room.code, room.players.filter(player => !player.isBot).map(player => player.id)]);
        if (membership) await addMembership(connection, room.code, membership);
        return true;
      });
    } catch (error) { if (error instanceof RetryWrite) return false; throw error; }
  }
  async delete(code: string, expectedVersion: number) {
    return (await this.db.query('DELETE FROM rooms WHERE code = $1 AND version = $2 RETURNING code', [code, expectedVersion])).rowCount === 1;
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
