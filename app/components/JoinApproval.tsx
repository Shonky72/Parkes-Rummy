'use client';
import { useEffect, useRef, useState } from 'react';
import { roomApi, RoomError } from '../../lib/client';
import type { PublicRoom } from '../../lib/types';

export interface PendingJoin { code:string; name:string; proof:string; expiresAt:number; identity:string; expectedToken?:string|null }
const KEY='parkes-rummy:pending-approval';
export function savePendingJoin(value:PendingJoin|null){try{if(value)sessionStorage.setItem(KEY,JSON.stringify(value));else sessionStorage.removeItem(KEY);}catch{/* Keep in memory when storage is unavailable. */}}
export function readPendingJoin(identity:string):PendingJoin|null{try{const p=JSON.parse(sessionStorage.getItem(KEY)||'null');return p&&p.identity===identity&&typeof p.code==='string'&&typeof p.name==='string'&&/^[a-f0-9]{64}$/.test(p.proof)&&Number.isFinite(p.expiresAt)?p:null;}catch{return null;}}
export function newJoinProof(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');}

export function JoinWaiting({pending,onReady,onCancel}:{pending:PendingJoin;onReady:(room:PublicRoom,token:string)=>void;onCancel:()=>void}){
  const [message,setMessage]=useState('Waiting for host approval'),[done,setDone]=useState(false);
  const callbacks=useRef({onReady,onCancel});callbacks.current={onReady,onCancel};
  const token=pending.identity==='guest'?pending.proof:pending.identity;
  useEffect(()=>{
    let disposed=false,inFlight=false,finished=false,timer:ReturnType<typeof setTimeout>|undefined;
    async function poll(){
      if(disposed||finished||inFlight)return;
      if(document.hidden)return;
      inFlight=true;
      try{
        // The server checks the seat before receipt expiry. The host may
        // already have approved and started while this tab was backgrounded.
        const result=await roomApi.joinRequests(pending.code,token,true);
        if(disposed)return;
        if(result.request?.status==='approved'){
          const room=result.room??(await roomApi.get(pending.code,token)).room;
          if(!disposed){finished=true;callbacks.current.onReady(room,token);}return;
        }
        if(!result.request||['declined','cancelled'].includes(result.request.status)||Date.now()>=pending.expiresAt){
          setMessage(result.request?.status==='declined'?'The host declined your request.':Date.now()>=pending.expiresAt?'Your request expired. Request a seat again when you are ready.':'This request is no longer available.');setDone(true);finished=true;return;
        }
        setMessage('Waiting for host approval');
      }catch(e){if(disposed)return;if(e instanceof RoomError&&[401,403,404,410].includes(e.status)){setMessage(e.message);setDone(true);finished=true;return;}setMessage(e instanceof Error?e.message:'Reconnecting to the host…');}
      finally{inFlight=false;if(!disposed&&!finished&&!document.hidden)timer=setTimeout(poll,3000);}
    }
    const resume=()=>{clearTimeout(timer);if(!document.hidden)void poll();};
    document.addEventListener('visibilitychange',resume);window.addEventListener('online',resume);
    void poll();return()=>{disposed=true;clearTimeout(timer);document.removeEventListener('visibilitychange',resume);window.removeEventListener('online',resume);};
  },[pending.code,pending.expiresAt,token]);
  async function cancel(){
    try{if(!done)await roomApi.cancelJoin(pending.code,token);savePendingJoin(null);callbacks.current.onCancel();}
    catch(e){setMessage(e instanceof Error?e.message:'Could not cancel. Please retry.');}
  }
  return <section className="approval-panel" aria-live="polite"><h2>{message}</h2><p>You will take a seat when the host approves you. Your request does not hold a seat.</p><button className="button outline" onClick={()=>void cancel()}>{done?'Back to invitation':'Cancel request'}</button></section>;
}

export function HostJoinRequests({room,token}:{room:PublicRoom;token:string}){
  const [requests,setRequests]=useState<{id:string;name:string;expiresAt:number}[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState('');
  const refresh=useRef<()=>Promise<void>>(async()=>{});
  useEffect(()=>{
    let disposed=false,timer:ReturnType<typeof setTimeout>;
    async function load(){
      if(disposed)return;
      if(!document.hidden){try{const r=await roomApi.joinRequests(room.code,token);if(!disposed){setRequests(r.requests||[]);setError('');}}catch(e){if(!disposed)setError(e instanceof Error?e.message:'Requests did not load.');}}
      if(!disposed)timer=setTimeout(load,3000);
    }
    refresh.current=async()=>{clearTimeout(timer);await load();};void load();
    return()=>{disposed=true;clearTimeout(timer);};
  },[room.code,token]);
  async function decide(id:string,decision:'approve'|'decline'){
    if(busy)return;setBusy(id);
    try{await roomApi.reviewJoin(room.code,token,id,decision);await refresh.current();}catch(e){setError(e instanceof Error?e.message:'Please retry.');}finally{setBusy('');}
  }
  if(!requests.length&&!error)return null;
  return <section className="approval-panel panel"><h2>Requests to join</h2>{error&&<p role="alert">{error}</p>}{requests.map(r=><div className="approval-request" key={r.id}><strong>{r.name}</strong><button className="button gold small" disabled={!!busy||room.players.length>=8} onClick={()=>void decide(r.id,'approve')}>Approve</button><button className="button outline small" disabled={!!busy} onClick={()=>void decide(r.id,'decline')}>Decline</button></div>)}</section>;
}
