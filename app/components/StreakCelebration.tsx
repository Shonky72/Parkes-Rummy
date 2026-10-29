'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowRight, Check, Flame, Sparkles } from 'lucide-react';
import { getClientIdentity, isClientIdentityCurrent, subscribeClientIdentity } from '../../lib/client-identity';
import { playStreakFanfare } from '../../lib/audio';
import { progressRequest } from '../../lib/progress-client';
import type { PlayStreakSummary } from '../../lib/play-streak';
import { STREAK_CELEBRATION_TIMING, streakAwardForResult, streakCelebrationHistory, type StreakAward } from '../../lib/streak-celebration';
import '../streak-celebration.css';

type AwardView = { accountId: string; handId: string; award: StreakAward };

/** Mount only for a finished game, inside the existing result dialog after its card reveal. */
export default function StreakCelebration({ accountId, handId, children }: {
  accountId: string; handId: string; children: ReactNode;
}) {
  const [view, setView] = useState<AwardView | null>(null);

  useEffect(() => {
    const identity = getClientIdentity();
    if (!identity.ready || identity.accountId !== accountId || !handId) return;
    const controller = new AbortController();
    let closed = false;
    let pending = false;
    let checked = false;
    const stopIdentity = subscribeClientIdentity(() => {
      controller.abort();
      setView(null);
    });
    const read = async () => {
      if (closed || pending || checked || document.visibilityState === 'hidden'
        || !isClientIdentityCurrent(identity)) return;
      pending = true;
      try {
        const summary = await progressRequest<PlayStreakSummary>('/api/play-streak', undefined, controller.signal);
        if (closed || !isClientIdentityCurrent(identity) || document.visibilityState === 'hidden') return;
        checked = true;
        const award = streakAwardForResult(summary, handId);
        if (award && !streakCelebrationHistory.has(accountId, award)) setView({ accountId, handId, award });
      } catch {
        // A missing celebration never blocks the authoritative game result.
      } finally { pending = false; }
    };
    const onVisible = () => { if (document.visibilityState !== 'hidden') void read(); };
    document.addEventListener('visibilitychange', onVisible);
    void read();
    return () => {
      closed = true; controller.abort(); stopIdentity();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [accountId, handId]);

  const active = view?.accountId === accountId && view.handId === handId ? view : null;
  if (!active) return children;
  return <StreakAwardMoment key={`${accountId}:${active.award.day}`} accountId={accountId} award={active.award} onContinue={() => setView(null)}/>;
}

function StreakAwardMoment({ accountId, award, onContinue }: {
  accountId: string; award: StreakAward; onContinue: () => void;
}) {
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [phase, setPhase] = useState<'hold' | 'roll' | 'landed' | 'complete'>(() => reducedMotion ? 'complete' : 'hold');
  const claimed = useRef(false);
  const dismiss = useRef(onContinue);
  const stopSound = useRef<() => void>(() => {});
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { dismiss.current = onContinue; }, [onContinue]);

  useEffect(() => {
    const identity = getClientIdentity();
    if (!identity.ready || identity.accountId !== accountId) { dismiss.current(); return; }
    // This effect runs only after the section is on the page. StrictMode retains the ref.
    if (!claimed.current) {
      if (!streakCelebrationHistory.claim(accountId, award)) { dismiss.current(); return; }
      claimed.current = true;
    }
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const reduced = media.matches;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let closed = false;
    stopSound.current = playStreakFanfare(reduced);
    heading.current?.focus({ preventScroll: true });
    if (!reduced) {
      timers.push(setTimeout(() => setPhase('roll'), STREAK_CELEBRATION_TIMING.holdMs));
      timers.push(setTimeout(() => setPhase('landed'), STREAK_CELEBRATION_TIMING.landingMs));
      timers.push(setTimeout(() => setPhase('complete'), STREAK_CELEBRATION_TIMING.messageMs));
    }
    const settle = () => {
      for (const timer of timers) clearTimeout(timer);
      stopSound.current();
      if (!closed) setPhase('complete');
    };
    const onHidden = () => { if (document.visibilityState === 'hidden') settle(); };
    const onMotion = () => { if (media.matches) { setReducedMotion(true); settle(); } };
    const stopIdentity = subscribeClientIdentity(() => { settle(); dismiss.current(); });
    document.addEventListener('visibilitychange', onHidden);
    media.addEventListener('change', onMotion);
    return () => {
      closed = true; settle(); stopIdentity();
      document.removeEventListener('visibilitychange', onHidden);
      media.removeEventListener('change', onMotion);
    };
  }, [accountId, award]);

  const landed = phase === 'landed' || phase === 'complete';
  const style = {
    '--streak-roll-ms': `${STREAK_CELEBRATION_TIMING.rollMs}ms`,
  } as CSSProperties;
  return <section className={`streak-award streak-award-${phase}${reducedMotion ? ' streak-award-reduced' : ''}`} style={style} aria-labelledby="streak-award-heading">
    <div className="streak-award-sparkles" aria-hidden="true">{Array.from({ length: 12 }, (_, index) => <i key={index} style={{ '--spark-index': index } as CSSProperties}/>)}</div>
    <span className="streak-award-flame" aria-hidden="true"><Flame size={35}/></span>
    <p className="streak-award-kicker">One finished game. One day earned.</p>
    <h3 id="streak-award-heading" ref={heading} tabIndex={-1}>Today’s streak earned!</h3>
    <div className="streak-award-counter" aria-hidden="true">
      <div className="streak-award-reel"><span>{award.previous}</span><span>{award.current}</span></div>
      <span className="streak-award-tick"><Check size={36}/></span>
    </div>
    <p className="streak-award-unit" aria-hidden="true">{landed ? award.current : award.previous} day{(landed ? award.current : award.previous) === 1 ? '' : 's'}</p>
    <p className="streak-award-message" role="status" aria-live="polite">
      {landed ? <><Sparkles size={19} aria-hidden="true"/>{award.current === 1 ? '1 day. Your streak starts today.' : `${award.current} days in a row. Keep going!`}</> : 'A finished game deserves a little celebration.'}
    </p>
    <p className={`streak-award-tomorrow${phase === 'complete' ? ' ready' : ''}`}>Come back tomorrow to continue your streak.</p>
    <button type="button" className="button gold streak-award-continue" data-sound="none" onClick={() => { stopSound.current(); dismiss.current(); }}>
      Continue<ArrowRight size={20} aria-hidden="true"/>
    </button>
  </section>;
}
