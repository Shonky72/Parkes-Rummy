import type { Metadata } from 'next';
import ParkesApp from './components/ParkesApp';
import PublicHomeInformation from './components/PublicHomeInformation';
import './public-home.css';

export const metadata: Metadata = {
  title: 'Parkes Rummy | Play with friends and learn the rules',
  description: 'Play Parkes Rummy with friends or AI opponents. Learn the house rules, wild twos, scoring and ten-rule game collections, then try a guided practice hand.',
  alternates: { canonical: 'https://parkesrummy.com/' },
};

export default function Home() {
  return <ParkesApp publicHome={<PublicHomeInformation/>} />;
}
