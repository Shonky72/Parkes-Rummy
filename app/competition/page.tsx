import type { Metadata } from 'next';
import CompetitionPanel from '../components/CompetitionPanel';

export const metadata: Metadata = { title: 'Challenges & clubs | Parkes Rummy', robots: { index: false, follow: false } };

export default async function CompetitionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const value = (key: string) => typeof params[key] === 'string' ? params[key] as string : '';
  return <CompetitionPanel initialTab={value('tab')} duelToken={value('duel')} rematchToken={value('rematch')}/>;
}
