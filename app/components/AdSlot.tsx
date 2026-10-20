'use client';
import { useAdvertising } from './AdvertisingConsent';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import type { AdSurface } from '../../lib/monetization';
import { shouldShowAds } from '../../lib/monetization';

const slotIds: Record<AdSurface, string | undefined> = {
  guide: process.env.NEXT_PUBLIC_ADSENSE_SLOT_GUIDES?.trim() || process.env.NEXT_PUBLIC_ADSENSE_SLOT_HOME?.trim(),
};

export default function AdSlot({ surface, adFree = false, activePlay = false }: { surface: AdSurface; adFree?: boolean; activePlay?: boolean }) {
  const pathname = usePathname();
  const element = useRef<HTMLModElement>(null);
  const pushed = useRef<HTMLModElement | null>(null);
  const {allowed,nonce}=useAdvertising();
  const client = process.env.NEXT_PUBLIC_ADSENSE_CLIENT?.trim();
  const slot = slotIds[surface];
  const enabled = process.env.NEXT_PUBLIC_ADS_ENABLED === 'true';
  const visible = allowed && enabled && Boolean(client && slot) && shouldShowAds({ adFree, surface, pathname, activePlay });
  useEffect(() => {
    if (!visible || !element.current || pushed.current === element.current) return;
    // Recheck the current document before inserting any third-party code.
    if (!shouldShowAds({ adFree, surface, pathname: window.location.pathname, activePlay })) return;
    try {
      if(!document.getElementById('parkes-advertising-script')){const script=document.createElement('script');script.id='parkes-advertising-script';script.nonce=nonce;script.async=true;script.crossOrigin='anonymous';script.src=`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client!)}`;document.head.append(script);}
      const w = window as typeof window & { adsbygoogle?: unknown[] };
      (w.adsbygoogle ||= []).push({});
      pushed.current = element.current;
    } catch { /* Ad provider retries on the next page view. */ }
  }, [visible,client,nonce,adFree,surface,pathname,activePlay]);
  if (!visible) return null;
  return <aside className={`ad-slot ad-slot-${surface}`} aria-label="Advertisement">
    <span className="ad-label">Advertisement</span>
    <ins ref={element} key={pathname} className="adsbygoogle" style={{ display: 'block' }} data-ad-client={client} data-ad-slot={slot} data-ad-format="auto" data-full-width-responsive="true"/>
  </aside>;
}
