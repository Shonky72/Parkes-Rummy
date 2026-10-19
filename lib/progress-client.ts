'use client';

import { getClientIdentity, isClientIdentityCurrent, subscribeClientIdentity } from './client-identity';
import { recheckAccount } from './account-client';

/** Identity pins prevent a late response from a previous sign-in reaching a new profile. */
export async function progressRequest<T>(path: string, body?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const identity = getClientIdentity();
  if (!identity.ready || !identity.accountId) throw new Error('Sign in to open your progress.');
  const controller = new AbortController();
  const abort = () => controller.abort();
  const stop = subscribeClientIdentity(abort);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 20_000);
  try {
    const response = await fetch(path, {
      method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      headers: { 'X-Parkes-Identity': identity.key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = await response.json();
    if (!isClientIdentityCurrent(identity)) throw new DOMException('Account changed', 'AbortError');
    if (response.status === 401) recheckAccount();
    if (!response.ok) throw new Error(value.error || 'Please try again.');
    return value as T;
  } finally {
    clearTimeout(timeout); stop(); signal?.removeEventListener('abort', abort);
  }
}

export async function copyProgressLink(path: string): Promise<string> {
  const url = new URL(path, window.location.origin).href;
  await navigator.clipboard.writeText(url);
  return url;
}

export async function shareProgressImage(share: { url: string; imageUrl: string }, title = 'Beat my record'): Promise<'shared' | 'copied' | 'cancelled'> {
  const url = new URL(share.url, window.location.origin).href;
  if (navigator.share) {
    try {
      const response = await fetch(share.imageUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error('This shared record is unavailable.');
      const blob = await response.blob();
      const file = new File([blob], 'parkes-rummy-record.png', { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ title, text: 'Beat my record on Parkes Rummy.', url, files: [file] });
      else await navigator.share({ title, text: 'Beat my record on Parkes Rummy.', url });
      return 'shared';
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
      // A desktop browser may reject native file sharing; the explicit link remains usable.
    }
  }
  await navigator.clipboard.writeText(url);
  return 'copied';
}
