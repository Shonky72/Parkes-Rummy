import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import type { QueryResultRow } from 'pg';
import type { SqlDatabase, SqlConnection } from '../db';
import { RecordsRepository, RECORDS_SCHEMA, recordsWriteCtes, redactSharedRecord } from '../db/records';
import { PostgresRoomRepository } from '../db/room-repository';
import { PostgresRequestSecurity } from '../db/security';
import { createRecordsHandlers } from '../lib/records-server';
import { sharedRecordImage } from '../lib/records-share-image';
import { createRoom, createPlayer, applyAction, enableRecords, publicRoom } from '../lib/rummy';
import { accountMarker, type AccountUser } from '../lib/auth-config';
import { RECORDS_ENGINE_VERSION, type RecordEvidence, type RoomRecordEvent } from '../lib/records-types';
import type { Meld } from '../lib/types';

const pg=new PGlite();
const statements:string[]=[];
function connection(target:Pick<PGlite|Transaction,'query'>):SqlConnection {
  return {async query<T extends QueryResultRow>(sql:string,values?:unknown[]){statements.push(sql);const result=await target.query<T>(sql,values);return {rows:result.rows,rowCount:result.affectedRows??result.rows.length};}};
}
const db:SqlDatabase={...connection(pg),transaction:work=>pg.transaction(tx=>work(connection(tx)))};
const records=new RecordsRepository(db),rooms=new PostgresRoomRepository(db);
const security=new PostgresRequestSecurity(db);
const API=(user:AccountUser|null)=>createRecordsHandlers({records,security,resolveSession:async()=>user});
const req=(user:AccountUser|null,body?:unknown,path='/api/records',pin?:string,origin='https://parkesrummy.com')=>new Request(`https://internal--parkes-rummy.netlify.app:80${path}`,{
  method:body===undefined?'GET':'POST',headers:{'x-nf-client-connection-ip':'192.0.2.21',Origin:origin,'Content-Type':'application/json','X-Parkes-Identity':pin??(user?accountMarker(user.id):'guest')},...(body===undefined?{}:{body:JSON.stringify(body)}),
});
async function user(name='Private Google Name') {
  const result:AccountUser={id:crypto.randomUUID(),name,email:`${crypto.randomUUID()}@example.test`,image:null};
  await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[result.id,result.name,result.email]);
  return result;
}
const opening=(playerId:string):Meld[]=>[{id:'private-meld-id',ownerId:playerId,kind:'run',constraint:'any',cards:[5,6,7,8,9].map((rank,i)=>({id:`private-card-${i}`,rank,suit:'H' as const}))}];
function evidence(playerId:string,overrides:Partial<RecordEvidence>={}):RecordEvidence {
  const cards=opening(playerId),now=Date.now();
  return {schemaVersion:1,gameId:crypto.randomUUID(),handId:crypto.randomUUID(),playerId,game:1,ruleNumber:1,ruleId:'1:1',handNumber:1,startedAt:now,finishedAt:now+10,status:'completed',eligible:true,exclusionReason:null,
    conditions:{engineVersion:RECORDS_ENGINE_VERSION,format:'quick-play',deal:'random',playerCount:2,humanCount:1,seat:0,startingSeat:0,roster:[{playerId,name:'private-owner-name',isBot:false,difficulty:'easy'},{playerId:'ai-private-id',name:'AI',isBot:true,difficulty:'easy'}],hints:true,timerSeconds:0},
    readyFromDeal:false,firstDrawReady:true,firstDrawCompletedOpening:true,firstReady:{turn:1,actionId:2,opening:cards},firstLegal:{turn:2,actionId:6,opening:cards},actualOpening:{turn:2,actionId:7,opening:cards},opportunitiesPassed:0,legalOpportunityTurns:[2],firstDiscardSurvived:true,readinessLostOnDiscard:0,completed:true,wentOut:true,closingTurns:2,penalty:0,totalScore:0,ownTurns:4,wildcardCount:0,naturalEligible:true,achievements:['first-chance','natural-talent'],timeline:[{kind:'draw',turn:1,actionId:2,ready:true,legal:false,cards:[{id:'private-pickup',rank:11,suit:'D'}],text:'Private pickup'}],timelineTruncated:false,gameOutcome:null,endActionId:10,...overrides};
}
async function store(owner:AccountUser,entry:RecordEvidence) {
  await records.ensure();
  await db.query('INSERT INTO records_evidence(user_id,hand_id,game_id,player_id,room_code,rule_id,status,source_event,started_at,updated_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)',[owner.id,entry.handId,entry.gameId,entry.playerId,'TEST',entry.ruleId,entry.status,`${entry.handId}:end`,entry.startedAt,entry.finishedAt??entry.startedAt,JSON.stringify(entry)]);
}
async function response(value:Promise<Response>){const r=await value;return{status:r.status,headers:r.headers,data:await r.json()};}
before(async()=>{
  await pg.query(await readFile(new URL('../db/schema-editor.sql',import.meta.url),'utf8'));
  await records.ensure();
});
after(async()=>{await pg.close();});

test('records migration is repeatable and its provisioning file stays identical',async()=>{
  await db.query(RECORDS_SCHEMA);
  const sql=await readFile(new URL('../db/records-migration.sql',import.meta.url),'utf8');
  assert.ok(sql.includes(RECORDS_SCHEMA));
});

test('profile requires a real session, identity pin, legitimate origin and private caching',async()=>{
  const owner=await user();
  assert.equal((await API(null).snapshot(req(null))).status,401);
  assert.equal((await API(owner).snapshot(req(owner,undefined,'/api/records','account:forged'))).status,401);
  assert.equal((await API(owner).mutate(req(owner,{action:'profile',displayName:'Shonky',featuredBadges:[]},'/api/records',undefined,'https://evil.test'))).status,403);
  const value=await response(API(owner).snapshot(req(owner)));
  assert.equal(value.status,200);
  assert.equal(value.data.profile.displayName,'Player');
  assert.ok(!JSON.stringify(value.data).includes(owner.email));
  assert.ok(!JSON.stringify(value.data).includes(owner.name));
  assert.match(value.headers.get('Cache-Control')!,/private.*no-store/);
  assert.equal(value.headers.get('Netlify-CDN-Cache-Control'),'no-store');
  const other=await user();await store(other,evidence('other-seat'));
  const mine=await response(API(owner).snapshot(req(owner)));
  assert.equal(mine.data.history.length,0);
  const cross=new Request(req(owner),{headers:{'Sec-Fetch-Site':'cross-site','X-Parkes-Identity':accountMarker(owner.id)}});
  assert.equal((await API(owner).snapshot(cross)).status,403);
});

test('featured badges are earned, limited to three and names never use an email',async()=>{
  const owner=await user();await store(owner,evidence('profile-seat'));
  assert.equal((await API(owner).mutate(req(owner,{action:'profile',displayName:owner.email,featuredBadges:[]}))).status,400);
  assert.equal((await API(owner).mutate(req(owner,{action:'profile',displayName:'Shonky',featuredBadges:['all-rounder']}))).status,400);
  assert.equal((await API(owner).mutate(req(owner,{action:'profile',displayName:'Shonky',featuredBadges:['first-chance','natural-talent','all-rounder','born-ready']}))).status,400);
  const saved=await response(API(owner).mutate(req(owner,{action:'profile',displayName:'Shonky',featuredBadges:['first-chance']})));
  assert.equal(saved.status,200);assert.deepEqual(saved.data.profile.featuredBadges,['first-chance']);
});

test('room boundary captures only authenticated starting memberships, drains atomically and preserves CAS',async()=>{
  const owner=await user();
  let room=createRoom('RONE',createPlayer({id:'owner-seat',name:'Owner',color:0,tokenHash:'private-secret'}));
  room=applyAction(room,'owner-seat',{type:'addBot',difficulty:'easy'});
  enableRecords(room);await rooms.insert(room,{userId:owner.id,playerId:'owner-seat'});
  const previous=room.version;room=applyAction(room,'owner-seat',{type:'start'});
  assert.equal(await rooms.save(room,previous,undefined,{membershipUnchanged:true}),true);
  assert.equal(room.records!.events.length,0);
  let captured=await records.allEvidence(owner.id);
  assert.equal(captured.length,1);assert.equal(captured[0].status,'started');
  const current=await rooms.load(room.code);assert.equal(current!.room.records!.events.length,0);
  assert.ok(!JSON.stringify(publicRoom(room,'owner-seat')).includes('firstReady'));
  assert.ok(!JSON.stringify(publicRoom(room,'owner-seat')).includes('records'));
  const ordinary={...room,version:room.version+1,updatedAt:Date.now()};
  const count=statements.length;assert.equal(await rooms.save(ordinary,room.version,undefined,{membershipUnchanged:true}),true);
  assert.equal(statements.length-count,1);assert.match(statements.at(-1)!,/^UPDATE rooms/);
  const final=evidence('owner-seat',{gameId:room.records!.gameId,handId:room.records!.handId!,startedAt:captured[0].startedAt});
  const completion:RoomRecordEvent={eventId:`${final.handId}:owner-seat:hand-end`,type:'hand-end',gameId:final.gameId,handId:final.handId,playerId:final.playerId,status:final.status,at:final.finishedAt!,evidence:final};
  const ended=structuredClone(ordinary);ended.version++;ended.records!.events=[completion];ended.records!.current['owner-seat']=final;
  const stale=structuredClone(ended);
  assert.equal(await rooms.save(ended,ordinary.version,undefined,{membershipUnchanged:true}),true);
  assert.equal(await rooms.save(stale,ordinary.version,undefined,{membershipUnchanged:true}),false);
  assert.equal(stale.records!.events.length,1);
  captured=await records.allEvidence(owner.id);assert.equal(captured.length,1);assert.equal(captured[0].status,'completed');
  assert.equal((await records.aggregate(owner.id)).achievements.find(a=>a.id==='first-chance')?.count,1);
  const retry=structuredClone(ended);retry.version++;retry.records!.events=[completion];
  assert.equal(await rooms.save(retry,ended.version,undefined,{membershipUnchanged:true}),true);
  assert.equal((await records.allEvidence(owner.id)).length,1);
});

test('essential evidence failure rolls back the game update rather than losing an earned result',async()=>{
  const owner=await user();let room=createRoom('RERR',createPlayer({id:'error-seat',name:'Owner',color:0,tokenHash:'secret'}));
  room=applyAction(room,'error-seat',{type:'addBot',difficulty:'easy'});enableRecords(room);await rooms.insert(room,{userId:owner.id,playerId:'error-seat'});
  const previous=room.version;room=applyAction(room,'error-seat',{type:'start'});
  await db.query(`CREATE FUNCTION reject_record_test() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'synthetic evidence write failure'; END; $$ LANGUAGE plpgsql`);
  await db.query('CREATE TRIGGER reject_record_test BEFORE INSERT ON records_evidence FOR EACH ROW EXECUTE FUNCTION reject_record_test()');
  await assert.rejects(rooms.save(room,previous,undefined,{membershipUnchanged:true}),/synthetic evidence/);
  await db.query('DROP TRIGGER reject_record_test ON records_evidence');await db.query('DROP FUNCTION reject_record_test()');
  assert.equal((await rooms.load(room.code))!.version,previous);
  assert.ok(room.records!.events.length>0);
  assert.equal(await rooms.save(room,previous,undefined,{membershipUnchanged:true}),true);
});

test('late sign-in cannot claim a guest deal and a finished event cannot transfer its original account ownership',async()=>{
  const original=await user(),late=await user();
  let room=createRoom('LATE',createPlayer({id:'original-seat',name:'Original',color:0,tokenHash:'secret'}));
  room.players.push(createPlayer({id:'guest-seat',name:'Guest',color:1,tokenHash:'guest-secret'}));
  enableRecords(room);await rooms.insert(room,{userId:original.id,playerId:'original-seat'});
  const previous=room.version;room=applyAction(room,'original-seat',{type:'start'});await rooms.save(room,previous,undefined,{membershipUnchanged:true});
  await db.query('DELETE FROM room_memberships WHERE room_code=$1',[room.code]);
  await db.query('INSERT INTO room_memberships(room_code,user_id,player_id) VALUES($1,$2,$3)',[room.code,late.id,'original-seat']);
  const prior=room.version;room.version++;
  room.records!.events=room.players.map(player=>{
    const final=evidence(player.id,{gameId:room.records!.gameId,handId:room.records!.handId!,startedAt:room.records!.current[player.id].startedAt});
    return {eventId:`${final.handId}:${player.id}:hand-end`,type:'hand-end',gameId:final.gameId,handId:final.handId,playerId:player.id,status:'completed',at:final.finishedAt!,evidence:final};
  });
  await rooms.save(room,prior,undefined,{membershipUnchanged:true});
  assert.equal((await records.allEvidence(original.id)).length,1);
  assert.equal((await records.allEvidence(original.id))[0].status,'completed');
  assert.equal((await records.allEvidence(late.id)).length,0);
});

test('deliberate table deletion retains unfinished attempts and penalty evidence; completed evidence survives room deletion',async()=>{
  const owner=await user();let room=createRoom('RDEL',createPlayer({id:'delete-seat',name:'Owner',color:0,tokenHash:'secret'}));
  room=applyAction(room,'delete-seat',{type:'addBot',difficulty:'easy'});enableRecords(room);await rooms.insert(room,{userId:owner.id,playerId:'delete-seat'});
  const before=room.version;room=applyAction(room,'delete-seat',{type:'start'});await rooms.save(room,before,undefined,{membershipUnchanged:true});
  assert.equal(await rooms.delete(room.code,room.version-1),false);
  assert.equal(await rooms.delete(room.code,room.version),true);
  const kept=await records.allEvidence(owner.id);assert.equal(kept.length,1);assert.equal(kept[0].status,'abandoned');assert.equal(typeof kept[0].penalty,'number');
  assert.equal((await records.aggregate(owner.id)).summary.abandoned,1);
  assert.equal(await rooms.load(room.code),null);
  const completedOwner=(await db.query<{user_id:string}>("SELECT user_id FROM records_evidence WHERE room_code='RONE' LIMIT 1")).rows[0].user_id;
  const completedRoom=await rooms.load('RONE');await rooms.delete('RONE',completedRoom!.version);
  assert.equal((await records.allEvidence(completedOwner))[0].status,'completed');
});

test('started hands reveal no cards or readiness through profile history or badges',async()=>{
  const owner=await user(),entry=evidence('live-seat',{status:'started',finishedAt:null,readyFromDeal:true,achievements:['born-ready']});await store(owner,entry);
  const result=await response(API(owner).snapshot(req(owner)));
  assert.equal(result.status,200);assert.equal(result.data.history.length,0);
  assert.equal(result.data.summary.achievements.find((a:{id:string})=>a.id==='born-ready').count,0);
  assert.ok(!JSON.stringify(result.data).includes('private-card'));
});

test('a host closing a table records their withdrawal without penalizing another human as a quitter',async()=>{
  const host=await user(),guest=await user();
  let room=createRoom('HCLO',createPlayer({id:'closure-host',name:'Host',color:0,tokenHash:'host-secret'}));
  room.players.push(createPlayer({id:'closure-guest',name:'Guest',color:1,tokenHash:'guest-secret'}));
  enableRecords(room);await rooms.insert(room,{userId:host.id,playerId:'closure-host'});
  await db.query('INSERT INTO room_memberships(room_code,user_id,player_id) VALUES($1,$2,$3)',[room.code,guest.id,'closure-guest']);
  const previous=room.version;room=applyAction(room,'closure-host',{type:'start'});await rooms.save(room,previous,undefined,{membershipUnchanged:true});
  await rooms.delete(room.code,room.version);
  const hostEvidence=(await records.allEvidence(host.id))[0],guestEvidence=(await records.allEvidence(guest.id))[0];
  assert.equal(hostEvidence.status,'abandoned');assert.equal(hostEvidence.eligible,true);
  assert.equal(guestEvidence.status,'service-interrupted');assert.equal(guestEvidence.eligible,false);assert.equal(guestEvidence.exclusionReason,'host closed the table');
  assert.equal((await records.aggregate(guest.id)).summary.abandoned,0);
});

test('friends require explicit acceptance; comparisons redact private evidence and honor cohort boundaries, revoke and block',async()=>{
  const first=await user(),second=await user(),outsider=await user();
  const [firstProfile,secondProfile]=await Promise.all([records.profile(first.id),records.profile(second.id)]);
  const initialCode=secondProfile.friendCode;
  await records.requestFriend(first.id,initialCode);
  let lists=await records.friends(second.id);assert.equal(lists.incoming.length,1);const id=lists.incoming[0].id;
  await assert.rejects(records.comparison(first.id,id));
  await assert.rejects(records.friendAction(first.id,'acceptFriend',id));
  await assert.rejects(records.friendAction(outsider.id,'acceptFriend',id));
  await records.friendAction(second.id,'acceptFriend',id);
  await store(first,evidence('first-player'));await store(second,evidence('second-player'));
  const mismatched=evidence('third-player');mismatched.conditions.hints=false;await store(second,mismatched);
  const compared=await records.comparison(first.id,id);assert.equal(compared.comparisons.length,1);
  assert.equal(compared.comparisons[0].friend.attempts,1);
  const serialized=JSON.stringify(compared);assert.ok(!serialized.includes('private-card'));assert.ok(!serialized.includes(first.email));assert.ok(!serialized.includes(second.id));assert.ok(!serialized.includes('timeline'));
  await assert.rejects(records.comparison(outsider.id,id));
  await records.friendAction(first.id,'unfriend',id);await assert.rejects(records.comparison(first.id,id));
  await records.requestFriend(first.id,initialCode);lists=await records.friends(second.id);const blockedFriend=lists.incoming[0].id;
  await records.friendAction(second.id,'blockFriend',blockedFriend);await assert.rejects(records.requestFriend(first.id,initialCode));
  const blocks=await records.friends(second.id);assert.equal(blocks.blocked.length,1);
  await records.friendAction(second.id,'unblockFriend',blocks.blocked[0].id);
  assert.equal((await records.friends(first.id)).accepted.length,0);
  await records.rotateFriendCode(second.id);await assert.rejects(records.requestFriend(first.id,initialCode));
  assert.ok(firstProfile.friendCode!==secondProfile.friendCode);
});

test('concurrent friend requests and opposite acceptance do not bypass consent or duplicate a pair',async()=>{
  const a=await user(),b=await user();const pa=await records.profile(a.id),pb=await records.profile(b.id);
  await Promise.all([records.requestFriend(a.id,pb.friendCode),records.requestFriend(b.id,pa.friendCode)]);
  const aa=await records.friends(a.id),bb=await records.friends(b.id);
  assert.equal(aa.accepted.length+bb.accepted.length,0);
  assert.equal(aa.incoming.length+aa.outgoing.length,1);assert.equal(bb.incoming.length+bb.outgoing.length,1);
});

test('public shares select only owned completed qualifying openings and contain no private identifiers',async()=>{
  const owner=await user(),stranger=await user();await records.updateProfile(owner.id,'Shonky',[]);
  const entry=evidence('share-seat');await store(owner,entry);
  await assert.rejects(records.createShare(stranger.id,entry.handId));
  const share=await records.createShare(owner.id,entry.handId);assert.equal(share.token.length,43);
  const published=await records.shared(share.token);assert.equal(published!.headline,'Beat my record');assert.equal(published!.displayName,'Shonky');
  assert.equal(published!.opening[0].cards.length,5);
  const body=JSON.stringify(published);for(const privateValue of [owner.email,owner.id,entry.handId,entry.gameId,entry.playerId,'private-card','private-pickup','private-owner-name','timeline','tokenHash','stock'])assert.ok(!body.includes(privateValue),privateValue);
  await assert.rejects(records.revokeShare(stranger.id,share.id));
  const publicResponse=await API(null).shared(req(null),share.token);assert.ok(!(publicResponse instanceof Response));
  await records.revokeShare(owner.id,share.id);assert.equal(await records.shared(share.token),null);
  const revoked=await API(null).shared(req(null),share.token);assert.ok(revoked instanceof Response);assert.equal(revoked.status,404);assert.equal(revoked.headers.get('Netlify-CDN-Cache-Control'),'no-store');
  for(const overrides of [{status:'started' as const},{status:'abandoned' as const},{eligible:false},{completed:false},{actualOpening:null}])assert.throws(()=>redactSharedRecord({...entry,...overrides},'Shonky'));
});

test('share image is a real downloadable PNG with fixed dimensions and revocation-safe headers',async()=>{
  const rendered=sharedRecordImage(redactSharedRecord(evidence('image-seat'),'Shonky'));
  assert.equal(rendered.headers.get('Content-Type'),'image/png');
  assert.equal(rendered.headers.get('Netlify-CDN-Cache-Control'),'no-store');
  const bytes=Buffer.from(await rendered.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  assert.equal(bytes.readUInt32BE(16),1200);assert.equal(bytes.readUInt32BE(20),630);
});

test('records history uses stable pagination without leaking another account or future observations',async()=>{
  const owner=await user(),base=Date.now()-1000;
  for(let i=0;i<27;i++)await store(owner,evidence('paged-seat',{startedAt:base+i}));
  const first=await records.history(owner.id);assert.equal(first.history.length,25);assert.ok(first.pagination.nextCursor);
  const second=await records.history(owner.id,{cursor:first.pagination.nextCursor!});assert.equal(second.history.length,2);
  assert.equal(new Set([...first.history,...second.history].map(e=>e.handId)).size,27);
  await assert.rejects(records.history(owner.id,{cursor:'invalid'}));
});

test('account deletion cascades evidence, chosen name, shares, friendship and blocks',async()=>{
  const owner=await user(),friend=await user(),blocked=await user();
  const p=await records.profile(friend.id),bp=await records.profile(blocked.id);
  await records.requestFriend(owner.id,p.friendCode);const relation=(await records.friends(friend.id)).incoming[0];await records.friendAction(friend.id,'acceptFriend',relation.id);
  await records.requestFriend(owner.id,bp.friendCode);const block=(await records.friends(blocked.id)).incoming[0];await records.friendAction(owner.id,'blockFriend',block.id);
  const entry=evidence('delete-account-seat');await store(owner,entry);const share=await records.createShare(owner.id,entry.handId);
  await db.query('DELETE FROM "user" WHERE id=$1',[owner.id]);
  assert.equal((await records.allEvidence(owner.id)).length,0);assert.equal(await records.shared(share.token),null);
  assert.equal((await records.friends(friend.id)).accepted.length,0);
  for(const table of ['records_profiles','records_shares'])assert.equal((await db.query(`SELECT 1 FROM ${table} WHERE user_id=$1`,[owner.id])).rows.length,0);
  assert.equal((await db.query('SELECT 1 FROM records_blocks WHERE blocker_id=$1 OR blocked_id=$1',[owner.id])).rows.length,0);
});

test('record SQL uses event data parameters, never dynamic player strings',()=>{
  const sql=recordsWriteCtes(6);assert.match(sql,/\$6::jsonb/);assert.match(sql,/room_memberships/);assert.match(sql,/records_evidence.status='started'/);
});

test('profile and invitation probes enforce the account request budget',async()=>{
  const owner=await user();
  let final:Response|null=null;
  for(let i=0;i<31;i++){
    const request=req(owner,{action:'requestFriend',friendCode:'0000000000000000'});
    request.headers.set('x-nf-client-connection-ip','192.0.2.222');
    final=await API(owner).mutate(request);
  }
  assert.equal(final!.status,429);assert.match(final!.headers.get('Cache-Control')!,/private.*no-store/);
  assert.equal(final!.headers.get('Netlify-CDN-Cache-Control'),'no-store');
});
