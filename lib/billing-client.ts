'use client';
import type { StoreProductKey } from './store-catalog';
export async function startStoreCheckout(product: StoreProductKey): Promise<void> {
  const response = await fetch('/api/store/checkout', { method:'POST', credentials:'same-origin', cache:'no-store', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ product }) });
  const data = await response.json().catch(() => ({})) as { url?: string; error?: string };
  if (!response.ok || !data.url) throw new Error(data.error || 'Checkout did not open.');
  const target = new URL(data.url);
  if (target.protocol !== 'https:' || target.hostname !== 'checkout.stripe.com') throw new Error('Checkout did not open.');
  window.location.assign(target.href);
}
export async function startRemoveAdsCheckout(): Promise<void> { return startStoreCheckout('remove_ads'); }
