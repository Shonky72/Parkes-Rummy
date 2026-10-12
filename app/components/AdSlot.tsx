'use client';

import { useEffect, useRef } from 'react';
import type { AdSurface } from '../../lib/monetization';
import { shouldShowAds } from '../../lib/monetization';

const slotIds: Record<AdSurface, string | undefined> = {
  home: process.env.NEXT_PUBLIC_ADSENSE_SLOT_HOME,
  lobby: process.env.NEXT_PUBLIC_ADSENSE_SLOT_LOBBY,
  scores: process.env.NEXT_PUBLIC_ADSENSE_SLOT_SCORES,
  'round-result': process.env.NEXT_PUBLIC_ADSENSE_SLOT_RESULTS,
  'final-result': process.env.NEXT_PUBLIC_ADSENSE_SLOT_RESULTS,
};

export default function AdSlot({ surface, adFree, activePlay = false }: { surface: AdSurface; adFree: boolean; activePlay?: boolean }) {
  const pushed = useRef(false);
  const client = process.env.NEXT_PUBLIC_ADSENSE_CLIENT;
  const slot = slotIds[surface];
  const enabled = process.env.NEXT_PUBLIC_ADS_ENABLED === 'true';
  const visible = enabled && Boolean(client && slot) && shouldShowAds({ adFree, surface, activePlay });
  useEffect(() => {
    if (!visible || pushed.current) return;
    try {
      const w = window as typeof window & { adsbygoogle?: unknown[] };
      (w.adsbygoogle ||= []).push({});
      pushed.current = true;
    } catch { /* Ad provider retries on the next page view. */ }
  }, [visible]);
  if (!visible) return null;
  return <aside className={`ad-slot ad-slot-${surface}`} aria-label="Advertisement">
    <span className="ad-label">Advertisement</span>
    <ins className="adsbygoogle" style={{ display: 'block' }} data-ad-client={client} data-ad-slot={slot} data-ad-format="auto" data-full-width-responsive="true"/>
  </aside>;
}
