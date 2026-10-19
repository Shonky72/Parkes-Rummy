import AdvertisingConsent from './components/AdvertisingConsent';
import { headers } from 'next/headers';
import type { Metadata, Viewport } from 'next';
import './globals.css';
import './hand-interactions.css';
import './table-motion.css';
import './move-hints.css';
import './mobile-table.css';
import './individual-rules.css';
import './background-suits.css';
import './game-layout.css';
import './mobile-hand.css';
import './sort-control.css';
import './turn-alerts.css';
import './invite-actions.css';
import './your-games.css';
import './draw-card-drag.css';
import './developer-credit.css';
import './monetization.css';
import './store.css';
import './install.css';
import './home-information.css';
import './mobile-usability.css';
import './table-readability.css';
import { fontCssUrl } from '../lib/store-catalog';
import InstallSupport from './components/InstallSupport';
import HomeInformation from './components/HomeInformation';
import NetlifyBadgeDock from './components/NetlifyBadgeDock';

export const metadata: Metadata = {
  title: 'Parkes Rummy',
  other: { 'google-adsense-account': process.env.NEXT_PUBLIC_ADSENSE_CLIENT?.trim() || 'ca-pub-5430752526720484' },
  authors: [{ name: 'IBD Collective' }],
  creator: 'IBD Collective',
  description: 'Your table, your friends, your house rules. Play Parkes Rummy together in your browser. Up to eight players, ten rules, and twos are wild.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Parkes Rummy', statusBarStyle: 'default' },
  icons: { icon: '/favicon.svg', shortcut: '/favicon.svg', apple: [{ url: '/app-icon/180.png', sizes: '180x180', type: 'image/png' }] },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#062c22' };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Dynamic rendering gives each HTML response its own CSP nonce. Next reads
  // the forwarded CSP and applies that nonce to its inline bootstrap scripts.
  const nonce=(await headers()).get('x-nonce')||'';
  return <html lang="en-AU">
    <head>
      <link rel="preconnect" href="https://fonts.googleapis.com"/>
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous"/>
      <link rel="stylesheet" href={fontCssUrl()}/>
    </head>
    <body><AdvertisingConsent nonce={nonce}><InstallSupport>{children}<HomeInformation/><NetlifyBadgeDock/></InstallSupport></AdvertisingConsent></body>
  </html>;
}
