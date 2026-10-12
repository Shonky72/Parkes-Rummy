import Image from 'next/image';
import SiteLinks from './SiteLinks';

export default function DeveloperCredit() {
  return <div className="developer-credit">
    <span>Developed by</span>
    <Image
      className="developer-wordmark"
      src="/ibd-collective.png"
      alt="IBD Collective"
      width={346}
      height={78}
      unoptimized
    />
    <SiteLinks/>
  </div>;
}
