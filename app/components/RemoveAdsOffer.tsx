'use client';

import { Check, ShieldCheck, Sparkles } from 'lucide-react';
import type { AccountSnapshot } from '../../lib/account-client';
import { signInWithGoogle } from '../../lib/account-client';
import { startRemoveAdsCheckout } from '../../lib/billing-client';
import { useState } from 'react';

export default function RemoveAdsOffer({ account, compact = false }: { account: AccountSnapshot; compact?: boolean }) {
  const enabled = process.env.NEXT_PUBLIC_MONETIZATION_ENABLED === 'true';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!enabled) return null;
  if (account.entitlements.removeAds) return <div className={`remove-ads-owned ${compact ? 'compact' : ''}`}><ShieldCheck size={20}/><span><strong>Ads removed</strong><small>Permanent on this account</small></span><Check size={18}/></div>;
  const buy = async () => {
    setError('');
    if (!account.user) { void signInWithGoogle(); return; }
    setBusy(true);
    try { await startRemoveAdsCheckout(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Checkout could not be opened.'); setBusy(false); }
  };
  return <div className={`remove-ads-offer ${compact ? 'compact' : ''}`}>
    <div><Sparkles size={20}/><span><strong>Remove Ads</strong><small>One-off · forever · A$1.99</small></span></div>
    <button type="button" className="button outline small" onClick={buy} disabled={busy || account.operation !== ''}>{busy ? 'Opening…' : account.user ? 'Remove ads' : 'Sign in to buy'}</button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
