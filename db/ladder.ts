import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { database, type SqlConnection, type SqlDatabase } from './index';
import { RecordsRepository, recordsWriteCtes, recordEventValues } from './records';
import { SecurityError } from './security';
import { abandonRecords, applyAction, createPlayer, createRoom, enableRecords, recordEvents } from '../lib/rummy';
import { LADDER_FORMAT, LADDER_POLICY, ladderProvisional, rateHumanLadder, sydneyDayKey } from '../lib/competition';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../lib/room-code';
import type { LadderResult } from '../lib/competition-types';
import type { AccountUser } from '../lib/auth-config';
import type { RoomState } from '../lib/types';

export const LADDER_SERVICE_POLICY = Object.freeze({
  ...LADDER_POLICY, game: 1, fullGame: true, timerSeconds: 90,
  absenceSeconds: 300, presenceGapSeconds: 90, queueExpirySeconds: 120, invitationHours: 24,
  rules: 'Ranked Game 1 is a full game between two signed-in humans. Hints are off and turns last 90 seconds. Both players explicitly agree before the deal.',
  consent: 'Sending or accepting a ranked invitation, or joining the ranked queue, confirms these conditions. Ordinary tables stay unranked.',
  disconnects: 'Reconnect resumes the saved game. A forfeit claim requires five minutes of opponent absence and five minutes of continuous presence from the claimant. Both players disconnecting never causes an automatic loss.',
  service: 'A confirmed service interruption is voided by the verified owner account. Players do not certify their own service errors. A void does not change ratings.',
  deletion: 'Deleting an account removes ranked invitations and public standing. An active ranked game closes without a rating change for the other player.',
});

export const LADDER_SCHEMA = `DO $$ BEGIN
CREATE TABLE IF NOT EXISTS ladder_players (
 user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
 public_id text NOT NULL UNIQUE, rating integer NOT NULL DEFAULT 1000,
 rated_games integer NOT NULL DEFAULT 0 CHECK(rated_games>=0), active_match_id text,
 created_at bigint NOT NULL, updated_at bigint NOT NULL);
CREATE TABLE IF NOT EXISTS ladder_matches (
 id text PRIMARY KEY, format text NOT NULL CHECK(format='ranked-human-v1'),
 first_user text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 second_user text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 source text NOT NULL CHECK(source IN ('friend','queue')),
 state text NOT NULL CHECK(state IN ('invited','active','completed','forfeited','void','declined','cancelled','expired')),
 first_accepted_at bigint NOT NULL, second_accepted_at bigint,
 first_player_id text, second_player_id text, game_id text UNIQUE,
 room_code text UNIQUE REFERENCES rooms(code) ON DELETE SET NULL,
 first_seen_at bigint, second_seen_at bigint, first_connected_at bigint, second_connected_at bigint,
 created_at bigint NOT NULL, expires_at bigint NOT NULL, started_at bigint, finished_at bigint,
 CHECK(first_user<>second_user));
CREATE INDEX IF NOT EXISTS ladder_matches_first ON ladder_matches(first_user,created_at DESC);
CREATE INDEX IF NOT EXISTS ladder_matches_second ON ladder_matches(second_user,created_at DESC);
IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='ladder_players_active_match_fk') THEN
 ALTER TABLE ladder_players ADD CONSTRAINT ladder_players_active_match_fk FOREIGN KEY(active_match_id) REFERENCES ladder_matches(id) ON DELETE SET NULL;
END IF;
CREATE TABLE IF NOT EXISTS ladder_queue (
 user_id text PRIMARY KEY REFERENCES ladder_players(user_id) ON DELETE CASCADE,
 queued_at bigint NOT NULL, seen_at bigint NOT NULL, consent_format text NOT NULL CHECK(consent_format='ranked-human-v1'));
CREATE INDEX IF NOT EXISTS ladder_queue_wait ON ladder_queue(queued_at,seen_at);
CREATE TABLE IF NOT EXISTS ladder_queue_lock (id integer PRIMARY KEY CHECK(id=1));
INSERT INTO ladder_queue_lock(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS ladder_pair_days (
 first_user text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 second_user text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 day text NOT NULL, rated_games integer NOT NULL DEFAULT 0 CHECK(rated_games>=0),
 PRIMARY KEY(first_user,second_user,day), CHECK(first_user<second_user));
CREATE TABLE IF NOT EXISTS ladder_results (
 game_id text PRIMARY KEY, match_id text NOT NULL UNIQUE REFERENCES ladder_matches(id) ON DELETE CASCADE,
 outcome text NOT NULL CHECK(outcome IN ('completed','forfeit','service-interrupted')),
 result text CHECK(result IN ('first','second','tie')), rated boolean NOT NULL,
 first_rating integer NOT NULL, second_rating integer NOT NULL, first_delta integer NOT NULL, second_delta integer NOT NULL,
 first_total integer, second_total integer, reason text, finished_at bigint NOT NULL);
CREATE TABLE IF NOT EXISTS ladder_service_voids (
 match_id text PRIMARY KEY REFERENCES ladder_matches(id) ON DELETE CASCADE,
 owner_id text REFERENCES "user"(id) ON DELETE SET NULL, note text NOT NULL, created_at bigint NOT NULL);
CREATE OR REPLACE FUNCTION ladder_deleted_match_cleanup() RETURNS trigger AS $ladder_cleanup$
BEGIN
 IF OLD.room_code IS NOT NULL THEN
  UPDATE records_evidence SET status='service-interrupted',updated_at=(extract(epoch FROM clock_timestamp())*1000)::bigint,
   payload=payload || jsonb_build_object('status','service-interrupted','eligible',false,'exclusionReason','ranked participant account deleted',
    'finishedAt',(extract(epoch FROM clock_timestamp())*1000)::bigint,'achievements','[]'::jsonb)
   WHERE room_code=OLD.room_code AND status='started';
  DELETE FROM rooms WHERE code=OLD.room_code AND state::jsonb->'ranked'->>'matchId'=OLD.id;
 END IF;
 RETURN OLD;
END $ladder_cleanup$ LANGUAGE plpgsql;
IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='ladder_deleted_match_cleanup_trigger') THEN
 CREATE TRIGGER ladder_deleted_match_cleanup_trigger AFTER DELETE ON ladder_matches FOR EACH ROW EXECUTE FUNCTION ladder_deleted_match_cleanup();
END IF;
END $$;`;

const schemaReady = new WeakMap<SqlDatabase, Promise<void>>();
export function ensureLadderSchema(db: SqlDatabase): Promise<void> {
  let ready = schemaReady.get(db);
  if (!ready) {
    ready = new RecordsRepository(db).ensure().then(() => db.query(LADDER_SCHEMA)).then(() => {}).catch(error => { schemaReady.delete(db); throw error; });
    schemaReady.set(db, ready);
  }
  return ready;
}

type MatchState = 'invited' | 'active' | 'completed' | 'forfeited' | 'void' | 'declined' | 'cancelled' | 'expired';
interface MatchRow {
  id: string; format: string; first_user: string; second_user: string; source: 'friend' | 'queue'; state: MatchState;
  first_accepted_at: string | number; second_accepted_at: string | number | null;
  first_player_id: string | null; second_player_id: string | null; game_id: string | null; room_code: string | null;
  first_seen_at: string | number | null; second_seen_at: string | number | null;
  first_connected_at: string | number | null; second_connected_at: string | number | null;
  created_at: string | number; expires_at: string | number; started_at: string | number | null; finished_at: string | number | null;
}
interface PlayerRow { user_id: string; public_id: string; rating: number; rated_games: number; active_match_id: string | null }
interface NamedMatch extends MatchRow {
  first_name: string; second_name: string; first_public_id: string; second_public_id: string;
  first_badges: string[]; second_badges: string[]; rated: boolean | null; result: LadderResult | null; result_outcome: string | null;
  first_delta: number | null; second_delta: number | null; first_total: number | null; second_total: number | null; reason: string | null;
}
export interface RankedMatchPreview {
  id: string; state: MatchState; source: 'friend' | 'queue'; role: 'first' | 'second';
  opponent: { id: string; displayName: string; featuredBadges: string[] };
  youAccepted: boolean; opponentAccepted: boolean; roomCode: string | null;
  createdAt: number; expiresAt: number; startedAt: number | null; finishedAt: number | null;
  opponentPresent: boolean; claimAvailableAt: number | null;
  result: { outcome: string; result: 'win' | 'loss' | 'tie' | 'void'; rated: boolean; ratingDelta: number; yourTotal: number | null; opponentTotal: number | null; reason: string | null } | null;
}
export interface LadderStanding { id: string; displayName: string; featuredBadges: string[]; rating: number; ratedGames: number; provisional: boolean; rank: number }
function deny(message: string, status = 400): never { throw new SecurityError(message, status); }
function requireConsent(consent: unknown): void { if (consent !== true) deny('Agree to the ranked rules before continuing.'); }
const ms = (value: string | number | null) => value === null ? null : Number(value);
function participant(match: MatchRow, userId: string): 'first' | 'second' {
  if (match.first_user === userId) return 'first';
  if (match.second_user === userId) return 'second';
  return deny('This ranked match is not available.', 404);
}
function assertConditions(room: RoomState, match: MatchRow): void {
  if (room.ranked?.format !== LADDER_FORMAT || room.ranked.matchId !== match.id || room.code !== match.room_code
    || room.game !== 1 || room.quickPlay || room.showMoveHints !== false || room.turnLimitSeconds !== 90
    || room.players.length !== 2 || room.players.some(player => player.isBot)
    || room.players[0].id !== match.first_player_id || room.players[1].id !== match.second_player_id
    || !match.first_accepted_at || !match.second_accepted_at
    || (room.records && room.records.gameId !== match.game_id)) deny('The ranked conditions or accepted seats do not match.', 409);
}
async function lockPlayers(connection: SqlConnection, users: string[]): Promise<PlayerRow[]> {
  return (await connection.query<PlayerRow>('SELECT user_id,public_id,rating,rated_games,active_match_id FROM ladder_players WHERE user_id=ANY($1::text[]) ORDER BY user_id FOR UPDATE', [users])).rows;
}
async function assertFriendship(connection: SqlConnection, firstUser: string, secondUser: string): Promise<void> {
  const [first, second] = [firstUser, secondUser].sort();
  const result = await connection.query(`SELECT id FROM records_friendships WHERE first_user=$1 AND second_user=$2 AND state='accepted'
    AND NOT EXISTS(SELECT 1 FROM records_blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1))`, [first, second]);
  if (!result.rows.length) deny('This ranked invitation requires an accepted, unblocked friend.', 403);
}
async function storeRoom(connection: SqlConnection, room: RoomState, priorVersion: number): Promise<void> {
  const events = recordEvents(room);
  const state = JSON.stringify(room.records ? { ...room, records: { ...room.records, events: [] } } : room);
  const values: unknown[] = [state, room.version, room.updatedAt, room.code, priorVersion];
  const update = 'UPDATE rooms SET state=$1,version=$2,updated_at=$3 WHERE code=$4 AND version=$5 RETURNING code';
  const sql = events.length ? `WITH changed AS (${update})${recordsWriteCtes(6)} SELECT code FROM changed` : update;
  if (events.length) values.push(recordEventValues(events));
  if (!(await connection.query(sql, values)).rows.length) deny('The ranked table changed. Reconnect before continuing.', 409);
  if (room.records) room.records.events = [];
}

async function settleMatch(connection: SqlConnection, match: MatchRow, room: RoomState,
  outcome: 'completed' | 'forfeit' | 'service-interrupted', result: LadderResult | null, now: number): Promise<void> {
  if (match.state !== 'active') return;
  if (!match.game_id) deny('This ranked match has no verified game.', 409);
  const players = await lockPlayers(connection, [match.first_user, match.second_user]);
  const first = players.find(player => player.user_id === match.first_user);
  const second = players.find(player => player.user_id === match.second_user);
  if (!first || !second || first.active_match_id !== match.id || second.active_match_id !== match.id) deny('The ranked account ownership changed.', 409);
  const [pairFirst, pairSecond] = [match.first_user, match.second_user].sort();
  const day = sydneyDayKey(now);
  await connection.query('INSERT INTO ladder_pair_days(first_user,second_user,day,rated_games) VALUES($1,$2,$3,0) ON CONFLICT DO NOTHING', [pairFirst, pairSecond, day]);
  const pair = (await connection.query<{ rated_games: number }>('SELECT rated_games FROM ladder_pair_days WHERE first_user=$1 AND second_user=$2 AND day=$3 FOR UPDATE', [pairFirst, pairSecond, day])).rows[0];
  const update = rateHumanLadder({ rating: first.rating, ratedGames: first.rated_games }, { rating: second.rating, ratedGames: second.rated_games }, result ?? 'tie', {
    format: match.format, playerCount: 2, humanCount: 2, bothOptedIn: true, showMoveHints: false, pairRatedGamesToday: pair.rated_games, outcome,
  });
  const firstTotal = outcome === 'completed' ? room.players[0].score : null;
  const secondTotal = outcome === 'completed' ? room.players[1].score : null;
  const inserted = await connection.query(`INSERT INTO ladder_results(game_id,match_id,outcome,result,rated,first_rating,second_rating,first_delta,second_delta,first_total,second_total,reason,finished_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING RETURNING game_id`,
  [match.game_id, match.id, outcome, result, update.rated, update.first.rating, update.second.rating, update.first.delta, update.second.delta, firstTotal, secondTotal, update.reason, now]);
  if (!inserted.rows.length) return;
  await connection.query('UPDATE ladder_players SET rating=$1,rated_games=$2,active_match_id=NULL,updated_at=$3 WHERE user_id=$4 AND active_match_id=$5', [update.first.rating, update.first.ratedGames, now, match.first_user, match.id]);
  await connection.query('UPDATE ladder_players SET rating=$1,rated_games=$2,active_match_id=NULL,updated_at=$3 WHERE user_id=$4 AND active_match_id=$5', [update.second.rating, update.second.ratedGames, now, match.second_user, match.id]);
  if (update.rated) await connection.query('UPDATE ladder_pair_days SET rated_games=rated_games+1 WHERE first_user=$1 AND second_user=$2 AND day=$3', [pairFirst, pairSecond, day]);
  await connection.query('UPDATE ladder_matches SET state=$1,finished_at=$2 WHERE id=$3', [outcome === 'completed' ? 'completed' : outcome === 'forfeit' ? 'forfeited' : 'void', now, match.id]);
}

/** Called inside the accepted room CAS transaction, after durable evidence. */
export async function processRankedRoom(connection: SqlConnection, room: RoomState, now = Date.now()): Promise<void> {
  if (!room.ranked || room.status !== 'finished') return;
  const match = (await connection.query<MatchRow>('SELECT * FROM ladder_matches WHERE id=$1 FOR UPDATE', [room.ranked.matchId])).rows[0];
  if (!match) deny('The ranked match is no longer available.', 409);
  assertConditions(room, match);
  if (match.state !== 'active') return;
  const members = (await connection.query<{ user_id: string; player_id: string }>('SELECT user_id,player_id FROM room_memberships WHERE room_code=$1', [room.code])).rows;
  if (!members.some(member => member.user_id === match.first_user && member.player_id === match.first_player_id)
    || !members.some(member => member.user_id === match.second_user && member.player_id === match.second_player_id)) deny('The ranked account seats changed.', 409);
  if (!room.result || !room.history.length || !room.result.scores.some(row => row.completed)
    || room.players.some(player => !Number.isSafeInteger(player.score) || player.score < 0)) deny('A complete authoritative Game 1 result is required.', 409);
  const result: LadderResult = room.players[0].score === room.players[1].score ? 'tie' : room.players[0].score < room.players[1].score ? 'first' : 'second';
  await settleMatch(connection, match, room, 'completed', result, now);
}

function previewMatch(match: NamedMatch, userId: string, now: number): RankedMatchPreview {
  const side = participant(match, userId), first = side === 'first';
  const opponentSeen = ms(first ? match.second_seen_at : match.first_seen_at);
  const ownSeen = ms(first ? match.first_seen_at : match.second_seen_at);
  const connected = ms(first ? match.first_connected_at : match.second_connected_at);
  const ownFresh = ownSeen !== null && ownSeen >= now - LADDER_SERVICE_POLICY.presenceGapSeconds * 1000;
  const claimAvailableAt = match.state === 'active' && ownFresh && connected !== null && opponentSeen !== null
    ? Math.max(opponentSeen, connected) + LADDER_SERVICE_POLICY.absenceSeconds * 1000 : null;
  const state = match.state === 'invited' && Number(match.expires_at) <= now ? 'expired' : match.state;
  return {
    id: match.id, state, source: match.source, role: side,
    opponent: { id: first ? match.second_public_id : match.first_public_id, displayName: first ? match.second_name : match.first_name, featuredBadges: first ? match.second_badges : match.first_badges },
    youAccepted: first || match.second_accepted_at !== null, opponentAccepted: first ? match.second_accepted_at !== null : true,
    roomCode: match.second_accepted_at !== null ? match.room_code : null,
    createdAt: Number(match.created_at), expiresAt: Number(match.expires_at), startedAt: ms(match.started_at), finishedAt: ms(match.finished_at),
    opponentPresent: opponentSeen !== null && opponentSeen >= now - LADDER_SERVICE_POLICY.presenceGapSeconds * 1000, claimAvailableAt,
    result: match.result_outcome ? {
      outcome: match.result_outcome, result: match.result_outcome === 'service-interrupted' ? 'void' : match.result === 'tie' ? 'tie' : match.result === side ? 'win' : 'loss',
      rated: match.rated === true, ratingDelta: (first ? match.first_delta : match.second_delta) ?? 0,
      yourTotal: first ? match.first_total : match.second_total, opponentTotal: first ? match.second_total : match.first_total, reason: match.reason,
    } : null,
  };
}
const namedMatchesSql = `SELECT m.*, p1.display_name AS first_name,p2.display_name AS second_name,
 p1.featured_badges AS first_badges,p2.featured_badges AS second_badges,
 l1.public_id AS first_public_id,l2.public_id AS second_public_id,
 r.rated,r.result,r.outcome AS result_outcome,r.first_delta,r.second_delta,r.first_total,r.second_total,r.reason
 FROM ladder_matches m JOIN records_profiles p1 ON p1.user_id=m.first_user JOIN records_profiles p2 ON p2.user_id=m.second_user
 JOIN ladder_players l1 ON l1.user_id=m.first_user JOIN ladder_players l2 ON l2.user_id=m.second_user
 LEFT JOIN ladder_results r ON r.match_id=m.id`;

export class LadderRepository {
  private readonly records: RecordsRepository;
  constructor(readonly db: SqlDatabase = database) { this.records = new RecordsRepository(db); }
  async ensure(): Promise<void> { await ensureLadderSchema(this.db); }
  async ensurePlayer(userId: string, now = Date.now()): Promise<void> {
    await this.ensure(); await this.records.profile(userId);
    await this.db.query('INSERT INTO ladder_players(user_id,public_id,created_at,updated_at) VALUES($1,$2,$3,$3) ON CONFLICT(user_id) DO NOTHING', [userId, randomUUID(), now]);
  }
  async match(userId: string, matchId: string, now = Date.now()): Promise<RankedMatchPreview> {
    await this.ensure();
    const row = (await this.db.query<NamedMatch>(`${namedMatchesSql} WHERE m.id=$1 AND (m.first_user=$2 OR m.second_user=$2)`, [matchId, userId])).rows[0];
    if (!row) deny('This ranked match is not available.', 404);
    return previewMatch(row, userId, now);
  }
  async snapshot(userId: string, now = Date.now()) {
    await this.ensurePlayer(userId, now);
    const [player, standings, matches, queue] = await Promise.all([
      this.db.query<PlayerRow>('SELECT user_id,public_id,rating,rated_games,active_match_id FROM ladder_players WHERE user_id=$1', [userId]),
      this.db.query<{ public_id: string; display_name: string; featured_badges: string[]; rating: number; rated_games: number; rank: string }>(`SELECT l.public_id,p.display_name,p.featured_badges,l.rating,l.rated_games,
        rank() OVER(ORDER BY l.rating DESC) AS rank FROM ladder_players l JOIN records_profiles p ON p.user_id=l.user_id
        WHERE l.rated_games>0 ORDER BY l.rating DESC,l.public_id LIMIT 50`),
      this.db.query<NamedMatch>(`${namedMatchesSql} WHERE m.first_user=$1 OR m.second_user=$1 ORDER BY m.created_at DESC,m.id DESC LIMIT 30`, [userId]),
      this.db.query<{ queued_at: string | number; seen_at: string | number }>('SELECT queued_at,seen_at FROM ladder_queue WHERE user_id=$1 AND seen_at>$2', [userId, now - LADDER_SERVICE_POLICY.queueExpirySeconds * 1000]),
    ]);
    const own = player.rows[0];
    return {
      policy: LADDER_SERVICE_POLICY,
      player: { id: own.public_id, rating: own.rating, ratedGames: own.rated_games, provisional: ladderProvisional(own.rated_games), activeMatchId: own.active_match_id },
      standings: standings.rows.map(row => ({ id: row.public_id, displayName: row.display_name, featuredBadges: row.featured_badges, rating: row.rating, ratedGames: row.rated_games, provisional: ladderProvisional(row.rated_games), rank: Number(row.rank) } satisfies LadderStanding)),
      matches: matches.rows.map(row => previewMatch(row, userId, now)),
      queue: { waiting: queue.rows.length === 1, joinedAt: queue.rows[0] ? Number(queue.rows[0].queued_at) : null },
    };
  }
  private async startMatch(connection: SqlConnection, match: MatchRow, now: number): Promise<void> {
    const players = await lockPlayers(connection, [match.first_user, match.second_user]);
    if (players.length !== 2 || players.some(player => player.active_match_id)) deny('One player already has an active ranked game. Finish or forfeit before starting another.', 409);
    const profiles = (await connection.query<{ user_id: string; display_name: string }>('SELECT user_id,display_name FROM records_profiles WHERE user_id=ANY($1::text[])', [[match.first_user, match.second_user]])).rows;
    const firstId = randomUUID(), secondId = randomUUID();
    let created: RoomState | null = null;
    for (let attempt = 0; attempt < 12 && !created; attempt++) {
      const code = Array.from({ length: ROOM_CODE_LENGTH }, () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)]).join('');
      const first = createPlayer({ id: firstId, name: profiles.find(profile => profile.user_id === match.first_user)!.display_name, color: 0, tokenHash: `account:${randomUUID()}` });
      const second = createPlayer({ id: secondId, name: profiles.find(profile => profile.user_id === match.second_user)!.display_name, color: 1, tokenHash: `account:${randomUUID()}` });
      let room = createRoom(code, first);
      room.players.push(second); room.game = 1; room.showMoveHints = false; room.turnLimitSeconds = 90;
      room.ranked = { format: LADDER_FORMAT, matchId: match.id };
      enableRecords(room, { format: 'ranked' });
      room = applyAction(room, firstId, { type: 'start' });
      room.createdAt = now; room.updatedAt = now; room.turnDeadline = now + 90_000;
      const events = recordEvents(room);
      const saved = await connection.query('INSERT INTO rooms(code,state,version,created_at,updated_at) VALUES($1,$2,$3,$4,$4) ON CONFLICT DO NOTHING RETURNING code', [code, JSON.stringify({ ...room, records: { ...room.records!, events: [] } }), room.version, now]);
      if (!saved.rows.length) continue;
      await connection.query('INSERT INTO room_memberships(room_code,user_id,player_id) VALUES($1,$2,$3),($1,$4,$5)', [code, match.first_user, firstId, match.second_user, secondId]);
      if (events.length) await connection.query(`WITH changed AS (SELECT code FROM rooms WHERE code=$1)${recordsWriteCtes(2)} SELECT code FROM changed`, [code, recordEventValues(events)]);
      created = room;
    }
    if (!created) deny('A ranked table could not be reserved. Please retry.', 503);
    await connection.query(`UPDATE ladder_matches SET state='active',first_player_id=$1,second_player_id=$2,game_id=$3,room_code=$4,
      second_accepted_at=$5,first_seen_at=$5,second_seen_at=$5,first_connected_at=$5,second_connected_at=$5,started_at=$5 WHERE id=$6`,
    [firstId, secondId, created.records!.gameId, created.code, now, match.id]);
    const reserved = await connection.query('UPDATE ladder_players SET active_match_id=$1,updated_at=$2 WHERE user_id=ANY($3::text[]) AND active_match_id IS NULL RETURNING user_id', [match.id, now, [match.first_user, match.second_user]]);
    if (reserved.rows.length !== 2) deny('A ranked player joined another table. Please retry.', 409);
    await connection.query('DELETE FROM ladder_queue WHERE user_id=ANY($1::text[])', [[match.first_user, match.second_user]]);
  }
  async invite(userId: string, friendId: string, consent: unknown, now = Date.now()) {
    requireConsent(consent); await this.ensurePlayer(userId, now);
    const friend = (await this.db.query<{ first_user: string; second_user: string }>("SELECT first_user,second_user FROM records_friendships WHERE id=$1 AND state='accepted' AND (first_user=$2 OR second_user=$2)", [friendId, userId])).rows[0];
    if (!friend) deny('Choose an accepted friend for this ranked invitation.', 404);
    const other = friend.first_user === userId ? friend.second_user : friend.first_user;
    await this.ensurePlayer(other, now);
    const matchId = await this.db.transaction(async connection => {
      await assertFriendship(connection, userId, other);
      const players = await lockPlayers(connection, [userId, other]);
      if (players.some(player => player.active_match_id)) deny('Finish the active ranked game before sending another invitation.', 409);
      const prior = (await connection.query<{ id: string }>("SELECT id FROM ladder_matches WHERE first_user=$1 AND second_user=$2 AND state='invited' AND expires_at>$3 ORDER BY created_at DESC LIMIT 1", [userId, other, now])).rows[0];
      if (prior) return prior.id;
      const id = randomBytes(24).toString('base64url');
      await connection.query(`INSERT INTO ladder_matches(id,format,first_user,second_user,source,state,first_accepted_at,created_at,expires_at)
        VALUES($1,$2,$3,$4,'friend','invited',$5,$5,$6)`, [id, LADDER_FORMAT, userId, other, now, now + LADDER_SERVICE_POLICY.invitationHours * 3_600_000]);
      return id;
    });
    return this.match(userId, matchId, now);
  }
  async accept(userId: string, matchId: string, consent: unknown, now = Date.now()) {
    requireConsent(consent); await this.ensurePlayer(userId, now);
    await this.db.transaction(async connection => {
      // Queue matching also reserves these players and removes their queue rows.
      // Take its shared mutex first, before match/player locks, so an accepted
      // friend invite cannot deadlock a simultaneous queue match.
      await connection.query('SELECT id FROM ladder_queue_lock WHERE id=1 FOR UPDATE');
      const match = (await connection.query<MatchRow>('SELECT * FROM ladder_matches WHERE id=$1 FOR UPDATE', [matchId])).rows[0];
      if (!match) deny('This ranked invitation is no longer available.', 404);
      participant(match, userId);
      if (match.state === 'active' || ['completed', 'forfeited', 'void'].includes(match.state)) return;
      if (match.state !== 'invited' || Number(match.expires_at) <= now) deny('This ranked invitation has expired or was withdrawn.', 410);
      if (match.second_user !== userId) deny('Your friend must accept this ranked invitation.', 403);
      await assertFriendship(connection, match.first_user, match.second_user);
      await this.startMatch(connection, match, now);
    });
    return this.match(userId, matchId, now);
  }
  async invitationAction(userId: string, matchId: string, action: 'decline' | 'cancel', now = Date.now()) {
    await this.ensure();
    await this.db.transaction(async connection => {
      const match = (await connection.query<MatchRow>('SELECT * FROM ladder_matches WHERE id=$1 FOR UPDATE', [matchId])).rows[0];
      if (!match) deny('This ranked invitation is no longer available.', 404);
      const role = participant(match, userId);
      if ((action === 'cancel' && role !== 'first') || (action === 'decline' && role !== 'second')) deny('This invitation action belongs to the other player.', 403);
      if (match.state === 'active') deny('This ranked game has started. Use Forfeit to withdraw.', 409);
      if (match.state !== 'invited') return;
      await connection.query('UPDATE ladder_matches SET state=$1,finished_at=$2 WHERE id=$3', [action === 'cancel' ? 'cancelled' : 'declined', now, match.id]);
    });
    return this.match(userId, matchId, now);
  }
  async joinQueue(userId: string, consent: unknown, now = Date.now()) {
    requireConsent(consent); await this.ensurePlayer(userId, now);
    const matchId = await this.db.transaction(async connection => {
      await connection.query('SELECT id FROM ladder_queue_lock WHERE id=1 FOR UPDATE');
      await connection.query('DELETE FROM ladder_queue WHERE seen_at<=$1', [now - LADDER_SERVICE_POLICY.queueExpirySeconds * 1000]);
      const self = (await connection.query<PlayerRow>('SELECT user_id,public_id,rating,rated_games,active_match_id FROM ladder_players WHERE user_id=$1', [userId])).rows[0];
      if (self.active_match_id) return self.active_match_id;
      const other = (await connection.query<{ user_id: string }>(`SELECT q.user_id FROM ladder_queue q JOIN ladder_players p ON p.user_id=q.user_id
        WHERE q.user_id<>$1 AND p.active_match_id IS NULL AND q.consent_format=$2
        AND NOT EXISTS(SELECT 1 FROM records_blocks b WHERE (b.blocker_id=$1 AND b.blocked_id=q.user_id) OR (b.blocker_id=q.user_id AND b.blocked_id=$1))
        ORDER BY q.queued_at,q.user_id LIMIT 1 FOR UPDATE OF q`, [userId, LADDER_FORMAT])).rows[0];
      if (!other) {
        const [own] = await lockPlayers(connection, [userId]);
        if (own.active_match_id) return own.active_match_id;
        await connection.query(`INSERT INTO ladder_queue(user_id,queued_at,seen_at,consent_format) VALUES($1,$2,$2,$3)
          ON CONFLICT(user_id) DO UPDATE SET seen_at=$2`, [userId, now, LADDER_FORMAT]);
        return null;
      }
      const id = randomBytes(24).toString('base64url');
      await connection.query(`INSERT INTO ladder_matches(id,format,first_user,second_user,source,state,first_accepted_at,second_accepted_at,created_at,expires_at)
        VALUES($1,$2,$3,$4,'queue','invited',$5,$5,$5,$6)`, [id, LADDER_FORMAT, other.user_id, userId, now, now + 86_400_000]);
      const match = (await connection.query<MatchRow>('SELECT * FROM ladder_matches WHERE id=$1', [id])).rows[0];
      await this.startMatch(connection, match, now);
      return id;
    });
    return matchId ? { match: await this.match(userId, matchId, now), waiting: false } : { match: null, waiting: true };
  }
  async leaveQueue(userId: string): Promise<void> {
    await this.ensure();
    await this.db.transaction(async connection => {
      await connection.query('SELECT id FROM ladder_queue_lock WHERE id=1 FOR UPDATE');
      await connection.query('DELETE FROM ladder_queue WHERE user_id=$1', [userId]);
    });
  }
  async assertAccess(room: RoomState, userId: string, actionType?: string): Promise<void> {
    if (!room.ranked) return;
    await this.ensure();
    const match = (await this.db.query<MatchRow>('SELECT * FROM ladder_matches WHERE id=$1', [room.ranked.matchId])).rows[0];
    if (!match) deny('This ranked match is no longer available.', 404);
    participant(match, userId); assertConditions(room, match);
    if (actionType && !['read', 'join', 'resume'].includes(actionType) && match.state !== 'active') deny('This ranked game has finished. Start a new ranked invitation.', 409);
  }
  async heartbeat(userId: string, matchId?: string, now = Date.now()): Promise<void> {
    await this.ensure();
    if (!matchId) {
      await this.db.query('UPDATE ladder_queue SET seen_at=$1 WHERE user_id=$2 AND seen_at>$3', [now, userId, now - LADDER_SERVICE_POLICY.queueExpirySeconds * 1000]);
      return;
    }
    const row = (await this.db.query<MatchRow>('SELECT * FROM ladder_matches WHERE id=$1 AND (first_user=$2 OR second_user=$2)', [matchId, userId])).rows[0];
    if (!row) deny('This ranked match is not available.', 404);
    if (row.state !== 'active') return;
    const side = participant(row, userId), seen = side === 'first' ? 'first_seen_at' : 'second_seen_at', connected = side === 'first' ? 'first_connected_at' : 'second_connected_at';
    await this.db.query(`UPDATE ladder_matches SET ${connected}=CASE WHEN ${seen} IS NULL OR ${seen}<$1 THEN $2 ELSE ${connected} END,${seen}=$2
      WHERE id=$3 AND state='active'`, [now - LADDER_SERVICE_POLICY.presenceGapSeconds * 1000, now, matchId]);
  }
  private async lockedGame<T>(matchId: string, work: (connection: SqlConnection, match: MatchRow, room: RoomState) => Promise<T>): Promise<T> {
    await this.ensure();
    return this.db.transaction(async connection => {
      // Match the gameplay transaction's lock order: room, match, rating rows.
      const location = (await connection.query<{ room_code: string | null }>('SELECT room_code FROM ladder_matches WHERE id=$1', [matchId])).rows[0];
      if (!location?.room_code) deny('This ranked game is not active.', 404);
      const saved = (await connection.query<{ state: string }>('SELECT state FROM rooms WHERE code=$1 FOR UPDATE', [location.room_code])).rows[0];
      if (!saved) deny('This ranked table is unavailable.', 409);
      const match = (await connection.query<MatchRow>('SELECT * FROM ladder_matches WHERE id=$1 FOR UPDATE', [matchId])).rows[0];
      if (!match) deny('This ranked match is no longer available.', 404);
      const room = JSON.parse(saved.state) as RoomState;
      assertConditions(room, match);
      return work(connection, match, room);
    });
  }
  async forfeit(userId: string, matchId: string, claim = false, now = Date.now()) {
    await this.lockedGame(matchId, async (connection, match, room) => {
      const side = participant(match, userId);
      if (match.state !== 'active') return;
      if (room.status === 'finished') { await processRankedRoom(connection, room, now); return; }
      if (claim) {
        const ownSeen = Number(side === 'first' ? match.first_seen_at : match.second_seen_at);
        const connected = Number(side === 'first' ? match.first_connected_at : match.second_connected_at);
        const opponentSeen = Number(side === 'first' ? match.second_seen_at : match.first_seen_at);
        if (!ownSeen || !connected || !opponentSeen || ownSeen < now - LADDER_SERVICE_POLICY.presenceGapSeconds * 1000
          || now < Math.max(opponentSeen, connected) + LADDER_SERVICE_POLICY.absenceSeconds * 1000) deny('A claim requires five minutes of opponent absence and your continuous presence. Keep this table open.', 409);
      }
      const loser = claim ? (side === 'first' ? 'second' : 'first') : side;
      const loserId = loser === 'first' ? match.first_player_id! : match.second_player_id!;
      const winnerId = loser === 'first' ? match.second_player_id! : match.first_player_id!;
      const priorVersion = room.version;
      abandonRecords(room, loserId, 'withdrawal'); abandonRecords(room, winnerId, 'table-closed');
      room.status = 'finished'; room.turnDeadline = null; room.turnPlayerId = ''; room.result = null; room.version++; room.updatedAt = now;
      room.events.push({ id: (room.events.at(-1)?.id ?? 0) + 1, type: 'game-end', text: 'Ranked game ended by forfeit.', at: now });
      if (room.events.length > 80) room.events.splice(0, room.events.length - 80);
      await storeRoom(connection, room, priorVersion);
      await settleMatch(connection, match, room, 'forfeit', loser === 'first' ? 'second' : 'first', now);
    });
    return this.match(userId, matchId, now);
  }
  async voidMatch(owner: AccountUser, matchId: string, reason: unknown, now = Date.now()): Promise<void> {
    await this.ensure();
    const ownerEmail = 'dan@ibdcollective.net';
    if (owner.email.trim().toLowerCase() !== ownerEmail) deny('Verified owner access is required.', 403);
    const verified = await this.db.query(`SELECT u.id FROM "user" u WHERE u.id=$1 AND lower(trim(u.email))=$2 AND u."emailVerified"=true
      AND EXISTS(SELECT 1 FROM "account" a WHERE a."userId"=u.id AND a."providerId"='google')`, [owner.id, ownerEmail]);
    if (!verified.rows.length) deny('Verified owner access is required.', 403);
    if (typeof reason !== 'string' || reason.trim().length < 10 || reason.length > 500) deny('Record a short explanation of the confirmed service interruption.');
    await this.lockedGame(matchId, async (connection, match, room) => {
      if (match.state === 'void') return;
      if (match.state !== 'active') deny('A settled ranked result cannot be changed through a service void.', 409);
      if (room.status === 'finished') { await processRankedRoom(connection, room, now); return; }
      const priorVersion = room.version;
      for (const player of room.players) abandonRecords(room, player.id, 'service-interruption');
      room.status = 'finished'; room.turnDeadline = null; room.turnPlayerId = ''; room.result = null; room.version++; room.updatedAt = now;
      room.events.push({ id: (room.events.at(-1)?.id ?? 0) + 1, type: 'game-end', text: 'Ranked game voided after a confirmed service interruption.', at: now });
      if (room.events.length > 80) room.events.splice(0, room.events.length - 80);
      await storeRoom(connection, room, priorVersion);
      await connection.query('INSERT INTO ladder_service_voids(match_id,owner_id,note,created_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [match.id, owner.id, reason.trim(), now]);
      await settleMatch(connection, match, room, 'service-interrupted', null, now);
    });
  }
}

export const ladderRepository = new LadderRepository();
export function assertRankedRoomAccess(room: RoomState, accountId: string, actionType?: string): Promise<void> { return ladderRepository.assertAccess(room, accountId, actionType); }
export async function heartbeatRankedRoom(room: RoomState, accountId: string): Promise<void> { if (room.ranked) await ladderRepository.heartbeat(accountId, room.ranked.matchId); }
