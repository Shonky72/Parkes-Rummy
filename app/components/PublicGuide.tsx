import type { ReactNode } from 'react';
import AdSlot from './AdSlot';
import GameLogo from './GameLogo';
import SiteLinks from './SiteLinks';
import '../public-guide.css';

const guideLinks = [
  { href: '/how-to-play', label: 'How to play' },
  { href: '/rules', label: 'Rules' },
  { href: '/scoring', label: 'Scoring' },
  { href: '/help', label: 'Help' },
  { href: '/about-help', label: 'About' },
];

export default function PublicGuide({
  title, intro, currentPath, sections = [], advertising = false, children,
}: {
  title: string;
  intro: string;
  currentPath: string;
  sections?: { href: string; label: string }[];
  advertising?: boolean;
  children: ReactNode;
}) {
  return <main className="public-guide">
    <div className="public-guide-topbar">
      <div className="public-guide-brand"><GameLogo large/></div>
      <a className="button gold public-guide-play" href="/">Play Parkes Rummy <span aria-hidden="true">↗</span></a>
    </div>
    <nav className="public-guide-nav" aria-label="Game guides">
      {guideLinks.map(link => <a key={link.href} href={link.href} aria-current={currentPath === link.href ? 'page' : undefined}>{link.label}</a>)}
    </nav>
    <header className="public-guide-header">
      <p className="public-guide-eyebrow">AT THE PARKES RUMMY TABLE</p>
      <h1>{title}</h1>
      <p className="public-guide-intro">{intro}</p>
    </header>
    {sections.length > 0 && <nav className="public-guide-contents" aria-label="On this page">
      <span>On this page</span>
      {sections.map(section => <a key={section.href} href={section.href}>{section.label}</a>)}
    </nav>}
    <article className="public-guide-article">{children}</article>
    <aside className="public-guide-next" aria-label="Practise and keep learning">
      <div><h2>Take a seat when you’re ready</h2><p>Try a guided hand, or open the table and play with friends or AI.</p></div>
      <div className="public-guide-actions"><a className="button gold" href="/tutorial">Try the practice hand</a><a className="button outline" href="/">Open the game</a></div>
    </aside>
    {advertising && <div className="public-guide-ad"><AdSlot surface="guide" adFree={false}/></div>}
    <nav className="public-guide-related" aria-label="More Parkes Rummy information">
      <a href="/progress-help">Records &amp; competition</a><a href="/install">Install to your phone</a><a href="/about-help">IBD Collective &amp; support</a>
    </nav>
    <footer className="public-guide-footer"><SiteLinks/></footer>
  </main>;
}

const suitNames: Record<string, string> = { '♣': 'clubs', '♦': 'diamonds', '♥': 'hearts', '♠': 'spades' };

export function GuideCards({ cards, label }: {
  cards: { rank: string; suit: '♣' | '♦' | '♥' | '♠'; represents?: string }[];
  label: string;
}) {
  return <div className="guide-cards" role="group" aria-label={label}>
    {cards.map((card, index) => <span
      className={'guide-card' + (card.suit === '♥' || card.suit === '♦' ? ' guide-card-red' : '')}
      key={card.rank + card.suit + index}
      role="img"
      aria-label={card.rank + ' of ' + suitNames[card.suit] + (card.represents ? ', wild representing ' + card.represents : '')}
    ><b aria-hidden="true">{card.rank}</b><span aria-hidden="true">{card.suit}</span>{card.represents && <small aria-hidden="true">as {card.represents}</small>}</span>)}
  </div>;
}
