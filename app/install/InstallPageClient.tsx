'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Copy, Globe, Smartphone, Wifi } from 'lucide-react';
import GameLogo from '../components/GameLogo';
import BackgroundSuits from '../components/BackgroundSuits';
import DeveloperCredit from '../components/DeveloperCredit';
import InstallIllustration from '../components/InstallIllustration';
import { InviteQR } from '../components/InviteQR';
import { usePhoneInstall } from '../components/InstallSupport';
import { detectInstallEnvironment, phoneInstallGuide, GAME_HOME_URL, PHONE_INSTALL_URL, type InstallBrowser, type InstallEnvironment, type PhonePlatform } from '../../lib/phone-install';

const browsers: { id: InstallBrowser; label: string }[] = [
  { id: 'chrome', label: 'Chrome' }, { id: 'safari', label: 'Safari' },
  { id: 'samsung', label: 'Samsung Internet' }, { id: 'opera', label: 'Opera' },
  { id: 'other', label: 'Other' },
];
export default function InstallPageClient() {
  const install = usePhoneInstall();
  const [environment, setEnvironment] = useState<InstallEnvironment | null>(null);
  const [platform, setPlatform] = useState<PhonePlatform>('android');
  const [browser, setBrowser] = useState<InstallBrowser>('chrome');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    const found = detectInstallEnvironment(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
    setEnvironment(found);
    setPlatform(found.platform === 'ios' ? 'ios' : 'android');
    setBrowser(found.platform === 'desktop' ? 'chrome' : found.browser);
    install.markViewed();
  }, [install.markViewed]);
  const guide = phoneInstallGuide(platform, browser);
  function chooseBrowser(value: InstallBrowser) {
    setBrowser(value);
    if (value === 'safari') setPlatform('ios');
    if (value === 'samsung') setPlatform('android');
    setMessage('');
  }
  function choosePhone(value: PhonePlatform) {
    setPlatform(value);
    setBrowser(value === 'ios' ? 'safari' : 'chrome');
    setMessage('');
  }
  async function copyAddress() {
    try { await navigator.clipboard.writeText(GAME_HOME_URL); setMessage('Game address copied. Paste into your phone browser.'); }
    catch { setMessage('Type parkesrummy.com into your phone browser.'); }
  }
  async function nativeInstall() {
    if (busy) return;
    setBusy(true); setMessage('');
    const result = await install.requestInstall();
    setBusy(false);
    setMessage(result === 'accepted' ? 'Request accepted. Finish the phone prompt, then look for your new game icon.'
      : result === 'dismissed' ? 'No problem. Follow the picture steps whenever you are ready.'
      : 'Use the picture steps below to add the game.');
  }
  const direct = install.available && !install.installed && !environment?.embedded && environment?.platform === 'android' && platform === 'android' && browser === environment.browser;
  return <div className="parkes-app phone-install-page">
    <div className="felt-grain" aria-hidden="true"/><BackgroundSuits/>
    <header className="site-header phone-install-header"><GameLogo/><Link className="button outline small" href="/"><ArrowLeft size={17}/>Back to game</Link></header>
    <main className="phone-install-main">
      <section className="panel install-guide-panel">
        <div className="install-guide-heading"><span className="install-kicker"><Smartphone size={17}/>YOUR GAME, ONE TAP AWAY</span><h1>Install to phone</h1><p>Add Parkes Rummy to your home screen. No app store. No extra charge.</p></div>
        {environment?.platform === 'desktop' && <aside className="install-desktop-help">
          <div className="install-qr"><InviteQR value={PHONE_INSTALL_URL} size={116} title="Scan for phone installation steps" description={`Open these instructions on your phone: ${PHONE_INSTALL_URL}`}/></div>
          <div><strong>On a computer?</strong><p>Point your phone camera at this code. Open the link, then follow the three pictures.</p><button className="text-link" onClick={copyAddress}><Copy size={15}/>Copy game address</button></div>
        </aside>}
        <div className="install-selectors">
          <div className="install-device-tabs" role="group" aria-label="Your phone"><button type="button" aria-pressed={platform === 'android'} onClick={() => choosePhone('android')}>Android</button><button type="button" aria-pressed={platform === 'ios'} onClick={() => choosePhone('ios')}>iPhone / iPad</button></div>
          <div className="install-browser-tabs" role="tablist" aria-label="Your browser">{browsers.map((item, index) => <button type="button" role="tab" id={`install-tab-${item.id}`} aria-selected={browser === item.id} aria-controls="install-browser-guide" tabIndex={browser === item.id ? 0 : -1} key={item.id} ref={element => { tabs.current[index] = element; }} onClick={() => chooseBrowser(item.id)} onKeyDown={event => {
            let next = index;
            if (event.key === 'ArrowRight') next = (index + 1) % browsers.length;
            else if (event.key === 'ArrowLeft') next = (index + browsers.length - 1) % browsers.length;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = browsers.length - 1;
            else return;
            event.preventDefault(); chooseBrowser(browsers[next].id); tabs.current[next]?.focus();
          }}>{item.label}</button>)}</div>
          <p className="install-detected">{environment && environment.platform !== 'desktop' ? 'Phone and browser selected automatically. Change the tabs if needed.' : 'Choose your phone and browser above.'}</p>
        </div>
        {install.installed && <p className="install-status install-already" role="status"><Check size={18}/>This game is already running as an app, or your browser confirmed installation.</p>}
        {environment?.embedded && <div className="install-browser-warning"><Globe size={22}/><div><strong>Open your usual browser first</strong><p>This looks like a browser inside another app. Open the app menu and choose Open in browser, or copy the game address.</p><button className="text-link" onClick={copyAddress}><Copy size={14}/>Copy game address</button></div></div>}
        <section id="install-browser-guide" role="tabpanel" aria-labelledby={`install-tab-${browser}`}>
          <div className="install-route-heading"><h2>{guide.title}</h2><span>3 easy steps</span></div>
          {guide.note && <p className="install-route-note">{guide.note}</p>}
          <p className="install-open-address">Start with <strong>parkesrummy.com</strong> open in {guide.browser === 'samsung' ? 'Samsung Internet' : guide.browser === 'safari' ? 'Safari' : guide.browser === 'opera' ? 'Opera' : 'Chrome'}.</p>
          {direct && <div className="install-native-offer"><button type="button" className="button gold" disabled={busy} onClick={() => { void nativeInstall(); }}><Smartphone size={18}/>{busy ? 'Opening phone prompt…' : 'Install on this phone'}</button><small>Your browser offers a direct install. The pictures below are another way.</small></div>}
          <ol className="install-steps">{guide.steps.map((step, index) => <li className="install-step" key={`${platform}-${browser}-${index}`}><div className="install-step-heading"><span>{index + 1}</span><h3>{step.title}</h3></div><InstallIllustration step={step} browser={guide.browser}/><p>{step.text}</p></li>)}</ol>
          <p className="install-visual-note">Pictures are illustrations. Menu names and positions vary with browser version.</p>
        </section>
        {message && <p className="install-status" role="status">{message}</p>}
        <div className="install-finish"><span className="install-finish-icon">♠</span><div><strong>Next time: tap your Parkes Rummy icon.</strong><p>Need these steps again? Open Settings → Install to phone.</p></div></div>
        <div className="install-important"><p><Wifi size={16}/>Internet is still required to play.</p><p>Use the same Google account to recover games and purchases if your phone asks you to sign in again.</p></div>
        <details className="install-more-help"><summary>Not seeing the option?</summary><p>Use a normal browser tab, not private or incognito mode. On iPhone, try Safari. On Android, try Chrome. Inside another app, use Open in browser first.</p><p>For Safari, scroll the Share list. If Add to Home Screen is missing, open Edit Actions and add the option.</p><a href={guide.source} target="_blank" rel="noreferrer">Browser help</a></details>
        <footer className="install-guide-footer"><Link className="button gold" href="/">Back to Parkes Rummy</Link><small>The main-screen shortcut is now tucked away in Settings on this browser.</small></footer>
      </section>
      <DeveloperCredit/>
    </main>
  </div>;
}
