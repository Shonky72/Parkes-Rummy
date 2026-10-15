'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import DeveloperCredit from './DeveloperCredit';

/** Follow the app's home surface, including a return from a saved game.
 * The footer is a normal grid row, never an overlay covering game controls.
 */
export default function HomeInformation() {
  const [home, setHome] = useState<Element | null>(null);
  useEffect(() => {
    let frame = 0;
    const scan = () => {
      frame = 0;
      const main = document.querySelector('.parkes-app > .home-main');
      setHome(old => old === main ? old : main);
    };
    const observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(scan);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    scan();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);
  return home ? createPortal(
    <footer className="home-information-footer" aria-label="About Parkes Rummy and player information">
      <DeveloperCredit/>
    </footer>, home, 'home-information-footer',
  ) : null;
}
