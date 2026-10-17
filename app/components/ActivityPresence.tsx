'use client';
import { useEffect, useRef } from 'react';
import { getClientIdentity } from '../../lib/client-identity';
import { ACTIVITY_INTERVAL_MS } from '../../lib/activity-types';

const GUEST_KEY = 'parkes-rummy:activity-guest-v1';
function guestIdentity():string {
  try {
    const saved = JSON.parse(localStorage.getItem(GUEST_KEY)||'null');
    if (saved && /^[a-f0-9-]{36}$/i.test(saved.id) && Number(saved.expires)>Date.now()) return saved.id;
    const id=crypto.randomUUID();
    localStorage.setItem(GUEST_KEY,JSON.stringify({id,expires:Date.now()+30*86400000}));
    return id;
  } catch { return crypto.randomUUID(); }
}
/** No game data, tokens or email addresses are stored in the guest identifier.
 * Background tabs stop immediately. Presence failures stay isolated from game actions.
 */
export default function ActivityPresence({roomCode,token,name,accountId}:{roomCode?:string;token?:string;name:string;accountId:string|null}) {
  const current=useRef({roomCode,token,name}); current.current={roomCode,token,name};
  const tabId=useRef('');
  const guestId=useRef('');
  useEffect(()=>{
    tabId.current=crypto.randomUUID();
    if (!guestId.current) guestId.current=guestIdentity();
    let disposed=false,timer:ReturnType<typeof setTimeout>|undefined,failures=0,inFlight=false;
    let controller:AbortController|null=null;
    const identity=getClientIdentity();
    if (!identity.ready) return;
    const initial={...current.current};
    async function send(visible:boolean) {
      if (visible && (disposed || document.hidden || !navigator.onLine || inFlight)) return;
      const latest=visible?current.current:initial;
      const headers:Record<string,string>={'Content-Type':'application/json','X-Parkes-Identity':identity.key};
      if (latest.token) headers.Authorization=`Bearer ${latest.token}`;
      const body=JSON.stringify({tabId:tabId.current,guestId:guestId.current,visible,...(latest.roomCode?{roomCode:latest.roomCode}:{}),name:latest.name.slice(0,24)});
      if (!visible) { void fetch('/api/activity/presence',{method:'POST',headers,body,credentials:'same-origin',keepalive:true,cache:'no-store'}).catch(()=>{}); return; }
      inFlight=true;controller=new AbortController();
      const timeout=setTimeout(()=>controller?.abort(),6000);
      try {
        const response=await fetch('/api/activity/presence',{method:'POST',headers,body,credentials:'same-origin',cache:'no-store',signal:controller.signal});
        failures=response.ok?0:Math.min(failures+1,4);
      } catch { failures=Math.min(failures+1,4); }
      finally {
        clearTimeout(timeout);inFlight=false;
        if(!disposed&&!document.hidden&&navigator.onLine)timer=setTimeout(()=>{void send(true);},Math.min(300_000,ACTIVITY_INTERVAL_MS*2**failures));
      }
    }
    function visibility(){clearTimeout(timer);if(document.hidden){controller?.abort();void send(false);}else{void send(true);}}
    function leave(){clearTimeout(timer);controller?.abort();void send(false);}
    function resume(){clearTimeout(timer);if(!document.hidden)void send(true);}
    document.addEventListener('visibilitychange',visibility);
    window.addEventListener('pagehide',leave);window.addEventListener('online',resume);
    void send(true);
    return ()=>{disposed=true;clearTimeout(timer);controller?.abort();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',leave);window.removeEventListener('online',resume);void send(false);};
  },[roomCode,accountId]);
  return null;
}
