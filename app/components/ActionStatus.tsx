'use client';

import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { pendingMoveText } from '../../lib/meld-layout';

/** The invisible measuring text retains the old geometry. Readable copy overlays
 * that same space, bounded by the existing status band, not by the card table. */
export default function ActionStatus({ hint, busy }: { hint: string; busy: string }) {
  const paragraph = useRef<HTMLParagraphElement>(null);
  const [height, setHeight] = useState(20);
  const pending = pendingMoveText(busy);
  useLayoutEffect(() => {
    const p = paragraph.current;
    const band = p?.parentElement;
    if (!p || !band) return;
    const measure = () => {
      const bounds = band.getBoundingClientRect(), text = p.getBoundingClientRect();
      const centre = (text.top + text.bottom) / 2;
      const room = Math.max(14, Math.min(40, 2 * Math.min(centre - bounds.top, bounds.bottom - centre) - 2));
      setHeight(old => Math.abs(old - room) < .5 ? old : room);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(band); observer.observe(p);
    return () => observer.disconnect();
  }, [hint]);
  return <p ref={paragraph} className="action-status-message" aria-live="polite" aria-atomic="true" data-pending={pending ? 'true' : undefined}>
    <span className="status-message-measure" aria-hidden="true">{hint}</span>
    <span className="status-message-visible" style={{ '--status-copy-height': `${height}px` } as CSSProperties}>{pending ?? hint}</span>
  </p>;
}
