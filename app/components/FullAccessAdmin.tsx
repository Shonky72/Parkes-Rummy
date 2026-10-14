'use client';
import { useEffect, useState } from 'react';
import { Gift, Trash2, UserPlus } from 'lucide-react';

interface Grant { email:string; note:string; grantedAt:string; grantedBy:string }

export default function FullAccessAdmin() {
  const [grants,setGrants]=useState<Grant[]>([]);
  const [email,setEmail]=useState('');
  const [note,setNote]=useState('');
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const load=async()=>{const r=await fetch('/api/admin/full-access',{credentials:'same-origin',cache:'no-store'});if(!r.ok)return;const d=await r.json();setGrants(d.grants||[]);};
  useEffect(()=>{void load();},[]);
  const add=async()=>{setBusy('add');setError('');try{const r=await fetch('/api/admin/full-access',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,note})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Access was not added.');setEmail('');setNote('');await load();}catch(e){setError(e instanceof Error?e.message:'Access was not added.');}finally{setBusy('');}};
  const remove=async(value:string)=>{setBusy(value);setError('');try{const r=await fetch('/api/admin/full-access',{method:'DELETE',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:value})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Access was not removed.');await load();}catch(e){setError(e instanceof Error?e.message:'Access was not removed.');}finally{setBusy('');}};
  return <section className="full-access-admin panel">
    <div className="store-heading"><div><span className="store-kicker"><Gift size={16}/>Owner tools</span><h3>Friends full access</h3><p>Add a Google-account email to give that account every premium feature without charging them.</p></div></div>
    <div className="full-access-form"><label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="friend@gmail.com" autoComplete="off"/></label><label>Note <small>(optional)</small><input value={note} onChange={e=>setNote(e.target.value)} placeholder="Family / beta tester" maxLength={120}/></label><button className="button gold small" disabled={!email.trim()||busy!==''} onClick={()=>void add()}><UserPlus size={16}/>{busy==='add'?'Adding…':'Give full access'}</button></div>
    <div className="full-access-list">{grants.length===0?<p>No complimentary accounts yet.</p>:grants.map(grant=><div key={grant.email}><span><strong>{grant.email}</strong>{grant.note&&<small>{grant.note}</small>}</span><button className="button quiet small" disabled={busy!==''} onClick={()=>void remove(grant.email)}><Trash2 size={15}/>{busy===grant.email?'Removing…':'Remove'}</button></div>)}</div>
    <p className="store-signin-note">Full access includes Remove Ads, fonts, symbols, Voice Chat and Original Rules. Removing a grant never removes anything the account bought separately.</p>
    {error&&<p className="store-error" role="alert">{error}</p>}
  </section>;
}
