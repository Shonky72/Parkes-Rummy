import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { database, type SqlDatabase } from './index';
import { SecurityError } from './security';
import { aggregateRecords, cohortKey } from '../lib/records';
import { RULES } from '../lib/rummy';
import type { RecordConditions, RecordEvidence, RecordsAggregate, RoomRecordEvent } from '../lib/records-types';
import type { Suit } from '../lib/types';

/** Additive migration only. Evidence deliberately has no rooms foreign key. */
export const RECORDS_SCHEMA = `DO $$ BEGIN
-- All three releases share this namespace to coordinate cold workers.
-- The lock releases automatically when this query's transaction ends.
PERFORM pg_advisory_xact_lock(1346458187,1);
CREATE TABLE IF NOT EXISTS records_profiles (
 user_id text PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
 display_name text NOT NULL DEFAULT 'Player', friend_code text NOT NULL UNIQUE,
 featured_badges text[] NOT NULL DEFAULT '{}', created_at bigint NOT NULL, updated_at bigint NOT NULL);
CREATE TABLE IF NOT EXISTS records_evidence (
 user_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 hand_id text NOT NULL, game_id text NOT NULL, player_id text NOT NULL, room_code text NOT NULL,
 rule_id text NOT NULL, status text NOT NULL CHECK(status IN ('started','completed','abandoned','service-interrupted')),
 source_event text NOT NULL, started_at bigint NOT NULL, updated_at bigint NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY(user_id,hand_id), UNIQUE(hand_id,player_id));
CREATE INDEX IF NOT EXISTS records_evidence_owner_history ON records_evidence(user_id,started_at DESC,hand_id DESC);
CREATE INDEX IF NOT EXISTS records_evidence_room ON records_evidence(room_code,status);
CREATE INDEX IF NOT EXISTS records_evidence_game ON records_evidence(user_id,game_id);
CREATE TABLE IF NOT EXISTS records_friendships (
 id text PRIMARY KEY, first_user text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 second_user text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 requester_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 state text NOT NULL CHECK(state IN ('pending','accepted')), created_at bigint NOT NULL,
 UNIQUE(first_user,second_user), CHECK(first_user<>second_user));
CREATE INDEX IF NOT EXISTS records_friendships_second ON records_friendships(second_user,state);
CREATE TABLE IF NOT EXISTS records_blocks (
 id text PRIMARY KEY, blocker_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 blocked_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 created_at bigint NOT NULL, UNIQUE(blocker_id,blocked_id), CHECK(blocker_id<>blocked_id));
CREATE TABLE IF NOT EXISTS records_shares (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 hand_id text NOT NULL, token text NOT NULL UNIQUE, token_hash text NOT NULL UNIQUE,
 payload jsonb NOT NULL, created_at bigint NOT NULL, expires_at bigint NOT NULL,
 FOREIGN KEY(user_id,hand_id) REFERENCES records_evidence(user_id,hand_id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS records_shares_owner ON records_shares(user_id,created_at DESC);
END $$;`;

/** Append to a CTE named changed returning code. The room CAS and durable
 * evidence insert are one SQL statement. Ownership comes from membership at
 * the deal, then remains pinned to the original evidence through withdrawal. */
export function recordsWriteCtes(parameter: number): string {
  return `, record_incoming AS (
    SELECT DISTINCT ON(value->>'handId',value->>'playerId') value
    FROM jsonb_array_elements($${parameter}::jsonb) WITH ORDINALITY event(value,ordinal)
    ORDER BY value->>'handId',value->>'playerId',ordinal DESC
  ), record_owners AS (
    SELECT changed.code, m.user_id, incoming.value
    FROM changed JOIN room_memberships m ON m.room_code=changed.code
    JOIN record_incoming incoming ON incoming.value->>'playerId'=m.player_id
    WHERE incoming.value->>'status'='started'
    UNION
    SELECT changed.code, e.user_id, incoming.value
    FROM changed JOIN records_evidence e ON e.room_code=changed.code
    JOIN record_incoming incoming ON incoming.value->>'handId'=e.hand_id
      AND incoming.value->>'gameId'=e.game_id AND incoming.value->>'playerId'=e.player_id
    WHERE incoming.value->>'status'<>'started'
  ), recorded AS (
    INSERT INTO records_evidence(user_id,hand_id,game_id,player_id,room_code,rule_id,status,source_event,started_at,updated_at,payload)
    SELECT user_id,value->>'handId',value->>'gameId',value->>'playerId',code,
      value->'evidence'->>'ruleId',value->>'status',value->>'eventId',
      (value->'evidence'->>'startedAt')::bigint,(value->>'at')::bigint,value->'evidence'
    FROM record_owners
    ON CONFLICT(user_id,hand_id) DO UPDATE SET status=EXCLUDED.status,source_event=EXCLUDED.source_event,
      updated_at=EXCLUDED.updated_at,payload=EXCLUDED.payload
    WHERE records_evidence.status='started'
    RETURNING user_id
  )`;
}

export const recordsTokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
export const validShareToken = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);
const newFriendCode = () => randomBytes(8).toString('hex').toUpperCase();
function deny(message = 'This record is not available.', status = 404): never { throw new SecurityError(message, status); }
const pair = (a: string, b: string) => [a,b].sort();
interface ProfileRow { user_id: string; display_name: string; friend_code: string; featured_badges: string[]; created_at: string | number }
export interface RecordsProfile { displayName: string; friendCode: string; featuredBadges: string[]; createdAt: number }
export interface FriendPreview { id: string; displayName: string; featuredBadges: string[] }
export interface RecordsFriends { accepted: FriendPreview[]; incoming: FriendPreview[]; outgoing: FriendPreview[]; blocked: FriendPreview[] }
interface FriendRow { id: string; first_user: string; second_user: string; requester_id: string; state: string }
export interface SharedRecord {
  displayName: string; headline: 'Beat my record'; ruleId: string; ruleName: string; ruleDescription: string;
  game: number; ruleNumber: number; openingTurn: number; firstLegalTurn: number | null;
  opportunitiesPassed: number; penalty: number; wentOut: boolean; finishedAt: number;
  conditions: { engineVersion: string; format: string; deal: string; playerCount: number; humanCount: number; seat: number; startingSeat: number; turnOrderSeat: number; ai: string[]; hints: boolean; timerSeconds: number };
  opening: { kind: string; cards: { rank: number; suit: Suit; asRank?: number; asSuit?: Suit }[] }[];
  badges: string[];
}
export interface SharePreview { id: string; handId: string; token: string; url: string; imageUrl: string; createdAt: number; expiresAt: number }
const publicShare = (row: {id:string; hand_id:string; token:string; created_at:string|number; expires_at:string|number}): SharePreview => ({
  id: row.id, handId: row.hand_id, token: row.token, url: `/records/shared/${row.token}`,
  imageUrl: `/api/records/share/${row.token}/image`, createdAt: Number(row.created_at), expiresAt: Number(row.expires_at),
});
export function publicConditions(c: RecordConditions): SharedRecord['conditions'] {
  const startingSeat=c.startingSeat??0;
  return {engineVersion:c.engineVersion,format:c.format,deal:c.deal,playerCount:c.playerCount,humanCount:c.humanCount,seat:c.seat,startingSeat,turnOrderSeat:(c.seat-startingSeat+c.playerCount)%c.playerCount,
    ai:c.roster.filter(p=>p.isBot).map(p=>p.difficulty),hints:c.hints,timerSeconds:c.timerSeconds};
}
/** Positive allow-list: a public share never serializes evidence wholesale. */
export function redactSharedRecord(e: RecordEvidence, displayName: string): SharedRecord {
  if (e.status !== 'completed' || !e.eligible || !e.completed || !e.actualOpening || e.finishedAt === null) deny('Choose a completed qualifying opening to share.',400);
  const rule = RULES[e.game][e.ruleNumber-1];
  return {displayName,headline:'Beat my record',ruleId:e.ruleId,ruleName:rule.title,ruleDescription:rule.description,
    game:e.game,ruleNumber:e.ruleNumber,openingTurn:e.actualOpening.turn,firstLegalTurn:e.firstLegal?.turn??null,
    opportunitiesPassed:e.opportunitiesPassed,penalty:e.penalty??0,wentOut:e.wentOut,finishedAt:e.finishedAt,
    conditions:publicConditions(e.conditions),opening:e.actualOpening.opening.map(m=>({kind:m.kind,cards:m.cards.map(c=>({rank:c.rank,suit:c.suit,...(c.asRank?{asRank:c.asRank}:{}),...(c.asSuit?{asSuit:c.asSuit}:{})}))})),
    badges:[...e.achievements]};
}

export class RecordsRepository {
  private ready: Promise<void> | null = null;
  private summaries = new Map<string,{watermark:string;value:RecordsAggregate}>();
  constructor(readonly db: SqlDatabase = database) {}
  async ensure(): Promise<void> {
    this.ready ??= this.db.query(RECORDS_SCHEMA).then(()=>{}).catch(error=>{this.ready=null;throw error;});
    return this.ready;
  }
  async profile(userId: string): Promise<RecordsProfile> {
    await this.ensure();
    await this.db.query('INSERT INTO records_profiles(user_id,friend_code,created_at,updated_at) VALUES($1,$2,$3,$3) ON CONFLICT(user_id) DO NOTHING',[userId,newFriendCode(),Date.now()]);
    const result=await this.db.query<ProfileRow>('SELECT user_id,display_name,friend_code,featured_badges,created_at FROM records_profiles WHERE user_id=$1',[userId]);
    const row=result.rows[0];
    return {displayName:row.display_name,friendCode:row.friend_code,featuredBadges:row.featured_badges,createdAt:Number(row.created_at)};
  }
  async allEvidence(userId: string): Promise<RecordEvidence[]> {
    await this.ensure();
    return (await this.db.query<{payload:RecordEvidence}>('SELECT payload FROM records_evidence WHERE user_id=$1 ORDER BY started_at,hand_id',[userId])).rows.map(r=>r.payload);
  }
  async aggregate(userId: string): Promise<RecordsAggregate> {
    await this.ensure();
    const result=await this.db.query<{latest:string|null;count:string;settled:string}>("SELECT max(updated_at)::text AS latest,count(*)::text AS count,count(*) FILTER(WHERE status<>'started')::text AS settled FROM records_evidence WHERE user_id=$1",[userId]);
    const watermark=`${result.rows[0].latest}:${result.rows[0].count}:${result.rows[0].settled}`;
    const cached=this.summaries.get(userId);
    if(cached?.watermark===watermark)return cached.value;
    const value=aggregateRecords(await this.allEvidence(userId));
    if(this.summaries.size>=128)this.summaries.clear();
    this.summaries.set(userId,{watermark,value});
    return value;
  }
  async history(userId: string, options: {cursor?:string;handId?:string;limit?:number} = {}) {
    await this.ensure();
    const limit=Math.max(1,Math.min(options.limit??25,50));
    let beforeTime=Number.MAX_SAFE_INTEGER,beforeId='~';
    if(options.cursor){
      try { const parsed=JSON.parse(Buffer.from(options.cursor,'base64url').toString('utf8')); if(!Array.isArray(parsed)||parsed.length!==2||!Number.isSafeInteger(parsed[0])||typeof parsed[1]!=='string'||parsed[1].length>200)throw new Error(); [beforeTime,beforeId]=parsed; }
      catch { deny('Invalid history page.',400); }
    }
    const result=await this.db.query<{payload:RecordEvidence}>(`SELECT payload FROM records_evidence WHERE user_id=$1 AND status<>'started'
      AND (started_at,hand_id)<($2::bigint,$3::text) AND ($4::text IS NULL OR hand_id=$4)
      ORDER BY started_at DESC,hand_id DESC LIMIT $5`,[userId,beforeTime,beforeId,options.handId??null,limit+1]);
    const rows=result.rows.slice(0,limit).map(r=>r.payload),last=rows.at(-1);
    return {history:rows,pagination:{nextCursor:result.rows.length>limit&&last?Buffer.from(JSON.stringify([last.startedAt,last.handId])).toString('base64url'):null}};
  }
  async updateProfile(userId: string, displayName: unknown, featuredBadges: unknown) {
    if(typeof displayName!=='string'||!Array.isArray(featuredBadges)||featuredBadges.length>3||featuredBadges.some(v=>typeof v!=='string'))deny('Choose a display name and up to three earned badges.',400);
    const name=(displayName as string).trim().replace(/[\u0000-\u001f\u007f<>]/g,'');
    if(name.length<2||name.length>24||name.includes('@')||/https?:|www\./i.test(name))deny('Use 2–24 characters without an email address or link.',400);
    const badges=[...new Set(featuredBadges as string[])];
    const summary=await this.aggregate(userId);
    if(badges.some(id=>!summary.achievements.some(a=>a.id===id&&a.count>0)))deny('Only earned badges belong on your profile.',400);
    await this.profile(userId);
    await this.db.query('UPDATE records_profiles SET display_name=$2,featured_badges=$3,updated_at=$4 WHERE user_id=$1',[userId,name,badges,Date.now()]);
    return this.profile(userId);
  }
  async rotateFriendCode(userId: string) {
    await this.profile(userId);
    await this.db.query('UPDATE records_profiles SET friend_code=$2,updated_at=$3 WHERE user_id=$1',[userId,newFriendCode(),Date.now()]);
    return this.profile(userId);
  }
  async friends(userId: string): Promise<RecordsFriends> {
    await this.ensure();
    const rows=await this.db.query<FriendRow & {display_name:string;featured_badges:string[]}>(`SELECT f.*,p.display_name,p.featured_badges FROM records_friendships f
      JOIN records_profiles p ON p.user_id=CASE WHEN f.first_user=$1 THEN f.second_user ELSE f.first_user END
      WHERE (f.first_user=$1 OR f.second_user=$1) AND NOT EXISTS(SELECT 1 FROM records_blocks b WHERE
      (b.blocker_id=f.first_user AND b.blocked_id=f.second_user) OR (b.blocker_id=f.second_user AND b.blocked_id=f.first_user)) ORDER BY f.created_at DESC LIMIT 200`,[userId]);
    const result:RecordsFriends={accepted:[],incoming:[],outgoing:[],blocked:[]};
    for(const row of rows.rows){const key=row.state==='accepted'?'accepted':row.requester_id===userId?'outgoing':'incoming'; result[key].push({id:row.id,displayName:row.display_name,featuredBadges:row.featured_badges});}
    result.blocked=(await this.db.query<{id:string;display_name:string}>(`SELECT b.id,p.display_name FROM records_blocks b JOIN records_profiles p ON p.user_id=b.blocked_id WHERE b.blocker_id=$1 ORDER BY b.created_at DESC LIMIT 200`,[userId])).rows.map(r=>({id:r.id,displayName:r.display_name,featuredBadges:[]}));
    return result;
  }
  async requestFriend(userId: string, code: unknown): Promise<void> {
    if(typeof code!=='string'||!/^[A-F0-9]{16}$/.test(code.trim().toUpperCase()))deny('Check the friend code.',400);
    await this.profile(userId);
    // Lock both profiles in a fixed order, shared by invitation and block writes.
    await this.db.transaction(async connection=>{
      const found=await connection.query<{user_id:string}>('SELECT user_id FROM records_profiles WHERE friend_code=$1',[String(code).trim().toUpperCase()]);
      const friend=found.rows[0]?.user_id;
      if(!friend||friend===userId)deny('This friend invitation is not available.',404);
      const [first,second]=pair(userId,friend);
      await connection.query('SELECT user_id FROM records_profiles WHERE user_id=ANY($1::text[]) ORDER BY user_id FOR UPDATE',[[first,second]]);
      const blocked=await connection.query('SELECT 1 FROM records_blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)',[first,second]);
      if(blocked.rows.length)deny('This friend invitation is not available.',404);
      const count=await connection.query<{count:string}>('SELECT count(*)::text AS count FROM records_friendships WHERE first_user=$1 OR second_user=$1',[userId]);
      if(Number(count.rows[0].count)>=200)deny('Remove an old invitation before adding another friend.',400);
      await connection.query(`INSERT INTO records_friendships(id,first_user,second_user,requester_id,state,created_at) VALUES($1,$2,$3,$4,'pending',$5) ON CONFLICT(first_user,second_user) DO NOTHING`,[randomUUID(),first,second,userId,Date.now()]);
    });
  }
  private async friendship(userId: string, id: string, accepted=false): Promise<FriendRow> {
    await this.ensure();
    const rows=await this.db.query<FriendRow>(`SELECT f.* FROM records_friendships f WHERE id=$1 AND (first_user=$2 OR second_user=$2)
      AND ($3::boolean=false OR state='accepted') AND NOT EXISTS(SELECT 1 FROM records_blocks b WHERE
      (b.blocker_id=f.first_user AND b.blocked_id=f.second_user) OR (b.blocker_id=f.second_user AND b.blocked_id=f.first_user))`,[id,userId,accepted]);
    return rows.rows[0]??deny('This friendship is not available.');
  }
  async friendAction(userId: string, action: string, friendId: string): Promise<void> {
    await this.ensure();
    if(action==='unblockFriend'){
      const result=await this.db.query('DELETE FROM records_blocks WHERE id=$1 AND blocker_id=$2 RETURNING id',[friendId,userId]);
      if(!result.rows.length)deny();return;
    }
    const relation=await this.friendship(userId,friendId);
    const friend=relation.first_user===userId?relation.second_user:relation.first_user;
    await this.db.transaction(async connection=>{
      await connection.query('SELECT user_id FROM records_profiles WHERE user_id=ANY($1::text[]) ORDER BY user_id FOR UPDATE',[pair(userId,friend)]);
      if(action==='blockFriend'){
        await connection.query('INSERT INTO records_blocks(id,blocker_id,blocked_id,created_at) VALUES($1,$2,$3,$4) ON CONFLICT(blocker_id,blocked_id) DO NOTHING',[randomUUID(),userId,friend,Date.now()]);
        await connection.query('DELETE FROM records_friendships WHERE id=$1',[friendId]);return;
      }
      if(action==='acceptFriend'){
        const accepted=await connection.query(`UPDATE records_friendships SET state='accepted' WHERE id=$1 AND state='pending' AND requester_id<>$2 AND (first_user=$2 OR second_user=$2)
          AND NOT EXISTS(SELECT 1 FROM records_blocks b WHERE (b.blocker_id=$2 AND b.blocked_id=$3) OR (b.blocker_id=$3 AND b.blocked_id=$2)) RETURNING id`,[friendId,userId,friend]);
        if(!accepted.rows.length)deny('This invitation is no longer available.');return;
      }
      if(action==='revokeFriend'||action==='unfriend'){
        const removed=await connection.query('DELETE FROM records_friendships WHERE id=$1 AND state=$2 AND (first_user=$3 OR second_user=$3) RETURNING id',[friendId,action==='unfriend'?'accepted':'pending',userId]);
        if(!removed.rows.length)deny('This friendship is no longer available.');return;
      }
      deny('Unknown friend action.',400);
    });
  }
  async comparison(userId: string, friendId: string) {
    const relation=await this.friendship(userId,friendId,true);
    const friendUser=relation.first_user===userId?relation.second_user:relation.first_user;
    const [mine,theirs,profile]=await Promise.all([this.allEvidence(userId),this.allEvidence(friendUser),this.profile(friendUser)]);
    const a=aggregateRecords(mine),b=aggregateRecords(theirs);
    const comparisons=a.rules.flatMap(rule=>rule.cohorts.flatMap(cohort=>{
      const matching=b.rules.find(r=>r.ruleId===rule.ruleId)?.cohorts.find(c=>c.cohortKey===cohort.cohortKey);
      if(!matching)return [];
      const stats=(c:typeof cohort)=>({attempts:c.attempts,completed:c.completed,abandoned:c.abandoned,successRate:c.successRate,medianOpeningTurn:c.medianOpeningTurn,bestOpeningTurn:c.best?.actualOpening?.turn??null,averagePenalty:c.averagePenalty,penaltySamples:c.penaltySamples});
      return [{ruleId:rule.ruleId,title:rule.title,cohortKey:cohort.cohortKey,conditions:publicConditions(cohort.conditions),you:stats(cohort),friend:stats(matching)}];
    }));
    const headToHead={hands:{played:0,you:0,friend:0,tied:0,neither:0},quickPlay:{played:0,you:0,friend:0,tied:0,neither:0},fullGames:{played:0,you:0,friend:0,tied:0,neither:0}};
    const finalMine=mine.filter(e=>e.status==='completed'&&e.eligible),finalTheirs=theirs.filter(e=>e.status==='completed'&&e.eligible);
    const countedGames=new Set<string>();
    for(const one of finalMine){
      const two=finalTheirs.find(e=>e.handId===one.handId&&e.gameId===one.gameId);
      if(!two)continue;
      headToHead.hands.played++;
      if(one.wentOut)headToHead.hands.you++;else if(two.wentOut)headToHead.hands.friend++;else headToHead.hands.neither++;
      if(one.conditions.format==='quick-play'){headToHead.quickPlay.played++;if(one.wentOut)headToHead.quickPlay.you++;else if(two.wentOut)headToHead.quickPlay.friend++;else headToHead.quickPlay.neither++;}
      if(one.conditions.format==='full-game'&&one.gameOutcome?.finished&&two.gameOutcome?.finished&&!countedGames.has(one.gameId)){
        countedGames.add(one.gameId);headToHead.fullGames.played++;
        const won=one.gameOutcome.winnerIds.includes(one.playerId),friendWon=two.gameOutcome.winnerIds.includes(two.playerId);
        if(won&&!friendWon)headToHead.fullGames.you++;else if(friendWon&&!won)headToHead.fullGames.friend++;else if(won&&friendWon)headToHead.fullGames.tied++;else headToHead.fullGames.neither++;
      }
    }
    const rematchHands=finalMine.filter(one=>finalTheirs.some(two=>two.handId===one.handId&&two.gameId===one.gameId))
      .sort((one,two)=>two.startedAt-one.startedAt).slice(0,30).map(one=>({handId:one.handId,game:one.game,ruleNumber:one.ruleNumber,startedAt:one.startedAt}));
    // Recheck permission after the reads, including concurrent block/unfriend.
    await this.friendship(userId,friendId,true);
    return {friend:{id:friendId,displayName:profile.displayName,featuredBadges:profile.featuredBadges},comparisons,headToHead,rematchHands};
  }
  async shares(userId: string): Promise<SharePreview[]> {
    await this.ensure();
    const rows=await this.db.query<{id:string;hand_id:string;token:string;created_at:string;expires_at:string}>('SELECT id,hand_id,token,created_at,expires_at FROM records_shares WHERE user_id=$1 AND expires_at>$2 ORDER BY created_at DESC LIMIT 100',[userId,Date.now()]);
    return rows.rows.map(publicShare);
  }
  async createShare(userId: string, handId: string): Promise<SharePreview> {
    const profile=await this.profile(userId);
    const found=await this.db.query<{payload:RecordEvidence}>('SELECT payload FROM records_evidence WHERE user_id=$1 AND hand_id=$2 AND status=\'completed\'',[userId,handId]);
    if(!found.rows.length)deny('Choose your own completed qualifying record.',400);
    const payload=redactSharedRecord(found.rows[0].payload,profile.displayName);
    const id=randomUUID(),token=randomBytes(32).toString('base64url'),now=Date.now(),expires=now+365*24*60*60*1000;
    await this.db.transaction(async connection=>{
      await connection.query('SELECT user_id FROM records_profiles WHERE user_id=$1 FOR UPDATE',[userId]);
      await connection.query('DELETE FROM records_shares WHERE user_id=$1 AND expires_at<=$2',[userId,now]);
      const count=await connection.query<{count:string}>('SELECT count(*)::text AS count FROM records_shares WHERE user_id=$1',[userId]);
      if(Number(count.rows[0].count)>=100)deny('Revoke an old share before adding another.',400);
      await connection.query('INSERT INTO records_shares(id,user_id,hand_id,token,token_hash,payload,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8)',[id,userId,handId,token,recordsTokenHash(token),JSON.stringify(payload),now,expires]);
    });
    return publicShare({id,hand_id:handId,token,created_at:now,expires_at:expires});
  }
  async revokeShare(userId: string, id: string) {
    await this.ensure();
    const result=await this.db.query('DELETE FROM records_shares WHERE id=$1 AND user_id=$2 RETURNING id',[id,userId]);
    if(!result.rows.length)deny();
  }
  async shared(token: string): Promise<SharedRecord|null> {
    if(!validShareToken(token))return null;
    await this.ensure();
    const result=await this.db.query<{payload:SharedRecord}>('SELECT payload FROM records_shares WHERE token_hash=$1 AND expires_at>$2',[recordsTokenHash(token),Date.now()]);
    return result.rows[0]?.payload??null;
  }
}
export const recordsRepository = new RecordsRepository();

/** Used only inside an already-open room transaction (initial quick-play deal). */
export function recordEventValues(events: RoomRecordEvent[]): string { return JSON.stringify(events); }
export { cohortKey };
