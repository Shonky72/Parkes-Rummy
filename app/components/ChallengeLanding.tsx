'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, RefreshCw, Target } from 'lucide-react';
import type { AttemptPreview, ChallengeDescriptor, CompetitionRepository } from '../../db/competition';
import { progressRequest } from '../../lib/progress-client';
import { AccountControls, AccountLoading, useAccountSession } from './AccountControls';
import { ChallengeCard, openCompetitionRoom } from './CompetitionPanel';
import ProgressShell from './ProgressShell';
import '../competition.css';

type Snapshot = Awaited<ReturnType<CompetitionRepository['snapshot']>>;
type AttemptResult = Awaited<ReturnType<CompetitionRepository['reserveAttempt']>>;
const isAbort = (reason: unknown) => reason instanceof Error && reason.name === 'AbortError';
const message = (reason: unknown) => reason instanceof Error ? reason.message : 'This invitation could not be opened. Please try again.';

export default function ChallengeLanding({ token }: { token: string }) {
  const account = useAccountSession();
  if (account.status !== 'ready' || account.operation) return <AccountLoading account={account}/>;
  return <ChallengeInvitation key={`${account.user?.id ?? 'guest'}:${account.epoch}:${token}`} token={token} account={account}/>;
}

function ChallengeInvitation({ token, account }: { token: string; account: ReturnType<typeof useAccountSession> }) {
  const [challenge, setChallenge] = useState<ChallengeDescriptor | null>(null), [attempts, setAttempts] = useState<AttemptPreview[]>([]);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const active = useRef(true), running = useRef(false);
  const signedIn = !!account.user;
  useEffect(() => {
    active.current = true; const controller = new AbortController();
    void load(controller.signal);
    return () => { active.current = false; controller.abort(); };
    // Identity and invitation changes remount this component and abort its requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, signedIn]);

  async function load(signal?: AbortSignal) {
    setLoading(true); setError('');
    try {
      const path = `/api/competition/challenge/${encodeURIComponent(token)}`;
      const readDescriptor = async () => {
        if (signedIn) return progressRequest<{ challenge: ChallengeDescriptor }>(path, undefined, signal);
        const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal });
        const value = await response.json();
        if (!response.ok) throw new Error(value.error || 'This invitation is unavailable or has been revoked.');
        return value as { challenge: ChallengeDescriptor };
      };
      const [descriptor, history] = await Promise.allSettled([readDescriptor(), signedIn ? progressRequest<Snapshot>('/api/competition', undefined, signal) : Promise.resolve(null)]);
      if (!active.current || signal?.aborted) return;
      if (descriptor.status === 'rejected') throw descriptor.reason;
      setChallenge(descriptor.value.challenge);
      if (history.status === 'fulfilled') setAttempts(history.value?.attempts ?? []);
      else if (!isAbort(history.reason)) setNotice('The invitation is ready. Open your first attempt to resume it or retrieve its saved result.');
    } catch (reason) { if (active.current && !isAbort(reason)) setError(message(reason)); }
    finally { if (active.current && !signal?.aborted) setLoading(false); }
  }

  async function play(practice: boolean) {
    if (!challenge || running.current || !signedIn) return;
    running.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const result = await progressRequest<AttemptResult>('/api/competition', { action: 'startAttempt', token: challenge.token, practice });
      if (!active.current) return;
      if (result.room) { openCompetitionRoom(result.roomCode); return; }
      setAttempts(current => [result.attempt, ...current.filter(attempt => attempt.id !== result.attempt.id)]);
      setChallenge(current => current ? { ...current, firstAttemptAvailable: false } : current);
      setNotice('Your first result is saved below. You can play this deal again as practice.');
    } catch (reason) { if (active.current && !isAbort(reason)) setError(message(reason)); }
    finally { running.current = false; if (active.current) setBusy(false); }
  }
  const first = attempts.find(attempt => attempt.challengeId === challenge?.challengeId && attempt.scored);
  const practice = attempts.find(attempt => attempt.challengeId === challenge?.challengeId && attempt.practice && attempt.status === 'active');
  return <ProgressShell title={challenge?.target ? 'Can you beat this deal?' : 'Your same-deal challenge'} intro="One fixed deal. The same initial cards and AI opponents. Your choices decide what follows." current="competition"><div className="competition-landing">
    <div className="competition-landing-heading"><Target size={22}/><span>{challenge ? `An invitation from ${challenge.hostName}` : 'Parkes Rummy challenge invitation'}</span></div>
    {error && <p role="alert" className="progress-error">{error}</p>}{notice && <p role="status" className="progress-notice">{notice}</p>}
    {challenge ? <ChallengeCard challenge={challenge} attempt={first} practiceAttempt={practice} busy={busy || loading} onStart={signedIn ? practice => { void play(practice); } : undefined}>
      {!signedIn && <div className="competition-landing-account"><p>Sign in to play this challenge. Your first attempt is saved, and you can reconnect from another device.</p><AccountControls account={account}/></div>}
    </ChallengeCard> : <section className="panel progress-section" aria-busy={loading}>{loading ? <p role="status">Opening the challenge invitation…</p> : <><h2>Invitation unavailable</h2><p>Ask the person who shared it for a current link, or try today’s Parkes deal.</p><button className="button outline" disabled={loading} onClick={() => { void load(); }}><RefreshCw size={17}/>Try again</button></>}</section>}
    <section className="panel progress-section"><h2>One scored first attempt</h2><p>Completing the opening comes first, followed by an earlier personal opening turn, going out, fewer closing turns and lower leftover points. Equal results share a place.</p><p>Your first reserved attempt counts. Reconnect to the same hand if you leave the page. Practice unlocks after that attempt settles and never replaces its score. Withdrawal scores −1; confirmed service interruptions are excluded.</p><p className="progress-note">Daily first attempts start on the displayed Sydney date and close at 02:00 the following day. Other attempts allow seven days to reconnect. A public invitation is separate from account access and can be revoked by its owner.</p></section>
    <nav className="competition-landing-links" aria-label="Challenge links"><a href="/competition?tab=deals">Your attempts &amp; invitations <ArrowRight size={14}/></a><a href="/competition">Daily Parkes Deal</a><a href="/progress-help">Scoring guide</a></nav>
  </div></ProgressShell>;
}
