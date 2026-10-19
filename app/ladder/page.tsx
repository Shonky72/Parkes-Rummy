import type { Metadata } from 'next';
import LadderPanel from '../components/LadderPanel';
export const metadata: Metadata = { title: 'Human ladder | Parkes Rummy', robots: { index: false, follow: false } };
export default function LadderPage() { return <LadderPanel/>; }
