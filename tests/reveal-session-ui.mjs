import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createWriteStream} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createRoom,createPlayer,publicRoom,applyAction} from '../lib/rummy.ts';
import {ROOM_PROTOCOL,ROOM_PROTOCOL_HEADER} from '../lib/room-protocol.ts';

const output='reveal-session-results';await mkdir(output,{recursive:true});
const port=await new Promise(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const base=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{stdio:['ignore','pipe','pipe']});
const log=createWriteStream(`${output}/next.log`);server.stdout.pipe(log);server.stderr.pipe(log);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const checks=[];let browser,lastPage;
const hostToken='a'.repeat(64);
function waitingRoom(code='JOIN') {return createRoom(code,createPlayer({id:'host',name:'Fixture Host',color:0,tokenHash:'fixture'}));}
function activeRoom(code='FLIP',quick=false) {
 let room=waitingRoom(code);
 room.players.push(createPlayer({id:'guest',name:'Fixture Guest',color:1,tokenHash:'fixture'}));
 if(quick)room.quickPlay={ruleNumber:9};
 room=applyAction(room,'host',{type:'start'});return room;
}
const getHandRect=page=>page.locator('.opponent-hand .card-backs').first().boundingBox();
const sameRect=(a,b)=>['x','y','width','height'].forEach(k=>assert.ok(Math.abs(a[k]-b[k])<=1.5,`Opponent rail ${k} moved ${a[k]} -> ${b[k]}`));

async function mock(context,state,role,{signed=false,voice=false}={}){
 await context.route('**/*',async route=>{
  const r=route.request(),u=new URL(r.url()),path=u.pathname,method=r.method();
  if(u.origin!==base)return route.abort();
  const respond=(data,status=200)=>route.fulfill({status,headers:{[ROOM_PROTOCOL_HEADER]:ROOM_PROTOCOL},json:data});
  if(path==='/api/account/session')return respond({configured:true,user:signed?{id:`account-${role}`,name:`Fixture ${role}`,email:`${role}@example.test`,image:null}:null,entitlements:{removeAds:true,premiumFonts:false,premiumSymbols:false,voiceChat:voice,originalRules:true},profile:{font:'default',symbol:'initials'},accessAdmin:false});
  if(path==='/api/activity/presence')return route.fulfill({status:204});
  if(path==='/api/account/games')return respond({games:[]});
  if(path==='/api/rooms/summaries')return respond({summaries:[]});
  if(path==='/api/voice'){
   const body=r.postDataJSON();state.voiceActions??=[];state.voiceActions.push({role,action:body.action});
   state.voiceMembers??=new Set();state.voiceSignals??=[];
   if(body.action==='join')state.voiceMembers.add(role);
   if(body.action==='leave')state.voiceMembers.delete(role);
   if(body.action==='signal')state.voiceSignals.push({id:state.voiceSignals.length+1,from:role,to:body.playerId,kind:body.kind,payload:body.payload});
   return respond({playerId:role,peers:[...state.voiceMembers].filter(p=>p!==role).map(id=>({id,name:`Fixture ${id}`})),signals:state.voiceSignals.filter(s=>s.to===role&&s.id>(body.since||0)),latestSignalId:state.voiceSignals.length,blockedPlayerIds:[],iceServers:[]});
  }
  const prefix=`/api/rooms/${state.room.code}`;
  if(path===prefix+'/preview')return respond({preview:{code:state.room.code,status:state.room.status,game:state.room.game,playerCount:state.room.players.length}});
  if(path===prefix+'/join-requests'){
   if(method==='DELETE'){state.cancelled=true;return respond({ok:true});}
   if(method==='POST'){
    const body=r.postDataJSON();state.approved=body.decision==='approve';
    if(state.approved&&!state.room.players.some(p=>p.id==='guest')){
     state.room.players.push(createPlayer({id:'guest',name:'Fixture Guest',color:1,tokenHash:'fixture'}));state.room.version++;
     if(state.startOnApprove)state.room=applyAction(state.room,'host',{type:'start'});
    }
    return respond({status:state.approved?'approved':'declined'});
   }
   if(u.searchParams.has('own')){
    if(!state.submitted)return respond({request:null});
    const data={request:{id:'approval-1',status:state.approved?'approved':'pending',expiresAt:Date.now()+600000}};
    if(state.approved&&!state.legacyReceipt)data.room=publicRoom(state.room,role);
    return respond(data);
   }
   return respond({requests:state.submitted&&!state.approved?[{id:'approval-1',name:'Fixture Guest',expiresAt:Date.now()+600000}]:[]});
  }
  if(path===prefix+'/join'){
   if(role==='host'||state.preseated||state.approved)return respond({room:publicRoom(state.room,role),token:signed?`account:account-${role}`:role==='host'?hostToken:state.guestToken});
   state.guestToken=r.postDataJSON().requestToken;state.submitted=true;
   return respond({pending:{id:'approval-1',status:'pending',expiresAt:Date.now()+600000}},202);
  }
  if(path===prefix+'/action'){
   const action=r.postDataJSON().action;state.room=applyAction(state.room,role,action);
   return respond({room:publicRoom(state.room,role)});
  }
  if(path===prefix){
   state.reads??=[];state.reads.push({role,status:state.room.status,version:state.room.version});
   if(role==='guest'&&!state.preseated&&!state.approved)return respond({error:'Approval required'},403);
   return respond({room:publicRoom(state.room,role)});
  }
  return route.continue();
 });
 await context.addInitScript(({role,signed,preseated,code,hostToken})=>{
  localStorage.setItem('parkes-rummy:audio',JSON.stringify({muted:true,musicEnabled:false,volume:0,musicVolume:0}));
  if(!signed&&(role==='host'||preseated))localStorage.setItem('parkes-rummy:seats',JSON.stringify({[code]:hostToken}));
 },{role,signed,preseated:state.preseated,code:state.room.code,hostToken});
}
async function newPage(state,role,options={},viewport={width:1440,height:1000}){
 const context=await browser.newContext({viewport,permissions:options.voice?['microphone']:[],...(viewport.width<600?{isMobile:true,hasTouch:true}:{}),reducedMotion:options.motion?'no-preference':'reduce'});
 await mock(context,state,role,options);const page=await context.newPage();lastPage=page;
 page.on('pageerror',err=>{state.errors??=[];state.errors.push(err.message);});
 return {page,context};
}
try{
 for(let n=0;n<100;n++){try{if((await fetch(base)).ok)break;}catch{}await sleep(200);}
 browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});

 // A code-only join, a direct invitation, immediate start, and the old receipt
 // format all open the first playable hand without visiting Your Games.
 for(const scenario of [
  {name:'guest-code',codeOnly:true,startOnApprove:false,signed:false},
  {name:'guest-immediate',codeOnly:false,startOnApprove:true,signed:false},
  {name:'account-immediate',codeOnly:false,startOnApprove:true,signed:true},
  {name:'old-receipt',codeOnly:false,startOnApprove:false,signed:false,legacyReceipt:true},
 ]){
  const state={room:waitingRoom(),...scenario};
  const h=await newPage(state,'host'),g=await newPage(state,'guest',{signed:scenario.signed}, {width:390,height:844});
  await g.page.goto(base+(scenario.codeOnly?'':'/join/JOIN'),{waitUntil:'domcontentloaded'});
  if(scenario.codeOnly){await g.page.locator('#home-name').fill('Fixture Guest');await g.page.locator('#home-code').fill('JOIN');}
  else await g.page.locator('#guest-name').fill('Fixture Guest');
  await g.page.getByRole('button',{name:'Join game',exact:true}).click();await g.page.getByRole('heading',{name:'Waiting for host approval'}).waitFor();
  await h.page.goto(base+'/join/JOIN',{waitUntil:'domcontentloaded'});await h.page.getByRole('button',{name:'Approve',exact:true}).click();
  if(!scenario.startOnApprove){await g.page.locator('.lobby-shell').waitFor();await h.page.getByRole('button',{name:'Start with 2 players',exact:false}).click();}
  await g.page.locator('.game-header').waitFor({timeout:12000});await g.page.locator('[data-hand-card]').first().waitFor();
  assert.equal(await g.page.locator('[data-hand-card]').count(),10,scenario.name);
  assert.equal(await g.page.locator('.approval-panel').count(),0);assert.equal(await g.page.locator('.account-loading').count(),0);
  assert.deepEqual(state.errors||[],[],scenario.name+' browser errors');
  await g.page.screenshot({path:`${output}/${scenario.name}.png`,fullPage:true});checks.push({scenario:scenario.name,approvedStart:true,handCards:10});
  await h.context.close();await g.context.close();
 }
 console.log('PASS approved-start handoffs',checks);

 // Both sides use real WebRTC and synthetic test microphones. Closing the
 // Settings menu must not stop either track, audio element, peer or polling.
 const call={room:activeRoom('CALL'),preseated:true};
 const a=await newPage(call,'host',{signed:true,voice:true}),b=await newPage(call,'guest',{signed:true,voice:true});
 for(const page of [a.page,b.page]){
  await page.addInitScript(()=>{
   window.testVoiceStreams=[];window.testVoicePeers=[];
   const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
   navigator.mediaDevices.getUserMedia=async settings=>{const stream=await get(settings);window.testVoiceStreams.push(stream);return stream;};
   const Native=window.RTCPeerConnection;
   window.RTCPeerConnection=class extends Native{constructor(settings){super(settings);window.testVoicePeers.push(this);}};
  });
  await page.goto(base+'/join/CALL',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Voice chat',exact:true}).click();
  await page.getByRole('button',{name:'Join voice',exact:true}).click();
  await page.locator('.voice-panel').getByText('Connected',{exact:true}).waitFor({timeout:10000});
  await page.getByRole('button',{name:'Done',exact:true}).click();
  assert.equal(await page.locator('.voice-panel').count(),0);
  assert.equal(await page.getByRole('button',{name:'Voice chat',exact:true}).getAttribute('aria-pressed'),'true');
 }
 for(const page of [a.page,b.page]){
  await page.waitForFunction(()=>window.testVoicePeers.some(p=>p.connectionState==='connected'),null,{timeout:18000});
  await page.waitForFunction(()=>document.querySelector('audio[data-voice-peer]')?.srcObject?.getAudioTracks().length>0,null,{timeout:15000});
  assert.ok(await page.evaluate(()=>window.testVoiceStreams.at(-1).getAudioTracks().every(t=>t.readyState==='live')));
  await page.waitForFunction(async()=>{let bytes=0;for(const p of window.testVoicePeers){for(const r of (await p.getStats()).values()){if(r.type==='inbound-rtp'&&r.kind==='audio')bytes+=r.bytesReceived||0;}}return bytes>0;},null,{timeout:10000,polling:200});
 }
 assert.equal(call.voiceActions.filter(x=>x.action==='leave').length,0,'Closing a connected voice menu must not send Leave');
 const polls=call.voiceActions.filter(x=>x.action==='poll').length;await sleep(2000);assert.ok(call.voiceActions.filter(x=>x.action==='poll').length>polls);
 await a.page.getByRole('button',{name:'Voice chat',exact:true}).click();await a.page.locator('.voice-panel').getByText('Connected',{exact:true}).waitFor();
 await a.page.getByRole('button',{name:'Mute mic',exact:true}).click();assert.ok(await a.page.evaluate(()=>window.testVoiceStreams.at(-1).getAudioTracks().every(t=>!t.enabled)));
 await a.page.getByRole('button',{name:'Unmute mic',exact:true}).click();await a.page.screenshot({path:`${output}/voice-connected.png`});await a.page.getByRole('button',{name:'Done',exact:true}).click();
 await a.page.getByRole('button',{name:'Exit game',exact:true}).click();await a.page.waitForFunction(()=>window.testVoiceStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended')));
 await b.page.evaluate(()=>{Object.defineProperty(document,'hidden',{get:()=>true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
 await b.page.waitForFunction(()=>window.testVoiceStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended')));
 checks.push({voicePersistsAfterMenu:true,realWebRtcSyntheticAudio:true,explicitMute:true,tableExitStopsMic:true,backgroundStopsMic:true});
 await a.context.close();await b.context.close();console.log('PASS connected voice persists across menus and stops on actual exits');

 for(const screen of [{name:'desktop',width:1440,height:1000},{name:'phone',width:390,height:844}]){
  const state={room:activeRoom('FLIP',true),preseated:true};
  state.room.phase='play';state.room.turnPlayerId='host';state.room.players[0].down=true;state.room.players[0].completedTurns=2;state.room.players[0].laidDownTurn=1;
  state.room.players[0].hand=[{id:'final-ace',rank:14,suit:'H'}];
  state.room.players[1].hand=[{id:'left5',rank:5,suit:'C'},{id:'left6',rank:6,suit:'D'},{id:'left7',rank:7,suit:'H'},{id:'left8',rank:8,suit:'S'},{id:'left9',rank:9,suit:'D'},{id:'left10',rank:10,suit:'H'},{id:'leftj',rank:11,suit:'C'},{id:'leftq',rank:12,suit:'D'},{id:'leftk',rank:13,suit:'S'},{id:'left2',rank:2,suit:'H'}];
  const h=await newPage(state,'host',{signed:true,motion:true},screen);
  await h.page.goto(base+'/join/FLIP',{waitUntil:'domcontentloaded'});await h.page.locator('[data-hand-card="final-ace"]').waitFor();
  // Complete label remains inside the desktop/modal group without clipping.
  await h.page.locator('.game-header .game-pill').click();await h.page.locator('.rules-modal').waitFor();
  const tabs=await h.page.locator('.rules-modal .game-tabs').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth,buttons:[...e.querySelectorAll('button')].map(b=>({text:b.textContent,w:b.clientWidth,scroll:b.scrollWidth,rect:b.getBoundingClientRect().toJSON()})),rect:e.getBoundingClientRect().toJSON()}));
  assert.equal(tabs.buttons.length,4);assert.ok(tabs.scroll<=tabs.width+1);
  for(const button of tabs.buttons){assert.ok(button.scroll<=button.w+1,button.text+' clipped');assert.ok(button.rect.right<=tabs.rect.right+1);}
  await h.page.screenshot({path:`${output}/${screen.name}-rules.png`});await h.page.getByRole('button',{name:'Close dialog',exact:true}).click();
  assert.equal(await h.page.locator('.opponent .end-hand-card').count(),0,'Do not expose an opponent before the hand ends');
  const before=await getHandRect(h.page);
  await h.page.locator('[data-hand-card="final-ace"]').click();
  await h.page.locator('.hand-actions>.button').filter({hasText:'Discard'}).click();
  await h.page.locator('.table-motion-winning-flight').waitFor({timeout:4000});
  assert.equal(await h.page.locator('.opponent .end-hand-card').count(),0,'No reveal during the final card flight');
  await h.page.locator('.opponent .end-hand-flipping').waitFor({timeout:10000});
  assert.equal(await h.page.locator('.result-modal').count(),0,'Wait for the flip before covering it with results');
  assert.equal(await h.page.locator('.opponent .end-hand-card').count(),10);
  sameRect(before,await getHandRect(h.page));
  await h.page.screenshot({path:`${output}/${screen.name}-flipping.png`});
  await h.page.locator('.result-modal').waitFor({timeout:7000});
  assert.equal(await h.page.locator('.result-hand [data-revealed-card]').count(),10);
  assert.equal(await h.page.locator('.result-cards').count(),0,'Cards should not be hidden behind a disclosure');
  const scoreRows=await h.page.locator('.result-row').evaluateAll(rows=>rows.map(e=>({width:e.clientWidth,scroll:e.scrollWidth,parts:[e.children[0],e.querySelector('.result-hand'),e.querySelector(':scope>span'),e.querySelector(':scope>b')].map(el=>el.getBoundingClientRect().toJSON())})));
  for(const row of scoreRows){assert.ok(row.scroll<=row.width+1);if(screen.width>850){assert.ok(row.parts[1].left>=row.parts[0].right-1);assert.ok(row.parts[1].right<=row.parts[2].left+1);}else assert.ok(row.parts[1].top>=row.parts[0].bottom-1);}
  assert.equal(await h.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await h.page.screenshot({path:`${output}/${screen.name}-results.png`,fullPage:true});
  await h.page.getByRole('button',{name:'Close dialog',exact:true}).click();assert.equal(await h.page.locator('.opponent .end-hand-card').count(),10);
  assert.deepEqual(state.errors||[],[]);
  checks.push({screen:screen.name,ruleLabelsFit:true,flipAtLanding:true,remainingCardsVisible:true,unchangedOpponentRail:true,responsiveResults:true});await h.context.close();
 }
 await writeFile(`${output}/checks.json`,JSON.stringify({checks,fixtureOnly:true},null,2));console.log('PASS reveal, approval and connected voice scenarios',checks);
}catch(error){await writeFile(`${output}/checks.json`,JSON.stringify({checks,error:String(error)},null,2));try{await lastPage?.screenshot({path:`${output}/failure.png`,fullPage:true});}catch{}throw error;}
finally{await browser?.close();server.kill('SIGTERM');log.end();}
