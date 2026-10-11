export const REMOVE_ADS_PRODUCT = {
  key: 'remove_ads',
  name: 'Parkes Rummy – Remove Ads',
  currency: 'aud',
  amount: 199,
} as const;

export type AdSurface = 'home' | 'lobby' | 'scores' | 'round-result' | 'final-result';

export function shouldShowAds(input: { adFree: boolean; surface: AdSurface; activePlay?: boolean }) {
  if (input.adFree || input.activePlay) return false;
  return ['home', 'lobby', 'scores', 'round-result', 'final-result'].includes(input.surface);
}

export function formatAudCents(cents: number) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);
}
