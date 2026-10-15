'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { Check, LogOut, RefreshCw, Smartphone } from 'lucide-react';
import { getAccountSnapshot, getServerAccountSnapshot, monitorAccount, refreshAccount, signInWithGoogle, signOutAccount, subscribeAccount, type AccountSnapshot } from '../../lib/account-client';
import '../account.css';
import GameLogo from './GameLogo';

export function useAccountSession() {
  const account = useSyncExternalStore(subscribeAccount, getAccountSnapshot, getServerAccountSnapshot);
  useEffect(() => monitorAccount(), []);
  return account;
}

function GoogleMark() {
  return <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6C44.4 38.03 46.98 31.87 46.98 24.55Z"/><path fill="#FBBC05" d="M10.53 28.59A14.41 14.41 0 0 1 9.75 24c0-1.59.27-3.13.77-4.59l-7.98-6.19A23.85 23.85 0 0 0 0 24c0 3.87.93 7.53 2.56 10.78l7.97-6.19Z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"/></svg>;
}

export function AccountControls({ account, compact = false, disabled = false }: { account: AccountSnapshot; compact?: boolean; disabled?: boolean }) {
  return <section className={`account-controls${compact ? ' account-controls-compact' : ''}`} aria-label="Your account">
    {account.user ? <>
      <div className="account-signed-in"><span className="account-check"><Check size={17} aria-hidden="true"/></span><div><strong>{account.user.name}</strong><p>Games available on your phone and desktop</p></div><button type="button" className="button outline account-signout" disabled={disabled} onClick={() => { void signOutAccount(); }} aria-label={`Sign out ${account.user.name}`}><LogOut size={16} aria-hidden="true"/><span>Sign out</span></button></div>
    </> : <>
      <div className="account-intro"><Smartphone size={19} aria-hidden="true"/><div><strong>Sign in to play across devices</strong><p>Guest play works without an account.</p></div></div>
      <button type="button" className="google-signin" disabled={disabled || !account.configured} onClick={() => { void signInWithGoogle(); }}><GoogleMark/><span>Sign in with Google</span></button>
      {!account.configured && <p className="account-setup-note">Google sign-in is being set up. Guest play is available.</p>}
    </>}
    {account.error && <p className="account-error" role="alert">{account.error}</p>}
  </section>;
}

export function AccountLoading({ account }: { account: AccountSnapshot }) {
  return <div className="parkes-app account-check-screen"><div className="felt-grain" aria-hidden="true"/><main className="panel account-check-panel" aria-busy={account.status === 'checking'}><h1 className="account-loading-logo"><GameLogo large/></h1>{account.status === 'error' ? <><p role="alert">{account.error}</p><button type="button" className="button gold" onClick={() => { void refreshAccount({ suspend: true, manual: true }); }}><RefreshCw size={18}/>Try again</button></> : <p role="status">{account.operation === 'signout' ? 'Signing out…' : account.operation === 'signin' ? 'Opening Google sign-in…' : 'Opening your table…'}</p>}</main></div>;
}
