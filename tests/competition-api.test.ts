import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import type { QueryResultRow } from 'pg';
import type { SqlConnection, SqlDatabase } from '../db';
import { CompetitionRepository, COMPETITION_SCHEMA, scoreFromEvidence } from '../db/competition';
import { RecordsRepository } from '../db/records';
import { PostgresRequestSecurity } from '../db/security';
import { createCompetitionHandlers } from '../lib/competition-server';
import { accountMarker, type AccountUser } from '../lib/auth-config';
import { challengePoints, sydneyDayKey, sydneyMidnight, shiftCalendarDay } from '../lib/competition';
import { applyChallengeAction } from '../lib/challenge-engine/v1';
import { RECORDS_ENGINE_VERSION, type RecordEvidence } from '../lib/records-types';
import type { ChallengeConfig, ChallengeRoom } from '../lib/competition-types';
import type { GameType, Meld } from '../lib/types';

const pg=new PGlite();
const sqlConnection=(target:Pick<PGlite|Transaction,'query'>):SqlConnection=>({
  async query<T extends QueryResultRow>(sql:string,values?:unknown[]) {
    const result=await target.query<T>(sql,values);return {rows:result.rows,rowCount:result.affectedRows??result.rows.length};
  },
});
const db:SqlDatabase={...sqlConnection(pg),transaction:work=>pg.transaction(tx=>work(sqlConnection(tx)))};
let now=sydneyMidnight('2026-10-19')+12*3600000;
const entitled=new Set<string>(),records=new RecordsRepository(db);
const competition=new CompetitionRepository(db,{records,now:()=>now,entitled:async id=>entitled.has(id),styles:async()=>({font:'default',symbol:'initials'})});
const security=new PostgresRequestSecurity(db);
const api=(user:AccountUser|null,enabled=true)=>createCompetitionHandlers({competition,security,resolveSession:async()=>user,enabled});
const request=(user:AccountUser|null,body?:unknown,path='/api/competition',pin?:string,origin='https://parkesrummy.com')=>new Request(`https://internal--parkes-rummy.netlify.app:80${path}`,{
  method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','x-nf-client-connection-ip':'192.0.2.71',Origin:origin,'X-Parkes-Identity':pin??(user?accountMarker(user.id):'guest')},...(body===undefined?{}:{body:JSON.stringify(body)}),
});
async function response(value:Promise<Response>){const r=await value;return {status:r.status,headers:r.headers,data:await r.json()};}
async function account(name='Private Google Name') {
  const user:AccountUser={id:crypto.randomUUID(),name,email:`${crypto.randomUUID()}@example.test`,image:null};
  await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[user.id,user.name,user.email]);
  await records.profile(user.id);return user;
}
async function friends(first:AccountUser,second:AccountUser) {
  await records.requestFriend(first.id,(await records.profile(second.id)).friendCode);
  const id=(await records.friends(second.id)).incoming[0].id;await records.friendAction(second.id,'acceptFriend',id);return id;
}
const custom=(user:AccountUser,game:GameType=1)=>competition.createChallenge(user.id,{game,ruleNumber:1,difficulties:['easy'],humanSeat:0,startingSeat:0,showMoveHints:false});
const opening=(playerId:string):Meld[]=>[{id:'private-meld-id',ownerId:playerId,kind:'run',constraint:'any',cards:[5,6,7,8,9].map((rank,i)=>({id:`private-card-${i}`,rank,suit:'H' as const}))}];
function finalEvidence(playerId:string,overrides:Partial<RecordEvidence>={}):RecordEvidence {
  const cards=opening(playerId);
  return {schemaVersion:1,gameId:crypto.randomUUID(),handId:crypto.randomUUID(),playerId,game:1,ruleNumber:1,ruleId:'1:1',handNumber:1,
    startedAt:now,finishedAt:now+100,status:'completed',eligible:true,exclusionReason:null,
    conditions:{engineVersion:RECORDS_ENGINE_VERSION,format:'quick-play',deal:'random',playerCount:2,humanCount:2,seat:0,startingSeat:0,roster:[{playerId,name:'private-seat-name',isBot:false,difficulty:'easy'},{playerId:'private-friend-seat',name:'private-friend-name',isBot:false,difficulty:'easy'}],hints:false,timerSeconds:0},
    readyFromDeal:false,firstDrawReady:true,firstDrawCompletedOpening:true,firstReady:{turn:1,actionId:2,opening:cards},firstLegal:{turn:2,actionId:4,opening:cards},actualOpening:{turn:2,actionId:5,opening:cards},opportunitiesPassed:0,legalOpportunityTurns:[2],firstDiscardSurvived:true,readinessLostOnDiscard:0,completed:true,wentOut:true,closingTurns:2,penalty:0,totalScore:0,ownTurns:4,wildcardCount:0,naturalEligible:true,achievements:['first-chance'],timeline:[{kind:'draw',turn:1,actionId:2,ready:true,legal:false,cards:[{id:'private-pickup',rank:11,suit:'D'}],text:'Private pickup'}],timelineTruncated:false,gameOutcome:null,endActionId:10,...overrides};
}
async function store(user:AccountUser,e:RecordEvidence) {
  await db.query('INSERT INTO records_evidence(user_id,hand_id,game_id,player_id,room_code,rule_id,status,source_event,started_at,updated_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)',[user.id,e.handId,e.gameId,e.playerId,'TEST',e.ruleId,e.status,`${e.handId}:end`,e.startedAt,e.finishedAt??e.startedAt,JSON.stringify(e)]);
}
/** Trusted engine-boundary fixture; request bodies never receive these values. */
async function finishAttempt(user:AccountUser,attemptId:string,overrides:Partial<RecordEvidence>={}) {
  const row=(await db.query<{room_code:string;player_id:string}>('SELECT room_code,player_id FROM competition_attempts WHERE id=$1 AND user_id=$2',[attemptId,user.id])).rows[0];
  const loaded=await competition.rooms.load(row.room_code);assert.ok(loaded);
  const room=loaded.room,started=room.records!.current[row.player_id],e=finalEvidence(row.player_id,{...started,status:'completed',finishedAt:now+100,completed:true,actualOpening:{turn:2,actionId:5,opening:opening(row.player_id)},wentOut:true,closingTurns:2,penalty:0,ownTurns:4,achievements:['first-chance'],...overrides});
  room.status='finished';room.version++;room.updatedAt=now+100;room.records!.current[row.player_id]=e;
  room.records!.events=[{eventId:`${e.handId}:${e.playerId}:hand-end`,type:'hand-end',gameId:e.gameId,handId:e.handId,playerId:e.playerId,status:e.status,at:e.finishedAt!,evidence:e}];
  assert.equal(await competition.rooms.save(room,loaded.version,undefined,{membershipUnchanged:true}),true);
  await competition.settle([user.id]);return e;
}
const attemptRow=async(id:string)=>(await db.query<{status:string;score:ReturnType<typeof scoreFromEvidence>;scored:boolean;daily_day:string|null}>('SELECT status,score,scored,daily_day FROM competition_attempts WHERE id=$1',[id])).rows[0];

before(async()=>{await pg.query(await readFile(new URL('../db/schema-editor.sql',import.meta.url),'utf8'));await competition.ensure();});
after(async()=>{await pg.close();});

test('fresh provisioning is one repeatable prepared statement and includes all three releases',async()=>{
  const schema=await readFile(new URL('../db/schema-editor.sql',import.meta.url),'utf8');await db.query(schema);
  await db.query(COMPETITION_SCHEMA);assert.ok((await readFile(new URL('../db/competition-migration.sql',import.meta.url),'utf8')).includes(COMPETITION_SCHEMA));
  const tables=(await db.query<{table_name:string}>("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")).rows.map(row=>row.table_name);
  for(const name of ['rooms','records_evidence','competition_attempts','competition_invitations','ladder_matches','ladder_results'])assert.ok(tables.includes(name),name);
});

test('competition requires authenticated identity, allowed origin and production context, with no client ownership or score authority',async()=>{
  const owner=await account();
  assert.equal((await api(null).snapshot(request(null))).status,401);
  assert.equal((await api(owner,false).mutate(request(owner,{action:'createChallenge',game:1,ruleNumber:1}))).status,409);
  assert.equal((await api(null,false).challenge(request(null),'A'.repeat(43))).status,409);
  assert.equal((await api(owner).snapshot(request(owner,undefined,'/api/competition','account:forged'))).status,401);
  assert.equal((await api(owner).mutate(request(owner,{action:'createClub',name:'Secret'},'/api/competition',undefined,'https://evil.test'))).status,403);
  const value=await response(api(owner).snapshot(request(owner)));assert.equal(value.status,200);
  assert.match(value.headers.get('Cache-Control')!,/private.*no-store/);assert.equal(value.headers.get('Netlify-CDN-Cache-Control'),'no-store');
  assert.ok(!JSON.stringify(value.data).includes(owner.email));assert.ok(!JSON.stringify(value.data).includes(owner.name));
  const created=await response(api(owner).mutate(request(owner,{action:'createChallenge',game:1,ruleNumber:1,seed:'client-known-private-seed',engineVersion:'client-version',userId:'forged-owner',score:{penalty:0,openingTurn:1}})));
  assert.equal(created.status,200);const privateRow=(await db.query<{owner_id:string;config:ChallengeConfig}>('SELECT owner_id,config FROM competition_challenges WHERE id=$1',[created.data.challenge.id])).rows[0];
  assert.equal(privateRow.owner_id,owner.id);assert.notEqual(privateRow.config.seed,'client-known-private-seed');assert.equal(privateRow.config.engineVersion,'parkes-challenge-v1');
  const attempt=await response(api(owner).mutate(request(owner,{action:'startAttempt',token:created.data.challenge.token,score:{openingTurn:1,penalty:0}})));assert.equal(attempt.status,200);
  assert.equal((await attemptRow(attempt.data.attempt.id)).score,null);assert.equal(attempt.data.token,accountMarker(owner.id));
  assert.equal((await api(owner).mutate(request(owner,{action:'submitScore',attemptId:attempt.data.attempt.id,penalty:0}))).status,400);
});

test('first scored reservation, room, authenticated membership and durable deal evidence commit atomically across concurrent reconnects',async()=>{
  const owner=await account(),challenge=await custom(owner);
  const [one,two]=await Promise.all([competition.reserveAttempt(owner.id,challenge.token),competition.reserveAttempt(owner.id,challenge.token)]);
  assert.equal(one.attempt.id,two.attempt.id);assert.equal(one.roomCode,two.roomCode);assert.equal(Number(one.resumed)+Number(two.resumed),1);
  assert.equal((await db.query('SELECT id FROM competition_attempts WHERE challenge_id=$1 AND user_id=$2',[challenge.id,owner.id])).rows.length,1);
  const room=await competition.rooms.load(one.roomCode),state=room!.room as ChallengeRoom;assert.equal(room!.memberships[0].userId,owner.id);assert.equal(room!.memberships[0].playerId,state.challenge.humanPlayerId);
  const evidence=await records.allEvidence(owner.id);assert.equal(evidence.length,1);assert.equal(evidence[0].status,'started');assert.equal(evidence[0].conditions.format,'challenge');
  const serialized=JSON.stringify(one.room);for(const secret of [state.challenge.config.seed,'randomCursor','tokenHash','"stock":','"records":','private-pickup'])assert.ok(!serialized.includes(secret),secret);
  assert.equal(room!.room.records!.events.length,0);
});

test('failed attempt insertion rolls back its room, membership, evidence and reservation instead of consuming a first try',async()=>{
  const owner=await account(),challenge=await custom(owner);
  await db.query("CREATE FUNCTION reject_competition_attempt_test() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'synthetic reservation failure'; END; $$ LANGUAGE plpgsql");
  await db.query('CREATE TRIGGER reject_competition_attempt_test BEFORE INSERT ON competition_attempts FOR EACH ROW EXECUTE FUNCTION reject_competition_attempt_test()');
  try{await assert.rejects(competition.reserveAttempt(owner.id,challenge.token),/synthetic reservation failure/);}finally{
    await db.query('DROP TRIGGER reject_competition_attempt_test ON competition_attempts');await db.query('DROP FUNCTION reject_competition_attempt_test()');
  }
  assert.equal((await db.query('SELECT room_code FROM room_memberships WHERE user_id=$1',[owner.id])).rows.length,0);
  assert.equal((await records.allEvidence(owner.id)).length,0);assert.equal((await db.query('SELECT id FROM competition_attempts WHERE user_id=$1',[owner.id])).rows.length,0);
  assert.equal((await competition.reserveAttempt(owner.id,challenge.token)).resumed,false);
});

test('practice cannot scout an unplayed first attempt; withdrawal is durable and practice remains explicitly unscored',async()=>{
  const owner=await account(),outsider=await account(),challenge=await custom(owner);
  await assert.rejects(competition.reserveAttempt(owner.id,challenge.token,true),/first scored attempt/);
  const scored=await competition.reserveAttempt(owner.id,challenge.token);await assert.rejects(competition.reserveAttempt(owner.id,challenge.token,true),/first scored attempt/);
  await assert.rejects(competition.withdrawAttempt(outsider.id,scored.attempt.id));await competition.withdrawAttempt(owner.id,scored.attempt.id);
  const final=await attemptRow(scored.attempt.id);assert.equal(final.status,'abandoned');assert.equal(challengePoints(final.score),-1);
  const resumed=await competition.reserveAttempt(owner.id,challenge.token);assert.equal(resumed.attempt.id,scored.attempt.id);assert.equal(resumed.room,null);
  const practice=await competition.reserveAttempt(owner.id,challenge.token,true),again=await competition.reserveAttempt(owner.id,challenge.token,true);
  assert.equal(practice.attempt.scored,false);assert.equal(practice.room!.challenge.practice,true);assert.equal(practice.attempt.id,again.attempt.id);
  assert.equal((await records.allEvidence(owner.id)).filter(e=>e.eligible).length,1);
  await competition.withdrawAttempt(owner.id,practice.attempt.id);assert.equal((await attemptRow(practice.attempt.id)).status,'abandoned');
  assert.equal((await records.aggregate(owner.id)).summary.attempts,1);
});

test('Beat My Deal is explicit, redacted, revocable and preserves one first attempt across every invitation alias',async()=>{
  const host=await account(),friend=await account();await records.updateProfile(host.id,'Shonky',[]);
  const challenge=await custom(host),source=await competition.reserveAttempt(host.id,challenge.token);
  assert.equal((await api(null).challenge(request(null),challenge.token)).status,404);
  await assert.rejects(competition.shareChallenge(host.id,source.attempt.id));
  const e=await finishAttempt(host,source.attempt.id);const shared=await competition.shareChallenge(host.id,source.attempt.id);
  assert.notEqual(shared.id,challenge.id);assert.equal(shared.challengeId,challenge.id);assert.equal(shared.targetPoints,challengePoints(scoreFromEvidence(e)));
  const publicView=await response(api(null).challenge(request(null),shared.token));assert.equal(publicView.status,200);assert.equal(publicView.data.challenge.hostName,'Shonky');assert.equal(publicView.data.challenge.owner,false);
  const raw=JSON.stringify(publicView.data);for(const secret of [host.id,host.email,host.name,'seed','randomCursor','private-pickup','private-card','timeline','roster'])assert.ok(!raw.includes(secret),secret);
  const first=await competition.reserveAttempt(friend.id,shared.token);const secondShare=await competition.shareChallenge(host.id,source.attempt.id);
  assert.equal((await competition.reserveAttempt(friend.id,secondShare.token)).attempt.id,first.attempt.id);
  assert.equal((await competition.reserveAttempt(host.id,shared.token)).attempt.id,source.attempt.id);
  await assert.rejects(competition.revokeChallenge(friend.id,shared.id));await competition.revokeChallenge(host.id,shared.id);
  const revoked=await response(api(null).challenge(request(null),shared.token));assert.equal(revoked.status,404);assert.equal(revoked.headers.get('Netlify-CDN-Cache-Control'),'no-store');
  assert.equal((await competition.challenge(secondShare.token,null)).challengeId,challenge.id);
});

test('Original Rules invitation grants only the entitled host’s exact challenge, never creation or rehosting rights',async()=>{
  const host=await account(),friend=await account();await assert.rejects(custom(friend,4),/Original Rules access/);
  entitled.add(host.id);const original=await custom(host,4);const source=await competition.reserveAttempt(host.id,original.token);await finishAttempt(host,source.attempt.id);
  const shared=await competition.shareChallenge(host.id,source.attempt.id),freeAttempt=await competition.reserveAttempt(friend.id,shared.token);
  assert.equal(freeAttempt.room!.game,4);assert.equal((await records.allEvidence(friend.id))[0].eligible,true);
  await finishAttempt(friend,freeAttempt.attempt.id);await assert.rejects(competition.shareChallenge(friend.id,freeAttempt.attempt.id),/Original Rules access/);
  entitled.delete(host.id);const newcomer=await account();await assert.rejects(competition.reserveAttempt(newcomer.id,shared.token),/Original Rules access/);
});

test('daily and rule-of-week publication is stable per Sydney calendar key and keeps server-only seeds',async()=>{
  now=sydneyMidnight('2026-10-22')+12*3600000;
  const owner=await account();const [one,two]=await Promise.all([competition.publishCalendar(),competition.publishCalendar()]);
  assert.equal(one.daily.id,two.daily.id);assert.equal(one.daily.token,two.daily.token);assert.equal(one.daily.config.seed,two.daily.config.seed);
  assert.equal((await db.query("SELECT id FROM competition_challenges WHERE kind='daily' AND day=$1",[one.calendar.day])).rows.length,1);
  const descriptor=await competition.challenge(one.daily.token,null);assert.equal(descriptor.owner,false);assert.ok([1,2,3].includes(descriptor.game));
  assert.ok(!JSON.stringify(descriptor).includes(one.daily.config.seed));const weekly=one.ruleWeek.id;
  now=sydneyMidnight('2026-10-23');const next=await competition.publishCalendar();assert.notEqual(next.daily.id,one.daily.id);assert.equal(next.ruleWeek.id,weekly);
  await assert.rejects(competition.reserveAttempt(owner.id,one.daily.token),/daily deal is closed/);
  now=sydneyMidnight('2026-10-26');assert.notEqual((await competition.publishCalendar()).ruleWeek.id,weekly);
});

test('daily expiry at the fixed grace deadline records a withdrawal; reconnect never resets the deal',async()=>{
  now=sydneyMidnight('2026-11-03')+23*3600000;const owner=await account(),{daily}=await competition.publishCalendar();
  const first=await competition.reserveAttempt(owner.id,daily.token);assert.equal(first.attempt.deadlineAt,sydneyMidnight('2026-11-04')+2*3600000);
  now=first.attempt.deadlineAt-1;assert.equal((await competition.reserveAttempt(owner.id,daily.token)).attempt.id,first.attempt.id);
  const room=await competition.rooms.load(first.roomCode);assert.throws(()=>applyChallengeAction(room!.room,room!.room.hostId,{type:'draw',source:'stock'},first.attempt.deadlineAt),/attempt has closed/);
  now=first.attempt.deadlineAt;await competition.settle([owner.id]);assert.equal((await attemptRow(first.attempt.id)).status,'abandoned');assert.equal((await competition.rooms.load(first.roomCode)),null);
  assert.equal((await competition.reserveAttempt(owner.id,daily.token)).attempt.id,first.attempt.id);assert.equal((await records.aggregate(owner.id)).summary.abandoned,1);
});

test('a lost challenge table is a service interruption in both competition and lifetime records, with no replacement first try',async()=>{
  const owner=await account(),challenge=await custom(owner),attempt=await competition.reserveAttempt(owner.id,challenge.token);
  await db.query('DELETE FROM rooms WHERE code=$1',[attempt.roomCode]);await competition.settle([owner.id]);
  const result=await attemptRow(attempt.attempt.id);assert.equal(result.status,'service-interrupted');assert.equal(challengePoints(result.score),null);
  const evidence=(await records.allEvidence(owner.id))[0];assert.equal(evidence.status,'service-interrupted');assert.equal(evidence.eligible,false);
  assert.equal((await records.aggregate(owner.id)).summary.attempts,0);assert.equal((await competition.reserveAttempt(owner.id,challenge.token)).attempt.id,attempt.attempt.id);
});

test('sharing yesterday’s daily preserves its seed and first-attempt identity without retroactive weekly points',async()=>{
  now=sydneyMidnight('2026-11-05')+12*3600000;const host=await account(),friend=await account(),{daily}=await competition.publishCalendar();
  const source=await competition.reserveAttempt(host.id,daily.token);await finishAttempt(host,source.attempt.id);const shared=await competition.shareChallenge(host.id,source.attempt.id);
  now=sydneyMidnight('2026-11-06')+12*3600000;const attempt=await competition.reserveAttempt(friend.id,shared.token);await finishAttempt(friend,attempt.attempt.id);
  assert.equal((await attemptRow(attempt.attempt.id)).daily_day,null);assert.equal((await competition.snapshot(friend.id)).weekly.attempts,0);
  assert.equal((await competition.reserveAttempt(host.id,shared.token)).attempt.id,source.attempt.id);
});

test('club invitations require member consent and owner approval, and privacy closes immediately after leave or block',async()=>{
  const owner=await account(),member=await account(),outsider=await account(),club=await competition.createClub(owner.id,'The Parkes Table');
  await assert.rejects(competition.club(outsider.id,club.id));const requested=await competition.requestClub(member.id,club.code);assert.equal(requested.status,'pending');
  await assert.rejects(competition.club(member.id,club.id));const pending=(await competition.club(owner.id,club.id)).members.find(m=>m.status==='pending')!;
  await assert.rejects(competition.clubAction(member.id,'approveMember',club.id,pending.id));await competition.clubAction(owner.id,'approveMember',club.id,pending.id);
  const joined=await competition.club(member.id,club.id);assert.equal(joined.members.length,2);for(const secret of [owner.id,member.id,owner.email,member.email,owner.name])assert.ok(!JSON.stringify(joined).includes(secret));
  await assert.rejects(competition.clubAction(owner.id,'leaveClub',club.id),/Transfer ownership/);await competition.clubAction(member.id,'leaveClub',club.id);await assert.rejects(competition.club(member.id,club.id));
  await competition.requestClub(member.id,club.code);const another=(await competition.club(owner.id,club.id)).members.find(m=>m.status==='pending')!;await competition.clubAction(owner.id,'blockMember',club.id,another.id);
  await assert.rejects(competition.requestClub(member.id,club.code));await competition.clubAction(owner.id,'unblockMember',club.id,another.id);
  await competition.clubAction(owner.id,'rotateClubCode',club.id);await assert.rejects(competition.requestClub(outsider.id,club.code));
});

test('club consistency includes all dealt attempts while contributions and private cards remain finalized only',async()=>{
  now=sydneyMidnight('2026-11-09')+12*3600000;const owner=await account(),member=await account(),club=await competition.createClub(owner.id,'Opening Club');
  await competition.requestClub(member.id,club.code);const pending=(await competition.club(owner.id,club.id)).members.find(m=>m.status==='pending')!;await competition.clubAction(owner.id,'approveMember',club.id,pending.id);
  const settled=finalEvidence('member-seat');await store(member,settled);
  await store(member,finalEvidence('pending-seat',{status:'started',finishedAt:null,readyFromDeal:true,actualOpening:{turn:1,actionId:2,opening:opening('pending-seat')},penalty:200,achievements:['born-ready']}));
  const different=finalEvidence('different-seat');different.conditions.hints=true;await store(member,different);
  const view=await competition.club(owner.id,club.id),same=view.consistency.find(c=>!c.conditions.hints)!;
  assert.equal(same.attempts,2);assert.equal(same.pending,1);assert.equal(same.completed,1);assert.equal(same.completionRate,.5);assert.equal(same.averagePenalty,0);assert.equal(same.provisional,true);
  assert.equal(view.consistency.length,2);assert.equal(view.goal.completed,1);assert.equal(view.goal.contributions.find(m=>m.memberId===pending.id)!.count,1);
  assert.equal(view.ruleRecords.length,2);const fastest=view.ruleRecords.find(c=>!c.conditions.hints)!;assert.equal(fastest.bestOpeningTurn,2);assert.equal(fastest.attempts,2);assert.equal(fastest.completionRate,.5);assert.equal(fastest.rank,1);
  const serialized=JSON.stringify(view);for(const secret of ['private-card','private-pickup','private-seat-name','timeline','born-ready',member.id,member.email])assert.ok(!serialized.includes(secret),secret);
});

test('club weekly best-five excludes pre-join attempts and archives shared first place once after Monday’s deadline',async()=>{
  now=sydneyMidnight('2026-11-16')+12*3600000;const owner=await account(),member=await account(),late=await account(),club=await competition.createClub(owner.id,'Weekly Club');
  await competition.requestClub(member.id,club.code);const pending=(await competition.club(owner.id,club.id)).members.find(m=>m.status==='pending')!;await competition.clubAction(owner.id,'approveMember',club.id,pending.id);
  const {daily}=await competition.publishCalendar();for(const user of [owner,member,late]){const attempt=await competition.reserveAttempt(user.id,daily.token);await finishAttempt(user,attempt.attempt.id);}
  now+=3600000;await competition.requestClub(late.id,club.code);const latePending=(await competition.club(owner.id,club.id)).members.find(m=>m.status==='pending')!;await competition.clubAction(owner.id,'approveMember',club.id,latePending.id);
  let view=await competition.club(owner.id,club.id);assert.equal(view.weekly.length,2);assert.ok(view.weekly.every(row=>row.rank===1));assert.equal(view.trophies.length,0);
  now=sydneyMidnight('2026-11-23')+2*3600000-1;view=await competition.club(owner.id,club.id);assert.equal(view.trophies.length,0);
  now++;view=await competition.club(owner.id,club.id);assert.equal(view.trophies.length,2);assert.ok(view.trophies.every(t=>t.week==='2026-11-16'));
  assert.equal((await competition.club(owner.id,club.id)).trophies.length,2);
});

test('a winner leaving after the week closes receives the immutable trophy before membership disappears',async()=>{
  now=sydneyMidnight('2026-11-30')+12*3600000;const owner=await account(),winner=await account(),club=await competition.createClub(owner.id,'Departure Club');
  await competition.requestClub(winner.id,club.code);const pending=(await competition.club(owner.id,club.id)).members.find(m=>m.status==='pending')!;await competition.clubAction(owner.id,'approveMember',club.id,pending.id);
  const {daily}=await competition.publishCalendar(),attempt=await competition.reserveAttempt(winner.id,daily.token);await finishAttempt(winner,attempt.attempt.id);
  now=sydneyMidnight('2026-12-07')+3*3600000;
  await competition.clubAction(winner.id,'leaveClub',club.id);
  const trophies=(await db.query<{user_id:string}>('SELECT user_id FROM competition_trophies WHERE club_id=$1 AND week=$2',[club.id,'2026-11-30'])).rows;
  assert.deepEqual(trophies,[{user_id:winner.id}]);assert.equal((await competition.club(owner.id,club.id)).trophies.length,1);
  await assert.rejects(competition.club(winner.id,club.id));
});

test('friend duel requires explicit recipient acceptance, exposes exactly three fixed deals and counts only first attempts',async()=>{
  const first=await account(),second=await account(),outsider=await account(),friendId=await friends(first,second);
  const invitation=await competition.createDuel(first.id,friendId);assert.equal(invitation.status,'pending');assert.equal(invitation.challenges.length,0);
  await assert.rejects(competition.duel(outsider.id,invitation.id));await assert.rejects(competition.duelAction(first.id,'acceptDuel',invitation.id));
  await competition.duelAction(second.id,'acceptDuel',invitation.id);let duel=await competition.duel(first.id,invitation.id);assert.equal(duel.challenges.length,3);assert.equal(new Set(duel.challenges.map(c=>c.challengeId)).size,3);
  await assert.rejects(competition.duelAction(first.id,'revokeDuel',invitation.id),/accepted duel keeps its first attempts/);
  for(const challenge of duel.challenges){
    await assert.rejects(competition.reserveAttempt(outsider.id,challenge.token));
    for(const user of [first,second]){const attempt=await competition.reserveAttempt(user.id,challenge.token);await finishAttempt(user,attempt.attempt.id);}
  }
  duel=await competition.duel(first.id,invitation.id);assert.equal(duel.complete,true);assert.equal(duel.outcome,'tie');assert.equal(duel.you.completedDeals,3);assert.equal(duel.other!.completedDeals,3);
  await assert.rejects(competition.duelAction(second.id,'revokeDuel',invitation.id),/accepted duel keeps its first attempts/);
  const replay=await competition.reserveAttempt(first.id,duel.challenges[0].token,true);await finishAttempt(first,replay.attempt.id,{actualOpening:{turn:2,actionId:5,opening:opening('practice')},closingTurns:1,ownTurns:3});
  assert.equal((await competition.duel(first.id,invitation.id)).you.points,duel.you.points);
  await records.friendAction(first.id,'unfriend',friendId);const ended=await competition.duel(first.id,invitation.id);assert.equal(ended.status,'revoked');assert.equal(ended.other,null);assert.equal(ended.challenges.length,0);
});

test('rematch uses verified shared evidence and accepted friendship, and duplicate acceptance creates one ordinary social table',async()=>{
  const first=await account(),second=await account(),outsider=await account(),friendId=await friends(first,second);
  await assert.rejects(competition.createRematch(first.id,friendId,'invented-hand'));
  const one=finalEvidence('first-seat'),two=finalEvidence('second-seat',{gameId:one.gameId,handId:one.handId,startedAt:one.startedAt,wentOut:false,penalty:25});await store(first,one);await store(second,two);
  const comparison=await records.comparison(first.id,friendId);assert.deepEqual(comparison.rematchHands,[{handId:one.handId,game:1,ruleNumber:1,startedAt:one.startedAt}]);
  const invitation=await competition.createRematch(first.id,friendId,one.handId);assert.equal(invitation.status,'pending');assert.equal(invitation.roomCode,null);
  await assert.rejects(competition.rematchAction(first.id,'acceptRematch',invitation.id));await assert.rejects(competition.rematchInvitation(outsider.id,invitation.token));
  const [accepted,retried]=await Promise.all([competition.rematchAction(second.id,'acceptRematch',invitation.id),competition.rematchAction(second.id,'acceptRematch',invitation.id)]);
  assert.ok('roomCode' in accepted&&'roomCode' in retried);assert.equal(accepted.roomCode,retried.roomCode);
  const room=await competition.rooms.load(accepted.roomCode!);assert.equal(room!.room.status,'lobby');assert.ok(!('challenge' in room!.room));assert.equal(room!.room.ranked,undefined);assert.equal(room!.room.players.length,2);assert.deepEqual(room!.memberships.map(m=>m.userId).sort(),[first.id,second.id].sort());
  await assert.rejects(competition.rematchAction(first.id,'revokeRematch',invitation.id),/managed through its game table/);
});

test('account deletion cascades private competition ownership, invitations and attempts while another account’s earned evidence survives',async()=>{
  const host=await account(),friend=await account(),challenge=await custom(host),first=await competition.reserveAttempt(host.id,challenge.token);await finishAttempt(host,first.attempt.id);
  const invite=await competition.shareChallenge(host.id,first.attempt.id),second=await competition.reserveAttempt(friend.id,invite.token);await finishAttempt(friend,second.attempt.id);
  const club=await competition.createClub(host.id,'Delete Me Club');await db.query('DELETE FROM "user" WHERE id=$1',[host.id]);
  for(const [table,key,value] of [['competition_challenges','id',challenge.id],['competition_invitations','id',invite.id],['competition_clubs','id',club.id],['competition_attempts','id',first.attempt.id]])assert.equal((await db.query(`SELECT 1 FROM ${table} WHERE ${key}=$1`,[value])).rows.length,0);
  assert.equal((await records.allEvidence(friend.id)).filter(e=>e.status==='completed').length,1);await assert.rejects(competition.challenge(invite.token,null));
});

test('unsupported frozen versions fail closed without reserving an attempt or silently changing the seed',async()=>{
  const owner=await account(),challenge=await custom(owner),row=(await db.query<{config:ChallengeConfig}>('SELECT config FROM competition_challenges WHERE id=$1',[challenge.id])).rows[0];
  await db.query("UPDATE competition_challenges SET config=jsonb_set(config,'{engineVersion}','\"unknown-future-version\"'::jsonb) WHERE id=$1",[challenge.id]);
  await assert.rejects(competition.reserveAttempt(owner.id,challenge.token),/frozen challenge version is unavailable/);
  assert.equal((await db.query('SELECT id FROM competition_attempts WHERE user_id=$1',[owner.id])).rows.length,0);
  assert.equal((await db.query<{seed:string}>("SELECT config->>'seed' AS seed FROM competition_challenges WHERE id=$1",[challenge.id])).rows[0].seed,row.config.seed);
});
