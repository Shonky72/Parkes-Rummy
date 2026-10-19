import {createHmac} from 'node:crypto';
import {PostgresRequestSecurity} from '../db/security';
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite,type Transaction} from '@electric-sql/pglite';
import type {QueryResultRow} from 'pg';
import type {SqlDatabase,SqlConnection} from '../db';
import {ActivityRepository,activityHash,type PresenceRecord} from '../db/activity';
import {PostgresRoomRepository} from '../db/room-repository';
import {createActivityHandlers,isActivityOwner} from '../lib/activity-server';
import {validActivityPulse} from '../lib/activity-types';
import {createRoom,createPlayer,applyAction} from '../lib/rummy';
import type {AccountUser} from '../lib/auth-config';

const pg=new PGlite();
function connection(target:Pick<PGlite|Transaction,'query'>):SqlConnection{return {async query<T extends QueryResultRow>(sql:string,values?:unknown[]){const result=await target.query<T>(sql,values);return{rows:result.rows,rowCount:result.affectedRows??result.rows.length};}};}
const db:SqlDatabase={...connection(pg),transaction:work=>pg.transaction(tx=>work(connection(tx)))};
const activity=new ActivityRepository(db),rooms=new PostgresRoomRepository(db);
const owner:AccountUser={id:'owner',email:'dan@ibdcollective.net',name:'Dan',image:null};
const other:AccountUser={id:'other',email:'another@example.test',name:'Other',image:null};
const unverified:AccountUser={id:'unverified',email:'dan@ibdcollective.net',name:'Impostor',image:null};
const bearer='d'.repeat(64);
const uuid=()=>crypto.randomUUID();
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
process.env.BETTER_AUTH_SECRET='activity-fixture-secret-is-not-production-123456';
const cookie=(body:unknown)=>{const id=(body as {guestId?:string})?.guestId||crypto.randomUUID();return `parkes-activity-visitor=${id}.${createHmac('sha256',process.env.BETTER_AUTH_SECRET!).update(`activity:${id}`).digest('hex')}`;};
const API=(user:AccountUser|null)=>createActivityHandlers({db,activity,rooms,security:new PostgresRequestSecurity(db),resolveSession:async()=>user});
const req=(body:unknown,identity='guest',token?:string,origin='https://parkesrummy.com')=>new Request('https://internal--parkes-rummy.netlify.app:80/api/activity/presence',{method:'POST',headers:{Cookie:cookie(body),'x-nf-client-connection-ip':'192.0.2.20',Origin:origin,'Content-Type':'application/json','X-Parkes-Identity':identity,...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
const record=(id:string,userId:string|null=null,place:PresenceRecord['place']='home',roomCode:string|null=null):PresenceRecord=>({sessionKey:hash(id),actorKey:hash(userId||id),userId,name:id,place,roomCode});
before(async()=>{
  await pg.query(await readFile(new URL('../db/schema-editor.sql',import.meta.url),'utf8'));
  for(const u of [owner,other])await db.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)',[u.id,u.name,u.email]);
  await db.query('INSERT INTO "account"(id,"accountId","providerId","userId") VALUES($1,$1,\'google\',$2)',['google-owner',owner.id]);
  await activity.ensure();
});
after(async()=>{await pg.close();});

test('only exact, verified Google owner gets private data; headers and request params do not grant access',async()=>{
  const request=new Request('https://parkesrummy.com/api/admin/activity?email=dan@ibdcollective.net',{headers:{'X-Parkes-Identity':'account:owner','X-Owner-Email':owner.email}});
  assert.equal((await API(null).snapshot(request)).status,401);
  assert.equal((await API(other).snapshot(request)).status,403);
  assert.equal((await API(unverified).snapshot(request)).status,403);
  assert.equal(await isActivityOwner({...owner,email:'dan@ibdcollective.net.evil.test'},db),false);
  assert.equal(await isActivityOwner({...owner,email:' DAN@IBDCOLLECTIVE.NET '},db),true);
  await db.query('UPDATE "user" SET "emailVerified"=false WHERE id=$1',[owner.id]);
  assert.equal((await API(owner).snapshot(request)).status,403);
  await db.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1',[owner.id]);
  const response=await API(owner).snapshot(request);
  assert.equal(response.status,200);assert.match(response.headers.get('Cache-Control')!,/no-store/);
  assert.equal(response.headers.get('Netlify-CDN-Cache-Control'),'no-store');
  assert.equal((await API(owner).snapshot(new Request(request,{headers:{'Sec-Fetch-Site':'cross-site'}}))).status,403);
});

test('presence deduplicates account tabs and one tab leaving does not remove another',async()=>{
  const now=Date.now(),one=record('tab1',other.id),two=record('tab2',other.id);
  await activity.pulse(one,now);await activity.pulse(two,now);
  let data=await activity.snapshot(now+1);assert.equal(data.totals.online,1);assert.equal(data.totals.signedIn,1);assert.equal(data.players[0].email,other.email);
  await activity.leave(one.sessionKey,one.actorKey);data=await activity.snapshot(now+2);assert.equal(data.totals.online,1);
  data=await activity.snapshot(now+90001);assert.equal(data.totals.online,0);assert.ok(data.history[0].players>=1);
  await activity.leave(two.sessionKey,two.actorKey);
});

test('live humans and AI seats are separate, and dashboard responses contain no cards or credentials',async()=>{
  let room=createRoom('LIVE',createPlayer({id:'human',name:'Guest one',color:0,tokenHash:hash(bearer)}));
  room=applyAction(room,'human',{type:'addBot',difficulty:'easy'});room=applyAction(room,'human',{type:'start'});
  await rooms.insert(room);
  const now=Date.now();await activity.pulse(record('guest-live',null,'playing',room.code),now);
  await activity.gameStarted(room);await activity.gameStarted(room);
  const data=await activity.snapshot(now+1);
  assert.equal(data.totals.playing,1);assert.equal(data.totals.aiInLiveGames,1);assert.equal(data.games[0].humanSeats,1);assert.equal(data.games[0].aiSeats,1);
  assert.equal(data.totals.todayGames,1);assert.equal(data.players.find(p=>p.guest)?.email,null);
  const serialized=JSON.stringify(data);assert.ok(!serialized.includes('tokenHash'));assert.ok(!serialized.includes('discardPile'));assert.ok(!serialized.includes(room.stock[0].id));assert.ok(!serialized.includes(bearer));
  await activity.leave(hash('guest-live'),hash('guest-live'));
});

test('presence requires authoritative game membership and ignores spoofed user, email and bot fields',async()=>{
  const pulse={tabId:uuid(),guestId:uuid(),visible:true,roomCode:'LIVE',name:'Guest',email:owner.email,userId:owner.id,isBot:false};
  assert.equal((await API(null).pulse(req(pulse,'guest','x'.repeat(64)))).status,403);
  assert.equal((await API(other).pulse(req(pulse,'account:other',bearer))).status,403);
  assert.equal((await API(null).pulse(req(pulse,'account:owner',bearer))).status,401);
  assert.equal((await API(null).pulse(req(pulse,'guest',bearer,'https://evil.test'))).status,403);
  const result=await API(null).pulse(req(pulse,'guest',bearer));assert.equal(result.status,204);
  const data=await activity.snapshot();assert.equal(data.players.filter(p=>p.guest).length,1);assert.equal(data.players.find(p=>p.guest)?.email,null);
  assert.equal((await API(null).pulse(req({...pulse,visible:false},'guest',bearer))).status,204);
});

test('30-day history starts with collection, uses Sydney dates, and guest duplication uses one actor key',async()=>{
  const now=Date.now(),a=record('guest-history'),b={...record('guest-history2'),actorKey:activityHash('guest-history')};
  await activity.pulse(a,now);await activity.pulse(b,now);
  const data=await activity.snapshot(now+1);
  assert.equal(data.players.filter(p=>p.id===a.actorKey).length,1);
  assert.equal(data.history.length,1);assert.equal(data.history[0].day,new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney'}).format(now));
  assert.ok(data.totals.peakToday>=data.totals.online);assert.equal(data.totals.returningAccounts,0);
  await activity.leave(a.sessionKey,a.actorKey);await activity.leave(b.sessionKey,b.actorKey);
});

test('deleting an account removes its identified presence and daily identifiers',async()=>{
  await activity.pulse(record('delete-tab',other.id));
  await db.query('DELETE FROM "user" WHERE id=$1',[other.id]);
  const rows=await db.query('SELECT * FROM activity_daily_players WHERE user_id=$1',[other.id]);assert.equal(rows.rowCount,0);
  const data=await activity.snapshot();assert.ok(!data.players.some(p=>p.email===other.email));
});

test('invalid, oversized and absent presence input is rejected',async()=>{
  assert.equal(validActivityPulse({}),false);
  assert.equal(validActivityPulse({tabId:uuid(),guestId:uuid(),visible:true}),true);
  assert.equal((await API(null).pulse(req({}))).status,400);
  assert.equal((await API(null).pulse(req({name:'x'.repeat(3000)}))).status,413);
});
