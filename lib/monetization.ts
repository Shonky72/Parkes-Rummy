export const REMOVE_ADS_PRODUCT = {
  key: 'remove_ads',
  name: 'Parkes Rummy – Remove Ads',
  currency: 'aud',
  amount: 199,
} as const;

export type AdSurface = 'guide';

const ADVERTISING_GUIDE_PATHS = new Set([
  '/how-to-play',
  '/rules',
  '/scoring',
  '/help',
  '/progress-help',
]);

/** Only standalone public guides are eligible. Query strings never grant access. */
export function isAdvertisingGuidePath(pathname: string | null | undefined): boolean {
  if (typeof pathname !== 'string') return false;
  return ADVERTISING_GUIDE_PATHS.has(pathname.split(/[?#]/, 1)[0]);
}

export function shouldShowAds(input: { adFree: boolean; surface: AdSurface; pathname: string | null; activePlay?: boolean }) {
  return !input.adFree && !input.activePlay && input.surface === 'guide' && isAdvertisingGuidePath(input.pathname);
}

export function formatAudCents(cents: number) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);
}
