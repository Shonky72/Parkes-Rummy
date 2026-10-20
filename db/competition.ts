import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { database, type SqlConnection, type SqlDatabase } from './index';
import { SecurityError } from './security';
import { getEntitlements, getPlayerProfile } from './entitlements';
import { RecordsRepository, recordsRepository, publicConditions } from './records';
import { PostgresRoomRepository } from './room-repository';
import { createChallengeRoom, publicChallengeRoom, validateChallengeConfig, challengeVersionSupported, frozenChallengeRule, isChallengeRoom } from '../lib/challenge-engine/v1';
import { createPlayer, createRoom, applyAction, RULES, publicRoom } from '../lib/rummy';
import { ROOM_CODE_ALPHABET } from '../lib/room-code';
import { CHALLENGE_ENGINE_VERSION, type ChallengeConfig, type ChallengeScore, type DailyChallengeResult } from '../lib/competition-types';
import { challengePoints, compareChallengeScores, competitionCalendar, COMPETITION_POLICY, consistencyBoard, rankWithTies, ruleOfTheWeek, shiftCalendarDay, sydneyDayKey, sydneyMidnight, sydneyWeekKey, threeDealTotal, weeklyBestFive } from '../lib/competition';
import { cohortKey } from '../lib/records';
import type { RecordEvidence } from '../lib/records-types';
import type { Difficulty, GameType, RoomState } from '../lib/types';

export const COMPETITION_SCHEMA=`DO $$ BEGIN
CREATE TABLE IF NOT EXISTS competition_challenges (
 id text PRIMARY KEY, owner_id text REFERENCES "user"("id") ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('daily','rule-week','custom','duel')),
 day text, week text, config jsonb NOT NULL, token text NOT NULL UNIQUE, token_hash text NOT NULL UNIQUE,
 shared boolean NOT NULL DEFAULT false, revoked_at bigint, target jsonb, source_attempt_id text, created_at bigint NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS competition_daily_unique ON competition_challenges(day) WHERE kind='daily';
CREATE UNIQUE INDEX IF NOT EXISTS competition_rule_week_unique ON competition_challenges(week) WHERE kind='rule-week';
CREATE INDEX IF NOT EXISTS competition_challenge_owner ON competition_challenges(owner_id,created_at DESC);
CREATE TABLE IF NOT EXISTS competition_invitations (
 id text PRIMARY KEY, challenge_id text NOT NULL REFERENCES competition_challenges(id) ON DELETE CASCADE,
 owner_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 token text NOT NULL UNIQUE, token_hash text NOT NULL UNIQUE, target jsonb NOT NULL,
 source_attempt_id text NOT NULL, created_at bigint NOT NULL, revoked_at bigint);
CREATE INDEX IF NOT EXISTS competition_invitation_owner ON competition_invitations(owner_id,created_at DESC);
CREATE TABLE IF NOT EXISTS competition_attempts (
 id text PRIMARY KEY, challenge_id text NOT NULL REFERENCES competition_challenges(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 room_code text NOT NULL UNIQUE, player_id text NOT NULL, hand_id text NOT NULL,
 scored boolean NOT NULL, status text NOT NULL CHECK(status IN ('active','completed','abandoned','service-interrupted')),
 score jsonb, daily_day text, source_token text, created_at bigint NOT NULL, deadline_at bigint NOT NULL, finished_at bigint);
ALTER TABLE competition_attempts ADD COLUMN IF NOT EXISTS source_token text;
CREATE UNIQUE INDEX IF NOT EXISTS competition_first_attempt ON competition_attempts(challenge_id,user_id) WHERE scored=true;
CREATE UNIQUE INDEX IF NOT EXISTS competition_active_practice ON competition_attempts(challenge_id,user_id) WHERE scored=false AND status='active';
CREATE INDEX IF NOT EXISTS competition_attempt_owner ON competition_attempts(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS competition_attempt_deadline ON competition_attempts(status,deadline_at);
CREATE TABLE IF NOT EXISTS competition_clubs (
 id text PRIMARY KEY, owner_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 name text NOT NULL, code text NOT NULL UNIQUE, created_at bigint NOT NULL);
CREATE TABLE IF NOT EXISTS competition_memberships (
 id text PRIMARY KEY, club_id text NOT NULL REFERENCES competition_clubs(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 role text NOT NULL CHECK(role IN ('owner','member')), status text NOT NULL CHECK(status IN ('pending','member','blocked')),
 requested_at bigint NOT NULL, joined_at bigint, UNIQUE(club_id,user_id));
CREATE INDEX IF NOT EXISTS competition_membership_user ON competition_memberships(user_id,status);
CREATE TABLE IF NOT EXISTS competition_club_weeks (
 club_id text NOT NULL REFERENCES competition_clubs(id) ON DELETE CASCADE,
 week text NOT NULL, published_at bigint NOT NULL, PRIMARY KEY(club_id,week));
CREATE TABLE IF NOT EXISTS competition_trophies (
 club_id text NOT NULL REFERENCES competition_clubs(id) ON DELETE CASCADE, week text NOT NULL,
 user_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE, points bigint NOT NULL, attempts integer NOT NULL,
 PRIMARY KEY(club_id,week,user_id));
CREATE TABLE IF NOT EXISTS competition_duels (
 id text PRIMARY KEY, creator_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 opponent_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE, friend_id text NOT NULL,
 token text NOT NULL UNIQUE, token_hash text NOT NULL UNIQUE, challenge_ids text[] NOT NULL,
 status text NOT NULL CHECK(status IN ('pending','accepted','revoked')), created_at bigint NOT NULL,
 CHECK(creator_id<>opponent_id), CHECK(array_length(challenge_ids,1)=3));
CREATE INDEX IF NOT EXISTS competition_duels_opponent ON competition_duels(opponent_id,status);
CREATE TABLE IF NOT EXISTS competition_rematches (
 id text PRIMARY KEY, creator_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 opponent_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE, friend_id text NOT NULL,
 source_hand_id text NOT NULL, game integer NOT NULL, token text NOT NULL UNIQUE, token_hash text NOT NULL UNIQUE,
 status text NOT NULL CHECK(status IN ('pending','accepted','revoked')), room_code text, created_at bigint NOT NULL,
 CHECK(creator_id<>opponent_id));
CREATE INDEX IF NOT EXISTS competition_rematches_opponent ON competition_rematches(opponent_id,status);
END $$;`;

type ChallengeKind='daily'|'rule-week'|'custom'|'duel';
type ChallengeRow={id:string;owner_id:string|null;kind:ChallengeKind;day:string|null;week:string|null;config:ChallengeConfig;token:string;shared:boolean;revoked_at:string|number|null;target:ChallengeScore|null;created_at:string|number;invitationId?:string;baseKind?:ChallengeKind};
type AttemptRow={id:string;challenge_id:string;user_id:string;room_code:string;player_id:string;hand_id:string;scored:boolean;status:'active'|'completed'|'abandoned'|'service-interrupted';score:ChallengeScore|null;source_token?:string|null;created_at:string|number;deadline_at:string|number;finished_at:string|number|null};
type ClubMember={id:string;club_id:string;user_id:string;role:'owner'|'member';status:'pending'|'member'|'blocked';joined_at:string|number|null;display_name?:string};
type DuelRow={id:string;creator_id:string;opponent_id:string;friend_id:string;token:string;challenge_ids:[string,string,string];status:'pending'|'accepted'|'revoked';created_at:string|number};
type RematchRow={id:string;creator_id:string;opponent_id:string;friend_id:string;token:string;source_hand_id:string;game:GameType;status:'pending'|'accepted'|'revoked';room_code:string|null;created_at:string|number};
type ClubEvidence=Pick<RecordEvidence,'game'|'ruleNumber'|'ruleId'|'startedAt'|'status'|'eligible'|'conditions'|'completed'|'penalty'>&{actualOpening:{turn:number}|null};
export interface ChallengeDescriptor {
  id:string;challengeId:string;token:string;kind:ChallengeKind;title:string;description:string;game:GameType;ruleNumber:number;
  engineVersion:string;difficulties:Difficulty[];humanSeat:number;startingSeat:number;showMoveHints:boolean;
  day:string|null;week:string|null;target:ChallengeScore|null;targetPoints:number|null;shared:boolean;owner:boolean;
  hostName:string;publicUrl:string;firstAttemptAvailable:boolean;deadlineAt:number|null;
}
export interface AttemptPreview {
  id:string;challengeId:string;title:string;token:string;roomCode:string;handId:string;
  scored:boolean;practice:boolean;status:AttemptRow['status'];score:ChallengeScore|null;points:number|null;
  createdAt:number;deadlineAt:number;finishedAt:number|null;
}
const token=()=>randomBytes(32).toString('base64url');
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const code=()=>randomBytes(8).toString('hex').toUpperCase();
const roomCode=()=>Array.from({length:4},()=>ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)]).join('');
function fail(message='This competition is not available.',status=404):never {throw new SecurityError(message,status);}
function label(value:unknown,maximum=32):string {
  if(typeof value!=='string')fail('Choose a name.',400);
  const result=value.trim().replace(/[\u0000-\u001f\u007f<>]/g,'');
  if(result.length<2||result.length>maximum||result.includes('@')||/https?:|www\./i.test(result))fail(`Use a name of 2–${maximum} characters without an email address or link.`,400);
  return result;
}
function clientDatabase(connection:SqlConnection):SqlDatabase {return {...connection,transaction:work=>work(connection)};}
function ownsAttemptRoom(room:RoomState,attempt:AttemptRow):boolean {
  return isChallengeRoom(room)&&room.challenge.attemptId===attempt.id&&room.challenge.config.id===attempt.challenge_id
    &&room.challenge.humanPlayerId===attempt.player_id&&room.records?.handId===attempt.hand_id;
}
function endOfDailyGrace(day:string):number {return sydneyMidnight(shiftCalendarDay(day,1))+2*60*60*1000;}
export const COMPETITION_SERVICE_POLICY={...COMPETITION_POLICY,
  deadlines:'Start a daily scored attempt on its Sydney date and finish before 02:00 the following day. Other attempts have a seven-day reconnect window. Expired attempts count as withdrawals.',
  trophies:'Weekly trophies settle after 02:00 Monday in Sydney. Current standings remain provisional until the week closes.',
  originalRules:'An entitled host shares access to this specific Original Rules challenge. Friends receive no general Original Rules purchase or permission to create new Original challenges.',
  privacy:'Club members consent to chosen names, challenge standings and opening contributions being visible to their club. Public challenge links are explicit and revocable. No Google email, private hand, seed or future deck is published.',
};
export function scoreFromEvidence(e:RecordEvidence):ChallengeScore {
  if(e.status==='started')fail('This attempt is still in progress.',409);
  const completed=!!e.actualOpening&&e.completed;
  const result:ChallengeScore={completed,openingTurn:completed?e.actualOpening!.turn:null,wentOut:completed&&e.wentOut,
    closingTurns:completed&&e.wentOut?e.closingTurns:null,penalty:e.penalty??(e.status==='service-interrupted'?0:220),outcome:e.status};
  challengePoints(result);return result;
}
export class CompetitionRepository {
  private ready:Promise<void>|null=null;
  readonly records:RecordsRepository;
  readonly rooms:PostgresRoomRepository;
  private readonly now:()=>number;
  private readonly entitled:(userId:string)=>Promise<boolean>;
  private readonly styles:typeof getPlayerProfile;
  constructor(readonly db:SqlDatabase=database,options:{records?:RecordsRepository;now?:()=>number;entitled?:(userId:string)=>Promise<boolean>;styles?:typeof getPlayerProfile}={}) {
    this.records=options.records??(db===database?recordsRepository:new RecordsRepository(db));this.rooms=new PostgresRoomRepository(db);
    this.now=options.now??Date.now;this.entitled=options.entitled??(async id=>(await getEntitlements(id)).originalRules);
    this.styles=options.styles??getPlayerProfile;
  }
  async ensure():Promise<void> {
    this.ready??=(async()=>{await this.records.ensure();await this.db.query(COMPETITION_SCHEMA);})().catch(error=>{this.ready=null;throw error;});
    return this.ready;
  }
  private configuration(id:string,game:GameType,ruleNumber:number,overrides:Partial<ChallengeConfig>={}):ChallengeConfig {
    return validateChallengeConfig({id,engineVersion:CHALLENGE_ENGINE_VERSION,seed:randomBytes(32).toString('hex'),game,ruleNumber,humanSeat:0,startingSeat:0,difficulties:['easy','medium'],showMoveHints:false,...overrides});
  }
  private async insertChallenge(connection:SqlConnection,config:ChallengeConfig,owner:string|null,kind:ChallengeKind,day:string|null=null,week:string|null=null,shared=false):Promise<ChallengeRow> {
    const invitation=token(),now=this.now();
    const rows=await connection.query<ChallengeRow>(`INSERT INTO competition_challenges(id,owner_id,kind,day,week,config,token,token_hash,shared,created_at)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10) ON CONFLICT(id) DO NOTHING RETURNING *`,[config.id,owner,kind,day,week,JSON.stringify(config),invitation,digest(invitation),shared,now]);
    return rows.rows[0]??(await connection.query<ChallengeRow>('SELECT * FROM competition_challenges WHERE id=$1',[config.id])).rows[0];
  }
  async publishCalendar() {
    await this.ensure();const now=this.now(),calendar=competitionCalendar(now),weekly=ruleOfTheWeek(now);
    const index=createHash('sha256').update(`parkes-daily-v1:${calendar.day}`).digest().readUInt32BE(0)%30;
    const daily=await this.insertChallenge(this.db,this.configuration(`daily:${calendar.day}`,(1+Math.floor(index/10)) as GameType,1+index%10),null,'daily',calendar.day,calendar.week,true);
    const ruleWeek=await this.insertChallenge(this.db,this.configuration(`rule-week:${calendar.week}`,weekly.game,weekly.ruleNumber),null,'rule-week',null,calendar.week,true);
    return {calendar,daily,ruleWeek};
  }
  private async activeFriend(userId:string,friendId:string,connection:SqlConnection=this.db):Promise<string> {
    const rows=await connection.query<{first_user:string;second_user:string}>(`SELECT f.first_user,f.second_user FROM records_friendships f WHERE f.id=$1 AND f.state='accepted'
      AND (f.first_user=$2 OR f.second_user=$2) AND NOT EXISTS(SELECT 1 FROM records_blocks b WHERE
      (b.blocker_id=f.first_user AND b.blocked_id=f.second_user) OR (b.blocker_id=f.second_user AND b.blocked_id=f.first_user))`,[friendId,userId]);
    const row=rows.rows[0];if(!row)fail('An accepted friendship is required.',403);return row.first_user===userId?row.second_user:row.first_user;
  }
  private async challengeByToken(invitation:string,userId:string|null,connection:SqlConnection=this.db):Promise<ChallengeRow> {
    if(!/^[A-Za-z0-9_-]{43}$/.test(invitation))fail();
    const rows=await connection.query<ChallengeRow>('SELECT * FROM competition_challenges WHERE token_hash=$1 AND revoked_at IS NULL',[digest(invitation)]);
    let row=rows.rows[0];
    if(!row){
      const invites=await connection.query<ChallengeRow & {invite_id:string;invite_owner:string;invite_token:string;invite_target:ChallengeScore}>(`SELECT c.*,i.id AS invite_id,i.owner_id AS invite_owner,i.token AS invite_token,i.target AS invite_target
        FROM competition_invitations i JOIN competition_challenges c ON c.id=i.challenge_id
        WHERE i.token_hash=$1 AND i.revoked_at IS NULL AND c.revoked_at IS NULL`,[digest(invitation)]);
      const found=invites.rows[0];if(!found)fail();
      row={...found,invitationId:found.invite_id,baseKind:found.kind,kind:'custom',owner_id:found.invite_owner,token:found.invite_token,target:found.invite_target,shared:true};
    }
    if(row.kind==='duel'){
      if(!userId)fail('Sign in to open your private duel.',401);
      const duel=await connection.query<DuelRow>(`SELECT * FROM competition_duels WHERE $1=ANY(challenge_ids) AND status='accepted' AND (creator_id=$2 OR opponent_id=$2)`,[row.id,userId]);
      if(!duel.rows.length)fail('Accept your duel invitation first.',403);
      await this.activeFriend(userId,duel.rows[0].friend_id,connection);
    }else if(!row.shared&&row.owner_id!==userId)fail();
    if(!challengeVersionSupported(row.config.engineVersion))fail('This frozen challenge version is unavailable. The original deal has not changed.',503);
    return row;
  }
  private async originalAccess(row:ChallengeRow,userId:string):Promise<void> {
    if(row.config.game!==4)return;
    if(await this.entitled(userId))return;
    if(row.shared&&row.owner_id&&await this.entitled(row.owner_id))return;
    fail('Original Rules access from you or this challenge’s entitled host is required.',403);
  }
  private async descriptor(row:ChallengeRow,userId:string|null):Promise<ChallengeDescriptor> {
    const rule=frozenChallengeRule(row.config);
    const first=userId?(await this.db.query('SELECT id FROM competition_attempts WHERE challenge_id=$1 AND user_id=$2 AND scored=true LIMIT 1',[row.id,userId])).rows.length>0:false;
    const host=row.owner_id?(await this.db.query<{display_name:string}>('SELECT display_name FROM records_profiles WHERE user_id=$1',[row.owner_id])).rows[0]?.display_name??'Player':'Parkes Rummy';
    return {id:row.invitationId??row.id,challengeId:row.id,token:row.token,kind:row.kind,title:rule.title,description:rule.description,game:row.config.game,ruleNumber:row.config.ruleNumber,
      engineVersion:row.config.engineVersion,difficulties:[...row.config.difficulties],humanSeat:row.config.humanSeat,startingSeat:row.config.startingSeat,showMoveHints:row.config.showMoveHints,
      day:row.day,week:row.week,target:row.target,targetPoints:row.target?challengePoints(row.target):null,shared:row.shared,owner:!!userId&&row.owner_id===userId,hostName:host,
      publicUrl:`/challenge/${row.token}`,firstAttemptAvailable:!first&&(row.kind!=='daily'||row.day===sydneyDayKey(this.now())),deadlineAt:row.kind==='daily'&&row.day?endOfDailyGrace(row.day):null};
  }
  async challenge(invitation:string,userId:string|null) {await this.ensure();const row=await this.challengeByToken(invitation,userId);return this.descriptor(row,userId);}
  async createChallenge(userId:string,input:Record<string,unknown>) {
    await this.ensure();await this.records.profile(userId);
    const game=Number(input.game),ruleNumber=Number(input.ruleNumber);
    if(game===4&&!await this.entitled(userId))fail('Original Rules access is required to host a new Original challenge.',403);
    const config=this.configuration(randomUUID(),game as GameType,ruleNumber,{
      ...(Array.isArray(input.difficulties)?{difficulties:input.difficulties as Difficulty[]}:{}),
      ...(input.humanSeat!==undefined?{humanSeat:Number(input.humanSeat)}:{}),...(input.startingSeat!==undefined?{startingSeat:Number(input.startingSeat)}:{}),
      ...(input.showMoveHints!==undefined?{showMoveHints:input.showMoveHints as boolean}:{}),
    });
    const row=await this.db.transaction(async connection=>{
      await connection.query('SELECT user_id FROM records_profiles WHERE user_id=$1 FOR UPDATE',[userId]);
      const count=await connection.query<{count:string}>('SELECT count(*)::text AS count FROM competition_challenges WHERE owner_id=$1 AND created_at>$2',[userId,this.now()-86400000]);
      if(Number(count.rows[0].count)>=20)fail('Twenty hosted challenges per day is the limit.',429);
      return this.insertChallenge(connection,config,userId,'custom');
    });
    return this.descriptor(row,userId);
  }
  private previewAttempt(row:AttemptRow,challenge:ChallengeRow):AttemptPreview {
    return {id:row.id,challengeId:row.challenge_id,title:frozenChallengeRule(challenge.config).title,token:row.source_token??challenge.token,roomCode:row.room_code,handId:row.hand_id,
      scored:row.scored,practice:!row.scored,status:row.status,score:row.score,points:row.score?challengePoints(row.score):null,createdAt:Number(row.created_at),deadlineAt:Number(row.deadline_at),finishedAt:row.finished_at===null?null:Number(row.finished_at)};
  }
  async settle(userIds:string[]):Promise<void> {
    await this.ensure();if(!userIds.length)return;
    const expired=await this.db.query<AttemptRow>("SELECT * FROM competition_attempts WHERE user_id=ANY($1::text[]) AND status='active' AND deadline_at<=$2 ORDER BY deadline_at LIMIT 100",[userIds,this.now()]);
    for(const attempt of expired.rows){
      const room=await this.rooms.load(attempt.room_code);
      if(room&&ownsAttemptRoom(room.room,attempt)&&room.room.status==='playing')await this.rooms.delete(attempt.room_code,room.version);
    }
    const completed=await this.db.query<AttemptRow & {evidence:RecordEvidence}>(`SELECT a.*,e.payload AS evidence FROM competition_attempts a JOIN records_evidence e
      ON e.user_id=a.user_id AND e.hand_id=a.hand_id AND e.player_id=a.player_id AND e.room_code=a.room_code
      WHERE a.user_id=ANY($1::text[]) AND a.status='active' AND e.status<>'started'`,[userIds]);
    for(const attempt of completed.rows){
      const score=scoreFromEvidence(attempt.evidence);
      // Historical/older clients never turn a post-deadline completion into a scored result.
      if(attempt.evidence.finishedAt!==null&&attempt.evidence.finishedAt>Number(attempt.deadline_at)&&score.outcome==='completed')score.outcome='abandoned';
      await this.db.query("UPDATE competition_attempts SET status=$2,score=$3::jsonb,finished_at=$4 WHERE id=$1 AND status='active'",[attempt.id,score.outcome,JSON.stringify(score),attempt.evidence.finishedAt??this.now()]);
    }
    // Losing a room without its durable end record is a service failure, not a
    // permission to charge a guessed loss or issue another ranked first try.
    await this.db.query(`WITH lost AS (UPDATE competition_attempts a SET status='service-interrupted',finished_at=$2,score=$3::jsonb
      WHERE a.user_id=ANY($1::text[]) AND a.status='active' AND NOT EXISTS(SELECT 1 FROM rooms r WHERE r.code=a.room_code
        AND r.state::jsonb->'challenge'->>'attemptId'=a.id AND r.state::jsonb->'challenge'->'config'->>'id'=a.challenge_id
        AND r.state::jsonb->'challenge'->>'humanPlayerId'=a.player_id AND r.state::jsonb->'records'->>'handId'=a.hand_id)
      AND NOT EXISTS(SELECT 1 FROM records_evidence e WHERE e.user_id=a.user_id AND e.hand_id=a.hand_id AND e.status<>'started')
      RETURNING id,user_id,hand_id,player_id,room_code), closed AS (
      UPDATE records_evidence e SET status='service-interrupted',updated_at=$2,
        payload=payload || jsonb_build_object('status','service-interrupted','finishedAt',$2::bigint,'eligible',false,
          'exclusionReason','challenge table unavailable','achievements','[]'::jsonb)
      FROM lost WHERE e.user_id=lost.user_id AND e.hand_id=lost.hand_id AND e.player_id=lost.player_id AND e.room_code=lost.room_code AND e.status='started'
      RETURNING e.hand_id) SELECT id FROM lost`,
    [userIds,this.now(),JSON.stringify({completed:false,openingTurn:null,wentOut:false,closingTurns:null,penalty:0,outcome:'service-interrupted'})]);
  }
  /** A reservation owns exactly one table. Link revocation and a later store
   * entitlement change do not remove that already granted account-bound seat. */
  async resumeAttempt(userId:string,attemptId:string) {
    await this.ensure();await this.settle([userId]);
    const row=(await this.db.query<AttemptRow & {challenge:ChallengeRow;room_state:string|null}>(`SELECT a.*,row_to_json(c) AS challenge,r.state AS room_state
      FROM competition_attempts a JOIN competition_challenges c ON c.id=a.challenge_id LEFT JOIN rooms r ON r.code=a.room_code
      WHERE a.id=$1 AND a.user_id=$2`,[attemptId,userId])).rows[0];
    if(!row)fail('This saved attempt is not available.');
    const room=row.room_state?JSON.parse(row.room_state) as RoomState:null;
    return {roomCode:row.room_code,room:room&&row.status==='active'&&ownsAttemptRoom(room,row)?publicChallengeRoom(room,row.player_id):null,
      attempt:this.previewAttempt(row,row.challenge),resumed:true};
  }
  async reserveAttempt(userId:string,invitation:string,practice=false) {
    await this.ensure();await this.settle([userId]);
    const selected=await this.challengeByToken(invitation,userId);
    // Resolve store access outside the reservation transaction. Existing seats
    // return before enforcing this grant; creating a new room enforces it below.
    const access=await this.originalAccess(selected,userId).then(()=>null,error=>error);
    const [profile,style]=await Promise.all([this.records.profile(userId),this.styles(userId)]);
    return this.db.transaction(async connection=>{
      await connection.query('SELECT id FROM competition_challenges WHERE id=$1 FOR UPDATE',[selected.id]);
      const challenge=await this.challengeByToken(invitation,userId,connection);
      const first=(await connection.query<AttemptRow>('SELECT * FROM competition_attempts WHERE challenge_id=$1 AND user_id=$2 AND scored=true FOR UPDATE',[challenge.id,userId])).rows[0];
      if(practice&&(!first||first.status==='active'))fail('Finish or withdraw from your first scored attempt before opening a practice replay.',409);
      const prior=practice?(await connection.query<AttemptRow>("SELECT * FROM competition_attempts WHERE challenge_id=$1 AND user_id=$2 AND scored=false AND status='active' FOR UPDATE",[challenge.id,userId])).rows[0]:first;
      if(prior){
        const saved=(await connection.query<{state:string}>('SELECT state FROM rooms WHERE code=$1',[prior.room_code])).rows[0],room=saved?JSON.parse(saved.state) as RoomState:null;
        return {roomCode:prior.room_code,room:room&&prior.status==='active'&&ownsAttemptRoom(room,prior)?publicChallengeRoom(room,prior.player_id):null,attempt:this.previewAttempt(prior,challenge),resumed:true};
      }
      if(access)throw access;
      if(!practice&&challenge.kind==='daily'&&challenge.day!==sydneyDayKey(this.now()))fail('This daily deal is closed. A completed first attempt is required before a practice replay.',409);
      const now=this.now(),dailyDay=(challenge.kind==='daily'||challenge.baseKind==='daily')&&challenge.day===sydneyDayKey(now)?challenge.day:null;
      const deadline=!practice&&dailyDay?endOfDailyGrace(dailyDay):now+7*86400000;
      const id=randomUUID(),player=createPlayer({id:randomUUID(),name:profile.displayName,color:0,tokenHash:digest(randomBytes(32).toString('hex')),fontId:style.font,symbolId:style.symbol});
      const repo=new PostgresRoomRepository(clientDatabase(connection));
      if(!await repo.consumeCreationLimit(`competition:${userId}`,now))fail('Please wait before creating another attempt.',429);
      for(let tries=0;tries<12;tries++){
        const room=createChallengeRoom(challenge.config,roomCode(),player,{practice,attemptId:id,now,deadlineAt:deadline});
        if(!await repo.insert(room,{userId,playerId:player.id}))continue;
        const inserted=await connection.query<AttemptRow>(`INSERT INTO competition_attempts(id,challenge_id,user_id,room_code,player_id,hand_id,scored,status,created_at,deadline_at,daily_day,source_token)
          VALUES($1,$2,$3,$4,$5,$6,$7,'active',$8,$9,$10,$11) RETURNING *`,[id,challenge.id,userId,room.code,player.id,room.records!.handId,!practice,now,deadline,practice?null:dailyDay,invitation]);
        return {roomCode:room.code,room:publicChallengeRoom(room,player.id),attempt:this.previewAttempt(inserted.rows[0],challenge),resumed:false};
      }
      fail('A new table was not available. Please try again.',503);
    });
  }
  async withdrawAttempt(userId:string,attemptId:string) {
    await this.ensure();const attempt=(await this.db.query<AttemptRow>('SELECT * FROM competition_attempts WHERE id=$1 AND user_id=$2',[attemptId,userId])).rows[0];
    if(!attempt)fail();
    if(attempt.status==='active'){
      const current=await this.rooms.load(attempt.room_code);
      if(current&&ownsAttemptRoom(current.room,attempt)&&!await this.rooms.delete(attempt.room_code,current.version))fail('Your hand changed. Refresh before withdrawing.',409);
      await this.settle([userId]);
    }
  }
  async shareChallenge(userId:string,attemptId:string) {
    await this.ensure();await this.settle([userId]);
    const result=await this.db.query<ChallengeRow & {attempt_score:ChallengeScore}>(`SELECT c.*,a.score AS attempt_score FROM competition_attempts a JOIN competition_challenges c ON c.id=a.challenge_id
      JOIN records_evidence e ON e.user_id=a.user_id AND e.hand_id=a.hand_id WHERE a.id=$1 AND a.user_id=$2 AND a.scored=true
      AND a.status='completed' AND e.status='completed' AND (e.payload->>'eligible')::boolean=true AND c.revoked_at IS NULL`,[attemptId,userId]);
    const source=result.rows[0];if(!source)fail('Choose your completed first scored AI challenge.',400);
    if(source.config.game===4&&!await this.entitled(userId))fail('Original Rules access is required to host a shared Original challenge.',403);
    const invitation=token(),id=randomUUID();
    await this.db.transaction(async connection=>{
      await connection.query('SELECT user_id FROM records_profiles WHERE user_id=$1 FOR UPDATE',[userId]);
      const count=await connection.query<{count:string}>('SELECT count(*)::text AS count FROM competition_invitations WHERE owner_id=$1 AND revoked_at IS NULL',[userId]);
      if(Number(count.rows[0].count)>=100)fail('Revoke an old challenge link before sharing another.',400);
      await connection.query('INSERT INTO competition_invitations(id,challenge_id,owner_id,token,token_hash,target,source_attempt_id,created_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8)',[id,source.id,userId,invitation,digest(invitation),JSON.stringify(source.attempt_score),attemptId,this.now()]);
    });
    return this.descriptor({...source,invitationId:id,baseKind:source.kind,kind:'custom',owner_id:userId,token:invitation,shared:true,target:source.attempt_score},userId);
  }
  async revokeChallenge(userId:string,challengeId:string) {
    await this.ensure();
    const invitation=await this.db.query('UPDATE competition_invitations SET revoked_at=$3 WHERE id=$1 AND owner_id=$2 AND revoked_at IS NULL RETURNING id',[challengeId,userId,this.now()]);
    if(invitation.rows.length)return;
    const result=await this.db.query("UPDATE competition_challenges SET revoked_at=$3,shared=false WHERE id=$1 AND owner_id=$2 AND kind='custom' AND revoked_at IS NULL RETURNING id",[challengeId,userId,this.now()]);
    if(!result.rows.length)fail();
  }
  private async dailyResults(userIds:string[],week?:string,connection:SqlConnection=this.db):Promise<(DailyChallengeResult & {reservedAt:number})[]> {
    if(!userIds.length)return [];
    const rows=await connection.query<{challenge_id:string;day:string;user_id:string;score:ChallengeScore;scored:boolean;created_at:string}>(`SELECT a.challenge_id,c.day,a.user_id,a.score,a.scored,a.created_at FROM competition_attempts a JOIN competition_challenges c ON c.id=a.challenge_id
      WHERE a.user_id=ANY($1::text[]) AND a.scored=true AND a.score IS NOT NULL AND c.kind='daily' AND a.daily_day=c.day AND ($2::text IS NULL OR c.week=$2)`,[userIds,week??null]);
    return rows.rows.map(r=>({challengeId:r.challenge_id,day:r.day,accountId:r.user_id,score:r.score,firstAttempt:true,reservedAt:Number(r.created_at)}));
  }
  private async standings(userIds:string[],week:string,membershipIds:Map<string,string>,joinedAt:Map<string,number>=new Map(),connection:SqlConnection=this.db) {
    const rows=await this.dailyResults(userIds,week,connection);
    const names=await connection.query<{user_id:string;display_name:string}>('SELECT user_id,display_name FROM records_profiles WHERE user_id=ANY($1::text[])',[userIds]);
    return rankWithTies(names.rows.map(p=>({memberId:membershipIds.get(p.user_id)??'you',displayName:p.display_name,...weeklyBestFive(rows.filter(r=>r.accountId===p.user_id&&r.reservedAt>=(joinedAt.get(p.user_id)??0)),week)})).filter(r=>r.attempts>0||r.serviceInterrupted>0),(a,b)=>b.points-a.points);
  }
  private async clubPermission(userId:string,clubId:string,owner=false,connection:SqlConnection=this.db):Promise<ClubMember> {
    const row=(await connection.query<ClubMember>("SELECT * FROM competition_memberships WHERE club_id=$1 AND user_id=$2 AND status='member'",[clubId,userId])).rows[0];
    if(!row||owner&&row.role!=='owner')fail(owner?'Only the club owner manages membership.':'Join this private club before viewing its board.',403);
    return row;
  }
  async createClub(userId:string,name:unknown) {
    await this.ensure();await this.records.profile(userId);const chosen=label(name);
    return this.db.transaction(async connection=>{
      await connection.query('SELECT user_id FROM records_profiles WHERE user_id=$1 FOR UPDATE',[userId]);
      const count=await connection.query<{count:string}>('SELECT count(*)::text AS count FROM competition_clubs WHERE owner_id=$1',[userId]);
      if(Number(count.rows[0].count)>=5)fail('Five owned clubs is the limit.',400);
      const id=randomUUID(),inviteCode=code(),now=this.now();
      await connection.query('INSERT INTO competition_clubs(id,owner_id,name,code,created_at) VALUES($1,$2,$3,$4,$5)',[id,userId,chosen,inviteCode,now]);
      await connection.query("INSERT INTO competition_memberships(id,club_id,user_id,role,status,requested_at,joined_at) VALUES($1,$2,$3,'owner','member',$4,$4)",[randomUUID(),id,userId,now]);
      return {id,name:chosen,code:inviteCode,role:'owner' as const,status:'member' as const};
    });
  }
  async requestClub(userId:string,invitation:string) {
    await this.ensure();await this.records.profile(userId);
    if(!/^[A-Fa-f0-9]{16}$/.test(invitation))fail('Check the club invitation code.',400);
    return this.db.transaction(async connection=>{
      const club=(await connection.query<{id:string;name:string}>('SELECT id,name FROM competition_clubs WHERE code=$1 FOR UPDATE',[invitation.toUpperCase()])).rows[0];
      if(!club)fail('This club invitation is not available.');
      const existing=(await connection.query<ClubMember>('SELECT * FROM competition_memberships WHERE club_id=$1 AND user_id=$2',[club.id,userId])).rows[0];
      if(existing?.status==='blocked')fail('This club invitation is not available.');
      const count=await connection.query<{count:string}>('SELECT count(*)::text AS count FROM competition_memberships WHERE user_id=$1',[userId]);
      if(!existing&&Number(count.rows[0].count)>=20)fail('Leave an old club before joining another.',400);
      if(!existing)await connection.query("INSERT INTO competition_memberships(id,club_id,user_id,role,status,requested_at) VALUES($1,$2,$3,'member','pending',$4)",[randomUUID(),club.id,userId,this.now()]);
      return {id:club.id,name:club.name,status:existing?.status??'pending'};
    });
  }
  async clubAction(userId:string,action:string,clubId:string,memberId?:string) {
    await this.ensure();
    const changesConsent=['leaveClub','removeMember','blockMember','transferClub','deleteClub'].includes(action);
    if(changesConsent){
      if(action==='leaveClub'){
        const member=(await this.db.query<ClubMember>('SELECT * FROM competition_memberships WHERE club_id=$1 AND user_id=$2',[clubId,userId])).rows[0];
        if(!member||member.status==='blocked')fail();
      }else await this.clubPermission(userId,clubId,true);
      const current=(await this.db.query<{user_id:string}>("SELECT user_id FROM competition_memberships WHERE club_id=$1 AND status='member'",[clubId])).rows;
      await this.settle(current.map(m=>m.user_id));
    }
    return this.db.transaction(async connection=>{
      await connection.query('SELECT id FROM competition_clubs WHERE id=$1 FOR UPDATE',[clubId]);
      if(changesConsent){
        const current=(await connection.query<ClubMember>("SELECT * FROM competition_memberships WHERE club_id=$1 AND status='member'",[clubId])).rows;
        await this.archiveClubWeeks(clubId,current,connection,true);
      }
      if(action==='leaveClub'){
        const own=(await connection.query<ClubMember>('SELECT * FROM competition_memberships WHERE club_id=$1 AND user_id=$2',[clubId,userId])).rows[0];
        if(!own||own.status==='blocked')fail();
        if(own.role==='owner')fail('Transfer ownership or delete your club before leaving.',409);
        await connection.query('DELETE FROM competition_memberships WHERE id=$1',[own.id]);return;
      }
      await this.clubPermission(userId,clubId,true,connection);
      if(action==='rotateClubCode'){await connection.query('UPDATE competition_clubs SET code=$2 WHERE id=$1',[clubId,code()]);return;}
      if(action==='deleteClub'){await connection.query('DELETE FROM competition_clubs WHERE id=$1 AND owner_id=$2',[clubId,userId]);return;}
      const target=(await connection.query<ClubMember>('SELECT * FROM competition_memberships WHERE id=$1 AND club_id=$2 FOR UPDATE',[memberId,clubId])).rows[0];
      if(!target||target.role==='owner')fail('Choose another club member.',400);
      if(action==='approveMember'){
        const count=await connection.query<{count:string}>("SELECT count(*)::text AS count FROM competition_memberships WHERE club_id=$1 AND status='member'",[clubId]);
        if(target.status!=='pending')fail('This membership request is no longer pending.',409);
        if(Number(count.rows[0].count)>=50)fail('Fifty members is the club limit.',400);
        await connection.query("UPDATE competition_memberships SET status='member',joined_at=$2 WHERE id=$1",[target.id,this.now()]);return;
      }
      if(action==='rejectMember'||action==='removeMember'||action==='unblockMember'){
        const expected=action==='rejectMember'?'pending':action==='removeMember'?'member':'blocked';
        if(target.status!==expected)fail('This membership changed. Refresh the club.',409);
        await connection.query('DELETE FROM competition_memberships WHERE id=$1',[target.id]);return;
      }
      if(action==='blockMember'){await connection.query("UPDATE competition_memberships SET status='blocked',role='member' WHERE id=$1",[target.id]);return;}
      if(action==='transferClub'){
        if(target.status!=='member')fail('Only an accepted member receives ownership.',400);
        await connection.query("UPDATE competition_memberships SET role='member' WHERE club_id=$1 AND user_id=$2",[clubId,userId]);
        await connection.query("UPDATE competition_memberships SET role='owner' WHERE id=$1",[target.id]);
        await connection.query('UPDATE competition_clubs SET owner_id=$2 WHERE id=$1',[clubId,target.user_id]);return;
      }
      fail('Choose a club action.',400);
    });
  }
  private async archiveClubWeeks(clubId:string,members:ClubMember[],connection:SqlConnection=this.db,membershipChange=false) {
    if(connection===this.db)return this.db.transaction(async client=>{
      await client.query('SELECT id FROM competition_clubs WHERE id=$1 FOR UPDATE',[clubId]);
      const current=(await client.query<ClubMember>("SELECT * FROM competition_memberships WHERE club_id=$1 AND status='member'",[clubId])).rows;
      await this.archiveClubWeeks(clubId,current,client,membershipChange);
    });
    const now=this.now(),currentWeek=sydneyWeekKey(now),ids=members.map(m=>m.user_id),joinedAt=new Map(members.map(m=>[m.user_id,Number(m.joined_at)]));
    if(membershipChange){
      const unsettled=await connection.query(`SELECT 1 FROM competition_attempts a JOIN competition_challenges c ON c.id=a.challenge_id
        WHERE a.user_id=ANY($1::text[]) AND a.status='active' AND a.scored=true AND a.daily_day=c.day AND c.week<$2
        AND a.deadline_at<=$3 LIMIT 1`,[ids,currentWeek,now]);
      if(unsettled.rows.length)fail('The previous week is settling. Refresh before changing club membership.',409);
    }
    const due=(await connection.query<{week:string;unsettled:boolean}>(`SELECT c.week,bool_or(a.status='active') AS unsettled
      FROM competition_attempts a JOIN competition_challenges c ON c.id=a.challenge_id
      JOIN competition_memberships m ON m.user_id=a.user_id AND m.club_id=$1 AND m.status='member' AND a.created_at>=m.joined_at
      WHERE a.scored=true AND c.kind='daily' AND a.daily_day=c.day AND c.week<$2
        AND NOT EXISTS(SELECT 1 FROM competition_club_weeks w WHERE w.club_id=$1 AND w.week=c.week)
      GROUP BY c.week ORDER BY c.week`,[clubId,currentWeek])).rows;
    for(const {week,unsettled} of due){
      if(unsettled||sydneyMidnight(shiftCalendarDay(week,7))+2*3600000>now)continue;
      const results=await this.dailyResults(ids,week,connection);
      const board=rankWithTies(members.map(m=>({memberId:m.id,...weeklyBestFive(results.filter(r=>r.accountId===m.user_id&&r.reservedAt>=(joinedAt.get(m.user_id)??0)),week)})).filter(p=>p.attempts>0),(a,b)=>b.points-a.points);
      const winners=board.filter(p=>p.rank===1&&p.attempts>p.abandoned);
      const publish=async(connection:SqlConnection)=>{
        const claimed=await connection.query('INSERT INTO competition_club_weeks(club_id,week,published_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING club_id',[clubId,week,now]);
        if(!claimed.rows.length)return;
        for(const winner of winners){const member=members.find(m=>m.id===winner.memberId);if(member)await connection.query('INSERT INTO competition_trophies(club_id,week,user_id,points,attempts) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[clubId,week,member.user_id,winner.points,winner.attempts]);}
      };
      if(connection===this.db)await this.db.transaction(publish);else await publish(connection);
    }
  }
  async club(userId:string,clubId:string) {
    await this.ensure();const own=await this.clubPermission(userId,clubId);
    const club=(await this.db.query<{id:string;name:string;code:string;created_at:string}>('SELECT id,name,code,created_at FROM competition_clubs WHERE id=$1',[clubId])).rows[0];
    const allMembers=(await this.db.query<ClubMember & {display_name:string}>(`SELECT m.*,p.display_name FROM competition_memberships m JOIN records_profiles p ON p.user_id=m.user_id
      WHERE m.club_id=$1 AND (m.status='member' OR $2::boolean=true) ORDER BY m.role,m.requested_at`,[clubId,own.role==='owner'])).rows;
    const members=allMembers.filter(m=>m.status==='member'),ids=members.map(m=>m.user_id),idMap=new Map(members.map(m=>[m.user_id,m.id])),joinedAt=new Map(members.map(m=>[m.user_id,Number(m.joined_at)]));
    await this.settle(ids);const {calendar,ruleWeek}=await this.publishCalendar();
    await this.archiveClubWeeks(clubId,members);
    const weekly=await this.standings(ids,calendar.week,idMap,joinedAt);
    const ruleAttempts=(await this.db.query<{user_id:string;score:ChallengeScore;created_at:string}>(`SELECT user_id,score,created_at FROM competition_attempts WHERE challenge_id=$1 AND user_id=ANY($2::text[]) AND scored=true AND score IS NOT NULL`,[ruleWeek.id,ids])).rows.filter(a=>Number(a.created_at)>=(joinedAt.get(a.user_id)??0));
    const ruleBoard=rankWithTies(ruleAttempts.map(a=>({memberId:idMap.get(a.user_id)!,displayName:members.find(m=>m.user_id===a.user_id)!.display_name,score:a.score,points:challengePoints(a.score)})).filter(a=>a.score.outcome!=='service-interrupted'),(a,b)=>compareChallengeScores(a.score,b.score));
    const evidenceRows=(await this.db.query<{user_id:string;payload:ClubEvidence}>(`SELECT e.user_id,jsonb_build_object(
        'game',e.payload->'game','ruleNumber',e.payload->'ruleNumber','ruleId',e.rule_id,'startedAt',e.started_at,'status',e.status,
        'eligible',true,'conditions',e.payload->'conditions','completed',e.payload->'completed','penalty',e.payload->'penalty',
        'actualOpening',CASE WHEN e.payload->'actualOpening'->'turn' IS NOT NULL THEN jsonb_build_object('turn',e.payload->'actualOpening'->'turn') ELSE 'null'::jsonb END) AS payload
      FROM records_evidence e JOIN competition_memberships m ON m.user_id=e.user_id AND m.club_id=$1 AND m.status='member'
      WHERE e.status IN ('started','completed','abandoned') AND (e.payload->>'eligible')::boolean=true AND e.started_at>=m.joined_at`,[clubId])).rows;
    const weekStart=sydneyMidnight(calendar.week),weekEnd=sydneyMidnight(shiftCalendarDay(calendar.week,7));
    const contributions=members.map(member=>{
      const rules=[...new Set(evidenceRows.filter(e=>e.user_id===member.user_id&&e.payload.status==='completed'&&e.payload.completed&&e.payload.actualOpening&&e.payload.startedAt>=weekStart&&e.payload.startedAt<weekEnd).map(e=>e.payload.ruleId))].sort();
      return {memberId:member.id,displayName:member.display_name,rules,count:rules.length};
    });
    const ruleIds=[...new Set(contributions.flatMap(p=>p.rules))].sort();
    const conditions=new Map(evidenceRows.map(({payload:e})=>[cohortKey(e.conditions),publicConditions(e.conditions)]));
    const consistency=consistencyBoard(evidenceRows.map(({user_id,payload:e})=>({accountId:idMap.get(user_id)!,displayName:members.find(m=>m.user_id===user_id)!.display_name,ruleId:e.ruleId,cohortKey:cohortKey(e.conditions),completed:e.status!=='started'&&e.completed,openingTurn:e.status==='started'?null:e.actualOpening?.turn??null,penalty:e.status==='started'?null:e.penalty,eligible:e.eligible,status:e.status}))).map(({accountId,...row})=>({...row,memberId:accountId,conditions:conditions.get(row.cohortKey)!}));
    const recordGroups=new Map<string,typeof evidenceRows>();
    for(const row of evidenceRows){const key=JSON.stringify([row.payload.ruleId,cohortKey(row.payload.conditions),row.user_id]);const group=recordGroups.get(key)??[];group.push(row);recordGroups.set(key,group);}
    const fastest=[...recordGroups.values()].flatMap(group=>{
      const best=group.filter(row=>row.payload.status==='completed'&&row.payload.completed&&row.payload.actualOpening).sort((a,b)=>a.payload.actualOpening!.turn-b.payload.actualOpening!.turn)[0];
      if(!best)return [];
      const e=best.payload,completed=group.filter(row=>row.payload.status!=='started'&&row.payload.completed).length;
      return [{memberId:idMap.get(best.user_id)!,displayName:members.find(m=>m.user_id===best.user_id)!.display_name,ruleId:e.ruleId,title:RULES[e.game][e.ruleNumber-1].title,
        cohortKey:cohortKey(e.conditions),conditions:publicConditions(e.conditions),bestOpeningTurn:e.actualOpening!.turn,attempts:group.length,completed,
        pending:group.filter(row=>row.payload.status==='started').length,completionRate:completed/group.length}];
    });
    const ruleBoards=new Map<string,typeof fastest>();
    for(const row of fastest){const key=JSON.stringify([row.ruleId,row.cohortKey]),group=ruleBoards.get(key)??[];group.push(row);ruleBoards.set(key,group);}
    const ruleRecords=[...ruleBoards.entries()].sort(([a],[b])=>a.localeCompare(b)).flatMap(([,group])=>rankWithTies(group,(a,b)=>a.bestOpeningTurn-b.bestOpeningTurn));
    const trophies=(await this.db.query<{week:string;user_id:string;points:string;attempts:number;display_name:string}>(`SELECT t.*,p.display_name FROM competition_trophies t JOIN records_profiles p ON p.user_id=t.user_id WHERE club_id=$1 ORDER BY week DESC LIMIT 100`,[clubId])).rows.map(t=>({week:t.week,displayName:t.display_name,points:Number(t.points),attempts:t.attempts}));
    await this.clubPermission(userId,clubId);
    return {id:club.id,name:club.name,code:club.code,role:own.role,status:own.status,createdAt:Number(club.created_at),
      members:allMembers.map(m=>({id:m.id,displayName:m.display_name,role:m.role,status:m.status})),weekly,ruleWeek:{challenge:await this.descriptor(ruleWeek,userId),standings:ruleBoard},
      goal:{week:calendar.week,target:10,completed:ruleIds.length,ruleIds,contributions},consistency,ruleRecords,trophies};
  }
  async createDuel(userId:string,friendId:string) {
    await this.ensure();await this.records.profile(userId);const opponent=await this.activeFriend(userId,friendId),id=randomUUID(),invitation=token(),now=this.now();
    const ids:[string,string,string]=[randomUUID(),randomUUID(),randomUUID()],offset=randomInt(30);
    await this.db.transaction(async connection=>{
      await connection.query('SELECT user_id FROM records_profiles WHERE user_id=$1 FOR UPDATE',[userId]);
      await this.activeFriend(userId,friendId,connection);
      const pending=await connection.query<{count:string}>("SELECT count(*)::text AS count FROM competition_duels WHERE creator_id=$1 AND status='pending'",[userId]);
      if(Number(pending.rows[0].count)>=10)fail('Finish or revoke an old duel invitation before creating another.',400);
      for(const [index,challengeId] of ids.entries()){
        const rule=(offset+index*7)%30;
        await this.insertChallenge(connection,this.configuration(challengeId,(1+Math.floor(rule/10)) as GameType,rule%10+1),userId,'duel');
      }
      await connection.query("INSERT INTO competition_duels(id,creator_id,opponent_id,friend_id,token,token_hash,challenge_ids,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,'pending',$8)",[id,userId,opponent,friendId,invitation,digest(invitation),ids,now]);
    });
    return this.duel(userId,id);
  }
  async duelAction(userId:string,action:string,duelId:string) {
    await this.ensure();
    await this.db.transaction(async connection=>{
      const row=(await connection.query<DuelRow>('SELECT * FROM competition_duels WHERE id=$1 AND (creator_id=$2 OR opponent_id=$2) FOR UPDATE',[duelId,userId])).rows[0];
      if(!row)fail();
      if(action==='acceptDuel'){
        if(row.status!=='pending'||row.opponent_id!==userId)fail('Only the invited friend accepts a pending duel.',403);
        await this.activeFriend(userId,row.friend_id,connection);
        await connection.query("UPDATE competition_duels SET status='accepted' WHERE id=$1",[duelId]);return;
      }
      if(action==='revokeDuel'){
        if(row.status!=='pending')fail('An accepted duel keeps its first attempts. Withdraw from an unfinished hand through Challenges.',409);
        await connection.query("UPDATE competition_duels SET status='revoked' WHERE id=$1",[duelId]);return;
      }
      fail('Choose a duel action.',400);
    });
  }
  async duel(userId:string,duelId:string) {
    await this.ensure();const row=(await this.db.query<DuelRow>('SELECT * FROM competition_duels WHERE id=$1 AND (creator_id=$2 OR opponent_id=$2)',[duelId,userId])).rows[0];if(!row)fail();
    const other=row.creator_id===userId?row.opponent_id:row.creator_id;
    let friendActive=true;try{await this.activeFriend(userId,row.friend_id);}catch{friendActive=false;}
    const profile=(await this.db.query<{display_name:string}>('SELECT display_name FROM records_profiles WHERE user_id=$1',[other])).rows[0];
    await this.settle([userId,...(friendActive?[other]:[])]);
    const results=(await this.db.query<{challenge_id:string;user_id:string;score:ChallengeScore}>(`SELECT challenge_id,user_id,score FROM competition_attempts WHERE challenge_id=ANY($1::text[]) AND scored=true AND score IS NOT NULL AND user_id=ANY($2::text[])`,[row.challenge_ids,friendActive?[userId,other]:[userId]])).rows;
    const total=(id:string)=>threeDealTotal(results.filter(r=>r.user_id===id).map(r=>({challengeId:r.challenge_id,accountId:id,day:sydneyDayKey(Number(row.created_at)),score:r.score,firstAttempt:true})),row.challenge_ids);
    const status=friendActive?row.status:'revoked';
    const challenges=status==='accepted'?(await this.db.query<ChallengeRow>('SELECT * FROM competition_challenges WHERE id=ANY($1::text[])',[row.challenge_ids])).rows:[];
    const yourTotal=total(userId),theirTotal=friendActive?total(other):null;
    return {id:row.id,token:row.token,url:`/competition?duel=${row.token}`,status,incoming:row.opponent_id===userId,friend:{id:row.friend_id,displayName:profile?.display_name??'Player'},
      createdAt:Number(row.created_at),challenges:await Promise.all(row.challenge_ids.flatMap(id=>challenges.filter(c=>c.id===id)).map(c=>this.descriptor(c,userId))),
      you:yourTotal,other:theirTotal,complete:status==='accepted'&&yourTotal.complete&&theirTotal?.complete===true,
      outcome:status==='accepted'&&yourTotal.complete&&theirTotal?.complete?(yourTotal.points===theirTotal.points?'tie':yourTotal.points>theirTotal.points?'you':'friend'):null};
  }
  async duelInvitation(userId:string,invitation:string) {
    await this.ensure();if(!/^[A-Za-z0-9_-]{43}$/.test(invitation))fail();
    const row=(await this.db.query<{id:string}>('SELECT id FROM competition_duels WHERE token_hash=$1 AND (creator_id=$2 OR opponent_id=$2)',[digest(invitation),userId])).rows[0];
    if(!row)fail();return this.duel(userId,row.id);
  }
  async createRematch(userId:string,friendId:string,handId:string) {
    await this.ensure();const opponent=await this.activeFriend(userId,friendId);
    const source=(await this.db.query<{payload:RecordEvidence}>(`SELECT e.payload FROM records_evidence e JOIN records_evidence other
      ON other.game_id=e.game_id AND other.hand_id=e.hand_id WHERE e.user_id=$1 AND other.user_id=$2 AND e.hand_id=$3
      AND e.status='completed' AND other.status='completed' AND (e.payload->>'eligible')::boolean=true AND (other.payload->>'eligible')::boolean=true`,[userId,opponent,handId])).rows[0];
    if(!source)fail('Choose a completed head-to-head hand with this accepted friend.',400);
    if(source.payload.game===4&&!await this.entitled(userId))fail('Original Rules access is required to host this rematch.',403);
    const id=randomUUID(),invitation=token();
    await this.db.transaction(async connection=>{
      await connection.query('SELECT user_id FROM records_profiles WHERE user_id=$1 FOR UPDATE',[userId]);
      await this.activeFriend(userId,friendId,connection);
      const pending=await connection.query<{count:string}>("SELECT count(*)::text AS count FROM competition_rematches WHERE creator_id=$1 AND status='pending'",[userId]);
      if(Number(pending.rows[0].count)>=10)fail('Finish or revoke an old rematch invitation before creating another.',400);
      await connection.query("INSERT INTO competition_rematches(id,creator_id,opponent_id,friend_id,source_hand_id,game,token,token_hash,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9)",[id,userId,opponent,friendId,handId,source.payload.game,invitation,digest(invitation),this.now()]);
    });
    return this.rematch(userId,id);
  }
  async rematch(userId:string,id:string) {
    await this.ensure();const row=(await this.db.query<RematchRow>('SELECT * FROM competition_rematches WHERE id=$1 AND (creator_id=$2 OR opponent_id=$2)',[id,userId])).rows[0];if(!row)fail();
    const friend=row.creator_id===userId?row.opponent_id:row.creator_id,profile=await this.records.profile(friend);
    let active=true;try{await this.activeFriend(userId,row.friend_id);}catch{active=false;}
    return {id:row.id,token:row.token,url:`/competition?rematch=${row.token}`,status:active?row.status:'revoked',incoming:row.opponent_id===userId,friend:{id:row.friend_id,displayName:profile.displayName},game:row.game,roomCode:row.room_code,createdAt:Number(row.created_at)};
  }
  async rematchInvitation(userId:string,invitation:string) {
    await this.ensure();if(!/^[A-Za-z0-9_-]{43}$/.test(invitation))fail();
    const row=(await this.db.query<{id:string}>('SELECT id FROM competition_rematches WHERE token_hash=$1 AND (creator_id=$2 OR opponent_id=$2)',[digest(invitation),userId])).rows[0];if(!row)fail();
    return this.rematch(userId,row.id);
  }
  async rematchAction(userId:string,action:string,id:string) {
    await this.ensure();
    const selected=(await this.db.query<RematchRow>('SELECT * FROM competition_rematches WHERE id=$1 AND (creator_id=$2 OR opponent_id=$2)',[id,userId])).rows[0];if(!selected)fail();
    const [hostProfile,guestProfile,hostStyle,guestStyle]=await Promise.all([this.records.profile(selected.creator_id),this.records.profile(selected.opponent_id),this.styles(selected.creator_id),this.styles(selected.opponent_id)]);
    if(action==='acceptRematch'&&selected.game===4&&!await this.entitled(selected.creator_id))fail('The host’s Original Rules access is required.',403);
    return this.db.transaction(async connection=>{
      const row=(await connection.query<RematchRow>('SELECT * FROM competition_rematches WHERE id=$1 AND (creator_id=$2 OR opponent_id=$2) FOR UPDATE',[id,userId])).rows[0];if(!row)fail();
      if(action==='revokeRematch'){
        if(row.status!=='pending')fail('An accepted rematch is managed through its game table.',409);
        await connection.query("UPDATE competition_rematches SET status='revoked' WHERE id=$1",[id]);return {ok:true};
      }
      if(action!=='acceptRematch'||row.opponent_id!==userId)fail('Only the invited friend accepts this rematch.',403);
      await this.activeFriend(userId,row.friend_id,connection);
      if(row.status==='accepted')return {roomCode:row.room_code,resumed:true};
      if(row.status!=='pending')fail('This rematch invitation was revoked.',409);
      const host=createPlayer({id:randomUUID(),name:hostProfile.displayName,color:0,tokenHash:digest(token()),fontId:hostStyle.font,symbolId:hostStyle.symbol});
      const guest=createPlayer({id:randomUUID(),name:guestProfile.displayName,color:1,tokenHash:digest(token()),fontId:guestStyle.font,symbolId:guestStyle.symbol});
      const repo=new PostgresRoomRepository(clientDatabase(connection));
      if(!await repo.consumeCreationLimit(`competition:${row.creator_id}`,this.now()))fail('Please wait before creating another table.',429);
      for(let tries=0;tries<12;tries++){
        let room=createRoom(roomCode(),host);room=applyAction(room,host.id,{type:'setGame',game:row.game});room.players.push(guest);
        room.events.push({id:(room.events.at(-1)?.id??0)+1,type:'join',playerId:guest.id,text:`${guest.name} accepted the rematch.`,at:this.now()});
        if(!await repo.insert(room,{userId:row.creator_id,playerId:host.id}))continue;
        await connection.query('INSERT INTO room_memberships(room_code,user_id,player_id) VALUES($1,$2,$3)',[room.code,row.opponent_id,guest.id]);
        await connection.query("UPDATE competition_rematches SET status='accepted',room_code=$2 WHERE id=$1",[id,room.code]);
        return {roomCode:room.code,room:publicRoom(room,guest.id),resumed:false};
      }
      fail('A rematch table was not available. Please try again.',503);
    });
  }
  async snapshot(userId:string) {
    await this.ensure();await this.records.profile(userId);await this.settle([userId]);
    const {calendar,daily,ruleWeek}=await this.publishCalendar();
    const owned=(await this.db.query<ChallengeRow>("SELECT * FROM competition_challenges WHERE owner_id=$1 AND kind='custom' AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 30",[userId])).rows;
    const invitations=(await this.db.query<{token:string}>('SELECT token FROM competition_invitations WHERE owner_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 30',[userId])).rows;
    const aliases:ChallengeRow[]=[];for(const invitation of invitations){try{aliases.push(await this.challengeByToken(invitation.token,userId));}catch{/* A deleted source revokes its dependent invitation. */}}
    const attemptRows=(await this.db.query<AttemptRow & {challenge:ChallengeRow}>(`SELECT a.*,row_to_json(c) AS challenge FROM competition_attempts a JOIN competition_challenges c ON c.id=a.challenge_id
      WHERE a.user_id=$1 ORDER BY a.created_at DESC LIMIT 60`,[userId])).rows;
    const memberships=(await this.db.query<ClubMember & {name:string}>('SELECT m.*,c.name FROM competition_memberships m JOIN competition_clubs c ON c.id=m.club_id WHERE m.user_id=$1 AND m.status<>\'blocked\' ORDER BY m.requested_at DESC',[userId])).rows;
    // Club analytics are loaded only for the explicitly selected private club.
    // Embedding every lifetime board makes otherwise small dashboard responses
    // scale with all memberships and can exceed a serverless response limit.
    const clubs=memberships.map(m=>({id:m.club_id,name:m.name,role:m.role,status:m.status}));
    const duelIds=(await this.db.query<{id:string}>("SELECT id FROM competition_duels WHERE (creator_id=$1 OR opponent_id=$1) AND status<>'revoked' ORDER BY created_at DESC LIMIT 30",[userId])).rows;
    const rematchIds=(await this.db.query<{id:string}>("SELECT id FROM competition_rematches WHERE (creator_id=$1 OR opponent_id=$1) AND status<>'revoked' ORDER BY created_at DESC LIMIT 30",[userId])).rows;
    const [dailyView,ruleWeekView,duels,rematches]=await Promise.all([this.descriptor(daily,userId),this.descriptor(ruleWeek,userId),Promise.all(duelIds.map(r=>this.duel(userId,r.id))),Promise.all(rematchIds.map(r=>this.rematch(userId,r.id)))]);
    return {calendar,policy:COMPETITION_SERVICE_POLICY,originalRules:await this.entitled(userId),daily:dailyView,ruleWeek:ruleWeekView,
      attempts:attemptRows.map(a=>this.previewAttempt(a,a.challenge)),challenges:await Promise.all([...owned,...aliases].map(row=>this.descriptor(row,userId))),clubs,duels,rematches,
      weekly:weeklyBestFive(await this.dailyResults([userId],calendar.week),calendar.week)};
  }
}
export const competitionRepository=new CompetitionRepository();
