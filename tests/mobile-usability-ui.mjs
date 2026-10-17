// Page readiness is checked by the existing UI locators below. Foreground presence is periodic network traffic.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { applyAction, createPlayer, createRoom, publicRoom } from '../lib/rummy.ts';

const output='mobile-usability-results';
await mkdir(output,{recursive:true});
const base=process.env.MOBILE_BASE_URL||'http://127.0.0.1:3106';
const log=createWriteStream(`${output}/next.log`);
const server=process.env.MOBILE_BASE_URL?null:spawn('node',['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3106'],{stdio:['ignore','pipe','pipe']});
server?.stdout.pipe(log);server?.stderr.pipe(log);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const results=[];let browser,currentPage;
const user={id:'mobile-user',name:'Dan Schonberg',email:'mobile@example.test',image:null};
const account=signed=>({configured:true,user:signed?user:null,entitlements:{removeAds:true,premiumFonts:false,premiumSymbols:false,voiceChat:true,originalRules:true},profile:{font:'default',symbol:'initials'},accessAdmin:false});
function fixture() {
 let room=createRoom('TNFG',createPlayer({id:'human',name:'Dan Schonberg',tokenHash:'',color:0}));
 room=applyAction(room,'human',{type:'setGame',game:4});
 room=applyAction(room,'human',{type:'addBot',difficulty:'medium'});
 room=applyAction(room,'human',{type:'addBot',difficulty:'easy'});
 room=applyAction(room,'human',{type:'start'});
 // A fixed hand makes touch targets deterministic. UI tests never touch live tables.
 room.players[0].hand=[{rank:11,suit:'C'},{rank:10,suit:'S'},{rank:10,suit:'D'},{rank:10,suit:'C'},{rank:9,suit:'D'},{rank:7,suit:'H'},{rank:7,suit:'D'},{rank:6,suit:'H'},{rank:5,suit:'D'},{rank:2,suit:'D'}].map((card,i)=>({...card,id:`ui-card-${i}`}));
 return room;
}
async function routes(page,signed,game=false) {
 let room=fixture();const actions=[];
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.origin!==new URL(base).origin)return route.abort();
  if(u.pathname==='/api/account/session')return route.fulfill({json:account(signed)});
  if(u.pathname==='/api/account/games')return route.fulfill({json:{games:[]}});
  if(game && u.pathname.startsWith('/api/rooms/TNFG')) {
   if(u.pathname.endsWith('/action')) {
    const action=route.request().postDataJSON().action;actions.push(action);
    try{room=applyAction(room,'human',action);}catch(error){return route.fulfill({status:400,json:{error:error.message}});}
   }
   return route.fulfill({json:{room:publicRoom(room,'human'),token:'account:mobile-user'}});
  }
  return route.continue();
 });
 return actions;
}
async function swipe(page,selector,dy,hold=25,dx=0) {
 const element=page.locator(selector).first();const r=await element.boundingBox();assert.ok(r,selector);
 const x=r.x+r.width/2,y=Math.min(page.viewportSize().height-15,r.y+r.height/2);
 const session=await page.context().newCDPSession(page);
 await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await pause(hold);
 for(let step=1;step<=8;step++) {
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*step/8,y:y+dy*step/8}]});await pause(18);
 }
 await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await pause(400);await session.detach();
}
function overlap(a,b){return a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;}
try {
 let ready=false;for(let i=0;i<90;i++){try{ready=(await fetch(base)).ok;}catch{}if(ready)break;await pause(1000);}assert.ok(ready);
 browser=await chromium.launch({headless:true});
 for(const screen of [{name:'small-phone',width:320,height:568},{name:'phone',width:390,height:844},{name:'fold-cover',width:360,height:800},{name:'large-phone',width:412,height:915}]) {
  for(const signed of [true,false]) {
   const context=await browser.newContext({viewport:screen,isMobile:true,hasTouch:true,reducedMotion:'reduce'});
   const page=await context.newPage();currentPage=page;const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await routes(page,signed);await page.goto(base,{waitUntil:'domcontentloaded'});await page.locator('.quick-play-button').waitFor();await pause(150);
   const create=await page.locator('.create-button').boundingBox(),quick=await page.locator('.quick-play-button').boundingBox();
   await page.screenshot({path:`${output}/${screen.name}-${signed?'account':'guest'}-home.png`});
   assert.ok(create.y>=0&&quick.y+quick.height<=screen.height,`${screen.name}/${signed}: main actions below fold ${JSON.stringify({create,quick})}`);
   assert.ok(quick.height>=44&&create.height>=44);
   assert.equal(await page.evaluate(()=>scrollY),0);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   // Starting a swipe directly on Quick Play scrolls the tab, never opens a game.
   const before=await page.locator('.home-tab-content').evaluate(e=>e.scrollTop);
   await swipe(page,'.quick-play-button',-100);
   const after=await page.locator('.home-tab-content').evaluate(e=>e.scrollTop);
   assert.ok(after>before || await page.evaluate(()=>scrollY)>0,'Swipe beginning on Quick Play must scroll');
   assert.equal(await page.locator('.home-main').count(),1);
   assert.deepEqual(errors,[]);results.push({screen:screen.name,signed,quickPlayFirstView:true,buttonSwipe:true});await context.close();
  }
  const context=await browser.newContext({viewport:screen,isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  const page=await context.newPage();currentPage=page;const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const actions=await routes(page,true,true);await page.goto(`${base}/join/TNFG`,{waitUntil:'domcontentloaded'});
  await page.locator('.game-header').waitFor();await page.evaluate(()=>scrollTo(0,0));await pause(150);
  const targets=['.game-header>.brand','.header-room-code','.exit-game-button','.game-header [aria-label="Voice chat"]','.game-header [aria-label="Settings"]','.game-header>.table-tabs','.game-header .game-pill'];
  const boxes=[];for(const sel of targets){const r=await page.locator(sel).boundingBox();assert.ok(r,sel);boxes.push(r);assert.ok(r.x>=-1&&r.x+r.width<=screen.width+1,`${sel} clipped`);}
  for(let a=0;a<boxes.length;a++)for(let b=a+1;b<boxes.length;b++)assert.equal(overlap(boxes[a],boxes[b]),false,`${targets[a]} overlaps ${targets[b]}`);
  await page.screenshot({path:`${output}/${screen.name}-table.png`});
  // Rules selector: all four fully readable and swipable, no YOU badges.
  await page.locator('.game-header .game-pill').click();await page.getByRole('dialog').waitFor();
  const tabs=page.locator('.rules-modal .game-tabs');assert.equal(await tabs.evaluate(e=>getComputedStyle(e).display),'grid');
  assert.equal(await tabs.locator('button').count(),4);
  for(const button of await tabs.locator('button').all()) assert.equal(await button.evaluate(e=>e.scrollWidth>e.clientWidth+1),false);
  assert.equal(await page.locator('.rule-avatars em').count(),0);
  await page.screenshot({path:`${output}/${screen.name}-rules.png`});
  const modalBefore=await page.locator('.rules-modal').evaluate(e=>e.scrollTop);
  await swipe(page,'.rules-modal .game-tabs button:last-child',-95);
  assert.ok(await page.locator('.rules-modal').evaluate(e=>e.scrollTop)>modalBefore,'Rule button swipe must scroll dialog');
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.evaluate(()=>scrollTo(0,0));await pause(120);
  // Touching a hand card is native page scrolling unless deliberately held.
  const count=actions.length;
  const beforeScroll=await page.evaluate(()=>scrollY);
  await swipe(page,'[data-hand-card]',-100);
  assert.ok(await page.evaluate(()=>scrollY)>beforeScroll,'A swipe over a hand card must scroll');
  assert.equal(actions.length,count);assert.equal(await page.locator('.hand-card.selected').count(),0);
  await page.evaluate(()=>scrollTo(0,0));await pause(100);
  await swipe(page,'.draw-card-button[data-pile="stock"]',-90);
  assert.ok(await page.evaluate(()=>scrollY)>0,'A swipe over the draw pile must scroll');
  assert.equal(actions.length,count,'A swipe must not draw');
  // An ordinary tap still selects, and a deliberate long hold still lifts a card.
  await page.locator('[data-hand-card]').first().tap();assert.equal(await page.locator('.hand-card.selected').count(),1);
  await page.locator('[data-hand-card]').first().tap();
  const hand=await page.locator('[data-hand-card]').first().boundingBox();
  const session=await context.newCDPSession(page);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:hand.x+hand.width/2,y:hand.y+hand.height/2}]});await pause(430);
  assert.equal(await page.locator('.hand-drag-ghost').count(),1,'Hold-to-drag retained');
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await session.detach();await pause(100);
  assert.equal(await page.locator('.hand-drag-ghost').count(),0);
  assert.deepEqual(errors,[]);results.push({screen:screen.name,nonOverlappingHeader:true,readableOriginalTab:true,nativeCardAndPileScroll:true,holdToDrag:true});await context.close();
 }
 // Loading uses the same card-mark asset and branded wordmark, not a lone spade.
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const page=await context.newPage();currentPage=page;
 await page.route('**/api/account/session',async route=>{await pause(1500);await route.fulfill({json:account(true)});});
 await page.goto(base,{waitUntil:'domcontentloaded'});
 await page.locator('.account-loading-logo .brand-mark').waitFor();
 assert.equal(await page.locator('.account-check-suit').count(),0);await page.screenshot({path:`${output}/loading.png`});
 await context.close();
 await writeFile(`${output}/checks.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}catch(error){await writeFile(`${output}/checks.json`,JSON.stringify({results,error:String(error)},null,2));try{await currentPage?.screenshot({path:`${output}/failure.png`,fullPage:true});}catch{}throw error;}
finally{await browser?.close();server?.kill('SIGTERM');log.end();}
