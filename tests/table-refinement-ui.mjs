// Page readiness is checked by the existing UI locators below. Foreground presence is periodic network traffic.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { applyAction, createPlayer, createRoom, publicRoom } from '../lib/rummy.ts';

const output='table-refinement-results';await mkdir(output,{recursive:true});
const base=process.env.TABLE_TEST_BASE_URL||'http://127.0.0.1:3108';
const server=process.env.TABLE_TEST_BASE_URL?null:spawn('node',['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3108'],{stdio:['ignore','pipe','pipe']});
const log=createWriteStream(`${output}/next.log`);server?.stdout.pipe(log);server?.stderr.pipe(log);
const pause=ms=>new Promise(r=>setTimeout(r,ms));let browser,page;const results=[];
const user={id:'table-user',name:'Dan',email:'table@example.test',image:null};
const account={configured:true,user,entitlements:{removeAds:true,premiumFonts:false,premiumSymbols:false,voiceChat:false,originalRules:true},profile:{font:'default',symbol:'initials'},accessAdmin:false};
function fixture(quick=false) {
 let room=createRoom('QUIK',createPlayer({id:'human',name:'Dan',tokenHash:'',color:0}));
 if(quick)room.quickPlay={ruleNumber:7};
 room=applyAction(room,'human',{type:'addBot',difficulty:'easy'});room=applyAction(room,'human',{type:'start'});
 room.phase='play';room.turnNumber=5;room.players[0].down=true;room.players[0].completedTurns=2;room.players[0].laidDownTurn=1;
 room.players[0].hand=(quick?[{rank:14,suit:'H'}]:[{rank:14,suit:'S'},{rank:7,suit:'H'},{rank:5,suit:'D'},{rank:11,suit:'C'},{rank:12,suit:'H'},{rank:5,suit:'S'},{rank:6,suit:'C'},{rank:9,suit:'D'},{rank:10,suit:'C'},{rank:13,suit:'D'}]).map((c,i)=>({...c,id:`hand-${i}`}));
 room.melds=[{id:'grow-run',ownerId:'human',kind:'run',constraint:'any',cards:Array.from({length:9},(_,i)=>({id:`run-${i}`,rank:i+5,suit:'H'}))},{id:'same-rank',ownerId:'human',kind:'set',constraint:'any',cards:Array.from({length:6},(_,i)=>({id:`set-${i}`,rank:7,suit:'D'}))},{id:'closed-run',ownerId:room.players[1].id,kind:'run',constraint:'any',cards:Array.from({length:10},(_,i)=>({id:`closed-${i}`,rank:i+5,suit:'S'}))}];
 room.players[1].down=true;return room;
}
const rects=page=>page.evaluate(()=>Object.fromEntries(['.game-header','.your-hand','.hand-status','.hand-draw-piles','.table-sidebar>.draw-section','.hand-layout','.hand-actions','.last-event'].flatMap(s=>{const el=document.querySelector(s);if(!el)return[];const r=el.getBoundingClientRect();return[[s,{x:r.x,y:r.y,width:r.width,height:r.height}]];})));
function equalGeometry(a,b,label){for(const s of Object.keys(a))for(const k of ['x','y','width','height'])assert.ok(Math.abs(a[s][k]-b[s][k])<1,`${label} moved ${s}.${k}: ${a[s][k]} -> ${b[s][k]}`);}
async function mock(context,quick=false){let room=fixture(quick);const actions=[];await context.route('**/*',async route=>{
 const u=new URL(route.request().url());if(u.origin!==new URL(base).origin)return route.abort();
 if(u.pathname==='/api/account/session')return route.fulfill({json:account});
 if(u.pathname==='/api/account/games')return route.fulfill({json:{games:[]}});
 if(u.pathname==='/api/rooms'&&route.request().method()==='POST'){assert.equal(route.request().postDataJSON().quickPlay,true);room=fixture(true);return route.fulfill({json:{room:publicRoom(room,'human'),token:'account:table-user'}});}
 if(u.pathname.startsWith('/api/rooms/QUIK')){
  if(u.pathname.endsWith('/action')){const action=route.request().postDataJSON().action;actions.push(action);await pause(850);try{room=applyAction(room,'human',action);}catch(e){return route.fulfill({status:400,json:{error:e.message}});}}
  return route.fulfill({json:{room:publicRoom(room,'human'),token:'account:table-user'}});
 }
 return route.continue();});return {actions,getRoom:()=>room};}
async function auditBadge(){
 const audit=await browser.newContext({viewport:{width:390,height:844}});const publicPage=await audit.newPage();
 await publicPage.route('**/*',route=>route.request().method()!=='GET'||/googlesyndication|doubleclick|google-analytics/.test(route.request().url())?route.abort():route.continue());
 try{
  await publicPage.goto('https://parkesrummy.com/',{waitUntil:'domcontentloaded',timeout:20000});await pause(2200);
  const badge=publicPage.locator('body>iframe#nl-badge-frame[title="Powered by Netlify"]');
  const before=await badge.evaluate(e=>({position:getComputedStyle(e).position,width:e.offsetWidth,height:e.offsetHeight,headerTop:document.querySelector('.home-header').getBoundingClientRect().top}));
  await publicPage.addStyleTag({content:await readFile('app/table-readability.css','utf8')});
  // Exercise the same outer placement in a read-only page view, without changing
  // the site, frame contents, cookies, account settings or game state.
  await publicPage.evaluate(()=>{
    const f=document.querySelector('body>iframe#nl-badge-frame[title="Powered by Netlify"]');const app=document.querySelector('.parkes-app');
    f.style.setProperty('--parkes-badge-top',`${Math.ceil(app.getBoundingClientRect().bottom-document.body.getBoundingClientRect().top+8)}px`);
    document.body.style.setProperty('--parkes-badge-clearance',`${f.offsetHeight+24}px`);
  });await pause(100);
  const after=await badge.evaluate(e=>{const r=e.getBoundingClientRect();return {position:getComputedStyle(e).position,width:e.offsetWidth,height:e.offsetHeight,right:r.right,viewport:innerWidth,top:r.top,pageBottom:document.querySelector('.parkes-app').getBoundingClientRect().bottom,headerTop:document.querySelector('.home-header').getBoundingClientRect().top};});
  assert.equal(after.position,'absolute');assert.equal(after.width,before.width);assert.equal(after.height,before.height);assert.ok(after.viewport-after.right>=7&&after.viewport-after.right<=9);assert.ok(after.top>=after.pageBottom);assert.equal(after.headerTop,before.headerTop);
  await badge.scrollIntoViewIfNeeded();await publicPage.screenshot({path:`${output}/netlify-side-placement.png`});
  await writeFile(`${output}/netlify-frames.json`,JSON.stringify({before,after},null,2));
 }catch(e){await writeFile(`${output}/badge-audit-note.txt`,String(e));}await audit.close();
}
try{
 let ready=false;for(let i=0;i<90;i++){try{ready=(await fetch(base)).ok;}catch{}if(ready)break;await pause(1000);}assert.ok(ready);browser=await chromium.launch({headless:true});
 await auditBadge();
 for(const size of [{name:'phone',width:390,height:844},{name:'small-phone',width:320,height:568},{name:'desktop',width:1440,height:900}]){
  const context=await browser.newContext({viewport:size,isMobile:size.width<800,hasTouch:size.width<800,reducedMotion:'reduce'});page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));const state=await mock(context);
  await page.goto(`${base}/join/QUIK`,{waitUntil:'domcontentloaded'});await page.locator('.adaptive-meld').first().waitFor();await pause(250);
  assert.equal(await page.locator('[data-meld-id="closed-run"].adaptive-meld .complete-run-stack').count(),1);
  assert.equal(await page.locator('[data-meld-id="closed-run"].adaptive-meld [data-meld-target]').count(),0);
  const overflow=await page.locator('.player-melds,.adaptive-meld-cards,.meld-fan').evaluateAll(es=>es.filter(e=>e.scrollWidth>e.clientWidth+2).map(e=>({class:e.className,scroll:e.scrollWidth,width:e.clientWidth})));
  assert.deepEqual(overflow,[],`${size.name}: overflowing melds`);
  const font=await page.locator('.status-message-visible').evaluate(e=>parseFloat(getComputedStyle(e).fontSize));
  const eventFont=await page.locator('.last-event').evaluate(e=>parseFloat(getComputedStyle(e).fontSize));
  assert.ok(font>=13.99,`${size.name}: status font ${font}px`);assert.ok(eventFont>=13.99,`${size.name}: announcement font ${eventFont}px`);
  const large=await rects(page);const oldEvent=size.width<850?'font-size:9px!important;line-height:1.5!important;padding:8px 3px!important;':'font-size:10px!important;line-height:1.5!important;padding:6px 7px 0!important;';
  const style=await page.addStyleTag({content:'.status-message-visible{font-size:9px!important}.in-game .last-event{height:auto!important;max-height:none!important;min-height:15px!important;'+oldEvent+'}'});await pause(80);const small=await rects(page);equalGeometry(large,small,'Enlarged announcements');await style.evaluate(e=>e.remove());await pause(100);
  // Match Netlify: its frame is inserted BEFORE the app, not conveniently after it.
  await page.evaluate(()=>{const f=document.createElement('iframe');f.id='nl-badge-frame';f.title='Powered by Netlify';f.style.cssText='position:fixed;bottom:0;right:0;width:194px;height:64px;border:0;z-index:2147483645';document.body.insertBefore(f,document.body.firstChild);});
  await page.waitForFunction(()=>!!document.getElementById('nl-badge-frame').style.getPropertyValue('--parkes-badge-top'));
  const badge=await page.locator('#nl-badge-frame').evaluate(e=>({position:getComputedStyle(e).position,top:e.getBoundingClientRect().top,pageBottom:document.querySelector('.parkes-app').getBoundingClientRect().bottom}));assert.equal(badge.position,'absolute');assert.ok(badge.top>=badge.pageBottom);
  equalGeometry(large,await rects(page),'Badge must not shift the page');
  await page.screenshot({path:`${output}/${size.name}-melds.png`,fullPage:true});
  await page.locator('[data-hand-card="hand-0"]').click();
  const target=page.locator('[data-meld-id="grow-run"].adaptive-meld [data-meld-end="end"]');
  await target.evaluate(e=>{e.scrollIntoView({block:'start',behavior:'instant'});window.scrollBy(0,-12);});await pause(100);
  const before=await rects(page);await target.click();await page.locator('.action-status-message[data-pending=true]').waitFor({timeout:500});
  assert.match(await page.locator('.status-message-visible').textContent(),/Adding/);equalGeometry(before,await rects(page),'Pending request');
  await page.locator('[data-meld-id="grow-run"].adaptive-meld .complete-run-stack').waitFor({timeout:5000});
  assert.equal(state.getRoom().melds.find(m=>m.id==='grow-run').cards.length,10);
  const complete=page.locator('[data-meld-id="grow-run"].adaptive-meld');await complete.locator('.complete-run-stack').click();assert.equal(await complete.locator('[data-table-card]').count(),10);assert.equal(await complete.locator('[data-meld-target]').count(),0);
  await complete.locator('.collapse-complete-run').click();
  await page.screenshot({path:`${output}/${size.name}-complete.png`,fullPage:true});assert.deepEqual(errors,[]);results.push({screen:size.name,font,eventFont,noMeldOverflow:true,fixedStatusGeometry:true,immediatePending:true,completeRunRetainsTenCards:true,badgeOutsideControls:true});await context.close();
 }
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});page=await context.newPage();await mock(context,true);
 await page.goto(`${base}/join/QUIK`,{waitUntil:'domcontentloaded'});await page.locator('[data-hand-card="hand-0"]').click();await page.locator('.hand-actions>.button').filter({hasText:'Discard'}).click();await page.locator('.quick-result-actions').waitFor({timeout:15000});
 assert.equal(await page.getByRole('button',{name:'Rematch',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:/Deal hand/}).count(),0);await page.screenshot({path:`${output}/quick-final.png`,fullPage:true});
 await page.getByRole('button',{name:'New Quick Play',exact:true}).click();await page.locator('.quick-result-actions').waitFor({state:'hidden'});await page.locator('.game-header').waitFor();await context.close();
 await writeFile(`${output}/checks.json`,JSON.stringify({results,quickFinal:true},null,2));console.log(JSON.stringify(results));
}catch(error){await writeFile(`${output}/checks.json`,JSON.stringify({results,error:String(error)},null,2));try{await page?.screenshot({path:`${output}/failure.png`,fullPage:true});}catch{}throw error;}
finally{await browser?.close();server?.kill('SIGTERM');log.end();}
