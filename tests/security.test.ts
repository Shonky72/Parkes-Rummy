import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite,type Transaction} from '@electric-sql/pglite';
import type {QueryResultRow} from 'pg';
import type {SqlDatabase,SqlConnection} from '../db';
import {PostgresRoomRepository} from '../db/room-repository';
import {PostgresJoinRequests} from '../db/join-requests';
import {PostgresRequestSecurity,SecurityError,trustedClientIp} from '../db/security';
import {createRoomHandlers} from '../lib/room-server';
import {ROOM_PROTOCOL,ROOM_PROTOCOL_HEADER} from '../lib/room-protocol';
import {advertisingAllowed} from '../lib/advertising';
import {contentSecurityPolicy} from '../lib/security-headers';
import {applyAction} from '../lib/rummy';

const pg=new PGlite();
function connection(target:Pick<PGlite|Transaction,'query'>):SqlConnection{return {async query<T extends QueryResultRow>(sql:string,values?:unknown[]){const r=await target.query<T>(sql,values);return {rows:r.rows,rowCount:r.affectedRows??r.rows.length};}};}
const db:SqlDatabase={...connection(pg),transaction:work=>pg.transaction(tx=>work(connection(tx)))};
const repository=new PostgresRoomRepository(db),joins=new PostgresJoinRequests(db),security=new PostgresRequestSecurity(db);
const api=createRoomHandlers({repository,joins,security,resolveSession:async()=>null});
let counter=0;
const proof=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
function req(path:string,body?:unknown,token?:string,ip=`198.51.100.${++counter%250+1}`){return new Request(`https://parkesrummy.com${path}`,{method:body===undefined?'GET':'POST',headers:{Origin:'https://parkesrummy.com','Content-Type':'application/json',[ROOM_PROTOCOL_HEADER]:ROOM_PROTOCOL,'x-nf-client-connection-ip':ip,...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
async function create(){const r=await api.createRoomRequest(req('/api/rooms',{name:'Host'}));assert.equal(r.status,201);return r.json();}
async function submit(code:string,name='Newcomer',token=proof()){const r=await api.joinRoomRequest(req(`/api/rooms/${code}/join`,{name,requestToken:token}),code);return {status:r.status,data:await r.json(),token};}
async function decide(host:{room:{code:string};token:string},id:string,approve=true,token=host.token){return api.reviewJoinRequest(req(`/api/rooms/${host.room.code}/join-requests`,{id,decision:approve?'approve':'decline'},token),host.room.code);}
before(async()=>{await pg.query(await readFile(new URL('../db/schema-editor.sql',import.meta.url),'utf8'));});
after(async()=>{await pg.close();});

test('new guests wait without a seat; previews and applicant status disclose no player identities',async()=>{
 const host=await create(),candidate=await submit(host.room.code);
 assert.equal(candidate.status,202);
 assert.equal((await repository.load(host.room.code))!.room.players.length,1);
 const preview=await (await api.roomPreviewRequest(req('/preview'),host.room.code)).json();
 assert.equal(preview.preview.players,undefined);assert.equal(preview.preview.hostName,undefined);
 const own=await api.joinRequestsRequest(req('/requests?own=true',undefined,candidate.token),host.room.code);
 assert.equal(own.status,200);const ownData=await own.json();assert.equal(ownData.request.id,candidate.data.pending.id);assert.equal(ownData.request.player,undefined);
 const outsider=await api.joinRequestsRequest(req('/requests?own=true',undefined,proof()),host.room.code);assert.equal((await outsider.json()).request,null);
 assert.equal((await api.joinRequestsRequest(req('/requests',undefined,candidate.token),host.room.code)).status,403);
 assert.equal((await api.readRoomRequest(req('/room',undefined,candidate.token),host.room.code)).status,403);
 assert.equal((await decide(host,candidate.data.pending.id,true,candidate.token)).status,403);
 assert.equal((await decide(host,candidate.data.pending.id)).status,200);
 const admitted=await api.readRoomRequest(req('/room',undefined,candidate.token),host.room.code);assert.equal(admitted.status,200);
 const retry=await submit(host.room.code,'Newcomer',candidate.token);assert.equal(retry.status,200);
 assert.equal((await repository.load(host.room.code))!.room.players.length,2);
});

test('retries deduplicate; only a current host can approve; decline and removal cannot reuse an approval',async()=>{
 const host=await create(),candidate=await submit(host.room.code);
 const retry=await submit(host.room.code,'Newcomer',candidate.token);assert.equal(retry.data.pending.id,candidate.data.pending.id);
 assert.equal((await decide(host,candidate.data.pending.id,false)).status,200);
 assert.equal((await submit(host.room.code,'Newcomer',candidate.token)).status,403);
 const other=await submit(host.room.code,'Other');await decide(host,other.data.pending.id);
 const before=(await repository.load(host.room.code))!;
 const otherId=before.room.players.find(p=>p.tokenHash===createHash('sha256').update(other.token).digest('hex'))!.id;
 const next=applyAction(before.room,before.room.hostId,{type:'removePlayer',playerId:otherId});await repository.save(next,before.version);
 assert.equal((await submit(host.room.code,'Other',other.token)).status,403);
});

test('cancellation and expiry prevent approval, and closed lobbies reject pending admission',async()=>{
 const host=await create(),candidate=await submit(host.room.code);
 const cancel=new Request(req('/requests',undefined,candidate.token),{method:'DELETE'});
 assert.equal((await api.cancelJoinRequest(cancel,host.room.code)).status,200);
 assert.equal((await decide(host,candidate.data.pending.id)).status,200); // idempotent no-op
 assert.equal((await repository.load(host.room.code))!.room.players.length,1);
 const expired=await submit(host.room.code,'Expired');await db.query('UPDATE join_requests SET expires_at=$1 WHERE id=$2',[Date.now()-1,expired.data.pending.id]);
 assert.equal((await decide(host,expired.data.pending.id)).status,410);
 const pending=await submit(host.room.code,'Waiting');const record=(await repository.load(host.room.code))!;
 let next=applyAction(record.room,record.room.hostId,{type:'addBot',difficulty:'easy'});next=applyAction(next,next.hostId,{type:'start'});await repository.save(next,record.version);
 assert.equal((await decide(host,pending.data.pending.id)).status,409);
});

test('simultaneous approvals preserve eight-seat capacity without losing accepted memberships',async()=>{
 const host=await create();let record=(await repository.load(host.room.code))!,room=record.room;
 for(let i=0;i<6;i++)room=applyAction(room,room.hostId,{type:'addBot',difficulty:'easy'});
 await repository.save(room,record.version);
 const a=await submit(host.room.code,'A'),b=await submit(host.room.code,'B');
 const responses=await Promise.all([decide(host,a.data.pending.id),decide(host,b.data.pending.id)]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
 record=(await repository.load(host.room.code))!;assert.equal(record.room.players.length,8);
 const duplicate=await decide(host,responses[0].status===200?a.data.pending.id:b.data.pending.id);assert.equal(duplicate.status,200);
 assert.equal((await repository.load(host.room.code))!.room.players.length,8);
});

test('pending caps, room-generation binding and expired limiter cleanup are enforced',async()=>{
 const host=await create(),record=(await repository.load(host.room.code))!;
 for(let i=0;i<24;i++)await joins.submit(host.room.code,record.room.createdAt,`actor-${i}`,null,{...record.room.players[0],id:crypto.randomUUID(),name:`Guest ${i}`,tokenHash:proof()});
 await assert.rejects(()=>joins.submit(host.room.code,record.room.createdAt,'overflow',null,record.room.players[0]),(e:unknown)=>e instanceof SecurityError&&e.status===429);
 const entry=(await joins.list(host.room.code,record.room.createdAt))[0];
 await assert.rejects(()=>joins.decide(host.room.code,record.room.createdAt+1,record.room.hostId,entry.id,true),(e:unknown)=>e instanceof SecurityError&&e.status===403);
 const limiter=new PostgresRequestSecurity(db);await db.query("INSERT INTO security_limits(key,count,expires_at) VALUES('expired',1,1)");await db.query("UPDATE security_limits SET expires_at=1 WHERE key='cleanup'");await limiter.check(req('/check'),'read');
 assert.equal((await db.query("SELECT * FROM security_limits WHERE key='expired'")).rows.length,0);
});

test('forwarded header rotation cannot bypass creation limits; missing production identity fails closed',async()=>{
 const production=process.env.NODE_ENV;Object.assign(process.env,{NODE_ENV:'production'});
 try{
  for(let i=0;i<15;i++){const r=new Request(req('/create',{},undefined,'203.0.113.40'),{headers:{'x-nf-client-connection-ip':'203.0.113.40','x-vercel-forwarded-for':`192.0.2.${i}`,'x-forwarded-for':`192.0.2.${i}`}});await security.check(r,'create');}
  await assert.rejects(()=>security.check(req('/create',{},undefined,'203.0.113.40'),'create'),(e:unknown)=>e instanceof SecurityError&&e.status===429);
  assert.equal(trustedClientIp(new Request('https://parkesrummy.com',{headers:{'x-vercel-forwarded-for':'192.0.2.1'}})),null);
  await assert.rejects(()=>security.check(new Request('https://parkesrummy.com'),'create'),(e:unknown)=>e instanceof SecurityError&&e.status===503);
 }finally{if(production===undefined)Reflect.deleteProperty(process.env,'NODE_ENV');else Object.assign(process.env,{NODE_ENV:production});}
});

test('distinct-code probes and rotated anonymous presence IDs are bounded; a shared eight-player IP still works',async()=>{
 for(let i=0;i<12;i++)await security.check(req('/preview',undefined,undefined,'203.0.113.41'),'preview',undefined,`invalid-code-${i}`);
 await assert.rejects(()=>security.check(req('/preview',undefined,undefined,'203.0.113.41'),'preview',undefined,'another'),(e:unknown)=>e instanceof SecurityError&&e.status===429);
 for(let i=0;i<120;i++)await security.check(req('/presence',{},undefined,'203.0.113.42'),'presence');
 await assert.rejects(()=>security.check(req('/presence',{},undefined,'203.0.113.42'),'presence'),(e:unknown)=>e instanceof SecurityError&&e.status===429);
 for(let i=0;i<8;i++)for(let j=0;j<40;j++)await security.check(req('/room',undefined,undefined,'203.0.113.43'),'read',`seat:${i}`);
});

test('advertising requires all eligibility conditions; CSP blocks framing and has a fresh bootstrap nonce',()=>{
 const allowed={enabled:true,consent:'accepted',ready:true,adFree:false};assert.equal(advertisingAllowed(allowed),true);
 for(const changed of [{enabled:false},{consent:null},{consent:'declined'},{ready:false},{adFree:true}])assert.equal(advertisingAllowed({...allowed,...changed}),false);
 const policy=contentSecurityPolicy('test-nonce');assert.match(policy,/frame-ancestors 'none'/);assert.match(policy,/script-src[^;]*'nonce-test-nonce'/);assert.ok(!/script-src[^;]*'unsafe-inline'/.test(policy));
});

test('approved guest receives the live hand in the approval response when the host starts immediately',async()=>{
 const host=await create(),candidate=await submit(host.room.code);
 assert.equal((await decide(host,candidate.data.pending.id)).status,200);
 const admitted=(await repository.load(host.room.code))!;
 const started=applyAction(admitted.room,admitted.room.hostId,{type:'start'});
 await repository.save(started,admitted.version);
 const response=await api.joinRequestsRequest(req('/requests?own=true',undefined,candidate.token),host.room.code);
 assert.equal(response.status,200);const own=await response.json();
 assert.equal(own.request.status,'approved');assert.equal(own.room.status,'playing');assert.equal(own.room.hand.length,10);
 assert.equal(own.room.players.find((p:{id:string})=>p.id===own.room.youId).name,'Newcomer');
 assert.ok(!JSON.stringify(own).includes('tokenHash'));
 const outsider=await api.joinRequestsRequest(req('/requests?own=true',undefined,proof()),host.room.code);
 const blocked=await outsider.json();assert.equal(blocked.room,undefined);assert.equal(blocked.request,null);
});

test('approved durable seats resume after receipt expiry; expired unapproved and removed applicants see no cards',async()=>{
 const host=await create(),candidate=await submit(host.room.code);
 assert.equal((await decide(host,candidate.data.pending.id)).status,200);
 await db.query('UPDATE join_requests SET expires_at=$1 WHERE id=$2',[Date.now()-1,candidate.data.pending.id]);
 const approved=await (await api.joinRequestsRequest(req('/requests?own=true',undefined,candidate.token),host.room.code)).json();
 assert.equal(approved.request.status,'approved');assert.equal(approved.room.status,'lobby');
 const record=(await repository.load(host.room.code))!,other=record.room.players.find(p=>p.id!==record.room.hostId)!;
 await repository.save(applyAction(record.room,record.room.hostId,{type:'removePlayer',playerId:other.id}),record.version);
 const removed=await (await api.joinRequestsRequest(req('/requests?own=true',undefined,candidate.token),host.room.code)).json();
 assert.equal(removed.room,undefined);assert.equal(removed.request,null);
 const waiting=await submit(host.room.code,'Waiting');
 await db.query('UPDATE join_requests SET expires_at=$1 WHERE id=$2',[Date.now()-1,waiting.data.pending.id]);
 const expired=await (await api.joinRequestsRequest(req('/requests?own=true',undefined,waiting.token),host.room.code)).json();
 assert.equal(expired.room,undefined);assert.equal(expired.request,null);
});
