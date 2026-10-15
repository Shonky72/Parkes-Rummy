'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import DeveloperCredit from './DeveloperCredit';

/** The home shell is shared across tabs. The playing table is never touched. */
export default function HomeInformation() {
  const [home, setHome] = useState<HTMLElement | null>(null);
  const footer = useRef<HTMLElement>(null);
  useEffect(() => {
    let frame = 0;
    const scan = () => {
      frame = 0;
      const main = document.querySelector<HTMLElement>('.parkes-app > .home-main');
      setHome(old => old === main ? old : main);
      // Keyboard users also need access to the same independent scroll region.
      const content = main?.querySelector<HTMLElement>('.start-panel > .home-tab-content');
      if (content) {
        content.tabIndex = 0;
        content.setAttribute('role', 'region');
        const tab = main?.querySelector('.home-play-tabs .active')?.textContent ?? 'Selected tab';
        content.setAttribute('aria-label', `${tab} content`);
      }
    };
    const observer = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(scan); });
    observer.observe(document.body, { childList: true, subtree: true });
    scan();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);

  useLayoutEffect(() => {
    if (!home || !footer.current) return;
    let frame = 0;
    const header = home.parentElement?.querySelector<HTMLElement>('.home-header');
    function measure() {
      frame = 0;
      if (!home || !footer.current) return;
      const desktop = window.matchMedia('(min-width: 851px)').matches;
      let height = 940;
      if (desktop) {
        const top = home.getBoundingClientRect().top + window.scrollY;
        const style = getComputedStyle(home);
        const footerHeight = footer.current.getBoundingClientRect().height;
        const space = document.documentElement.clientHeight - top
          - parseFloat(style.paddingTop || '0') - parseFloat(style.rowGap || '0')
          - footerHeight - 18;
        // No shrink-to-fit fonts or reordered forms. Short windows scroll the tab body.
        height = Math.max(520, Math.floor(space));
      }
      const value = `${height}px`;
      if (home.style.getPropertyValue('--home-panel-height') !== value) {
        home.style.setProperty('--home-panel-height', value);
      }
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(measure); }
    const observer = new ResizeObserver(schedule);
    observer.observe(home);
    observer.observe(footer.current);
    if (header) observer.observe(header);
    window.addEventListener('resize', schedule);
    measure();
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      home.style.removeProperty('--home-panel-height');
    };
  }, [home]);

  return home ? createPortal(
    <footer ref={footer} className="home-information-footer" aria-label="About Parkes Rummy and player information">
      <DeveloperCredit/>
    </footer>, home, 'home-information-footer',
  ) : null;
}
