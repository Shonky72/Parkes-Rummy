import assert from 'node:assert/strict';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
const out='owner-activity-results';await mkdir(out,{recursive:true});
const base='http://127.0.0.1:3106';
const server=spawn('node',['node_modules/next/dist/bin/next','start','-p','3106','-H','127.0.0.1'],{stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));let browser,page;
const now=Date.now();
const sample={generatedAt:now,trackingSince:now-86400000,timeZone:'Australia/Sydney',onlineWindowSeconds:90,refreshSeconds:30,historyDays:30,
 totals:{online:3,playing:2,signedIn:2,guests:1,liveGames:1,aiInLiveGames:1,todayPlayers:8,todayGames:5,returningAccounts:2,peakToday:4},
 players:[{id:'1',name:'Example Player',email:'player@example.test',guest:false,place:'playing',rooms:['DEMO'],lastSeen:now-5000},{id:'2',name:'Sample Guest',email:null,guest:true,place:'playing',rooms:['DEMO'],lastSeen:now-12000},{id:'3',name:'Another Player',email:'other@example.test',guest:false,place:'home',rooms:[],lastSeen:now-3000}],
 games:[{code:'DEMO',game:2,quick:true,rule:7,onlineHumans:2,humanSeats:2,aiSeats:1,currentPlayer:'Alex',lastMoveAt:now-3000}],
 history:[{day:new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney'}).format(now),players:8,signedIn:5,guests:3,gamesStarted:5,peakOnline:4,peakPlaying:3}],playersTruncated:false};
try{
 let ready=false;for(let n=0;n<60;n++){try{ready=(await fetch(base+'/')).ok;}catch{}if(ready)break;await wait(1000);}assert.ok(ready);
 const denied=await fetch(base+'/api/admin/activity');assert.equal(denied.status,401);assert.match(denied.headers.get('cache-control'),/no-store/);
 const serverPage=await(await fetch(base+'/admin/activity')).text();assert.ok(serverPage.includes('Owner access required'));assert.ok(!serverPage.includes('player@example.test'));assert.ok(!serverPage.includes('People online'));
 browser=await chromium.launch({headless:true});
 const checks=[];
 for(const [name,width,height] of [['desktop',1440,1000],['phone',390,844],['small-phone',320,700]]){
  const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'});page=await context.newPage();
  let revoked=false,reads=0;
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==base)return route.abort();if(url.pathname==='/api/admin/activity'){reads++;return route.fulfill({status:revoked?403:200,json:revoked?{error:'Owner access required.'}:sample});}return route.continue();});
  await page.goto(base+'/activity-ui-fixture');await page.getByRole('heading',{name:"Who's at the tables?"}).waitFor();await page.getByText('player@example.test',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Dashboard overflow '+name);
  await page.getByRole('textbox',{name:'Search players, emails or rooms'}).fill('Sample Guest');assert.equal(await page.getByText('player@example.test',{exact:true}).count(),0);assert.equal(await page.getByText('Sample Guest',{exact:true}).count(),1);
  await page.getByRole('textbox',{name:'Search players, emails or rooms'}).fill('');
  await page.screenshot({path:`${out}/${name}-dashboard.png`,fullPage:true});
  revoked=true;await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('heading',{name:'Owner access required'}).waitFor();
  assert.equal(await page.getByText('player@example.test',{exact:true}).count(),0,'Clear private data after access revocation');
  checks.push({name,width,noPageOverflow:true,privateDataCleared:true,reads});await context.close();
 }
 const context=await browser.newContext({viewport:{width:390,height:844}});page=await context.newPage();const pulses=[];
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==base)return route.abort();if(url.pathname==='/api/account/session')return route.fulfill({json:{configured:false,user:null,entitlements:{},profile:{font:'default',symbol:'initials'},accessAdmin:false}});if(url.pathname==='/api/activity/presence'){pulses.push(JSON.parse(route.request().postData()||'{}'));return route.fulfill({status:204});}return route.continue();});
 await page.goto(base);await page.locator('.home-header').waitFor();for(let n=0;n<20&&!pulses.length;n++)await wait(100);
 assert.ok(pulses.some(p=>p.visible));assert.ok(pulses.every(p=>!('email' in p)&&!('userId' in p)));
 await page.locator('.home-settings').click();assert.equal(await page.getByRole('link',{name:'Owner activity dashboard'}).count(),0,'Guest sees no owner shortcut');
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{get:()=>true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});await wait(200);
 assert.ok(pulses.some(p=>p.visible===false),'Hidden tab reports inactive');
 await context.close();
 await writeFile(`${out}/checks.json`,JSON.stringify({accessEndpoint:401,serverPageDenied:true,checks,foregroundPresence:true,samplesAreFictional:true},null,2));
 console.log('Owner dashboard UI and access checks passed',checks);
}catch(error){try{await page?.screenshot({path:`${out}/failure.png`,fullPage:true});}catch{}throw error;}
finally{await browser?.close();server.kill('SIGTERM');await rm('app/activity-ui-fixture',{recursive:true,force:true});}
