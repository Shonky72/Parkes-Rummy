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
import { fontCssUrl } from '../lib/store-catalog';

export const metadata: Metadata = {
  title: 'Parkes Rummy',
  authors: [{ name: 'IBD Collective' }],
  creator: 'IBD Collective',
  description: 'Your table, your friends, your house rules. Play Parkes Rummy together in your browser. Up to eight players, ten rules, and twos are wild.',
  icons: { icon: '/favicon.svg', shortcut: '/favicon.svg' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#062c22' };
const ADSENSE_VERIFICATION_CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT?.trim() || 'ca-pub-5430752526720484';

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-AU">
    <head>
      <link rel="preconnect" href="https://fonts.googleapis.com"/>
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous"/>
      <link rel="stylesheet" href={fontCssUrl()}/>
      <script
        async
        src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_VERIFICATION_CLIENT}`}
        crossOrigin="anonymous"
      />
    </head>
    <body>{children}</body>
  </html>;
}

