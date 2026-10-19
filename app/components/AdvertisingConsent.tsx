'use client';
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { getAccountSnapshot, getServerAccountSnapshot, subscribeAccount, monitorAccount } from '../../lib/account-client';
import { advertisingAllowed } from '../../lib/advertising';

const KEY='parkes-rummy:advertising-consent-v1';
const Consent=createContext({allowed:false,nonce:'',open:()=>{}});
export function useAdvertising(){return useContext(Consent);}
export function AdvertisingChoices(){const {open}=useAdvertising();return <button type="button" className="text-link" onClick={open}>Advertising choices</button>;}
export default function AdvertisingConsent({children,nonce}:{children:ReactNode;nonce:string}){
  const account=useSyncExternalStore(subscribeAccount,getAccountSnapshot,getServerAccountSnapshot);
  useEffect(()=>monitorAccount(),[]);
  const [consent,setConsent]=useState<string|null>(null),[show,setShow]=useState(false);
  const enabled=process.env.NEXT_PUBLIC_ADS_ENABLED==='true';
  useEffect(()=>{const load=()=>{try{setConsent(localStorage.getItem(KEY));}catch{setConsent('declined');}};load();window.addEventListener('storage',load);return()=>window.removeEventListener('storage',load);},[]);
  const allowed=advertisingAllowed({enabled,consent,ready:account.status==='ready'&&!account.operation,adFree:account.entitlements.removeAds});
  useEffect(()=>{if(document.getElementById('parkes-advertising-script')&&(consent==='declined'||(account.status==='ready'&&account.entitlements.removeAds)))window.location.reload();},[consent,account.status,account.entitlements.removeAds]);
  function choose(value:'accepted'|'declined'){
    try{localStorage.setItem(KEY,value);}catch{/* The choice still applies for this page. */}
    setConsent(value);setShow(false);
    // A script cannot be unloaded from a running page. A fresh page guarantees
    // previously loaded advertising code stops executing after withdrawal.
    if(value==='declined'&&document.getElementById('parkes-advertising-script'))window.location.reload();
  }
  return <Consent.Provider value={{allowed,nonce,open:()=>setShow(true)}}>{children}{(show||(enabled&&consent===null&&account.status==='ready'&&!account.entitlements.removeAds))&&<aside className="approval-panel panel" aria-label="Advertising choices"><h2>Optional advertising</h2><p>Allow Google advertising to load? You can decline and keep playing. Change this choice on the Cookies page.</p><button className="button gold small" onClick={()=>choose('accepted')}>Allow advertising</button> <button className="button outline small" onClick={()=>choose('declined')}>Decline</button></aside>}</Consent.Provider>;
}
