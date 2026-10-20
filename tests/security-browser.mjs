import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createRoom,createPlayer,publicRoom,applyAction} from '../lib/rummy.ts';
import {ROOM_PROTOCOL,ROOM_PROTOCOL_HEADER} from '../lib/room-protocol.ts';

// The real production app and real browser; API fixtures contain no live users.
const port=await new Promise(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const env={...process.env,PARKES_SECURITY_BUILD:'1',NEXT_PUBLIC_ADS_ENABLED:'true',NEXT_PUBLIC_ADSENSE_CLIENT:'ca-pub-fixture',NEXT_PUBLIC_ADSENSE_SLOT_HOME:'fixture',NEXT_TELEMETRY_DISABLED:'1'};
async function command(args){await new Promise((resolve,reject)=>{const p=spawn(process.execPath,args,{env,stdio:'inherit',windowsHide:true});p.on('exit',code=>code===0?resolve():reject(new Error(`Build exited ${code}`)));p.on('error',reject);});}
async function fillInvitationName(page,name){
 const field=page.locator('#guest-name');await field.waitFor({state:'visible'});
 // The initial saved-name preference is applied on an animation frame.
 // Wait for that first paint instead of racing it with synthetic typing.
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await field.fill(name);assert.equal(await field.inputValue(),name);
}
const generatedInputs=await Promise.all(['tsconfig.json','next-env.d.ts'].map(async path=>[path,await readFile(path)]));
try{
 // Other browser suites remove their CI-only page after building .next.
 // This separate build must not typecheck those stale generated validators.
 const config=JSON.parse(generatedInputs.find(([path])=>path==='tsconfig.json')[1].toString());
 config.include=config.include.filter(path=>!path.startsWith('.next/'));
 config.exclude=[...config.exclude,'.next'];
 await writeFile('tsconfig.json',JSON.stringify(config,null,2)+'\n');
 await command(['node_modules/next/dist/bin/next','build']);
}
finally{for(const [path,contents] of generatedInputs)await writeFile(path,contents);}
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(port),'--hostname','127.0.0.1'],{env,stdio:'inherit',windowsHide:true});
const base=`http://127.0.0.1:${port}`;
let browser;
try{
 for(let i=0;i<100;i++){try{if((await fetch(base)).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
 browser=await chromium.launch({headless:true});
 const hostToken='a'.repeat(64);let guestToken='',approved=false,submitted=false;
 let room=createRoom('ABCD',createPlayer({id:'host',name:'Fixture host',tokenHash:'fixture',color:0}));
 let accountUser=null,ads=0,voiceJoins=0,voicePolls=0,delayVoice=false,releaseVoice;
 async function setup(context,role='guest'){
  await context.route('https://**/*',route=>route.abort());
  await context.route('**/pagead/js/adsbygoogle.js?*',async route=>{ads++;await route.fulfill({contentType:'application/javascript',body:'window.adsbygoogle = window.adsbygoogle || [];'});});
  await context.route('**/api/**',async route=>{
   const url=new URL(route.request().url()),path=url.pathname,method=route.request().method();
   const respond=data=>route.fulfill({status:200,contentType:'application/json',headers:{[ROOM_PROTOCOL_HEADER]:ROOM_PROTOCOL},body:JSON.stringify(data)});
   if(path==='/api/account/session')return respond({configured:true,user:role==='voice'?accountUser:null,entitlements:{removeAds:role==='adfree',voiceChat:role==='voice',originalRules:false,premiumFonts:false,premiumSymbols:false},accessAdmin:false,profile:{font:'default',symbol:'initials'}});
   if(path==='/api/activity/presence')return route.fulfill({status:204});
   if(path==='/api/voice'){
    const body=route.request().postDataJSON();if(body.action==='join'){voiceJoins++;if(delayVoice)await new Promise(r=>{releaseVoice=r;});}if(body.action==='poll')voicePolls++;
    return respond({playerId:'host',peers:[],blockedPlayerIds:[],signals:[],latestSignalId:0,iceServers:[]});
   }
   if(path==='/api/rooms/ABCD/preview')return respond({preview:{code:'ABCD',game:1,status:'lobby',playerCount:room.players.length}});
   if(path==='/api/rooms/ABCD/join-requests'){
    if(method==='DELETE'){submitted=false;return respond({ok:true});}
    if(method==='POST'){
     const body=route.request().postDataJSON();approved=body.decision==='approve';
     if(approved&&!room.players.some(p=>p.id==='guest'))room.players.push(createPlayer({id:'guest',name:'Fixture guest',tokenHash:'fixture',color:1}));
     return respond({status:approved?'approved':'declined'});
    }
    return url.searchParams.has('own')?respond({request:{id:'request-1',status:approved?'approved':'pending',expiresAt:Date.now()+600000}}):respond({requests:submitted&&!approved?[{id:'request-1',name:'Fixture guest',expiresAt:Date.now()+600000}]:[]});
   }
   if(path==='/api/rooms/ABCD/join'){
    if(role==='host'||role==='voice')return respond({room:publicRoom(room,'host'),token:role==='voice'?'account:fixture-owner':hostToken});
    const body=route.request().postDataJSON();guestToken=body.requestToken;submitted=true;
    return route.fulfill({status:202,contentType:'application/json',headers:{[ROOM_PROTOCOL_HEADER]:ROOM_PROTOCOL},body:JSON.stringify({pending:{id:'request-1',status:'pending',expiresAt:Date.now()+600000}})});
   }
   if(path==='/api/rooms/ABCD/action'){const body=route.request().postDataJSON();room=applyAction(room,'host',body.action);return respond({room:publicRoom(room,'host')});}
   if(path==='/api/rooms/ABCD')return respond({room:publicRoom(room,role==='guest'?'guest':'host')});
   if(path==='/api/account/games')return respond({games:[]});
   if(path==='/api/rooms/summaries')return respond({summaries:[]});
   return respond({});
  });
 }
 const hostContext=await browser.newContext(),guestContext=await browser.newContext();
 await setup(hostContext,'host');await setup(guestContext);
 await hostContext.addInitScript(token=>localStorage.setItem('parkes-rummy:seats',JSON.stringify({ABCD:token})),hostToken);
 const host=await hostContext.newPage(),guest=await guestContext.newPage();
 const cspErrors=[];for(const page of [host,guest])page.on('console',m=>{if(m.type()==='error'&&m.text().includes('Content Security Policy'))cspErrors.push(m.text());});
 const response=await guest.goto(`${base}/join/ABCD`);
 assert.match(response.headers()['content-security-policy'],/nonce-/);assert.equal(response.headers()['x-frame-options'],'DENY');
 await fillInvitationName(guest,'Fixture guest');await guest.getByRole('button',{name:/Join game/}).click();
 await guest.getByRole('heading',{name:'Waiting for host approval'}).waitFor();
 assert.deepEqual(await guest.evaluate(()=>JSON.parse(localStorage.getItem('parkes-rummy:seats')||'{}')),{});
 await host.goto(`${base}/join/ABCD`);await host.getByRole('button',{name:'Approve',exact:true}).click();
 await guest.locator('.lobby-shell').waitFor();assert.equal(await guest.evaluate(()=>JSON.parse(localStorage.getItem('parkes-rummy:seats')).ABCD),guestToken);
 console.log('PASS: host approval and saved guest seat in real browser');

 // Repeat with cancellation: pending applicants never become seated players.
 const cancelContext=await browser.newContext();await setup(cancelContext);const cancelPage=await cancelContext.newPage();
 approved=false;submitted=false;await cancelPage.goto(`${base}/join/ABCD`);await fillInvitationName(cancelPage,'Cancel guest');await cancelPage.getByRole('button',{name:/Join game/}).click();await cancelPage.getByRole('button',{name:'Cancel request'}).click();assert.equal(submitted,false);assert.deepEqual(await cancelPage.evaluate(()=>JSON.parse(localStorage.getItem('parkes-rummy:seats')||'{}')),{});
 console.log('PASS: pending cancellation leaves no saved seat');

 // Fake media devices expose only a stop counter; no real microphone is used.
 accountUser={id:'fixture-owner',name:'Voice fixture',email:'fixture@example.test',image:null};
 const voiceContext=await browser.newContext();await setup(voiceContext,'voice');
 await voiceContext.addInitScript(()=>{window.fixtureStops=0;window.fixtureMode='permission';Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:()=>new Promise(resolve=>{const stream={getTracks:()=>[{stop(){window.fixtureStops++;}}]};window.fixtureResolve=()=>resolve(stream);if(window.fixtureMode==='immediate')resolve(stream);})}});});
 const voice=await voiceContext.newPage();await voice.goto(`${base}/join/ABCD`);await voice.getByRole('button',{name:'Voice chat',exact:true}).click();await voice.getByRole('button',{name:'Join voice',exact:true}).click();await voice.getByRole('button',{name:'Done',exact:true}).click();await voice.evaluate(()=>window.fixtureResolve());
 await voice.waitForFunction(()=>window.fixtureStops>0);assert.equal(voiceJoins,0);
 await voice.getByRole('button',{name:'Voice chat',exact:true}).click();await voice.evaluate(()=>{window.fixtureMode='immediate';});delayVoice=true;await voice.getByRole('button',{name:'Join voice',exact:true}).click();
 for(let i=0;i<50&&!releaseVoice;i++)await new Promise(r=>setTimeout(r,50));assert.ok(releaseVoice);
 await voice.getByRole('button',{name:'Done',exact:true}).click();releaseVoice();await new Promise(r=>setTimeout(r,2100));assert.equal(voicePolls,0);assert.ok(await voice.evaluate(()=>window.fixtureStops>=2));
 console.log('PASS: late permission and late HTTP cannot restart microphone or polling after exit');

 const adContext=await browser.newContext();await setup(adContext);const adPage=await adContext.newPage();
 await adPage.goto(base);assert.equal(await adPage.locator('#parkes-advertising-script').count(),0);assert.equal(ads,0);
 await adPage.goto(`${base}/how-to-play`);await adPage.getByRole('button',{name:'Decline',exact:true}).click();assert.equal(ads,0);
 await adPage.goto(`${base}/cookies`);await adPage.getByRole('button',{name:'Advertising choices',exact:true}).click();await adPage.getByRole('button',{name:'Allow advertising',exact:true}).click();
 async function accountPaint(page,action){
  const response=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/account/session'&&response.status()===200);
  await action();await (await response).finished();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 }
 for(const path of ['/', '/?tab=store', '/profile', '/competition', '/ladder', '/tutorial', '/cookies']){
  await accountPaint(adPage,()=>adPage.goto(`${base}${path}`));assert.equal(await adPage.locator('#parkes-advertising-script').count(),0,path);assert.equal(await adPage.locator('.adsbygoogle').count(),0,path);assert.equal(ads,0,path);
 }
 await adPage.goto(`${base}/how-to-play`);for(let i=0;i<50&&ads===0;i++)await new Promise(r=>setTimeout(r,100));assert.equal(ads,1);
 await accountPaint(adPage,()=>adPage.locator('a[href="/"]').first().click());await adPage.waitForURL(`${base}/`);await adPage.locator('.home-main').waitFor();assert.equal(await adPage.locator('#parkes-advertising-script').count(),0);assert.equal(await adPage.locator('.adsbygoogle').count(),0);assert.equal(ads,1);
 const freeContext=await browser.newContext();await setup(freeContext,'adfree');await freeContext.addInitScript(()=>localStorage.setItem('parkes-rummy:advertising-consent-v1','accepted'));const free=await freeContext.newPage();await accountPaint(free,()=>free.goto(`${base}/how-to-play`));await free.getByRole('heading',{level:1}).first().waitFor();assert.equal(await free.locator('#parkes-advertising-script').count(),0);assert.equal(await free.locator('.adsbygoogle').count(),0);assert.equal(ads,1);
 assert.deepEqual(cspErrors,[]);
 console.log('PASS: advertising stays off game/private/utility pages and declined/fresh/ad-free sessions; opted-in guides use the configured slot');
}finally{await browser?.close();server.kill();}
