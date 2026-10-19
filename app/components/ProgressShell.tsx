import type { ReactNode } from 'react';
import GameLogo from './GameLogo';
import DeveloperCredit from './DeveloperCredit';
import '../progress.css';

export default function ProgressShell({ title, intro, children, current = 'profile' }: { title: string; intro: string; children: ReactNode; current?: 'profile' | 'competition' | 'ladder' }) {
  return <div className="parkes-app progress-app"><div className="felt-grain" aria-hidden="true"/>
    <header className="progress-header"><a href="/" aria-label="Parkes Rummy home"><GameLogo/></a><a className="button outline" href="/">Back to game</a></header>
    <main className="progress-main"><div className="progress-title"><div><p className="progress-eyebrow">YOUR PARKES RUMMY</p><h1>{title}</h1><p>{intro}</p></div></div>
      <nav className="progress-primary" aria-label="Player progress"><a aria-current={current === 'profile' ? 'page' : undefined} href="/profile">My profile</a><a aria-current={current === 'competition' ? 'page' : undefined} href="/competition">Challenges &amp; clubs</a><a aria-current={current === 'ladder' ? 'page' : undefined} href="/ladder">Human ladder</a></nav>
      {children}
    </main><footer className="progress-footer"><DeveloperCredit/><a href="/progress-help">Records &amp; competition guide</a><a href="/privacy">Privacy</a></footer>
  </div>;
}
