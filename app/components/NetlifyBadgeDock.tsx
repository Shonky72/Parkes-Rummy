'use client';

import { useEffect } from 'react';
import { positionNetlifyBadge } from '../../lib/netlify-badge';

export default function NetlifyBadgeDock() {
  useEffect(() => {
    let scheduled = 0;
    let app: Element | null = null;
    let badge: Element | null = null;
    const schedule = () => { if (!scheduled) scheduled = requestAnimationFrame(update); };
    const sizes = new ResizeObserver(schedule);
    function update() {
      scheduled = 0;
      const nextApp = document.querySelector('.parkes-app');
      const nextBadge = document.querySelector('body > iframe#nl-badge-frame[title="Powered by Netlify"]');
      if (nextApp !== app) { if (app) sizes.unobserve(app); app = nextApp; if (app) sizes.observe(app); }
      if (nextBadge !== badge) { if (badge) sizes.unobserve(badge); badge = nextBadge; if (badge) sizes.observe(badge); }
      positionNetlifyBadge();
    }
    const children = new MutationObserver(schedule);
    children.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule, { passive: true });
    update();
    return () => {
      children.disconnect(); sizes.disconnect(); cancelAnimationFrame(scheduled);
      window.removeEventListener('resize', schedule);
      document.body.style.removeProperty('--parkes-badge-clearance');
    };
  }, []);
  return null;
}
