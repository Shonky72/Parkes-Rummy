/** Isolated PGlite benchmark. Creates synthetic accounts only in process memory.
 * Run: node --import tsx scripts/benchmark-gamification-service.ts
 * No production database, browser session or network connection is used. */
import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import type { QueryResultRow } from 'pg';
import type { SqlConnection, SqlDatabase } from '../db';
import { RecordsRepository } from '../db/records';
import { CompetitionRepository } from '../db/competition';
import { PostgresRequestSecurity } from '../db/security';
import { createRecordsHandlers } from '../lib/records-server';
import { accountMarker, type AccountUser } from '../lib/auth-config';
import { getRuleExample } from '../lib/rummy';
import { sydneyMidnight, sydneyDayKey, shiftCalendarDay } from '../lib/competition';
import { CHALLENGE_ENGINE_VERSION } from '../lib/competition-types';
import { RECORDS_ENGINE_VERSION, type RecordEvidence } from '../lib/records-types';
import type { GameType } from '../lib/types';

const pg=new PGlite();let queries=0,rowsRead=0,now=sydneyMidnight('2026-12-13')+12*3600000;
function connection(target:Pick<PGlite|Transaction,'query'>):SqlConnection {
  return {async query<T extends QueryResultRow>(sql:string,values?:unknown[]){queries++;const result=await target.query<T>(sql,values);rowsRead+=result.rows.length;return {rows:result.rows,rowCount:result.affectedRows??result.rows.length};}};
}
const db:SqlDatabase={...connection(pg),transaction:work=>pg.transaction(tx=>work(connection(tx)))};
await db.query(await readFile(new URL('../db/schema-editor.sql',import.meta.url),'utf8'));
const records=new RecordsRepository(db),competition=new CompetitionRepository(db,{records,now:()=>now,entitled:async()=>false,styles:async()=>({font:'default',symbol:'initials'})}),security=new PostgresRequestSecurity(db);
await competition.ensure();
const clubCount=50,handsPerMember=200,totalAccounts=clubCount+1,week='2026-12-07',joinedAt=sydneyMidnight('2026-11-01');
const users:AccountUser[]=Array.from({length:totalAccounts},(_,i)=>({id:`benchmark-account-${i}`,name:`Private source ${i}`,email:`synthetic-${i}@example.invalid`,image:null}));
await db.query(`INSERT INTO "user"(id,name,email) SELECT value->>'id',value->>'name',value->>'email' FROM jsonb_array_elements($1::jsonb) AS value`,[JSON.stringify(users)]);
await db.query(`INSERT INTO records_profiles(user_id,display_name,friend_code,created_at,updated_at)
 SELECT id,'Club member '||row_number() OVER(ORDER BY id),md5(id),$1,$1 FROM "user"`,[joinedAt]);
const club=await competition.createClub(users[0].id,'Synthetic benchmark club');
await db.query('UPDATE competition_memberships SET joined_at=$2 WHERE club_id=$1',[club.id,joinedAt]);
await db.query(`INSERT INTO competition_memberships(id,club_id,user_id,role,status,requested_at,joined_at)
 SELECT 'member-'||value,$1,value,'member','member',$3,$3 FROM jsonb_array_elements_text($2::jsonb) AS value`,[club.id,JSON.stringify(users.slice(1,clubCount).map(u=>u.id)),joinedAt]);

let evidenceBytes=0;
for(const [index,user] of users.entries()){
  const evidence=Array.from({length:handsPerMember},(_,hand):RecordEvidence=>{
    const game=(1+Math.floor((hand%40)/10)) as GameType,ruleNumber=hand%10+1,playerId=`seat-${index}`,handId=`hand-${index}-${hand}`;
    const actualOpening={turn:2+hand%8,actionId:10,opening:getRuleExample(game,ruleNumber)};
    const status=hand%20===0?'started':hand%10===0?'abandoned':'completed',completed=status==='completed'&&hand%5!==0;
    const startedAt=joinedAt+Math.floor(hand*40*86400000/handsPerMember);
    return {schemaVersion:1,gameId:`game-${index}-${hand}`,handId,playerId,game,ruleNumber,ruleId:`${game}:${ruleNumber}`,handNumber:1,startedAt,
      finishedAt:status==='started'?null:startedAt+900000,status,eligible:true,exclusionReason:null,
      conditions:{engineVersion:RECORDS_ENGINE_VERSION,format:'quick-play',deal:'random',playerCount:2,humanCount:1,seat:0,startingSeat:0,roster:[{playerId,name:'Private synthetic owner',isBot:false,difficulty:'easy'},{playerId:'private-ai-id',name:'Computer',isBot:true,difficulty:'easy'}],hints:false,timerSeconds:0},
      readyFromDeal:hand%9===0,firstDrawReady:hand%6===0,firstDrawCompletedOpening:hand%4===0,firstReady:actualOpening,firstLegal:actualOpening,actualOpening:completed?actualOpening:null,
      opportunitiesPassed:hand%4,legalOpportunityTurns:[2,3,4],firstDiscardSurvived:true,readinessLostOnDiscard:0,completed,wentOut:completed&&hand%3===0,closingTurns:completed&&hand%3===0?2:null,
      penalty:status==='started'?null:hand%100,totalScore:hand%100,ownTurns:15,wildcardCount:0,naturalEligible:true,achievements:completed?['first-chance']:[],
      timeline:Array.from({length:24},(_,turn)=>({kind:turn%2?'discard' as const:'draw' as const,turn:1+Math.floor(turn/2),actionId:turn,ready:turn>4,legal:turn>5,cards:[{id:`private-card-${turn}`,rank:5+turn%10,suit:'H' as const}],text:`Private synthetic turn ${turn}`})),timelineTruncated:false,gameOutcome:null,endActionId:status==='started'?null:40};
  });
  const encoded=JSON.stringify(evidence);evidenceBytes+=Buffer.byteLength(encoded);
  await db.query(`INSERT INTO records_evidence(user_id,hand_id,game_id,player_id,room_code,rule_id,status,source_event,started_at,updated_at,payload)
    SELECT $1,value->>'handId',value->>'gameId',value->>'playerId','BENCH',value->>'ruleId',value->>'status',value->>'handId',
      (value->>'startedAt')::bigint,COALESCE((value->>'finishedAt')::bigint,(value->>'startedAt')::bigint),value FROM jsonb_array_elements($2::jsonb) AS value`,[user.id,encoded]);
}
const referenceNow=now;
for(let day=0;day<7;day++){
  now=sydneyMidnight(shiftCalendarDay(week,day))+12*3600000;const {daily}=await competition.publishCalendar();
  const score={completed:true,openingTurn:2+day,wentOut:true,closingTurns:2,penalty:0,outcome:'completed'};
  await db.query(`INSERT INTO competition_attempts(id,challenge_id,user_id,room_code,player_id,hand_id,scored,status,score,daily_day,created_at,deadline_at,finished_at)
    SELECT 'daily-'||$1||'-'||value,$2,value,'daily-room-'||$1||'-'||value,'seat-'||value,'daily-hand-'||$1||'-'||value,true,'completed',$4::jsonb,$1,$5::bigint,$5::bigint+3600000,$5::bigint+600000
    FROM jsonb_array_elements_text($3::jsonb) AS value`,[sydneyDayKey(now),daily.id,JSON.stringify(users.map(u=>u.id)),JSON.stringify(score),now]);
}
now=referenceNow;

const percentile=(values:number[],fraction:number)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*fraction))];
const rounded=(n:number)=>Math.round(n*1000)/1000;
async function benchmark(name:string,work:()=>Promise<unknown>,samples=20){
  await work();const times:number[]=[],counts:number[]=[],returnedRows:number[]=[],bytes:number[]=[];
  for(let index=0;index<samples;index++){
    const start=performance.now(),before=queries,rowsBefore=rowsRead,result=await work();
    times.push(performance.now()-start);counts.push(queries-before);returnedRows.push(rowsRead-rowsBefore);bytes.push(Buffer.byteLength(JSON.stringify(result)));
  }
  return {name,samples,p50Ms:rounded(percentile(times,.5)),p95Ms:rounded(percentile(times,.95)),maxMs:rounded(Math.max(...times)),
    sqlQueries:{min:Math.min(...counts),max:Math.max(...counts)},databaseRows:{min:Math.min(...returnedRows),max:Math.max(...returnedRows)},responseBytes:Math.max(...bytes)};
}
const owner=users[0],solo=users.at(-1)!;
const ownerRequest=()=>new Request('https://parkesrummy.com/api/records',{headers:{Origin:'https://parkesrummy.com','x-nf-client-connection-ip':'192.0.2.199','X-Parkes-Identity':accountMarker(owner.id)}});
const handler=(repo:RecordsRepository)=>createRecordsHandlers({records:repo,security,resolveSession:async()=>owner,enabled:true});
const warm=handler(records);
const measurements=[];
measurements.push(await benchmark('profile API warm summary (200 lifetime hands)',async()=>{const result=await warm.snapshot(ownerRequest());if(result.status!==200)throw new Error(await result.text());return result.json();},12));
await db.query('DELETE FROM security_limits');
measurements.push(await benchmark('profile API cold repository (200 lifetime hands)',async()=>{const result=await handler(new RecordsRepository(db)).snapshot(ownerRequest());if(result.status!==200)throw new Error(await result.text());return result.json();},12));
measurements.push(await benchmark('private club detail (50 members, 10000 lifetime hands, 350 weekly attempts)',()=>competition.club(owner.id,club.id)));
measurements.push(await benchmark('daily and weekly account dashboard (7 daily results, no club)',()=>competition.snapshot(solo.id)));
console.log(JSON.stringify({runtime:process.version,engine:CHALLENGE_ENGINE_VERSION,database:'PGlite in-memory PostgreSQL; no network latency',
  dataset:{accounts:totalAccounts,clubMembers:clubCount,handsPerAccount:handsPerMember,evidenceRows:totalAccounts*handsPerMember,evidenceJsonBytes:evidenceBytes,weeklyResults:totalAccounts*7},measurements,
  limits:'Local p50/p95 measures parsing, SQL execution and response assembly. It is not a production network, pool saturation or serverless cold-start estimate.'},null,2));
await pg.close();
