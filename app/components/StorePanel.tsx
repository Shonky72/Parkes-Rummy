'use client';
import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Check, Crown, MessageCircle, Palette, ShieldCheck, Sparkles, Star } from 'lucide-react';
import type { AccountSnapshot } from '../../lib/account-client';
import { refreshAccount, signInWithGoogle } from '../../lib/account-client';
import { startStoreCheckout } from '../../lib/billing-client';
import { FONT_STYLES, PLAYER_SYMBOLS, STORE_PRODUCTS, type FontId, type PlayerProfile, type StoreProductKey, type SymbolId, fontCssUrl } from '../../lib/store-catalog';
import FullAccessAdmin from './FullAccessAdmin';

interface CatalogResponse {
  signedIn: boolean;
  entitlements: AccountSnapshot['entitlements'] | null;
  profile: PlayerProfile;
  items: Array<{ key: StoreProductKey; label: string; amount: number; description: string; configured: boolean }>;
}
const productIcon: Record<StoreProductKey, typeof Star> = { remove_ads:ShieldCheck, fonts_pack:Palette, symbols_pack:Star, voice_access:MessageCircle, original_rules:BookOpen, everything_pack:Crown };
function owns(product: StoreProductKey, e: AccountSnapshot['entitlements']) {
  if (product === 'remove_ads') return e.removeAds;
  if (product === 'fonts_pack') return e.premiumFonts;
  if (product === 'symbols_pack') return e.premiumSymbols;
  if (product === 'voice_access') return e.voiceChat;
  if (product === 'original_rules') return e.originalRules;
  return e.removeAds && e.premiumFonts && e.premiumSymbols && e.voiceChat && e.originalRules;
}
export default function StorePanel({ account, onChanged }: { account: AccountSnapshot; onChanged?: () => void }) {
  const [catalog,setCatalog]=useState<CatalogResponse|null>(null), [busy,setBusy]=useState(''), [error,setError]=useState('');
  const [profile,setProfile]=useState<PlayerProfile>({ font:(account.profile.font as FontId)||'default',symbol:(account.profile.symbol as SymbolId)||'initials' });
  const [fontsLoaded,setFontsLoaded]=useState(false);
  useEffect(()=>{ setProfile({font:(account.profile.font as FontId)||'default',symbol:(account.profile.symbol as SymbolId)||'initials'}); },[account.profile.font,account.profile.symbol]);
  useEffect(()=>{ let active=true; fetch('/api/store/catalog',{credentials:'same-origin',cache:'no-store'}).then(r=>r.json()).then(data=>{if(active)setCatalog(data);}).catch(()=>{if(active)setError('Store details did not load.');}); return()=>{active=false;}; },[account.epoch]);
  const items = catalog?.items ?? (Object.entries(STORE_PRODUCTS) as Array<[StoreProductKey,(typeof STORE_PRODUCTS)[StoreProductKey]]>).map(([key,item])=>({key,label:item.label,amount:item.amount,description:item.description,configured:false}));
  const purchase = async (product:StoreProductKey) => {
    setError('');
    if (!account.user) { void signInWithGoogle(); return; }
    setBusy(product);
    try { await startStoreCheckout(product); } catch(e) { setError(e instanceof Error?e.message:'Checkout did not open.'); setBusy(''); }
  };
  const equip = async () => {
    if (!account.user) { void signInWithGoogle(); return; }
    setBusy('profile'); setError('');
    try {
      const r=await fetch('/api/store/profile',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(profile)});
      const d=await r.json().catch(()=>({})); if(!r.ok)throw new Error(d.error||'Style did not save.');
      await refreshAccount({suspend:true,manual:true}); onChanged?.();
    } catch(e) { setError(e instanceof Error?e.message:'Style did not save.'); } finally { setBusy(''); }
  };
  const premiumFontAllowed = profile.font==='default'||account.entitlements.premiumFonts;
  const premiumSymbolAllowed = profile.symbol==='initials'||account.entitlements.premiumSymbols;
  const previewStyle = useMemo(()=>({fontFamily:FONT_STYLES[profile.font]?.stack??FONT_STYLES.default.stack}),[profile.font]);
  return <section className="store-panel">
    <div className="store-heading"><div><span className="store-kicker"><Sparkles size={16}/>Optional extras</span><h3>Parkes Rummy Store</h3><p>One-off purchases. No subscriptions. Game rules and card odds stay the same.</p></div>{account.user&&<span className="store-account">Purchases follow {account.user.name} across devices.</span>}</div>
    <div className="store-items">{items.map(item=>{const Icon=productIcon[item.key];const owned=owns(item.key,account.entitlements);return <article key={item.key} className={`store-card ${item.key==='everything_pack'?'store-featured':''}`}>
      {item.key==='everything_pack'&&<span className="best-value">BEST VALUE</span>}<Icon size={25}/><h4>{item.label}</h4><p>{item.description}</p><strong>A${(item.amount/100).toFixed(2)}</strong><small>One-off · permanent</small>
      <button type="button" className={`button ${item.key==='everything_pack'?'gold':'outline'} small`} disabled={owned||busy!==''||!item.configured} onClick={()=>void purchase(item.key)}>{owned?<><Check size={16}/>Owned</>:busy===item.key?'Opening…':!item.configured?'Setting up':account.user?'Buy':'Sign in to buy'}</button>
    </article>;})}</div>
    <div className="style-shop panel"><div className="style-preview"><span aria-hidden="true">{PLAYER_SYMBOLS[profile.symbol]?.symbol || (account.user?.name||'P').slice(0,1).toUpperCase()}</span><strong style={previewStyle}>{account.user?.name||'Your name'}</strong></div><div className="style-controls">
      <div><label htmlFor="store-font">Player name font</label><select id="store-font" value={profile.font} onChange={e=>setProfile(old=>({...old,font:e.target.value as FontId}))}>{Object.entries(FONT_STYLES).map(([id,font])=><option value={id} key={id}>{font.label}{id!=='default'&&!account.entitlements.premiumFonts?' · preview':''}</option>)}</select></div>
      <div><label htmlFor="store-symbol">Player symbol</label><select id="store-symbol" value={profile.symbol} onChange={e=>setProfile(old=>({...old,symbol:e.target.value as SymbolId}))}>{Object.entries(PLAYER_SYMBOLS).map(([id,item])=><option value={id} key={id}>{item.symbol?`${item.symbol} `:''}{item.label}{id!=='initials'&&!account.entitlements.premiumSymbols?' · preview':''}</option>)}</select></div>
      <div className="style-actions"><button type="button" className="text-link" disabled={fontsLoaded} onClick={()=>{const link=document.createElement('link');link.rel='stylesheet';link.href=fontCssUrl();link.referrerPolicy='no-referrer';document.head.append(link);setFontsLoaded(true);}}>Load actual font previews</button><button type="button" className="button gold small" disabled={busy!==''||!premiumFontAllowed||!premiumSymbolAllowed} onClick={()=>void equip()}>{busy==='profile'?'Saving…':'Apply owned style'}</button></div>
    </div></div>
    {!account.user&&<p className="store-signin-note">Sign in only when you want purchases or games to follow you between devices.</p>}
    {account.accessAdmin&&<FullAccessAdmin/>}
    {error&&<p className="store-error" role="alert">{error}</p>}
  </section>;
}
