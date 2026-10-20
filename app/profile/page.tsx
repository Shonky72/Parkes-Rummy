import type { Metadata } from 'next';
import ProfilePanel from '../components/ProfilePanel';
export const metadata: Metadata = { title: 'My profile | Parkes Rummy', robots: { index: false, follow: false } };
export default async function ProfilePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  return <ProfilePanel initialTab={typeof params.tab === 'string' ? params.tab : 'overview'} initialRule={typeof params.rule === 'string' ? params.rule : ''} initialHand={typeof params.handId === 'string' ? params.handId : ''}/>;
}
