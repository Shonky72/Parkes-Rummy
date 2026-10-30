'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, Check, Flame, LoaderCircle, RefreshCw, Trophy } from 'lucide-react';
import type { CompetitionRepository } from '../../db/competition';
import type { AccountSnapshot } from '../../lib/account-client';
import type { PlayStreakSummary } from '../../lib/play-streak';
import { getClientIdentity, isClientIdentityCurrent } from '../../lib/client-identity';
import { openCompetitionRoom } from '../../lib/competition-client';
import { competitionCalendar, sydneyDayBounds, sydneyDayKey } from '../../lib/competition';
import { progressRequest } from '../../lib/progress-client';
import '../home-daily-play.css';

type Snapshot = Pick<Awaited<ReturnType<CompetitionRepository['snapshot']>>, 'calendar' | 'daily' | 'attempts'>;
type AttemptResult = Awaited<ReturnType<CompetitionRepository['reserveAttempt']>>;
const weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError';
const message = (error: unknown) => error instanceof Error ? error.message : 'Please reconnect and try again.';

/** Remounted on account epoch changes so no previous player's progress survives. */
export default function HomeDailyPlay({ account, disabled = false, showDaily = true }: { account: AccountSnapshot; disabled?: boolean; showDaily?: boolean }) {
  if (!account.user) return <section className="home-daily-play" aria-label={showDaily ? 'Daily Challenge and play streak' : 'Play streak'}>
    {showDaily && <a className="button gold home-main-action home-daily-button" href="/competition" aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined} onClick={event => { if (disabled) event.preventDefault(); }}><CalendarDays size={28} aria-hidden="true"/>Daily Challenge</a>}
    <div className="home-streak home-streak-guest"><Flame size={24} aria-hidden="true"/><div><strong>Start your streak today</strong><p>Sign in to save your streak across devices. Finish a Quick Play or challenge, win or lose.</p></div></div>
  </section>;
  return <SignedDailyPlay key={`${account.user.id}:${account.epoch}`} accountId={account.user.id} disabled={disabled} showDaily={showDaily}/>;
}

function SignedDailyPlay({ accountId, disabled, showDaily }: { accountId: string; disabled: boolean; showDaily: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [streak, setStreak] = useState<PlayStreakSummary | null>(null);
  const [dailyError, setDailyError] = useState('');
  const [streakError, setStreakError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const mounted = useRef(false);
  const running = useRef(false);
  const sequence = useRef(0);
  const loadController = useRef<AbortController | null>(null);
  const startController = useRef<AbortController | null>(null);
  const lastRefresh = useRef(0);

  const load = useCallback(async () => {
    if (!mounted.current || running.current) return;
    const identity = getClientIdentity();
    if (!identity.ready || identity.accountId !== accountId) return;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    const request = ++sequence.current;
    lastRefresh.current = Date.now();
    setLoading(true);
    const results = await Promise.allSettled([
      showDaily ? progressRequest<Snapshot>('/api/competition', undefined, controller.signal) : Promise.resolve(null),
      progressRequest<PlayStreakSummary>('/api/play-streak', undefined, controller.signal),
    ]);
    if (!mounted.current || controller.signal.aborted || request !== sequence.current || !isClientIdentityCurrent(identity)) return;
    const [dailyResult, streakResult] = results;
    if (dailyResult.status === 'fulfilled') { setSnapshot(dailyResult.value); setDailyError(''); }
    else if (!isAbort(dailyResult.reason)) setDailyError(message(dailyResult.reason));
    if (streakResult.status === 'fulfilled') { setStreak(streakResult.value); setStreakError(''); }
    else if (!isAbort(streakResult.reason)) setStreakError(message(streakResult.reason));
    setLoading(false);
  }, [accountId, showDaily]);

  useEffect(() => {
    mounted.current = true;
    let day = sydneyDayKey();
    let midnightTimer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      if (document.hidden || running.current) return;
      const nextDay = sydneyDayKey();
      if (nextDay !== day) {
        day = nextDay;
        setSnapshot(null); setStreak(null); setNotice('');
      } else if (Date.now() - lastRefresh.current < 5_000) return;
      void load();
    };
    const scheduleMidnight = () => {
      midnightTimer = setTimeout(() => { refresh(); scheduleMidnight(); }, Math.max(1_000, sydneyDayBounds().end - Date.now() + 250));
    };
    void load();
    scheduleMidnight();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      mounted.current = false;
      sequence.current++;
      loadController.current?.abort();
      startController.current?.abort();
      clearTimeout(midnightTimer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load]);

  const firstAttempt = snapshot?.attempts.find(attempt => attempt.challengeId === snapshot.daily.challengeId && attempt.scored);
  const activePractice = snapshot?.attempts.find(attempt => attempt.challengeId === snapshot.daily.challengeId && attempt.practice && attempt.status === 'active');
  const dailyUnplayed = !!snapshot && snapshot.daily.firstAttemptAvailable && !firstAttempt;
  const dailyActive = firstAttempt?.status === 'active';
  const dailyCompleted = firstAttempt?.status === 'completed';
  const dailyFinished = !!firstAttempt && !dailyActive;
  const label = starting ? 'Opening Daily Challenge…' : dailyActive ? 'Continue Daily Challenge' : dailyFinished ? activePractice ? 'Continue practice replay' : 'Daily Challenge · replay' : 'Daily Challenge';

  async function start() {
    if (running.current || disabled) return;
    if (!snapshot) { window.location.assign('/competition'); return; }
    const identity = getClientIdentity();
    if (!identity.ready || identity.accountId !== accountId) return;
    running.current = true;
    loadController.current?.abort();
    sequence.current++;
    const controller = new AbortController();
    startController.current = controller;
    setStarting(true); setDailyError(''); setNotice('');
    try {
      const result = await progressRequest<AttemptResult>('/api/competition', {
        action: 'startAttempt', token: snapshot.daily.token, practice: dailyFinished,
      }, controller.signal);
      if (!mounted.current || controller.signal.aborted || !isClientIdentityCurrent(identity)) return;
      if (result.roomCode && result.room) { openCompetitionRoom(result.roomCode); return; }
      setNotice('Your first result is saved. Open a practice replay for another hand.');
    } catch (error) {
      if (mounted.current && !controller.signal.aborted && isClientIdentityCurrent(identity) && !isAbort(error)) setDailyError(message(error));
    } finally {
      running.current = false;
      if (mounted.current && isClientIdentityCurrent(identity)) { setStarting(false); void load(); }
    }
  }

  const status = streak?.completedToday ? 'Today complete' : streak && streak.current > 0 ? 'Keep your streak going' : 'Start your streak today';
  return <section className="home-daily-play" aria-label={showDaily ? 'Daily Challenge and play streak' : 'Play streak'}>
    {showDaily && <><button type="button" className={`button gold home-main-action home-daily-button${dailyUnplayed && !dailyError && !starting && !disabled ? ' home-daily-unplayed' : ''}`}
      disabled={disabled || starting || loading && !snapshot} onClick={() => { void start(); }}>
      {starting ? <LoaderCircle size={28} className="spin" aria-hidden="true"/> : dailyCompleted ? <Check size={28} aria-hidden="true"/> : <CalendarDays size={28} aria-hidden="true"/>}
      <span>{label}</span>
    </button>
    {snapshot && <p className="home-daily-caption">{dailyCompleted ? 'Today’s challenge finished. Replays are practice.' : dailyActive ? 'Your saved daily hand is ready to continue.' : dailyFinished ? 'Your first attempt is recorded. Practice replay is available.' : `Game ${snapshot.daily.game} · Rule ${snapshot.daily.ruleNumber}: ${snapshot.daily.title}`}</p>}
    {loading && !snapshot && <p className="home-daily-caption" role="status">Checking today’s deal…</p>}
    {dailyError && <div className="home-daily-error" role="status"><p>{dailyError}</p><a href="/competition">Open Challenges</a></div>}
    {notice && <p className="home-daily-caption" role="status">{notice}</p>}

    </>}
    <div className={`home-streak${streak?.completedToday ? ' home-streak-complete' : ''}`} aria-label="Daily play streak">
      {streak ? <>
        <div className="home-streak-heading"><Flame size={24} aria-hidden="true"/><div><strong>{streak.current} day{streak.current === 1 ? '' : 's'}</strong><span>Play streak</span></div><span className="home-streak-best"><Trophy size={14} aria-hidden="true"/>Best {streak.best}</span></div>
        <p className="home-streak-prompt" role="status">{streak.completedToday && <Check size={16} aria-hidden="true"/>}{status}</p>
        <p className="home-streak-note">{streak.completedToday ? 'Your finished game earned today’s tick. Return tomorrow to extend your streak.' : streak.current > 0 ? `Finish a game today to reach ${streak.current + 1} days. Wins and losses both count.` : 'Finish a Quick Play, challenge or full game to earn your first day.'}</p>
        <ol className="home-streak-week" aria-label="Finished-game days this week">{competitionCalendar(streak.today).weekDays.map((day, index) => {
          const complete = streak.completedDays.includes(day);
          const today = day === streak.today;
          const future = day > streak.today;
          return <li key={day} className={`${complete ? 'is-complete' : ''}${today ? ' is-today' : ''}${future ? ' is-future' : ''}`} aria-current={today ? 'date' : undefined} aria-label={`${weekdayLabels[index]}, ${day}${today ? ', today' : ''}: ${complete ? 'completed' : future ? 'upcoming' : 'no completed game'}`}>
            <span>{weekdayLabels[index]}</span><span className="home-streak-day" aria-hidden="true">{complete ? <Check size={17}/> : today ? <span className="home-streak-today-dot"/> : '·'}</span>
          </li>;
        })}</ol>
        <small className="home-streak-calendar">One completed-game credit per day. Days reset at midnight Sydney time.</small>
      </> : <div className="home-streak-pending" role="status"><Flame size={22} aria-hidden="true"/><span>{streakError ? 'Your streak is unavailable right now.' : 'Loading your play streak…'}</span></div>}
      {streakError && <p className="home-streak-error">{streakError}</p>}
      {(dailyError || streakError) && <button type="button" className="text-link home-streak-refresh" disabled={disabled || loading || starting} onClick={() => { void load(); }}><RefreshCw size={15} aria-hidden="true"/>Try again</button>}
    </div>
  </section>;
}
