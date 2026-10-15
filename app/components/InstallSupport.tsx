'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Smartphone } from 'lucide-react';
import { hasSeenInstallGuide, saveInstallGuideSeen, INSTALL_GUIDE_SEEN_KEY } from '../../lib/phone-install';

interface DeferredInstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
interface InstallState {
  ready: boolean;
  installed: boolean;
  available: boolean;
  viewed: boolean;
  markViewed(): void;
  requestInstall(): Promise<'accepted' | 'dismissed' | 'unavailable' | 'error'>;
}
const InstallContext = createContext<InstallState | null>(null);
export function usePhoneInstall(): InstallState {
  const value = useContext(InstallContext);
  if (!value) throw new Error('Phone installation context is missing');
  return value;
}

/** Progressive enhancement only. No cached games, network interceptors, or automatic prompts. */
export default function InstallSupport({ children }: { children: ReactNode }) {
  const deferred = useRef<DeferredInstallPrompt | null>(null);
  const [ready, setReady] = useState(false);
  const [viewed, setViewed] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [available, setAvailable] = useState(false);
  const markViewed = useCallback(() => {
    setViewed(true);
    try { saveInstallGuideSeen(window.localStorage); } catch { /* Storage disabled. */ }
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(display-mode: standalone)');
    const isStandalone = () => media.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const refresh = () => {
      setInstalled(isStandalone());
      try { setViewed(hasSeenInstallGuide(window.localStorage)); } catch { /* Keep memory state. */ }
    };
    const onPrompt = (event: Event) => {
      const prompt = event as DeferredInstallPrompt;
      if (typeof prompt.prompt !== 'function') return;
      event.preventDefault();
      deferred.current = prompt;
      setAvailable(true);
    };
    const onInstalled = () => { deferred.current = null; setAvailable(false); setInstalled(true); markViewed(); };
    const onStorage = (event: StorageEvent) => { if (event.key === INSTALL_GUIDE_SEEN_KEY || event.key === null) refresh(); };
    refresh(); setReady(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener('pageshow', refresh);
    window.addEventListener('storage', onStorage);
    media.addEventListener('change', refresh);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener('pageshow', refresh);
      window.removeEventListener('storage', onStorage);
      media.removeEventListener('change', refresh);
    };
  }, [markViewed]);

  const requestInstall = useCallback(async () => {
    const prompt = deferred.current;
    if (!prompt) return 'unavailable' as const;
    // A native event is single-use, including after dismissal. Consume before awaiting.
    deferred.current = null; setAvailable(false);
    try { await prompt.prompt(); return (await prompt.userChoice).outcome; }
    catch { return 'error' as const; }
  }, []);

  return <InstallContext.Provider value={{ ready, viewed, installed, available, markViewed, requestInstall }}>
    {children}<InstallEntryPoints/>
  </InstallContext.Provider>;
}

/** The app mounts/unmounts its home and Settings surfaces as accounts and rooms change.
 * Portals attach only to those two existing surfaces, leaving the large game component untouched.
 */
function InstallEntryPoints() {
  const { ready, viewed, installed, markViewed } = usePhoneInstall();
  const [home, setHome] = useState<Element | null>(null);
  const [settings, setSettings] = useState<Element | null>(null);
  useEffect(() => {
    let frame = 0;
    const scan = () => {
      frame = 0;
      const header = document.querySelector('.home-header .header-actions');
      const settingsRow = document.querySelector('.settings-modal .settings-games-row');
      setHome(old => old === header ? old : header);
      setSettings(old => old === settingsRow ? old : settingsRow);
    };
    const observer = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(scan); });
    observer.observe(document.body, { childList: true, subtree: true });
    scan();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);
  return <>
    {ready && home && !viewed && !installed && createPortal(
      <Link href="/install" className="button outline install-phone-shortcut" onClick={markViewed}>
        <Smartphone size={18} aria-hidden="true"/><span>Install to phone</span>
      </Link>, home, 'phone-install-home')}
    {settings && createPortal(
      <div className="settings-install-entry">
        <Link href="/install" className="button outline" onClick={markViewed}><Smartphone size={19} aria-hidden="true"/>Install to phone</Link>
        <p>Simple picture instructions. No app store needed.</p>
      </div>, settings, 'phone-install-settings')}
  </>;
}
