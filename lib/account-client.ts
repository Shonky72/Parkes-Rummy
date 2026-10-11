'use client';

import { setClientIdentity, safeAccountReturnPath } from './client-identity';

export interface AccountUser { id: string; name: string; email: string; image: string | null }
export interface AccountSnapshot {
  status: 'checking' | 'ready' | 'error';
  configured: boolean;
  user: AccountUser | null;
  epoch: number;
  operation: '' | 'signin' | 'signout';
  error: string;
  entitlements: { removeAds: boolean; premiumFonts: boolean; premiumSymbols: boolean; voiceChat: boolean };
  profile: { font: string; symbol: string };
}

const initialSnapshot: AccountSnapshot = { status: 'checking', configured: false, user: null, epoch: 0, operation: '', error: '', entitlements: { removeAds: false, premiumFonts: false, premiumSymbols: false, voiceChat: false }, profile: { font: 'default', symbol: 'initials' } };
let snapshot = initialSnapshot;
const listeners = new Set<() => void>();
let generation = 0;
let sessionController: AbortController | null = null;
let sessionPromise: Promise<void> | null = null;
let channel: BroadcastChannel | null = null;
let consumers = 0;
let stopMonitoring: (() => void) | null = null;
let lastResolvedAccountId: string | null | undefined;
let changeTimeout: ReturnType<typeof setTimeout> | null = null;
let manualRecheckRequired = false;
const CHANGE_KEY = 'parkes-rummy:account-change';

export const getAccountSnapshot = () => snapshot;
export const getServerAccountSnapshot = () => initialSnapshot;
export function subscribeAccount(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

function publish(next: AccountSnapshot) {
  snapshot = next;
  for (const listener of [...listeners]) listener();
}

function suspendAccount(operation: AccountSnapshot['operation'] = '') {
  generation++;
  sessionController?.abort();
  sessionController = null;
  sessionPromise = null;
  const identity = setClientIdentity(null, false);
  publish({ ...snapshot, status: 'checking', user: null, epoch: identity.epoch, operation, error: '' });
}

function closeAccountUntilRechecked(error: string) {
  // Also invalidate a session request already in flight when sign-out failed.
  // Merely preventing the next refresh would leave that late response live.
  manualRecheckRequired = true;
  suspendAccount();
  publish({ ...snapshot, status: 'error', operation: '', error });
}

function announceAccountChange(phase: 'changing' | 'changed' = 'changed') {
  // Only a notification crosses tabs. No account or session data is stored here.
  channel?.postMessage(phase);
  try { window.localStorage.setItem(CHANGE_KEY, `${phase}:${Date.now()}:${Math.random()}`); } catch { /* BroadcastChannel still works with blocked storage. */ }
}

async function authRequest(path: string, body: unknown) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  try {
    return await fetch(path, { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } finally { window.clearTimeout(timeout); }
}

export async function refreshAccount(options: { suspend?: boolean; manual?: boolean; requireSignedOut?: boolean } = {}): Promise<void> {
  if (typeof window === 'undefined') return;
  if (options.manual) manualRecheckRequired = false;
  else if (manualRecheckRequired) return;
  if (options.suspend) suspendAccount();
  if (sessionPromise) return sessionPromise;
  const expectedGeneration = generation;
  const controller = new AbortController();
  sessionController = controller;
  const timer = window.setTimeout(() => controller.abort(), 15000);
  const task = (async () => {
    try {
      const response = await fetch('/api/account/session', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('Your account could not be checked.');
      const data = await response.json() as { configured: boolean; user: AccountUser | null; entitlements?: { removeAds?: boolean; premiumFonts?: boolean; premiumSymbols?: boolean; voiceChat?: boolean }; profile?: { font?: string; symbol?: string } };
      if (expectedGeneration !== generation || controller.signal.aborted) return;
      if (typeof data.configured !== 'boolean' || (data.user !== null && (!data.user || typeof data.user.id !== 'string' || !data.user.id))) throw new Error('Your account could not be checked.');
      if (options.requireSignedOut && data.user) {
        closeAccountUntilRechecked('Sign-out was not confirmed. Reconnect and check your account before continuing.');
        return;
      }
      const user = data.user ? { id: data.user.id, name: data.user.name || 'Player', email: data.user.email || '', image: data.user.image || null } : null;
      const accountChanged = lastResolvedAccountId !== (user?.id ?? null);
      const announce = accountChanged && (lastResolvedAccountId !== undefined || user !== null);
      lastResolvedAccountId = user?.id ?? null;
      const identity = setClientIdentity(user?.id ?? null);
      publish({ status: 'ready', configured: data.configured, user, epoch: identity.epoch, operation: '', error: '', entitlements: { removeAds: Boolean(data.entitlements?.removeAds), premiumFonts: Boolean(data.entitlements?.premiumFonts), premiumSymbols: Boolean(data.entitlements?.premiumSymbols), voiceChat: Boolean(data.entitlements?.voiceChat) }, profile: { font: data.profile?.font || 'default', symbol: data.profile?.symbol || 'initials' } });
      if (announce) announceAccountChange();
    } catch {
      if (expectedGeneration !== generation) return;
      // An uncertain session never falls back to guest access while a cookie may
      // still identify someone else on a shared device.
      const identity = setClientIdentity(null, false);
      publish({ ...snapshot, status: 'error', user: null, epoch: identity.epoch, operation: '', error: 'Connection lost while checking your account. Reconnect and try again.' });
    } finally {
      window.clearTimeout(timer);
      if (sessionController === controller) { sessionController = null; sessionPromise = null; }
    }
  })();
  sessionPromise = task;
  return task;
}

/** A 401 removes the previous account's private view before checking its cookie. */
export function recheckAccount() {
  if (snapshot.status === 'checking') return;
  void refreshAccount({ suspend: true });
}

export function monitorAccount(): () => void {
  consumers++;
  if (consumers === 1) {
    const changed = (phase?: string) => {
      if (changeTimeout) { clearTimeout(changeTimeout); changeTimeout = null; }
      if (phase === 'changing') {
        suspendAccount('signout');
        changeTimeout = setTimeout(() => {
          closeAccountUntilRechecked('An account change needs checking. Reconnect and try again.');
        }, 20000);
      } else void refreshAccount({ suspend: true });
    };
    const resume = () => { if (!document.hidden && !snapshot.operation) void refreshAccount(); };
    const storage = (event: StorageEvent) => { if (event.key === CHANGE_KEY || event.key === null) changed(event.newValue?.split(':')[0]); };
    window.addEventListener('storage', storage);
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel('parkes-rummy:account');
      channel.addEventListener('message', (event: MessageEvent) => changed(typeof event.data === 'string' ? event.data : undefined));
    }
    const interval = window.setInterval(resume, 30000);
    if (snapshot.status !== 'ready') void refreshAccount({ suspend: true }); else void refreshAccount();
    stopMonitoring = () => {
      window.removeEventListener('storage', storage);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
      window.clearInterval(interval);
      if (changeTimeout) clearTimeout(changeTimeout);
      channel?.close(); channel = null;
      sessionController?.abort();
    };
  }
  return () => { consumers--; if (!consumers) { stopMonitoring?.(); stopMonitoring = null; } };
}

export async function signInWithGoogle() {
  if (snapshot.status !== 'ready' || !snapshot.configured || snapshot.operation) return;
  const callbackURL = safeAccountReturnPath(window.location.pathname);
  suspendAccount('signin');
  try {
    const response = await authRequest('/api/auth/sign-in/social', { provider: 'google', callbackURL });
    const data = await response.json() as { url?: string };
    if (!response.ok || !data.url) throw new Error('Google sign-in did not open.');
    const target = new URL(data.url, window.location.origin);
    if (target.protocol !== 'https:' || target.hostname !== 'accounts.google.com') throw new Error('Google sign-in did not open.');
    window.location.assign(target.href);
  } catch {
    await refreshAccount();
    publish({ ...snapshot, operation: '', error: 'Google sign-in did not open. Please try again.' });
  }
}

export async function signOutAccount() {
  if (snapshot.status !== 'ready' || !snapshot.user || snapshot.operation) return;
  // Unmount the hand and abort every identity-bound request immediately.
  suspendAccount('signout');
  announceAccountChange('changing');
  try {
    const response = await authRequest('/api/auth/sign-out', {});
    if (!response.ok) throw new Error('Sign-out failed.');
    // A cross-tab refresh must not be reused as sign-out confirmation.
    suspendAccount('signout');
    await refreshAccount({ requireSignedOut: true });
    if (getAccountSnapshot().status !== 'ready' || getAccountSnapshot().user) throw new Error('Sign-out was not confirmed.');
    announceAccountChange();
  } catch {
    // Keep the private view closed if the server did not confirm sign-out.
    closeAccountUntilRechecked('Sign-out was not confirmed. Reconnect and check your account before continuing.');
  }
}
