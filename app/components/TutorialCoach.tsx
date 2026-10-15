'use client';

import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { placeTutorialCoach, type CoachingStep, type CoachPlacement, type CoachRect } from '../../lib/tutorial-coaching';

interface Layout { placement: CoachPlacement; target: CoachRect; height: number }
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(n, high));

/** A non-modal teaching popup: the highlighted game control remains clickable. */
export default function TutorialCoach({ step, feedback = '' }: { step: CoachingStep; feedback?: string }) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [layout, setLayout] = useState<Layout | null>(null);
  useLayoutEffect(() => { setMounted(true); }, []);

  useLayoutEffect(() => {
    if (!mounted) return;
    let frame = 0;
    let target: HTMLElement | null = null;
    let previousDescription: string | null = null;
    let movedIntoView = false;
    const viewport = window.visualViewport;
    const observer = new ResizeObserver(() => schedule());
    if (panel.current) observer.observe(panel.current);

    function measure() {
      frame = 0;
      const element = document.querySelector<HTMLElement>(step.target);
      const popup = panel.current;
      if (!element || !popup) { setLayout(null); return; }
      if (element !== target) {
        if (target) {
          observer.unobserve(target);
          target.removeAttribute('data-practice-coach-target');
          if (previousDescription === null) target.removeAttribute('aria-describedby');
          else target.setAttribute('aria-describedby', previousDescription);
        }
        target = element;
        previousDescription = element.getAttribute('aria-describedby');
        element.setAttribute('aria-describedby', [previousDescription, `${id}-body`].filter(Boolean).join(' '));
        element.setAttribute('data-practice-coach-target', 'true');
        observer.observe(element);
      }
      const view = {
        left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0,
        width: viewport?.width ?? window.innerWidth, height: viewport?.height ?? window.innerHeight,
      };
      let box = element.getBoundingClientRect();
      if (!movedIntoView) {
        movedIntoView = true;
        if (box.top < view.top + 16 || box.bottom > view.top + view.height - 16) {
          element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
          box = element.getBoundingClientRect();
        }
      }
      const bounds = { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      const naturalHeight = popup.scrollHeight + 2;
      const placement = placeTutorialCoach(bounds, naturalHeight, view);
      const next: Layout = { placement, target: bounds, height: Math.min(naturalHeight, placement.maxHeight) };
      setLayout(old => JSON.stringify(old) === JSON.stringify(next) ? old : next);
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(measure); }
    schedule();
    const mutation = new MutationObserver(schedule);
    // React portals (the Sort menu) sometimes arrive after the control update.
    mutation.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect(); mutation.disconnect();
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      if (target) {
        target.removeAttribute('data-practice-coach-target');
        if (previousDescription === null) target.removeAttribute('aria-describedby');
        else target.setAttribute('aria-describedby', previousDescription);
      }
    };
  }, [mounted, step.id, step.target, feedback, id]);

  if (!mounted) return null;
  let arrow: { x1: number; y1: number; x2: number; y2: number } | null = null;
  if (layout) {
    const p = layout.placement, t = layout.target;
    const middleX = (t.left + t.right) / 2, middleY = (t.top + t.bottom) / 2;
    if (p.side === 'above' || p.side === 'below') {
      const x = clamp(middleX, p.left + 20, p.left + p.width - 20);
      arrow = { x1: x, y1: p.side === 'above' ? p.top + layout.height : p.top, x2: middleX, y2: p.side === 'above' ? t.top - 5 : t.bottom + 5 };
    } else {
      const y = clamp(middleY, p.top + 18, p.top + layout.height - 18);
      arrow = { x1: p.side === 'left' ? p.left + p.width : p.left, y1: y, x2: p.side === 'left' ? t.left - 5 : t.right + 5, y2: middleY };
    }
  }
  return createPortal(<div className="practice-coach-layer">
    {layout && <div className="practice-coach-ring" aria-hidden="true" style={{ left: layout.target.left - 5, top: layout.target.top - 5, width: layout.target.right - layout.target.left + 10, height: layout.target.bottom - layout.target.top + 10 }}/>}
    {arrow && <svg className="practice-coach-arrow" aria-hidden="true">
      <defs><marker id={`${id}-arrow`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#f3cf7c"/></marker></defs>
      <line {...arrow} stroke="#07271e" strokeWidth="6"/>
      <line {...arrow} stroke="#f3cf7c" strokeWidth="2.5" markerEnd={`url(#${id}-arrow)`}/>
    </svg>}
    <div ref={panel} role="region" aria-label="Practice help" aria-live="polite" aria-atomic="true"
      data-tutorial-coach="" data-step-id={step.id} data-target-selector={step.target}
      className="practice-coach"
      style={layout ? { left: layout.placement.left, top: layout.placement.top, width: layout.placement.width, maxHeight: layout.placement.maxHeight } : { visibility: 'hidden', width: 'min(340px, calc(100vw - 24px))' }}>
      <div className="practice-coach-step">STEP {step.number} OF 11</div>
      <h2 className="practice-coach-title">{step.title}</h2>
      <p id={`${id}-body`} className="practice-coach-body">{step.body}</p>
      {feedback && <p className="practice-coach-feedback">{feedback}</p>}
      <div className="practice-coach-cue">{step.cue}</div>
    </div>
  </div>, document.body);
}
