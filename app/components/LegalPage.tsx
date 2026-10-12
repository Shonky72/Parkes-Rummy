import Link from 'next/link';
import DeveloperCredit from './DeveloperCredit';

export default function LegalPage({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  return <main className="legal-page">
    <header className="legal-header"><Link href="/" className="legal-back">← Parkes Rummy</Link><h1>{title}</h1>{intro && <p>{intro}</p>}</header>
    <article className="legal-card">{children}</article>
    <nav className="legal-links" aria-label="Website information">
      <Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/cookies">Cookies</Link><Link href="/data-account">Data & Account</Link><Link href="/about-help">About & Help</Link>
    </nav>
    <DeveloperCredit />
  </main>;
}
