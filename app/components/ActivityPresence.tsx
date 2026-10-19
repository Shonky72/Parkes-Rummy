'use client';
import { useEffect, useRef } from 'react';
import { getClientIdentity } from '../../lib/client-identity';
import { ACTIVITY_INTERVAL_MS } from '../../lib/activity-types';

function guestIdentity(){return crypto.randomUUID();}
/** Foreground-only operational presence. No display, card actions or account state changes. */
export default function ActivityPresence({roomCode,token,name,accountId}:{roomCode?:string;token?:string;name:string;accountId:string|null}) {
  const current=useRef({roomCode,token,name}); current.current={roomCode,token,name};
  const guestId=useRef('');
  useEffect(()=>{
    const tabId=crypto.randomUUID();
    if (!guestId.current) guestId.current=guestIdentity();
    const guest=guestId.current;
    let disposed=false,timer:ReturnType<typeof setTimeout>|undefined,failures=0,inFlight=false;
    let controller:AbortController|null=null;
    let retryAt=0;
    const identity=getClientIdentity();
    if (!identity.ready) return;
    const initial={...current.current};
    async function send(visible:boolean) {
      if (visible && (Date.now()<retryAt || disposed || document.hidden || !navigator.onLine || inFlight)) return;
      const latest=visible?current.current:initial;
      const headers:Record<string,string>={'Content-Type':'application/json','X-Parkes-Identity':identity.key};
      if (latest.token) headers.Authorization=`Bearer ${latest.token}`;
      const body=JSON.stringify({tabId,guestId:guest,visible,...(latest.roomCode?{roomCode:latest.roomCode}:{}),name:latest.name.slice(0,24)});
      if (!visible) {
        void fetch('/api/activity/presence',{method:'POST',headers,body,credentials:'same-origin',keepalive:true,cache:'no-store'})
          .then(response=>response.body?.cancel()).catch(()=>{});
        return;
      }
      inFlight=true;
      const requestController=new AbortController(); controller=requestController;
      const timeout=setTimeout(()=>requestController.abort(),6000);
      try {
        const response=await fetch('/api/activity/presence',{method:'POST',headers,body,credentials:'same-origin',cache:'no-store',signal:requestController.signal});
        // The endpoint is a small 204/error response; release its body before another check-in.
        await response.arrayBuffer();
        if(response.status===429)retryAt=Date.now()+Math.min(300,Number(response.headers.get('Retry-After'))||60)*1000;
        failures=response.ok?0:Math.min(failures+1,4);
      } catch { failures=Math.min(failures+1,4); }
      finally {
        clearTimeout(timeout);inFlight=false;
        if(!disposed&&!document.hidden&&navigator.onLine)timer=setTimeout(()=>{void send(true);},Math.max(retryAt-Date.now(),Math.min(300_000,ACTIVITY_INTERVAL_MS*2**failures)));
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
