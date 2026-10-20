'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, CalendarDays, Copy, LockKeyhole, Plus, RefreshCw, RotateCcw, Share2, Swords, Target, Trophy, Users } from 'lucide-react';
import type { AttemptPreview, ChallengeDescriptor, CompetitionRepository } from '../../db/competition';
import type { RecordsRepository } from '../../db/records';
import type { ChallengeScore } from '../../lib/competition-types';
import type { Difficulty, GameType } from '../../lib/types';
import { rememberSeat } from '../../lib/client';
import { getClientIdentity } from '../../lib/client-identity';
import { copyProgressLink, progressRequest } from '../../lib/progress-client';
import { sharedConditionLines } from '../../lib/record-condition-label';
import { AccountControls, AccountLoading, useAccountSession } from './AccountControls';
import ProgressShell from './ProgressShell';
import type { ProfileSnapshot } from './ProfilePanel';
import '../competition.css';

type Snapshot = Awaited<ReturnType<CompetitionRepository['snapshot']>>;
type Club = Awaited<ReturnType<CompetitionRepository['club']>>;
type Duel = Awaited<ReturnType<CompetitionRepository['duel']>>;
type Rematch = Awaited<ReturnType<CompetitionRepository['rematch']>>;
type Comparison = Awaited<ReturnType<RecordsRepository['comparison']>>;
type AttemptResult = Awaited<ReturnType<CompetitionRepository['reserveAttempt']>>;
type Tab = 'daily' | 'deals' | 'clubs' | 'duels' | 'rematches';
type Props = { initialTab?: string; duelToken?: string; rematchToken?: string };
type ActionResult = { challenge?: ChallengeDescriptor; club?: { id: string }; duel?: Duel; rematch?: Rematch; roomCode?: string | null; room?: AttemptResult['room']; attempt?: AttemptPreview; resumed?: boolean };
type Mutate = (action: string, values?: Record<string, unknown>, message?: string) => Promise<void>;
const tabs: { key: Tab; label: string }[] = [{ key: 'daily', label: 'Daily deal' }, { key: 'deals', label: 'My deals' }, { key: 'clubs', label: 'Clubs' }, { key: 'duels', label: 'Three-deal duels' }, { key: 'rematches', label: 'Rematches' }];
const gameName = (game: number) => game === 4 ? 'Original Rules' : `Game ${game}`;
const points = (value: number | null | undefined) => value === null || value === undefined ? 'Excluded' : new Intl.NumberFormat('en-AU').format(value);
const date = (value: number) => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', dateStyle: 'medium' }).format(value);
const deadline = (value: number) => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', dateStyle: 'medium', timeStyle: 'short' }).format(value);
const ruleName = (id: string) => { const [game, rule] = id.split(':'); return `${gameName(Number(game))} · Rule ${rule}`; };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Please reconnect and try again.';
const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError';

/** The server has already created and authenticated this account's seat. */
export function openCompetitionRoom(roomCode: string) {
  const identity = getClientIdentity();
  if (!identity.ready || !identity.accountId || !rememberSeat(roomCode, identity.key)) throw new Error('Your account changed. Refresh before opening this table.');
  window.location.assign(`/join/${encodeURIComponent(roomCode)}`);
}

export function ChallengeScoreSummary({ score, value, label = 'Your result' }: { score: ChallengeScore; value?: number | null; label?: string }) {
  if (score.outcome === 'service-interrupted') return <div className="competition-result"><strong>{label}: service interruption</strong><p>This attempt is excluded from points. Its first-attempt reservation remains recorded.</p></div>;
  return <div className="competition-result"><div className="progress-row"><strong>{label}</strong>{value !== undefined && <span className="competition-points">{points(value)} points</span>}</div>
    {score.outcome === 'abandoned' && <p>Withdrawn. A practice replay cannot replace this result.</p>}
    <dl className="record-metrics"><div><dt>Opening</dt><dd>{score.completed ? `Personal turn ${score.openingTurn}` : 'Not completed'}</dd></div><div><dt>Finish</dt><dd>{score.wentOut ? `Went out · ${score.closingTurns} closing turn${score.closingTurns === 1 ? '' : 's'}` : `${score.penalty} leftover points`}</dd></div></dl>
  </div>;
}

export function ChallengeCard({ challenge, attempt, practiceAttempt, busy, onStart, onRevoke, children }: {
  challenge: ChallengeDescriptor; attempt?: AttemptPreview; practiceAttempt?: AttemptPreview; busy: boolean;
  onStart?: (practice: boolean) => void; onRevoke?: () => void; children?: React.ReactNode;
}) {
  const activeFirst = attempt?.status === 'active';
  const finishedFirst = !!attempt && !activeFirst;
  const canPractice = finishedFirst;
  const label = challenge.kind === 'daily' ? 'Daily Parkes Deal' : challenge.kind === 'rule-week' ? 'Rule of the Week' : challenge.kind === 'duel' ? 'Three-Deal Duel' : challenge.target ? 'Beat My Deal' : 'Your fixed deal';
  return <article className="panel progress-section competition-challenge">
    <p className="progress-eyebrow">{label}{challenge.day ? ` · ${challenge.day}` : ''}</p>
    <p className="competition-rule-label">{gameName(challenge.game)} · Rule {challenge.ruleNumber}</p><h2>{challenge.title}</h2><p>{challenge.description}</p>
    <ul className="competition-conditions" aria-label="Fixed challenge conditions"><li>{challenge.difficulties.length} AI opponent{challenge.difficulties.length === 1 ? '' : 's'}: {challenge.difficulties.join(', ')}</li><li>Hints {challenge.showMoveHints ? 'on' : 'off'}</li><li>You sit in seat {challenge.humanSeat + 1}; seat {challenge.startingSeat + 1} starts</li></ul>
    {challenge.target && <ChallengeScoreSummary score={challenge.target} value={challenge.targetPoints} label={`${challenge.hostName}’s target`}/>}
    {attempt?.score && <ChallengeScoreSummary score={attempt.score} value={attempt.points} label="Your first scored attempt"/>}
    {activeFirst && <p className="competition-status">First attempt in progress. Reconnect before {deadline(attempt.deadlineAt)} Sydney time.</p>}
    {onStart && <div className="progress-actions competition-play-actions">
      {(challenge.firstAttemptAvailable || activeFirst || !attempt) && <button type="button" className="button gold" disabled={busy} onClick={() => onStart(false)}><ArrowRight size={17}/>{activeFirst ? 'Continue first attempt' : challenge.firstAttemptAvailable ? 'Play this challenge' : 'Resume or view first result'}</button>}
      {canPractice && <button type="button" className="button outline" disabled={busy} onClick={() => onStart(true)}><RotateCcw size={16}/>{practiceAttempt?.status === 'active' ? 'Continue practice' : 'Practice replay'}</button>}
      {attempt?.status === 'completed' && <a className="text-link" href={`/profile?tab=history&handId=${encodeURIComponent(attempt.handId)}`}>Review your hand</a>}
    </div>}
    {challenge.firstAttemptAvailable && !attempt && <p className="progress-note">Your first attempt counts. Opening this deal reserves that attempt; reconnecting resumes it.</p>}
    {activeFirst && <p className="progress-note">Practice unlocks after your first attempt finishes or you withdraw.</p>}
    {challenge.kind === 'daily' && !challenge.firstAttemptAvailable && !attempt && <p className="progress-note">New scored attempts may be closed. Check for your saved first attempt to resume it or view its result.</p>}
    {finishedFirst && <p className="progress-note">Replays are practice and cannot replace your first score.</p>}
    {children}
    <details className="competition-version"><summary>Same-deal conditions</summary><p>Everyone receives the same initial cards, seat and AI setup. The card order and AI behaviour stay fixed for this version. Different choices can change what happens later.</p><p className="progress-note">Version: {challenge.engineVersion}. No turn timer.</p>{challenge.game === 4 && <p className="progress-note">Original Rules access may be supplied by this challenge’s entitled host. It applies to this deal.</p>}</details>
    {onRevoke && challenge.owner && <details className="competition-manage"><summary>{challenge.shared ? 'Manage this public link' : 'Manage this private deal'}</summary><p className="progress-note">{challenge.shared ? 'Revoking this invitation prevents new visitors from opening it.' : 'Removing a private deal also revokes any invitations made from it. Earned results remain saved.'}</p><button className="text-link" type="button" disabled={busy} onClick={onRevoke}>{challenge.shared ? 'Revoke public link' : 'Remove private deal'}</button></details>}
  </article>;
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) { return <div className="progress-stat"><strong>{value}</strong><span>{label}</span></div>; }

function CompetitionRules({ policy }: { policy: Snapshot['policy'] }) {
  return <details className="panel progress-section competition-rules"><summary>How scores, first attempts and weeks work</summary><p>{policy.scoring}</p><p>{policy.points}</p><p>{policy.attempts}</p><p>{policy.weekly}</p><p>{policy.deadlines}</p><p>{policy.trophies}</p><p>{policy.originalRules}</p><p>{policy.privacy}</p><a href="/progress-help">Read the full records and competition guide</a></details>;
}

export default function CompetitionPanel(props: Props) {
  const account = useAccountSession();
  if (account.status !== 'ready' || account.operation) return <AccountLoading account={account}/>;
  if (!account.user) return <ProgressShell title="A little friendly rivalry" intro="Play the same deal, join a private club and see how your first attempt compares." current="competition"><section className="panel progress-section"><h2><Target size={23}/>Your next challenge</h2><p>Daily deals and three-deal duels use fixed cards and AI opponents. Private clubs bring your friends’ results together.</p><AccountControls account={account}/><p className="progress-note">Sign in to save your first attempt and return to the same hand on another device.</p></section></ProgressShell>;
  return <SignedCompetition key={`${account.user.id}:${account.epoch}`} {...props}/>;
}

function SignedCompetition({ initialTab = '', duelToken = '', rematchToken = '' }: Props) {
  const [data, setData] = useState<Snapshot | null>(null), [profile, setProfile] = useState<ProfileSnapshot | null>(null);
  const [tab, setTab] = useState<Tab>(duelToken ? 'duels' : rematchToken ? 'rematches' : tabs.some(item => item.key === initialTab) ? initialTab as Tab : 'daily');
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState('');
  const [shared, setShared] = useState<ChallengeDescriptor | null>(null), [clubId, setClubId] = useState('');
  const [clubData, setClubData] = useState<Club | null>(null), [clubLoading, setClubLoading] = useState(false), [clubError, setClubError] = useState('');
  const [linkedDuel, setLinkedDuel] = useState<Duel | null>(null), [linkedRematch, setLinkedRematch] = useState<Rematch | null>(null);
  const active = useRef(true), running = useRef(false), sequence = useRef(0);

  useEffect(() => {
    active.current = true; const controller = new AbortController();
    void load(controller.signal).catch(reason => { if (active.current && !isAbort(reason)) setError(errorMessage(reason)); });
    return () => { active.current = false; controller.abort(); };
    // Account identity is the parent component's key. A remount clears all private data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duelToken, rematchToken]);

  async function load(signal?: AbortSignal) {
    const request = ++sequence.current;
    const [snapshot, records, duel, rematch] = await Promise.allSettled([
      progressRequest<Snapshot>('/api/competition', undefined, signal),
      progressRequest<ProfileSnapshot>('/api/records', undefined, signal),
      duelToken ? progressRequest<Duel>(`/api/competition?duel=${encodeURIComponent(duelToken)}`, undefined, signal) : Promise.resolve(null),
      rematchToken ? progressRequest<Rematch>(`/api/competition?rematch=${encodeURIComponent(rematchToken)}`, undefined, signal) : Promise.resolve(null),
    ]);
    if (!active.current || request !== sequence.current || signal?.aborted) return;
    if (snapshot.status === 'rejected') throw snapshot.reason;
    setData(snapshot.value);
    if (records.status === 'fulfilled') setProfile(records.value);
    else if (!isAbort(records.reason)) setNotice('Challenges are ready. Friends and rule titles could not refresh; use Refresh to reconnect them.');
    if (duel.status === 'fulfilled') setLinkedDuel(duel.value); else if (!isAbort(duel.reason)) setError(errorMessage(duel.reason));
    if (rematch.status === 'fulfilled') setLinkedRematch(rematch.value); else if (!isAbort(rematch.reason)) setError(errorMessage(rematch.reason));
  }

  async function mutate(action: string, values: Record<string, unknown> = {}, message = 'Saved.') {
    if (running.current) return;
    running.current = true; setBusy(action); setError(''); setNotice('');
    try {
      const result = await progressRequest<ActionResult>('/api/competition', { action, ...values });
      if (!active.current) return;
      if ((action === 'startAttempt' || action === 'resumeAttempt') && result.roomCode && result.room) { openCompetitionRoom(result.roomCode); return; }
      if (action === 'acceptRematch' && result.roomCode) { openCompetitionRoom(result.roomCode); return; }
      if (result.challenge && action === 'shareChallenge') { setShared(result.challenge); setTab('deals'); }
      if (result.club) { setClubId(result.club.id); setTab('clubs'); }
      if (result.duel) setTab('duels');
      if (result.rematch) setTab('rematches');
      if (action === 'revokeChallenge' && values.challengeId === shared?.id) setShared(null);
      await load();
      if (active.current) setNotice((action === 'startAttempt' || action === 'resumeAttempt') && result.attempt ? 'Your first attempt has finished. Its result is saved; you can now open a practice replay.' : message);
    } catch (reason) { if (active.current && !isAbort(reason)) setError(errorMessage(reason)); }
    finally { running.current = false; if (active.current) setBusy(''); }
  }
  async function refresh() {
    if (running.current) return;
    running.current = true; setBusy('refresh'); setError('');
    try { await load(); } catch (reason) { if (active.current && !isAbort(reason)) setError(errorMessage(reason)); }
    finally { running.current = false; if (active.current) setBusy(''); }
  }
  async function copy(path: string, raw = false) {
    try { if (raw) await navigator.clipboard.writeText(path); else await copyProgressLink(path); if (active.current) setNotice(raw ? 'Invitation code copied.' : 'Link copied. Send it when you are ready.'); }
    catch { if (active.current) setError('Copy is unavailable in this browser. Select the visible link or code and copy it.'); }
  }
  async function shareLink(challenge: ChallengeDescriptor) {
    const url = new URL(challenge.publicUrl, window.location.origin).href;
    if (!navigator.share) { await copy(challenge.publicUrl); return; }
    try { await navigator.share({ title: 'Beat My Deal · Parkes Rummy', text: `${challenge.hostName} invites you to try the same ${gameName(challenge.game)}, Rule ${challenge.ruleNumber} deal.`, url }); }
    catch (reason) { if (!isAbort(reason)) setError('Sharing is unavailable. Use Copy link or select the visible link.'); }
  }
  const first = (challengeId: string) => data?.attempts.find(attempt => attempt.challengeId === challengeId && attempt.scored);
  const practice = (challengeId: string) => data?.attempts.find(attempt => attempt.challengeId === challengeId && attempt.practice && attempt.status === 'active');
  const challengeCard = (challenge: ChallengeDescriptor) => <ChallengeCard key={challenge.id} challenge={challenge} attempt={first(challenge.challengeId)} practiceAttempt={practice(challenge.challengeId)} busy={!!busy}
    onStart={practice => { void mutate('startAttempt', { token: challenge.token, practice }); }} onRevoke={challenge.owner ? () => { void mutate('revokeChallenge', { challengeId: challenge.id }, 'Invitation revoked. Earned results remain saved.'); } : undefined}/>;
  const memberships = data?.clubs.filter(club => club.status === 'member') ?? [];
  const selectedClubId = memberships.find(club => club.id === clubId)?.id ?? memberships[0]?.id ?? '';
  const selectedClub = clubData?.id === selectedClubId ? clubData : null;
  useEffect(() => {
    setClubData(null); setClubError('');
    if (tab !== 'clubs' || !selectedClubId) { setClubLoading(false); return; }
    const controller = new AbortController(); setClubLoading(true);
    progressRequest<Club>(`/api/competition?clubId=${encodeURIComponent(selectedClubId)}`, undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted) setClubData(value); })
      .catch(reason => { if (!controller.signal.aborted && !isAbort(reason)) setClubError(errorMessage(reason)); })
      .finally(() => { if (!controller.signal.aborted) setClubLoading(false); });
    return () => controller.abort();
  }, [selectedClubId, tab, data]);
  const duels = linkedDuel ? [linkedDuel, ...(data?.duels.filter(duel => duel.id !== linkedDuel.id) ?? [])] : data?.duels ?? [];
  const rematches = linkedRematch ? [linkedRematch, ...(data?.rematches.filter(rematch => rematch.id !== linkedRematch.id) ?? [])] : data?.rematches ?? [];
  return <ProgressShell title="Challenges & clubs" intro="A shared deal, a friendly target and your first attempt saved across devices." current="competition">
    <div className="progress-toolbar"><nav className="progress-tabs" aria-label="Competition sections">{tabs.map(item => <button type="button" key={item.key} aria-pressed={tab === item.key} onClick={() => setTab(item.key)}>{item.label}</button>)}</nav><button type="button" className="icon-button" aria-label="Refresh challenges and clubs" disabled={!!busy} onClick={() => { void refresh(); }}><RefreshCw size={20}/></button></div>
    {error && <p role="alert" className="progress-error">{error}</p>}{notice && <p role="status" className="progress-notice">{notice}</p>}
    {!data ? <section className="panel progress-section" aria-busy={!error}>{error ? 'Press Refresh to try again.' : 'Opening your challenges…'}</section> : <>
      {tab === 'daily' && <>
        <section className="competition-calendar"><CalendarDays size={20}/><span>{data.calendar.day} · Sydney time · Week beginning {data.calendar.week}</span></section>
        <div className="progress-challenge-grid">{challengeCard(data.daily)}<section className="panel progress-section"><p className="progress-eyebrow">A week of chances</p><h2><Trophy size={23}/>Your Weekly Best Five</h2><p>Your best five daily first attempts count. A missed day contributes zero. Equal totals share a place.</p><div className="progress-stat-grid competition-two-stats"><Stat label="Counted points" value={points(data.weekly.points)}/><Stat label="Counted days" value={`${data.weekly.countedDays.length}/5`}/><Stat label="Settled daily attempts" value={data.weekly.attempts}/><Stat label="Openings completed" value={data.weekly.completions}/></div><div className="competition-week" aria-label="Days included in your current total">{data.calendar.weekDays.map(day => <div key={day} className={data.weekly.countedDays.includes(day) ? 'counted' : ''}><span>{new Intl.DateTimeFormat('en-AU', { weekday: 'short', timeZone: 'Australia/Sydney' }).format(new Date(`${day}T12:00:00Z`))}</span><strong>{data.weekly.countedDays.includes(day) ? 'Counted' : day > data.calendar.day ? 'Upcoming' : 'Not counted'}</strong></div>)}</div><p className="progress-note">Current week is provisional. Completed results, withdrawals and service interruptions remain visible in My deals.</p><button type="button" className="button outline" onClick={() => setTab('clubs')}><Users size={17}/>Open your club standings</button></section></div>
        {challengeCard(data.ruleWeek)}
      </>}
      {tab === 'deals' && <>
        <CreateDeal originalRules={data.originalRules} catalog={profile?.summary.rules ?? []} busy={!!busy} onCreate={values => { void mutate('createChallenge', values, 'Your private deal is ready. Complete your first attempt to make a Beat My Deal invitation.'); }}/>
        {shared && <section className="panel progress-section competition-share" aria-label="Your new Beat My Deal link"><h2><Share2 size={23}/>Beat My Deal</h2><p>This public invitation shows your chosen name, the rule and your completed target. Everyone plays the same initial deal.</p><ChallengeScoreSummary score={shared.target!} value={shared.targetPoints} label="Your shared target"/><label htmlFor="new-challenge-link">Revocable public link</label><input id="new-challenge-link" readOnly value={shared.publicUrl} onFocus={event => event.currentTarget.select()}/><div className="progress-actions"><button className="button gold" onClick={() => { void shareLink(shared); }}><Share2 size={17}/>Share invitation</button><button className="button outline" onClick={() => { void copy(shared.publicUrl); }}><Copy size={17}/>Copy link</button><a className="button outline" href={shared.publicUrl}>View landing page</a><button className="text-link" disabled={!!busy} onClick={() => { void mutate('revokeChallenge', { challengeId: shared.id }, 'Public invitation revoked.'); }}>Revoke this link</button></div></section>}
        <section className="panel progress-section"><h2>Your attempts</h2><p>First scored attempts and practice replays are labelled separately. A saved active attempt always resumes its existing hand.</p>{!data.attempts.length && <p className="progress-empty">Try today’s deal or create a private fixed deal to begin.</p>}{data.attempts.map(attempt => <AttemptCard key={attempt.id} attempt={attempt} busy={!!busy} mutate={mutate}/>)}</section>
        {data.challenges.length > 0 && <><h2 className="competition-section-title">Your fixed deals and public invitations</h2><div className="progress-challenge-grid">{data.challenges.map(challengeCard)}</div></>}
      </>}
      {tab === 'clubs' && <>
        <ClubForms busy={!!busy} mutate={mutate}/>
        {data.clubs.length === 0 && <section className="panel progress-section"><h2><Users size={23}/>Your own corner of Parkes Rummy</h2><p>Create a private club or request to join with its invitation code. The club owner approves each new member.</p></section>}
        <div className="competition-club-tabs" aria-label="Your clubs">{data.clubs.map(club => club.status === 'member' ? <button type="button" key={club.id} className="button outline" aria-pressed={selectedClubId === club.id} onClick={() => setClubId(club.id)}>{club.name}{club.role === 'owner' ? ' · owner' : ''}</button> : <div className="panel competition-pending" key={club.id}><strong>{club.name}</strong><span>Waiting for owner approval</span><button className="text-link" disabled={!!busy} onClick={() => { void mutate('leaveClub', { clubId: club.id }, 'Club request cancelled.'); }}>Cancel request</button></div>)}</div>
        {clubError && <p className="progress-error" role="alert">{clubError} Press Refresh to retry.</p>}{clubLoading && <p className="panel progress-section" aria-busy="true">Opening the selected club’s boards…</p>}
        {selectedClub && <ClubPanel key={selectedClub.id} club={selectedClub} busy={!!busy || clubLoading} mutate={mutate} copy={copy} renderChallenge={challengeCard}/>}
      </>}
      {tab === 'duels' && <>
        <section className="panel progress-section"><h2><Swords size={23}/>Three deals. Two friends.</h2><p>{data.policy.duels}</p><p>Send an invitation to an accepted friend. You can play at different times; every deal has one scored first attempt per person.</p><FriendDuelForm friends={profile?.friends.accepted ?? []} busy={!!busy} mutate={mutate}/></section>
        {!duels.length && <p className="panel progress-section progress-empty">Your incoming and outgoing duel invitations will appear here.</p>}
        {duels.map(duel => <section className="panel progress-section" key={duel.id}><div className="progress-row"><h2>Duel with {duel.friend.displayName}</h2><span className="competition-pill">{duel.status}</span></div>{duel.status === 'pending' ? <><p>{duel.incoming ? `${duel.friend.displayName} has invited you to three matching deals.` : 'Your friend must accept before either player can see the three deals.'}</p><div className="progress-actions">{duel.incoming && <button className="button gold" disabled={!!busy} onClick={() => { void mutate('acceptDuel', { duelId: duel.id }, 'Duel accepted. Your three deals are ready.'); }}>Accept duel</button>}<button className="button outline" onClick={() => { void copy(duel.url); }}><Copy size={16}/>Copy invitation</button><button className="text-link" disabled={!!busy} onClick={() => { void mutate('revokeDuel', { duelId: duel.id }, 'Duel invitation closed.'); }}>{duel.incoming ? 'Decline duel' : 'Revoke invitation'}</button></div><input readOnly aria-label={`Duel invitation for ${duel.friend.displayName}`} value={duel.url}/></> : duel.status === 'revoked' ? <p>This invitation is no longer available. A current accepted friendship is required.</p> : <><div className="progress-stat-grid competition-two-stats"><Stat label={`You · ${duel.you.completedDeals}/3 settled deals`} value={points(duel.you.points)}/><Stat label={`${duel.friend.displayName} · ${duel.other?.completedDeals ?? 0}/3 settled deals`} value={points(duel.other?.points)}/></div>{duel.complete ? <p className="competition-outcome"><Trophy size={21}/>{duel.outcome === 'tie' ? 'A shared result. The duel is a draw.' : duel.outcome === 'you' ? 'You won this three-deal duel.' : `${duel.friend.displayName} won this three-deal duel.`}</p> : <p className="progress-note">Scores stay provisional until all three first attempts settle for both players.</p>}<div className="progress-challenge-grid competition-nested">{duel.challenges.map(challengeCard)}</div><p className="progress-note">Accepted duels retain their first-attempt results. Resume each deal, or withdraw from an active attempt in My deals.</p></>}</section>)}
      </>}
      {tab === 'rematches' && <>
        <section className="panel progress-section"><h2><RotateCcw size={23}/>Another game with a friend</h2><p>Choose an accepted friend and a completed hand you both played. This creates an invitation. Your friend explicitly accepts before a new table is created.</p><RematchForm friends={profile?.friends.accepted ?? []} busy={!!busy} mutate={mutate}/></section>
        {!rematches.length && <p className="panel progress-section progress-empty">Your rematch invitations will appear here.</p>}
        {rematches.map(rematch => <section className="panel progress-section" key={rematch.id}><div className="progress-row"><h2>{gameName(rematch.game)} with {rematch.friend.displayName}</h2><span className="competition-pill">{rematch.status}</span></div>{rematch.status === 'accepted' && rematch.roomCode ? <><p>Your friend has accepted. The new table is ready.</p><button className="button gold" disabled={!!busy} onClick={() => { try { openCompetitionRoom(rematch.roomCode!); } catch (reason) { setError(errorMessage(reason)); } }}><ArrowRight size={17}/>Open rematch table</button></> : rematch.status === 'pending' ? <><p>{rematch.incoming ? 'You have been invited to another game. Accepting creates a new table for both players.' : 'Your invitation is waiting for your friend’s acceptance.'}</p><div className="progress-actions">{rematch.incoming && <button className="button gold" disabled={!!busy} onClick={() => { void mutate('acceptRematch', { rematchId: rematch.id }); }}>Accept rematch</button>}<button className="button outline" onClick={() => { void copy(rematch.url); }}><Copy size={16}/>Copy invitation</button><button className="text-link" disabled={!!busy} onClick={() => { void mutate('revokeRematch', { rematchId: rematch.id }, 'Rematch invitation closed.'); }}>{rematch.incoming ? 'Decline' : 'Revoke invitation'}</button></div><input readOnly aria-label={`Rematch invitation for ${rematch.friend.displayName}`} value={rematch.url}/></> : <p>This rematch invitation is no longer available.</p>}</section>)}
      </>}
      <CompetitionRules policy={data.policy}/>
    </>}
  </ProgressShell>;
}

function CreateDeal({ originalRules, catalog, busy, onCreate }: { originalRules: boolean; catalog: ProfileSnapshot['summary']['rules']; busy: boolean; onCreate: (values: Record<string, unknown>) => void }) {
  const [game, setGame] = useState<GameType>(1), [rule, setRule] = useState(1), [difficulties, setDifficulties] = useState<Difficulty[]>(['easy', 'medium']);
  const [hints, setHints] = useState(false), [humanSeat, setHumanSeat] = useState(0), [startingSeat, setStartingSeat] = useState(0);
  const options = catalog.filter(record => record.game === game);
  return <details className="panel progress-section competition-create"><summary><Plus size={19}/>Create a fixed deal</summary><p>Pick a rule and AI opponents. Play your first attempt, then create a Beat My Deal link from the saved result.</p>
    <form className="progress-form" onSubmit={event => { event.preventDefault(); onCreate({ game, ruleNumber: rule, difficulties, humanSeat, startingSeat, showMoveHints: hints }); }}>
      <div className="competition-form-grid"><div><label htmlFor="challenge-game">Ruleset</label><select id="challenge-game" value={game} onChange={event => { setGame(Number(event.target.value) as GameType); setRule(1); }}>{([1, 2, 3, ...(originalRules ? [4] : [])]).map(value => <option key={value} value={value}>{gameName(value)}</option>)}</select></div>
      <div><label htmlFor="challenge-rule">Opening rule</label><select id="challenge-rule" value={rule} onChange={event => setRule(Number(event.target.value))}>{options.length ? options.map(record => <option key={record.ruleId} value={record.ruleNumber}>{record.ruleNumber}. {record.title}</option>) : Array.from({ length: 10 }, (_, index) => <option key={index} value={index + 1}>Rule {index + 1}</option>)}</select></div></div>
      <label htmlFor="challenge-ai-count">Number of AI opponents</label><select id="challenge-ai-count" value={difficulties.length} onChange={event => { const count = Number(event.target.value); setDifficulties(current => Array.from({ length: count }, (_, index) => current[index] ?? 'medium')); setHumanSeat(current => Math.min(current, count)); setStartingSeat(current => Math.min(current, count)); }}>{Array.from({ length: 3 }, (_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}</select>
      <div className="competition-form-grid">{difficulties.map((difficulty, index) => <div key={index}><label htmlFor={`challenge-ai-${index}`}>AI {index + 1} strength</label><select id={`challenge-ai-${index}`} value={difficulty} onChange={event => setDifficulties(current => current.map((value, seat) => seat === index ? event.target.value as Difficulty : value))}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard" disabled={difficulty !== 'hard' && difficulties.includes('hard')}>Hard</option></select></div>)}</div><p className="progress-note">One to three AI opponents, with at most one Hard AI, keep these challenges comparable.</p>
      <details><summary>Seat and hint options</summary><div className="competition-form-grid"><div><label htmlFor="challenge-human-seat">Your seat</label><select id="challenge-human-seat" value={humanSeat} onChange={event => setHumanSeat(Number(event.target.value))}>{Array.from({ length: difficulties.length + 1 }, (_, index) => <option key={index} value={index}>Seat {index + 1}</option>)}</select></div><div><label htmlFor="challenge-start-seat">Starting seat</label><select id="challenge-start-seat" value={startingSeat} onChange={event => setStartingSeat(Number(event.target.value))}>{Array.from({ length: difficulties.length + 1 }, (_, index) => <option key={index} value={index}>Seat {index + 1}</option>)}</select></div></div><label className="competition-checkbox"><input type="checkbox" checked={hints} onChange={event => setHints(event.target.checked)}/>Show move hints for everyone attempting this deal</label></details>
      <button className="button gold" type="submit" disabled={busy}><Plus size={17}/>Create private deal</button>
      {!originalRules && <p className="progress-note">Games 1–3 are available to everyone. Creating Original Rules challenges requires your own Original Rules access.</p>}
    </form>
  </details>;
}

function AttemptCard({ attempt, busy, mutate }: { attempt: AttemptPreview; busy: boolean; mutate: Mutate }) {
  const [withdraw, setWithdraw] = useState(false);
  return <article className="competition-attempt"><div className="progress-row"><div><h3>{attempt.title}</h3><p className="progress-note">{date(attempt.createdAt)} · {attempt.practice ? 'Practice replay' : 'First scored attempt'}</p></div><span className={`competition-pill${attempt.practice ? ' practice' : ''}`}>{attempt.status === 'active' ? 'In progress' : attempt.status === 'service-interrupted' ? 'Interrupted' : attempt.status === 'abandoned' ? 'Withdrawn' : 'Finished'}</span></div>
    {attempt.score && <ChallengeScoreSummary score={attempt.score} value={attempt.practice ? undefined : attempt.points}/>}
    {attempt.status === 'active' ? <><p className="progress-note">Reconnect before {deadline(attempt.deadlineAt)} Sydney time.</p><div className="progress-actions"><button className="button gold" disabled={busy} onClick={() => { void mutate('resumeAttempt', { attemptId: attempt.id }); }}>Continue {attempt.practice ? 'practice' : 'first attempt'}</button><button className="text-link" disabled={busy} onClick={() => setWithdraw(true)}>Withdraw from this attempt</button></div>{withdraw && <div className="competition-confirm"><p>{attempt.practice ? 'This ends your practice hand.' : 'This ends your first attempt with a withdrawal score of −1. Replays cannot replace it.'}</p><div className="progress-actions"><button className="button outline" disabled={busy} onClick={() => { void mutate('withdrawAttempt', { attemptId: attempt.id }, 'Attempt withdrawn.'); setWithdraw(false); }}>Withdraw now</button><button className="text-link" onClick={() => setWithdraw(false)}>Keep playing</button></div></div>}</> : <div className="progress-actions">{attempt.scored && <button className="button outline" disabled={busy} onClick={() => { void mutate('startAttempt', { token: attempt.token, practice: true }); }}><RotateCcw size={16}/>Practice replay</button>}{attempt.status === 'completed' && attempt.scored && <><button className="button gold" disabled={busy} onClick={() => { void mutate('shareChallenge', { attemptId: attempt.id }, 'Your public Beat My Deal invitation is ready. Share or copy it above.'); }}><Share2 size={16}/>Create Beat My Deal link</button><a className="text-link" href={`/profile?tab=history&handId=${encodeURIComponent(attempt.handId)}`}>Review hand</a></>}</div>}
    {attempt.practice && <p className="progress-note">Practice does not change records, club points or your first scored attempt.</p>}
  </article>;
}

function ClubForms({ busy, mutate }: { busy: boolean; mutate: Mutate }) {
  const [name, setName] = useState(''), [code, setCode] = useState('');
  return <div className="progress-club-grid"><section className="panel progress-section"><h2><Plus size={22}/>Create a private club</h2><form onSubmit={event => { event.preventDefault(); void mutate('createClub', { name: name.trim() }, 'Club created. Share its invitation code with your friends.'); }}><label htmlFor="club-name">Club name</label><input id="club-name" required minLength={2} maxLength={32} value={name} onChange={event => setName(event.target.value)} placeholder="Friday Night Cards"/><p className="progress-note">As owner, you approve members and manage the invitation code.</p><button className="button gold" disabled={busy || name.trim().length < 2}>Create club</button></form></section>
    <section className="panel progress-section"><h2><LockKeyhole size={22}/>Join with a club code</h2><form onSubmit={event => { event.preventDefault(); void mutate('requestClub', { code: code.trim() }, 'Request sent to the club owner. Membership begins after approval.'); }}><label htmlFor="club-code">Invitation code</label><input id="club-code" autoCapitalize="characters" autoComplete="off" spellCheck={false} required pattern="[A-Fa-f0-9]{16}" maxLength={16} value={code} onChange={event => setCode(event.target.value.trim())}/><p className="progress-note">Joining shares your chosen name, comparable standings and opening contributions with that club. The owner approves your request.</p><button className="button gold" disabled={busy || code.trim().length !== 16}>Request to join</button></form></section></div>;
}

function ClubPanel({ club, busy, mutate, copy, renderChallenge }: { club: Club; busy: boolean; mutate: Mutate; copy: (path: string, raw?: boolean) => Promise<void>; renderChallenge: (challenge: ChallengeDescriptor) => React.ReactNode }) {
  return <>
    <section className="panel progress-section"><div className="progress-row"><div><p className="progress-eyebrow">Private friends’ club</p><h2><Users size={23}/>{club.name}</h2></div><span className="competition-pill">{club.role === 'owner' ? 'You are the owner' : 'Member'}</span></div><p className="progress-note">Chosen player names and approved members only. Every standings group uses matching conditions.</p><label htmlFor={`club-code-${club.id}`}>Invitation code · requests require owner approval</label><div className="progress-input-row"><input id={`club-code-${club.id}`} readOnly value={club.code} onFocus={event => event.currentTarget.select()}/><button className="button outline" onClick={() => { void copy(club.code, true); }}><Copy size={17}/>Copy</button></div>
      <h3>Weekly Best Five standings</h3><p className="progress-note">Current week is provisional. Equal totals share a place. The best five daily first attempts count.</p>{club.weekly.length ? <div className="progress-comparison-table"><table><thead><tr><th scope="col">Place</th><th scope="col">Player</th><th scope="col">Points</th><th scope="col">Counted days</th><th scope="col">Attempts</th><th scope="col">Openings</th></tr></thead><tbody>{club.weekly.map(row => <tr key={row.memberId}><td>{row.rank}</td><th scope="row">{row.displayName}</th><td>{points(row.points)}</td><td>{row.countedDays.length}/5</td><td>{row.attempts}</td><td>{row.completions}</td></tr>)}</tbody></table></div> : <p className="progress-empty">This week’s first finished daily attempts will start the board.</p>}
    </section>
    <section className="panel progress-section"><h2><Target size={23}/>Ten different openings, together</h2><p>Complete ten different opening rules as a club this Sydney week. Each rule counts once for the club; every member’s contribution is shown.</p><div className="competition-goal"><strong>{club.goal.completed}/{club.goal.target}</strong><progress max={club.goal.target} value={Math.min(club.goal.completed, club.goal.target)} aria-label="Different opening rules completed by your club"/></div><p className="progress-note">Week beginning {club.goal.week}. Only qualifying hands started after joining this club count.</p><div className="competition-rule-tags">{club.goal.ruleIds.map(id => <span className="competition-pill" key={id}>{ruleName(id)}</span>)}</div><h3>Individual contributions</h3>{club.goal.contributions.map(member => <div className="progress-person" key={member.memberId}><strong>{member.displayName}</strong><span>{member.count} distinct opening{member.count === 1 ? '' : 's'}</span>{member.rules.length > 0 && <p className="progress-note competition-full-row">{member.rules.map(ruleName).join(' · ')}</p>}</div>)}</section>
    {renderChallenge(club.ruleWeek.challenge)}
    <section className="panel progress-section"><h2>Rule of the Week board</h2><p>Complete opening, earlier personal opening turn, going out, shorter closing, then lower remaining points. Equal results share a place.</p>{club.ruleWeek.standings.length ? <div className="progress-comparison-table"><table><thead><tr><th scope="col">Place</th><th scope="col">Player</th><th scope="col">Opening</th><th scope="col">Finish</th><th scope="col">Points</th></tr></thead><tbody>{club.ruleWeek.standings.map(row => <tr key={row.memberId}><td>{row.rank}</td><th scope="row">{row.displayName}</th><td>{row.score.outcome === 'abandoned' ? 'Withdrawn' : row.score.completed ? `Turn ${row.score.openingTurn}` : 'Not completed'}</td><td>{row.score.wentOut ? `${row.score.closingTurns} closing turns` : `${row.score.penalty} points left`}</td><td>{points(row.points)}</td></tr>)}</tbody></table></div> : <p className="progress-empty">The club’s first scored results will appear here.</p>}</section>
    <ClubRuleRecords rows={club.ruleRecords}/>
    <ClubConsistency rows={club.consistency}/>
    <section className="panel progress-section"><h2><Trophy size={23}/>Club trophy cabinet</h2><p>Weekly trophies settle after 02:00 Monday in Sydney. Tied winners each receive a trophy.</p>{club.trophies.length ? club.trophies.map((trophy, index) => <div className="progress-person" key={`${trophy.week}:${index}`}><div><strong>{trophy.displayName}</strong><p className="progress-note">Week beginning {trophy.week}</p></div><span>{points(trophy.points)} points · {trophy.attempts} attempts</span></div>) : <p className="progress-empty">The first closed weekly competition will begin the cabinet.</p>}</section>
    <section className="panel progress-section"><h2>Members & permissions</h2><p>{club.role === 'owner' ? 'You manage membership requests, removals and blocks. Transfer ownership to an accepted member before leaving.' : 'The owner manages membership. Leaving removes access to this private board.'}</p>{club.members.map(member => <div className="progress-person" key={member.id}><div><strong>{member.displayName}</strong><p className="progress-note">{member.role === 'owner' ? 'Club owner' : member.status === 'member' ? 'Member' : member.status === 'pending' ? 'Requested to join' : 'Blocked'}</p></div>{club.role === 'owner' && member.role !== 'owner' && <div className="progress-actions">{member.status === 'pending' && <><button className="button gold" disabled={busy} onClick={() => { void mutate('approveMember', { clubId: club.id, memberId: member.id }, 'Member approved.'); }}>Approve</button><button className="text-link" disabled={busy} onClick={() => { void mutate('rejectMember', { clubId: club.id, memberId: member.id }, 'Request declined.'); }}>Decline</button></>}{member.status === 'member' && <><button className="text-link" disabled={busy} onClick={() => { void mutate('removeMember', { clubId: club.id, memberId: member.id }, 'Member removed.'); }}>Remove</button><details><summary>Ownership</summary><p className="progress-note">{member.displayName} will become owner and manage this club. You remain a member.</p><button className="text-link" disabled={busy} onClick={() => { void mutate('transferClub', { clubId: club.id, memberId: member.id }, 'Club ownership transferred.'); }}>Make owner</button></details></>}{member.status === 'blocked' ? <button className="text-link" disabled={busy} onClick={() => { void mutate('unblockMember', { clubId: club.id, memberId: member.id }, 'Member unblocked. They may request to join again.'); }}>Unblock</button> : <button className="text-link" disabled={busy} onClick={() => { void mutate('blockMember', { clubId: club.id, memberId: member.id }, 'Player blocked from this club.'); }}>Block</button>}</div>}</div>)}<div className="competition-club-management">{club.role === 'owner' ? <><button className="button outline" disabled={busy} onClick={() => { void mutate('rotateClubCode', { clubId: club.id }, 'Invitation code replaced. Existing members stay in the club.'); }}>Replace invitation code</button><details><summary>Delete club</summary><p className="progress-note">This removes the club, its memberships, standings and trophy cabinet. Personal game records remain saved.</p><button className="text-link" disabled={busy} onClick={() => { void mutate('deleteClub', { clubId: club.id }, 'Club deleted. Personal records remain saved.'); }}>Delete this club</button></details></> : <button className="button outline" disabled={busy} onClick={() => { void mutate('leaveClub', { clubId: club.id }, 'You left the club.'); }}>Leave club</button>}</div></section>
  </>;
}

function ClubRuleRecords({ rows }: { rows: Club['ruleRecords'] }) {
  const groups = new Map<string, Club['ruleRecords']>();
  for (const row of rows) { const key = `${row.ruleId}:${row.cohortKey}`; groups.set(key, [...(groups.get(key) ?? []), row]); }
  return <section className="panel progress-section"><h2><Trophy size={23}/>Club rule records</h2><p>Fastest verified openings under matching conditions. Equally early personal opening turns share a place. Samples show how often each player has tried and completed the rule.</p>{!rows.length && <p className="progress-empty">Your club’s first completed openings will start these records.</p>}{[...groups.entries()].map(([key, group]) => <div className="record-cohort" key={key}><p className="progress-eyebrow">{ruleName(group[0].ruleId)}</p><h3>{group[0].title}</h3><p className="progress-note">{sharedConditionLines(group[0].conditions).join(' · ')}</p><div className="progress-comparison-table"><table><thead><tr><th scope="col">Place</th><th scope="col">Player</th><th scope="col">Best opening</th><th scope="col">Opening success</th><th scope="col">Pending</th></tr></thead><tbody>{group.map(row => <tr key={row.memberId}><td>{row.rank}</td><th scope="row">{row.displayName}</th><td>Turn {row.bestOpeningTurn}</td><td>{Math.round(row.completionRate * 100)}% ({row.completed}/{row.attempts})</td><td>{row.pending}</td></tr>)}</tbody></table></div></div>)}</section>;
}

function ClubConsistency({ rows }: { rows: Club['consistency'] }) {
  const groups = new Map<string, Club['consistency']>();
  for (const row of rows) { const key = `${row.ruleId}:${row.cohortKey}`; groups.set(key, [...(groups.get(key) ?? []), row]); }
  return <section className="panel progress-section"><h2>Rule consistency</h2><p>Twenty qualifying dealt attempts are needed for a full ranking. Opening success comes first, then median personal opening turn. Pending and withdrawn hands remain in the denominator; equal figures share a place.</p>{!rows.length && <p className="progress-empty">Comparable records from hands started after joining the club will appear here.</p>}{[...groups.entries()].map(([key, group]) => <div className="record-cohort" key={key}><h3>{ruleName(group[0].ruleId)}</h3><p className="progress-note">{sharedConditionLines(group[0].conditions).join(' · ')}</p><p className="progress-note">{group[0].minimumAttempts} attempts for a full ranking</p><div className="progress-comparison-table"><table><thead><tr><th scope="col">Place</th><th scope="col">Player</th><th scope="col">Opening success</th><th scope="col">Median opening</th><th scope="col">Pending</th><th scope="col">Withdrawn</th></tr></thead><tbody>{group.map(row => <tr key={row.memberId}><td>{row.provisional ? 'Provisional' : row.rank}</td><th scope="row">{row.displayName}</th><td>{Math.round(row.completionRate * 100)}% ({row.completed}/{row.attempts})</td><td>{row.medianOpeningTurn === null ? 'No openings' : `Turn ${row.medianOpeningTurn}`}</td><td>{row.pending}</td><td>{row.abandoned}</td></tr>)}</tbody></table></div></div>)}</section>;
}

function FriendDuelForm({ friends, busy, mutate }: { friends: ProfileSnapshot['friends']['accepted']; busy: boolean; mutate: Mutate }) {
  const [friend, setFriend] = useState('');
  const selected = friends.some(item => item.id === friend) ? friend : friends[0]?.id ?? '';
  if (!friends.length) return <p className="progress-empty"><a href="/profile?tab=friends">Add an accepted friend</a> to invite them to a duel.</p>;
  return <form className="progress-form" onSubmit={event => { event.preventDefault(); void mutate('createDuel', { friendId: selected }, 'Duel invitation created. Share its link with your friend.'); }}><label htmlFor="duel-friend">Choose an accepted friend</label><select id="duel-friend" value={selected} onChange={event => setFriend(event.target.value)}>{friends.map(item => <option value={item.id} key={item.id}>{item.displayName}</option>)}</select><button className="button gold" disabled={busy || !selected}><Swords size={17}/>Create duel invitation</button><p className="progress-note">No message is sent automatically.</p></form>;
}

function RematchForm({ friends, busy, mutate }: { friends: ProfileSnapshot['friends']['accepted']; busy: boolean; mutate: Mutate }) {
  const [friend, setFriend] = useState(''), [comparison, setComparison] = useState<Comparison | null>(null), [handId, setHandId] = useState('');
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const selected = friends.some(item => item.id === friend) ? friend : friends[0]?.id ?? '';
  useEffect(() => {
    setComparison(null); setHandId(''); setError('');
    if (!selected) return;
    const controller = new AbortController(); setLoading(true);
    progressRequest<Comparison>(`/api/records?friendId=${encodeURIComponent(selected)}`, undefined, controller.signal).then(value => { if (!controller.signal.aborted) setComparison(value); }).catch(reason => { if (!controller.signal.aborted && !isAbort(reason)) setError(errorMessage(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selected]);
  if (!friends.length) return <p className="progress-empty"><a href="/profile?tab=friends">Add an accepted friend</a> to create a rematch invitation.</p>;
  const hands = comparison?.rematchHands ?? [];
  const selectedHand = hands.some(hand => hand.handId === handId) ? handId : hands[0]?.handId ?? '';
  return <form className="progress-form" onSubmit={event => { event.preventDefault(); void mutate('createRematch', { friendId: selected, handId: selectedHand }, 'Rematch invitation created. Your friend can accept using its link.'); }}><label htmlFor="rematch-friend">Choose an accepted friend</label><select id="rematch-friend" value={selected} onChange={event => setFriend(event.target.value)}>{friends.map(item => <option value={item.id} key={item.id}>{item.displayName}</option>)}</select>{error && <p className="progress-error" role="alert">{error}</p>}{loading ? <p role="status">Finding your shared completed hands…</p> : hands.length ? <><label htmlFor="rematch-hand">A completed hand you played together</label><select id="rematch-hand" value={selectedHand} onChange={event => setHandId(event.target.value)}>{hands.map(hand => <option key={hand.handId} value={hand.handId}>{gameName(hand.game)} · Rule {hand.ruleNumber} · {date(hand.startedAt)}</option>)}</select><button className="button gold" disabled={busy || !selectedHand}><RotateCcw size={17}/>Create rematch invitation</button></> : <p className="progress-empty">No shared qualifying completed hands with this friend yet. Finish a new recorded game together to invite a rematch.</p>}<p className="progress-note">No message is sent automatically. Your game begins only after explicit acceptance.</p></form>;
}
