import { after } from 'next/server';
import { createHash } from 'node:crypto';
import { database, type SqlDatabase } from './index';
import type { RoomState } from '../lib/types';
import { ACTIVITY_ONLINE_MS, type ActivityDay, type ActivityGame, type ActivityPlace, type ActivityPlayer, type ActivitySnapshot } from '../lib/activity-types';
import { deploymentContext } from '../lib/deployment-context';

export const ACTIVITY_SCHEMA = `DO $$ BEGIN
CREATE TABLE IF NOT EXISTS activity_meta (id integer PRIMARY KEY CHECK(id=1), started_at bigint NOT NULL, cleaned_at bigint NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS activity_presence (
 session_key text PRIMARY KEY, actor_key text NOT NULL, user_id text REFERENCES "user"("id") ON DELETE CASCADE,
 guest_name text NOT NULL, room_code text REFERENCES rooms(code) ON DELETE SET NULL, place text NOT NULL,
 last_seen bigint NOT NULL);
CREATE INDEX IF NOT EXISTS activity_presence_seen ON activity_presence(last_seen);
CREATE TABLE IF NOT EXISTS activity_daily_players (
 day date NOT NULL, actor_key text NOT NULL, user_id text REFERENCES "user"("id") ON DELETE CASCADE,
 first_seen bigint NOT NULL, last_seen bigint NOT NULL, PRIMARY KEY(day,actor_key));
CREATE INDEX IF NOT EXISTS activity_daily_players_actor ON activity_daily_players(actor_key,day);
CREATE TABLE IF NOT EXISTS activity_daily_peaks (day date PRIMARY KEY, online integer NOT NULL, playing integer NOT NULL);
CREATE TABLE IF NOT EXISTS activity_game_starts (
 instance_key text PRIMARY KEY, day date NOT NULL, started_at bigint NOT NULL, quick boolean NOT NULL);
END $$;`;
const daySql = `(to_timestamp($1::double precision/1000) AT TIME ZONE 'Australia/Sydney')::date`;
export const activityHash = (value: string) => createHash('sha256').update(value).digest('hex');
export interface PresenceRecord { sessionKey: string; actorKey: string; userId: string | null; name: string; roomCode: string | null; place: ActivityPlace }

export class ActivityRepository {
  private ready: Promise<void> | null = null;
  private retryAfter = 0;
  private nextCleanup = 0;
  constructor(private readonly db: SqlDatabase = database) {}
  async ensure(now = Date.now()): Promise<void> {
    if (now < this.retryAfter) throw new Error('Activity storage is temporarily unavailable');
    if (!this.ready) this.ready = (async () => {
      await this.db.query(ACTIVITY_SCHEMA);
      await this.db.query('INSERT INTO activity_meta(id,started_at) VALUES(1,$1) ON CONFLICT DO NOTHING', [now]);
    })().catch(error => { this.ready = null; this.retryAfter = Date.now()+60_000; throw error; });
    await this.ready;
  }
  async pulse(p: PresenceRecord, now = Date.now()): Promise<void> {
    await this.ensure(now);
    // Presence is separate from rooms: no room version, turn, score or membership writes.
    // A per-tab row keeps one hidden tab from disconnecting a second visible tab.
    await this.db.query(`WITH touched AS (
      INSERT INTO activity_presence(session_key,actor_key,user_id,guest_name,room_code,place,last_seen)
      VALUES($2,$3,$4,$5,$6,$7,$1)
      ON CONFLICT(session_key) DO UPDATE SET guest_name=EXCLUDED.guest_name,room_code=EXCLUDED.room_code,place=EXCLUDED.place,last_seen=EXCLUDED.last_seen
      WHERE activity_presence.last_seen <= $1::bigint-20000 OR activity_presence.place<>EXCLUDED.place OR activity_presence.room_code IS DISTINCT FROM EXCLUDED.room_code
      RETURNING actor_key,place
    ), daily AS (
      INSERT INTO activity_daily_players(day,actor_key,user_id,first_seen,last_seen)
      SELECT ${daySql},$3,$4,$1,$1 FROM touched
      ON CONFLICT(day,actor_key) DO UPDATE SET last_seen=GREATEST(activity_daily_players.last_seen,EXCLUDED.last_seen)
    ), current_people AS (
      SELECT actor_key,place FROM activity_presence WHERE last_seen>$1::bigint-$8::bigint AND session_key<>$2
      UNION ALL SELECT $3::text,$7::text
    ) INSERT INTO activity_daily_peaks(day,online,playing)
      SELECT ${daySql},count(DISTINCT actor_key)::integer,count(DISTINCT actor_key) FILTER(WHERE place='playing')::integer FROM current_people
      HAVING EXISTS(SELECT 1 FROM touched)
      ON CONFLICT(day) DO UPDATE SET online=GREATEST(activity_daily_peaks.online,EXCLUDED.online),playing=GREATEST(activity_daily_peaks.playing,EXCLUDED.playing)`,
    [now,p.sessionKey,p.actorKey,p.userId,p.name,p.roomCode,p.place,ACTIVITY_ONLINE_MS]);
    await this.cleanup(now);
  }
  async leave(sessionKey: string, actorKey: string): Promise<void> {
    await this.ensure();
    await this.db.query('DELETE FROM activity_presence WHERE session_key=$1 AND actor_key=$2',[sessionKey,actorKey]);
  }
  async gameStarted(room: RoomState): Promise<void> {
    const context = deploymentContext();
    if (context === 'deploy-preview' || context === 'branch-deploy') return;
    const event = room.events.findLast(e => e.type === 'start');
    if (!event || room.round !== 1 || room.status !== 'playing') return;
    await this.ensure();
    await this.db.query(`INSERT INTO activity_game_starts(instance_key,day,started_at,quick)
      VALUES($2,${daySql},$1,$3) ON CONFLICT DO NOTHING`,
    [event.at,activityHash(`${room.code}:${room.createdAt}:${event.id}`),!!room.quickPlay]);
  }
  private async cleanup(now: number) {
    if (now < this.nextCleanup) return;
    this.nextCleanup = now + 300_000;
    // At most once per five minutes globally, not once per request or worker.
    const claimed = await this.db.query('UPDATE activity_meta SET cleaned_at=$1 WHERE id=1 AND cleaned_at<$1::bigint-300000 RETURNING id',[now]);
    if (!claimed.rowCount) return;
    await this.db.query(`WITH a AS (DELETE FROM activity_presence WHERE last_seen<$1::bigint-86400000),
      b AS (DELETE FROM activity_daily_players WHERE day<${daySql}-29),
      c AS (DELETE FROM activity_game_starts WHERE day<${daySql}-29)
      DELETE FROM activity_daily_peaks WHERE day<${daySql}-29`,[now]);
  }
  async snapshot(now = Date.now()): Promise<ActivitySnapshot> {
    await this.ensure(now);
    await this.cleanup(now);
    type PersonRow = { actor_key: string; user_id: string | null; name: string; email: string | null; place: ActivityPlace; rooms: string[]; last_seen: string | number };
    const [people, daily, meta, returning] = await Promise.all([
      this.db.query<PersonRow>(`SELECT p.actor_key,p.user_id,
        COALESCE(u.name,max(p.guest_name)) AS name,u.email,
        CASE WHEN bool_or(p.place='playing') THEN 'playing' WHEN bool_or(p.place='lobby') THEN 'lobby' WHEN bool_or(p.place='results') THEN 'results' ELSE 'home' END AS place,
        array_remove(array_agg(DISTINCT p.room_code),NULL) AS rooms,max(p.last_seen) AS last_seen
        FROM activity_presence p LEFT JOIN "user" u ON u.id=p.user_id WHERE p.last_seen>$1::bigint-$2::bigint
        GROUP BY p.actor_key,p.user_id,u.name,u.email ORDER BY max(p.last_seen) DESC`,[now,ACTIVITY_ONLINE_MS]),
      this.db.query<{day:string;players:string;signed_in:string;guests:string;games_started:string;peak_online:number;peak_playing:number}>(`WITH days AS (
        SELECT generate_series(GREATEST(${daySql}-29,(SELECT (to_timestamp(started_at::double precision/1000) AT TIME ZONE 'Australia/Sydney')::date FROM activity_meta WHERE id=1)),${daySql},'1 day')::date AS day
      ), people AS (SELECT day,count(*) AS players,count(*) FILTER(WHERE user_id IS NOT NULL) AS signed_in,count(*) FILTER(WHERE user_id IS NULL) AS guests FROM activity_daily_players GROUP BY day),
      games AS (SELECT day,count(*) AS starts FROM activity_game_starts GROUP BY day)
      SELECT days.day::text,COALESCE(p.players,0) AS players,COALESCE(p.signed_in,0) AS signed_in,COALESCE(p.guests,0) AS guests,
      COALESCE(g.starts,0) AS games_started,COALESCE(k.online,0) AS peak_online,COALESCE(k.playing,0) AS peak_playing
      FROM days LEFT JOIN people p USING(day) LEFT JOIN games g USING(day) LEFT JOIN activity_daily_peaks k USING(day) ORDER BY days.day DESC`,[now]),
      this.db.query<{started_at:string}>('SELECT started_at FROM activity_meta WHERE id=1'),
      this.db.query<{count:string}>(`SELECT count(DISTINCT p.actor_key) AS count FROM activity_daily_players p WHERE p.day=${daySql} AND p.user_id IS NOT NULL AND EXISTS(SELECT 1 FROM activity_daily_players old WHERE old.actor_key=p.actor_key AND old.day<p.day AND old.day>=${daySql}-29)`,[now]),
    ]);
    const players: ActivityPlayer[] = people.rows.map(p => ({id:p.actor_key,name:p.name||'Guest',email:p.user_id?p.email:null,guest:!p.user_id,place:p.place,rooms:p.rooms||[],lastSeen:Number(p.last_seen)}));
    const codes = [...new Set(players.filter(p=>p.place==='playing').flatMap(p=>p.rooms))];
    const games: ActivityGame[] = [];
    if (codes.length) {
      const rows = await this.db.query<{state:string}>('SELECT state FROM rooms WHERE code=ANY($1::text[])',[codes]);
      for (const row of rows.rows) {
        const room = JSON.parse(row.state) as RoomState;
        if (room.status !== 'playing') continue;
        games.push({code:room.code,game:room.game,quick:!!room.quickPlay,rule:room.quickPlay?.ruleNumber??room.round,
          onlineHumans:players.filter(p=>p.place==='playing'&&p.rooms.includes(room.code)).length,
          humanSeats:room.players.filter(p=>!p.isBot).length,aiSeats:room.players.filter(p=>p.isBot).length,
          currentPlayer:room.players.find(p=>p.id===room.turnPlayerId)?.name||'',lastMoveAt:room.lastMoveAt??null});
      }
    }
    const history: ActivityDay[] = daily.rows.map(d=>({day:d.day,players:Number(d.players),signedIn:Number(d.signed_in),guests:Number(d.guests),gamesStarted:Number(d.games_started),peakOnline:d.peak_online,peakPlaying:d.peak_playing}));
    return {generatedAt:now,trackingSince:Number(meta.rows[0].started_at),timeZone:'Australia/Sydney',onlineWindowSeconds:90,refreshSeconds:30,historyDays:30,
      totals:{online:players.length,playing:players.filter(p=>p.place==='playing').length,signedIn:players.filter(p=>!p.guest).length,guests:players.filter(p=>p.guest).length,
      liveGames:games.length,aiInLiveGames:games.reduce((n,g)=>n+g.aiSeats,0),todayPlayers:history[0]?.players??0,todayGames:history[0]?.gamesStarted??0,returningAccounts:Number(returning.rows[0]?.count??0),peakToday:history[0]?.peakOnline??0},
      players:players.slice(0,500),games,history,playersTruncated:players.length>500};
  }
}
export const activityRepository = new ActivityRepository();
/** Only used after a newly started game was saved successfully. Never fail gameplay for analytics. */
export async function recordActivityGameStart(room: RoomState): Promise<void> {
  try {
    after(async () => {
      try { await activityRepository.gameStarted(room); } catch { console.warn('Activity statistics temporarily unavailable'); }
    });
  } catch { /* Direct engine tests have no HTTP lifecycle. Never block or fail a game response for telemetry. */ }
}
