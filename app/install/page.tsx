import type { Metadata } from 'next';
import InstallPageClient from './InstallPageClient';

export const metadata: Metadata = {
  title: 'Install to phone | Parkes Rummy',
  description: 'Three picture steps to add Parkes Rummy to your phone home screen. Chrome, Safari, Samsung Internet and Opera help.',
};
export default function InstallPage() { return <InstallPageClient/>; }
