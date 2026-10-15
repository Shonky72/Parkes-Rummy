import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
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
const rects=page=>page.evaluate(()=>Object.fromEntries(['.game-header','.your-hand','.hand-status','.hand-draw-piles','.table-sidebar>.draw-section','.hand-layout','.hand-actions'].flatMap(s=>{const el=document.querySelector(s);if(!el)return[];const r=el.getBoundingClientRect();return[[s,{x:r.x,y:r.y,width:r.width,height:r.height}]];})));
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
 try{await publicPage.goto('https://parkesrummy.com/',{waitUntil:'domcontentloaded',timeout:20000});await pause(2200);
 const frames=await publicPage.locator('iframe').evaluateAll(es=>es.map(e=>({id:e.id,title:e.title,src:e.getAttribute('src'),style:e.getAttribute('style'),parentId:e.parentElement?.id,parentClass:e.parentElement?.className,sandbox:e.getAttribute('sandbox')})));
 const nodes=await publicPage.locator('[id*="netlify"],[class*="netlify"]').evaluateAll(es=>es.map(e=>e.outerHTML.slice(0,1800)));
 await writeFile(`${output}/netlify-frames.json`,JSON.stringify({frames,nodes},null,2));await publicPage.screenshot({path:`${output}/public-badge.png`});
 }catch(e){await writeFile(`${output}/badge-audit-note.txt`,String(e));}await audit.close();
}
try{
 let ready=false;for(let i=0;i<90;i++){try{ready=(await fetch(base)).ok;}catch{}if(ready)break;await pause(1000);}assert.ok(ready);browser=await chromium.launch({headless:true});
 await auditBadge();
 for(const size of [{name:'phone',width:390,height:844},{name:'small-phone',width:320,height:568},{name:'desktop',width:1440,height:900}]){
  const context=await browser.newContext({viewport:size,isMobile:size.width<800,hasTouch:size.width<800,reducedMotion:'reduce'});page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));const state=await mock(context);
  await page.goto(`${base}/join/QUIK`,{waitUntil:'networkidle'});await page.locator('.adaptive-meld').first().waitFor();await pause(250);
  assert.equal(await page.locator('[data-meld-id="closed-run"].adaptive-meld .complete-run-stack').count(),1);
  assert.equal(await page.locator('[data-meld-id="closed-run"].adaptive-meld [data-meld-target]').count(),0);
  const overflow=await page.locator('.player-melds,.adaptive-meld-cards,.meld-fan').evaluateAll(es=>es.filter(e=>e.scrollWidth>e.clientWidth+2).map(e=>({class:e.className,scroll:e.scrollWidth,width:e.clientWidth})));
  assert.deepEqual(overflow,[],`${size.name}: overflowing melds`);
  const large=await rects(page);const style=await page.addStyleTag({content:'.status-message-visible{font-size:9px!important}'});const small=await rects(page);equalGeometry(large,small,'Changing status font');await style.evaluate(e=>e.remove());
  assert.ok(await page.locator('.status-message-visible').evaluate(e=>parseFloat(getComputedStyle(e).fontSize))>=14);
  await page.screenshot({path:`${output}/${size.name}-melds.png`,fullPage:true});
  await page.locator('[data-hand-card="hand-0"]').click();
  const target=page.locator('[data-meld-id="grow-run"].adaptive-meld [data-meld-end="end"]');
  // Put the target above the fixed hand before measuring. Playwright otherwise
  // scrolls again while clicking a target hidden behind that dock on short phones.
  await target.evaluate(e=>{e.scrollIntoView({block:'start',behavior:'instant'});window.scrollBy(0,-12);});await pause(100);
  const before=await rects(page);await target.click();await page.locator('.action-status-message[data-pending=true]').waitFor({timeout:500});
  assert.match(await page.locator('.status-message-visible').textContent(),/Adding/);equalGeometry(before,await rects(page),'Pending request');
  await page.locator('[data-meld-id="grow-run"].adaptive-meld .complete-run-stack').waitFor({timeout:5000});
  assert.equal(state.getRoom().melds.find(m=>m.id==='grow-run').cards.length,10);
  const complete=page.locator('[data-meld-id="grow-run"].adaptive-meld');await complete.locator('.complete-run-stack').click();assert.equal(await complete.locator('[data-table-card]').count(),10);assert.equal(await complete.locator('[data-meld-target]').count(),0);
  await complete.locator('.collapse-complete-run').click();
  await page.screenshot({path:`${output}/${size.name}-complete.png`,fullPage:true});assert.deepEqual(errors,[]);results.push({screen:size.name,noMeldOverflow:true,fixedStatusGeometry:true,immediatePending:true,completeRunRetainsTenCards:true});await context.close();
 }
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});page=await context.newPage();await mock(context,true);
 await page.goto(`${base}/join/QUIK`,{waitUntil:'networkidle'});await page.locator('[data-hand-card="hand-0"]').click();await page.locator('.hand-actions>.button').filter({hasText:'Discard'}).click();await page.locator('.quick-result-actions').waitFor({timeout:15000});
 assert.equal(await page.getByRole('button',{name:'Rematch',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:/Deal hand/}).count(),0);await page.screenshot({path:`${output}/quick-final.png`,fullPage:true});
 await page.getByRole('button',{name:'New Quick Play',exact:true}).click();await page.locator('.quick-result-actions').waitFor({state:'hidden'});await page.locator('.game-header').waitFor();await context.close();
 await writeFile(`${output}/checks.json`,JSON.stringify({results,quickFinal:true},null,2));console.log(JSON.stringify(results));
}catch(error){await writeFile(`${output}/checks.json`,JSON.stringify({results,error:String(error)},null,2));try{await page?.screenshot({path:`${output}/failure.png`,fullPage:true});}catch{}throw error;}
finally{await browser?.close();server?.kill('SIGTERM');log.end();}
