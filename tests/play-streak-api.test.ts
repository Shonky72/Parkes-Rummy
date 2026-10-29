import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayStreakHandler } from '../lib/play-streak-server';
import { accountMarker, type AccountUser } from '../lib/auth-config';
import { SecurityError } from '../db/security';
import type { PlayStreakSummary } from '../lib/play-streak';

const NOW = Date.parse('2026-10-30T01:00:00Z');
const USER: AccountUser = {id:'streak-owner',name:'Private name',email:'private@example.test',image:null};
const SUMMARY: PlayStreakSummary = {today:'2026-10-30',timeZone:'Australia/Sydney',current:3,best:8,completedToday:true,completedDays:['2026-10-28','2026-10-29','2026-10-30'],todayFirstHandId:'first-hand',todayFirstCompletedAt:NOW-1000};
function request(changes: Record<string,string> = {}, path = '/api/play-streak') {
  return new Request(`https://parkesrummy.com${path}`, {
    headers:{Origin:'https://parkesrummy.com','X-Parkes-Identity':accountMarker(USER.id),...changes},
  });
}
function setup(user: AccountUser | null = USER, enabled = true) {
  const calls: {userId:string;now:number}[] = [];
  const handler = createPlayStreakHandler({enabled,resolveSession:async()=>user,now:()=>NOW,
    security:{check:async()=>{}},records:{playStreak:async(userId,now=0)=>{calls.push({userId,now});return SUMMARY;}},
  });
  return {handler,calls};
}

test('play streak requires a session and the matching identity pin before reading records', async () => {
  const guest=setup(null);
  assert.equal((await guest.handler(request())).status,401);
  assert.equal(guest.calls.length,0);
  const changed=setup();
  assert.equal((await changed.handler(request({'X-Parkes-Identity':'account:other'}))).status,401);
  const unpinned=new Request(request());unpinned.headers.delete('X-Parkes-Identity');
  assert.equal((await changed.handler(unpinned)).status,401);
  assert.equal(changed.calls.length,0);
});

test('production isolation and cross-origin checks reject reads before touching saved history', async () => {
  const preview=setup(USER,false);
  assert.equal((await preview.handler(request())).status,409);
  assert.equal(preview.calls.length,0);
  const production=setup();
  assert.equal((await production.handler(request({Origin:'https://evil.example'}))).status,403);
  const cross=request({'Sec-Fetch-Site':'cross-site'});cross.headers.delete('Origin');
  assert.equal((await production.handler(cross)).status,403);
  assert.equal(production.calls.length,0);
});

test('response is owner scoped, private and minimal; request parameters cannot choose an account or clock', async () => {
  const {handler,calls}=setup();
  const response=await handler(request({},'/api/play-streak?userId=someone-else&now=9999999999999'));
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),SUMMARY);
  assert.deepEqual(calls,[{userId:USER.id,now:NOW}]);
  assert.match(response.headers.get('Cache-Control')!,/private.*no-store/);
  assert.equal(response.headers.get('CDN-Cache-Control'),'no-store');
  assert.equal(response.headers.get('Netlify-CDN-Cache-Control'),'no-store');
  assert.match(response.headers.get('Vary')!,/X-Parkes-Identity/);
});

test('the endpoint exposes no mutation and does not treat a failed read as an empty streak', async () => {
  const {handler,calls}=setup();
  const mutation=await handler(new Request(request(),{method:'POST',body:'{}'}));
  assert.equal(mutation.status,405);assert.equal(mutation.headers.get('Allow'),'GET');
  assert.equal(calls.length,0);
  const failed=createPlayStreakHandler({enabled:true,resolveSession:async()=>USER,
    security:{check:async()=>{}},records:{playStreak:async()=>{throw new Error('private database details');}},
  });
  const unavailable=await failed(request());
  assert.equal(unavailable.status,503);
  const body=await unavailable.text();
  assert.ok(!body.includes('private database details'));
  assert.ok(!body.includes('"current":0'));
});

test('existing security limits retain their status and retry delay without reading records', async () => {
  let reads=0;
  const limited=createPlayStreakHandler({enabled:true,resolveSession:async()=>USER,
    security:{check:async()=>{throw new SecurityError('Please wait before trying again.',429,17);}},
    records:{playStreak:async()=>{reads++;return SUMMARY;}},
  });
  const response=await limited(request());
  assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'17');
  assert.equal(reads,0);
});
