import Link from 'next/link';
export default function SiteLinks() {
  return <nav className="site-links" aria-label="Website information"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/cookies">Cookies</Link><Link href="/data-account">Data & Account</Link><Link href="/store">Store</Link><Link href="/about-help">Help</Link></nav>;
}
