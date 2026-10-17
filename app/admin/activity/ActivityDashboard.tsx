'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Activity, ArrowLeft, Bot, Clock, Layers, LockKeyhole, RefreshCw, Search, Users } from 'lucide-react';
import GameLogo from '@/app/components/GameLogo';
import DeveloperCredit from '@/app/components/DeveloperCredit';
import type { ActivitySnapshot } from '@/lib/activity-types';

const number=(value:number)=>value.toLocaleString('en-AU');
const date=(value:number)=>new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Sydney',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(value);
const ago=(at:number,now:number)=>{const secs=Math.max(0,Math.floor((now-at)/1000));return secs<60?`${secs}s ago`:secs<3600?`${Math.floor(secs/60)}m ago`:`${Math.floor(secs/3600)}h ago`;};
const labels={home:'Browsing',lobby:'In lobby',playing:'Playing',results:'Viewing results'};
export default function ActivityDashboard(){
  const [data,setData]=useState<ActivitySnapshot|null>(null);
  const [loading,setLoading]=useState(true),[problem,setProblem]=useState(''),[denied,setDenied]=useState(false);
  const [automatic,setAutomatic]=useState(true),[query,setQuery]=useState('');
  const [now,setNow]=useState(Date.now());
  const pending=useRef(false),controller=useRef<AbortController|null>(null),alive=useRef(true);
  const refresh=useCallback(async()=>{
    if(pending.current||document.hidden)return;
    pending.current=true;setLoading(true);
    const abort=new AbortController();controller.current=abort;
    const timeout=setTimeout(()=>abort.abort(),12000);
    try{
      const response=await fetch('/api/admin/activity',{cache:'no-store',credentials:'same-origin',signal:abort.signal});
      if(!alive.current||abort.signal.aborted)return;
      if(response.status===401||response.status===403){setData(null);setDenied(true);setProblem('Owner access is no longer available. Sign in again with the authorised account.');return;}
      if(!response.ok)throw new Error('Activity is temporarily unavailable. Game play is unaffected.');
      const value=await response.json() as ActivitySnapshot;
      if(!value.totals||!Array.isArray(value.players)||!Array.isArray(value.history))throw new Error('Activity response was incomplete.');
      if(alive.current&&!abort.signal.aborted){setData(value);setProblem('');setDenied(false);setNow(Date.now());}
    }catch(err){if(alive.current&&!document.hidden)setProblem(err instanceof Error&&err.name!=='AbortError'?err.message:'The activity request timed out. Try Refresh.');}
    finally{clearTimeout(timeout);pending.current=false;if(alive.current)setLoading(false);}
  },[]);
  useEffect(()=>{
    alive.current=true;void refresh();
    const onVisibility=()=>{if(document.hidden){controller.current?.abort();setData(null);}else void refresh();};
    const onStorage=(e:StorageEvent)=>{if(e.key?.includes('account')){setData(null);void refresh();}};
    document.addEventListener('visibilitychange',onVisibility);window.addEventListener('storage',onStorage);
    const timer=setInterval(()=>{setNow(Date.now());if(automatic&&!denied&&!document.hidden)void refresh();},30000);
    return()=>{alive.current=false;clearInterval(timer);controller.current?.abort();document.removeEventListener('visibilitychange',onVisibility);window.removeEventListener('storage',onStorage);};
  },[automatic,denied,refresh]);
  const filter=query.trim().toLowerCase();
  const people=data?.players.filter(p=>`${p.name} ${p.email||''} ${p.rooms.join(' ')}`.toLowerCase().includes(filter))??[];
  return <div className="parkes-app activity-page">
    <div className="felt-grain" aria-hidden="true"/>
    <header className="activity-header"><GameLogo/><span className="activity-owner"><LockKeyhole size={16}/>Private owner dashboard</span><Link className="button outline small" href="/"><ArrowLeft size={16}/>Back to game</Link></header>
    <main className="activity-main">
      <section className="activity-title"><div><span className="activity-eyebrow">PARKES RUMMY / ACTIVITY</span><h1>Who's at the tables?</h1><p>Live players, active Google accounts and the last 30 days.</p></div><div className="activity-refresh"><button className="button outline small" disabled={loading} onClick={()=>{void refresh();}}><RefreshCw size={17} className={loading?'spin':''}/>{loading?'Checking…':'Refresh'}</button><label><input type="checkbox" checked={automatic} onChange={e=>setAutomatic(e.target.checked)}/>Auto refresh · 30s</label></div></section>
      {problem&&<div className="activity-error" role="alert">{problem}{data&&<strong> Previous figures are shown below. They are not live.</strong>}</div>}
      {denied?<section className="panel activity-denied"><LockKeyhole size={30}/><h2>Owner access required</h2><Link href="/" className="button gold">Return to sign in</Link></section>:!data?<section className="panel activity-empty" role="status"><Activity size={30}/><h2>{loading?'Checking player activity':'No activity snapshot available'}</h2><p>{loading?'Fetching live counts securely.':'Refresh to try again. No player data is displayed.'}</p></section>:<>
        <div className="activity-freshness"><span className={!problem?'activity-live-dot':'activity-stale-dot'}/><span>{problem?'Last successful update':'Updated'} {date(data.generatedAt)} · {ago(data.generatedAt,now)}</span><span>All dates: Sydney time</span></div>
        <section className="activity-stats" aria-label="Current activity">
          <Stat icon={<Users size={22}/>} label="People online" value={data.totals.online} note={`${number(data.totals.signedIn)} signed in · ${number(data.totals.guests)} guests`}/>
          <Stat icon={<Activity size={22}/>} label="Playing now" value={data.totals.playing} note="Humans in active games"/>
          <Stat icon={<Layers size={22}/>} label="Live tables" value={data.totals.liveGames} note="At least one online human"/>
          <Stat icon={<Bot size={22}/>} label="AI seats" value={data.totals.aiInLiveGames} note="In live tables · not people"/>
        </section>
        <section className="panel activity-today" aria-label="Today so far"><h2>Today so far</h2><div><span><strong>{number(data.totals.todayPlayers)}</strong>Unique players</span><span><strong>{number(data.totals.todayGames)}</strong>Games started</span><span><strong>{number(data.totals.peakToday)}</strong>Peak people online</span><span><strong>{number(data.totals.returningAccounts)}</strong>Returning accounts</span></div></section>
        <section className="panel activity-section"><div className="activity-section-heading"><div><h2>Active players</h2><p>Google sign-in email is visible only in this owner view.</p></div><label className="activity-search"><Search size={17}/><input aria-label="Search players, emails or rooms" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Player, email or room"/></label></div>
          {!people.length?<p className="activity-empty-copy">{filter?'No players match your search.':'No humans have reported activity in the last 90 seconds.'}</p>:<div className="activity-table-scroll"><table><thead><tr><th>Player</th><th>Google account</th><th>Status</th><th>Room</th><th>Last seen</th></tr></thead><tbody>{people.map(p=><tr key={p.id}><td><strong>{p.name}</strong><small>{p.guest?'Guest browser':'Signed in'}</small></td><td>{p.email||<span className="activity-muted">Guest · no email collected</span>}</td><td><span className={`activity-status status-${p.place}`}>{labels[p.place]}</span></td><td>{p.rooms.length?p.rooms.map(code=><code key={code}>{code}</code>):'Home'}</td><td>{ago(p.lastSeen,now)}</td></tr>)}</tbody></table></div>}
          {data.playersTruncated&&<p className="activity-footnote">Showing the 500 most recently seen people. Totals include everyone.</p>}
        </section>
        <section className="panel activity-section"><div className="activity-section-heading"><div><h2>Live games</h2><p>Read-only table details. Private cards and seat credentials are never included.</p></div></div>
          {!data.games.length?<p className="activity-empty-copy">No active table currently has an online human.</p>:<div className="activity-table-scroll"><table><thead><tr><th>Room</th><th>Format</th><th>Humans online / seats</th><th>AI seats</th><th>Current turn</th><th>Last move</th></tr></thead><tbody>{data.games.map(g=><tr key={g.code}><td><code>{g.code}</code></td><td>{g.quick?`Quick Play · Rule ${g.rule}`:'Full game'}<small>{g.game===4?'Original Rules':`Game ${g.game}`}</small></td><td>{g.onlineHumans} / {g.humanSeats}</td><td>{g.aiSeats}</td><td>{g.currentPlayer||'Waiting'}</td><td>{g.lastMoveAt?ago(g.lastMoveAt,now):'No move yet'}</td></tr>)}</tbody></table></div>}
        </section>
        <section className="panel activity-section"><div className="activity-section-heading"><div><h2>Daily history</h2><p>Recording began {date(data.trackingSince)}. No earlier activity is reconstructed.</p></div><Clock size={23}/></div><div className="activity-table-scroll"><table><thead><tr><th>Date</th><th>Unique players</th><th>Signed in</th><th>Guests</th><th>Games started</th><th>Peak online</th><th>Peak playing</th></tr></thead><tbody>{data.history.map(d=><tr key={d.day}><td>{d.day}</td><td>{d.players}</td><td>{d.signedIn}</td><td>{d.guests}</td><td>{d.gamesStarted}</td><td>{d.peakOnline}</td><td>{d.peakPlaying}</td></tr>)}</tbody></table></div></section>
        <details className="panel activity-definitions"><summary>How these numbers work</summary><p>A visible game screen checks in every 30 seconds. People drop out after 90 seconds without a check-in. Background tabs stop reporting; closing or switching away sends an offline signal where possible.</p><p>Signed-in people are counted once across tabs and devices. Guests are estimated by a random browser identifier, so different browsers or cleared storage count separately. AI seats never increase the human count. Waiting for another player's turn still counts as playing.</p><p>Returning accounts means a signed-in account seen today and on an earlier day within the retained 30-day history. It does not imply their first-ever visit. Peak values are sampled from check-ins, not continuous surveillance.</p><p>Detailed presence expires from the online view after 90 seconds and is cleaned from storage after 24 hours. Daily identifiers and totals are cleaned after 30 days during the next activity request. The dashboard itself does not count as playing.</p></details>
      </>}
      <footer className="activity-footer"><LockKeyhole size={15}/><span>Owner-only access · dan@ibdcollective.net</span><DeveloperCredit/></footer>
    </main>
  </div>;
}
function Stat({icon,label,value,note}:{icon:React.ReactNode;label:string;value:number;note:string}){return <article className="panel activity-stat"><span>{icon}{label}</span><strong>{number(value)}</strong><small>{note}</small></article>;}
