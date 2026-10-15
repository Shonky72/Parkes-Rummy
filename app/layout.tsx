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
import { fontCssUrl } from '../lib/store-catalog';
import InstallSupport from './components/InstallSupport';
import HomeInformation from './components/HomeInformation';

export const metadata: Metadata = {
  title: 'Parkes Rummy',
  authors: [{ name: 'IBD Collective' }],
  creator: 'IBD Collective',
  description: 'Your table, your friends, your house rules. Play Parkes Rummy together in your browser. Up to eight players, ten rules, and twos are wild.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Parkes Rummy', statusBarStyle: 'default' },
  icons: { icon: '/favicon.svg', shortcut: '/favicon.svg', apple: [{ url: '/app-icon/180.png', sizes: '180x180', type: 'image/png' }] },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#062c22' };
const ADSENSE_VERIFICATION_CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT?.trim() || 'ca-pub-5430752526720484';

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-AU">
    <head>
      <link rel="preconnect" href="https://fonts.googleapis.com"/>
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous"/>
      <link rel="stylesheet" href={fontCssUrl()}/>
      <script async src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_VERIFICATION_CLIENT}`} crossOrigin="anonymous"/>
    </head>
    <body><InstallSupport>{children}<HomeInformation/></InstallSupport></body>
  </html>;
}
