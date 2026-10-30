'use client';

import { ArrowUpRight, Award, BookOpen, CalendarRange, History, Share2, Swords, Trophy, Users } from 'lucide-react';
import type { AccountSnapshot } from '../../lib/account-client';
import HomeDailyPlay from './HomeDailyPlay';
import '../home-progress.css';

const destinations = [
  { href: '/profile?tab=achievements', title: 'Achievements', description: 'Earned badges and your next milestones.', Icon: Award },
  { href: '/profile?tab=rules', title: 'Personal records', description: 'Your best openings and progress through every rule.', Icon: BookOpen },
  { href: '/ladder', title: 'Ranked ladder', description: 'Human matches, ratings and standings.', Icon: Trophy },
  { href: '/competition?tab=rule-week', title: 'Rule of the Week', description: 'A fresh rule and shared deal to master.', Icon: CalendarRange },
  { href: '/competition?tab=deals', title: 'Shared challenges', description: 'Create a deal, share a target or resume an attempt.', Icon: Share2 },
  { href: '/competition?tab=clubs', title: 'Clubs', description: 'Private clubs and friendly weekly standings.', Icon: Users },
  { href: '/competition?tab=duels', title: 'Three-deal duels', description: 'Challenge a friend across three fixed deals.', Icon: Swords },
  { href: '/competition?tab=rematches', title: 'Rematches', description: 'Return to a rivalry with another match.', Icon: Swords },
  { href: '/profile?tab=history', title: 'Hand review', description: 'Revisit your completed hands and decisions.', Icon: History },
  { href: '/profile?tab=friends', title: 'Friends', description: 'Connect by invitation and compare records.', Icon: Users },
];

export default function HomeProgressPanel({ account, disabled = false }: { account: AccountSnapshot; disabled?: boolean }) {
  return <section className="home-progress" aria-label="Your progress and challenges">
    <div className="home-progress-intro"><h3>Your progress</h3><p>Your streak, achievements and next challenge, all together.</p></div>
    {!account.user && <p className="home-progress-signin">Sign in above to save your progress and open your personal records.</p>}
    <HomeDailyPlay account={account} disabled={disabled} showDaily={false}/>
    <nav className="home-progress-links" aria-label="Achievements and challenges">{destinations.map(({ href, title, description, Icon }) => <a key={href} href={href}>
      <Icon size={22} aria-hidden="true"/><span><strong>{title}</strong><small>{description}</small></span><ArrowUpRight size={17} aria-hidden="true"/>
    </a>)}</nav>
    <a className="home-progress-help" href="/progress-help">How records, achievements and challenges work</a>
  </section>;
}
