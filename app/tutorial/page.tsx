import type { Metadata } from 'next';
import TutorialGame from '../components/TutorialGame';
import '../tutorial.css';

export const metadata: Metadata = {
  title: 'Guided Practice | Parkes Rummy',
  description: 'Learn Parkes Rummy with a guided, guaranteed-win practice hand against a scripted AI.',
};

export default function TutorialPage() {
  return <TutorialGame/>;
}
