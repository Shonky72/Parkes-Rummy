'use client';

import { useEffect, useRef, useState } from 'react';
import { Flag, RefreshCw, Trophy, Users } from 'lucide-react';
import type { LadderRepository, RankedMatchPreview } from '../../db/ladder';
import type { RecordsFriends } from '../../db/records';
import { getClientIdentity } from '../../lib/client-identity';
import { rememberSeat } from '../../lib/client';
import { progressRequest } from '../../lib/progress-client';
import { AccountControls, AccountLoading, useAccountSession } from './AccountControls';
import ProgressShell from './ProgressShell';

type LadderSnapshot = Awaited<ReturnType<LadderRepository['snapshot']>>;
const dateTime = (value: number) => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', dateStyle: 'medium', timeStyle: 'short' }).format(value);

export default function LadderPanel() {
  const account = useAccountSession();
  if (account.status !== 'ready') return <AccountLoading account={account}/>;
  if (!account.user) return <ProgressShell title="Human ladder" intro="A separate ranked table for two players who choose to compete." current="ladder"><section className="panel progress-section"><AccountControls account={account}/></section></ProgressShell>;
  return <SignedLadder key={`${account.user.id}:${account.epoch}`} owner={account.user.email.trim().toLowerCase() === 'dan@ibdcollective.net'}/>;
}

function SignedLadder({ owner }: { owner: boolean }) {
  const [data, setData] = useState<LadderSnapshot | null>(null), [friends, setFriends] = useState<RecordsFriends['accepted']>([]);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState('');
  const [consent, setConsent] = useState(false), [friendId, setFriendId] = useState(''), [forfeitId, setForfeitId] = useState(''), [voidReason, setVoidReason] = useState('');
  const active = useRef(true);
  const activeMatchId = data?.player.activeMatchId ?? undefined;
  const waiting = data?.queue.waiting ?? false;
  async function refresh() { const snapshot = await progressRequest<LadderSnapshot>('/api/ladder'); if (active.current) setData(snapshot); }
  useEffect(() => {
    active.current = true; const controller = new AbortController();
    Promise.all([progressRequest<LadderSnapshot>('/api/ladder', undefined, controller.signal), progressRequest<{ friends: RecordsFriends }>('/api/records', undefined, controller.signal)]).then(([snapshot, records]) => { if (active.current) { setData(snapshot); setFriends(records.friends.accepted); } }).catch(reason => { if (active.current && reason.name !== 'AbortError') setError(reason.message); });
    return () => { active.current = false; controller.abort(); };
  }, []);
  useEffect(() => {
    if (!waiting && !activeMatchId) return;
    let inFlight = false;
    async function pulse() {
      if (document.visibilityState !== 'visible' || inFlight) return;
      inFlight = true;
      try { await progressRequest('/api/ladder', { action: 'heartbeat', ...(activeMatchId ? { matchId: activeMatchId } : {}) }); await refresh(); }
      catch (reason) { if (active.current && reason instanceof Error && reason.name !== 'AbortError') setError(reason.message); }
      finally { inFlight = false; }
    }
    void pulse(); const timer = setInterval(() => { void pulse(); }, 30_000);
    document.addEventListener('visibilitychange', pulse);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', pulse); };
  }, [waiting, activeMatchId]);
  function openRoom(code: string) { const identity = getClientIdentity(); if (!rememberSeat(code, identity.key)) { setError('Your account changed. Refresh before joining.'); return; } window.location.assign(`/join/${code}`); }
  async function action(actionName: string, payload: Record<string, unknown> = {}) {
    if (busy) return; setBusy(actionName); setError(''); setNotice('');
    try {
      const result = await progressRequest<{ roomCode?: string; match?: RankedMatchPreview }>('/api/ladder', { action: actionName, ...payload });
      if (!active.current) return;
      if (result.roomCode && (actionName === 'accept' || actionName === 'joinQueue')) { openRoom(result.roomCode); return; }
      await refresh(); if (active.current) { setNotice(actionName === 'invite' ? 'Ranked invitation ready for your friend to accept.' : actionName === 'joinQueue' ? 'Waiting for another willing ranked player.' : 'Saved.'); setForfeitId(''); }
    } catch (reason) { if (active.current && reason instanceof Error && reason.name !== 'AbortError') setError(reason.message); }
    finally { if (active.current) setBusy(''); }
  }
  return <ProgressShell title="Human ladder" intro="Two humans. One full Game 1. Both players choose ranked play." current="ladder">
    <div className="progress-toolbar"><span className="progress-note">Australia/Sydney calendar · Elo ratings</span><button className="button outline" disabled={!!busy} onClick={() => { void refresh().catch(reason => setError(reason.message)); }}><RefreshCw size={16}/>Refresh</button></div>
    {error && <p className="progress-error" role="alert">{error}</p>}{notice && <p className="progress-notice" role="status">{notice}</p>}
    {!data ? <p className="panel progress-section" aria-busy="true">Opening the ladder…</p> : <>
      <section className="progress-stat-grid"><div className="progress-stat"><strong>{data.player.rating}</strong><span>Your rating</span></div><div className="progress-stat"><strong>{data.player.ratedGames}</strong><span>Rated games</span></div><div className="progress-stat"><strong>{data.player.provisional ? 'Provisional' : 'Established'}</strong><span>First 10 rated games are provisional</span></div><div className="progress-stat"><strong>2 per pair</strong><span>Rated meetings per Sydney day</span></div></section>
      <section className="panel progress-section"><h2><Flag size={21}/>Choose ranked play</h2><p>Full Game 1, two signed-in humans, hints off, 90-second turns. Lowest total score wins; tied totals share the result. Ratings start at 1,000 using Elo with K=32.</p><p className="progress-note">An explicit forfeit counts as a loss. Absence claims require five minutes away and five minutes of continuous claimant presence. Returning after both players disconnect grants no immediate win.</p><label className="ranked-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)}/> I agree to the ranked rules and the rating, reconnect and forfeit policy.</label><div className="progress-actions">{data.queue.waiting ? <button className="button outline" disabled={!!busy} onClick={() => { void action('leaveQueue'); }}>Leave ranked queue</button> : <button className="button gold" disabled={!consent || !!busy || !!activeMatchId} onClick={() => { void action('joinQueue', { consent: true }); }}><Users size={17}/>Find a ranked opponent</button>}</div>{data.queue.waiting && <p role="status">Waiting for an opponent. Keep this page visible to remain in the queue.</p>}
        <form className="progress-form" onSubmit={event => { event.preventDefault(); void action('invite', { friendId, consent }); }}><label htmlFor="ranked-friend">Or invite an accepted friend</label><select id="ranked-friend" required value={friendId} onChange={event => setFriendId(event.target.value)}><option value="">Select a friend</option>{friends.map(friend => <option key={friend.id} value={friend.id}>{friend.displayName}</option>)}</select><button className="button outline" disabled={!consent || !friendId || !!busy || !!activeMatchId}>Create ranked invitation</button></form>{friends.length === 0 && <p><a href="/profile?tab=friends">Add a friend through My Profile</a> before creating an invitation.</p>}
      </section>
      <section className="panel progress-section"><h2>Your ranked matches</h2>{data.matches.length === 0 && <p>No ranked matches yet. Ordinary social games never affect this ladder.</p>}{data.matches.map(match => <article className="record-cohort" key={match.id}><div className="progress-row"><div><h3>You vs {match.opponent.displayName}</h3><p>{match.state} · {dateTime(match.createdAt)}</p></div>{match.result && <div className="progress-score">{match.result.result === 'void' ? 'Voided' : match.result.result === 'tie' ? 'Tied' : match.result.result === 'win' ? 'Won' : 'Lost'} {match.result.rated ? `${match.result.ratingDelta >= 0 ? '+' : ''}${match.result.ratingDelta}` : ''}</div>}</div>
        {match.result && <p>{match.result.yourTotal !== null ? `Your score ${match.result.yourTotal}; opponent ${match.result.opponentTotal}. ` : ''}{match.result.rated ? 'Rating recorded.' : match.result.reason || 'No rating change.'}</p>}
        <div className="progress-actions">{match.state === 'invited' && !match.youAccepted && <button className="button gold" disabled={!consent || !!busy} onClick={() => { void action('accept', { matchId: match.id, consent }); }}>Accept ranked match</button>}{match.state === 'invited' && <button className="text-link" disabled={!!busy} onClick={() => { void action(match.youAccepted ? 'cancel' : 'decline', { matchId: match.id }); }}>{match.youAccepted ? 'Cancel invitation' : 'Decline'}</button>}{match.roomCode && <button className="button outline" onClick={() => openRoom(match.roomCode!)}>{match.state === 'active' ? 'Open ranked table' : 'View table'}</button>}{match.state === 'active' && <button className="text-link" disabled={!!busy} onClick={() => setForfeitId(match.id)}>Forfeit this match</button>}{match.state === 'active' && match.claimAvailableAt !== null && <button className="button outline" disabled={!!busy || Date.now() < match.claimAvailableAt} onClick={() => { void action('claimForfeit', { matchId: match.id }); }}>Claim opponent absence</button>}</div>
        {match.state === 'active' && <p className="progress-note">Opponent {match.opponentPresent ? 'present' : 'away'}.{match.claimAvailableAt ? ` Absence claim available from ${dateTime(match.claimAvailableAt)} if the conditions remain satisfied.` : ' Keep this page or the ranked table visible to register your presence.'}</p>}
        {forfeitId === match.id && <div className="progress-error"><p><strong>Forfeit against {match.opponent.displayName}?</strong> This ends your ranked match as a loss under the published rating rules.</p><div className="progress-actions"><button className="button outline" onClick={() => setForfeitId('')}>Keep playing</button><button className="button gold" disabled={!!busy} onClick={() => { void action('forfeit', { matchId: match.id }); }}>Confirm forfeit</button></div></div>}
        {owner && match.state === 'active' && <details><summary>Owner: confirmed service interruption</summary><p>Only the server-verified Google owner receives this permission. Record the confirmed service fault before voiding.</p><input aria-label="Confirmed service fault reason" value={voidReason} maxLength={250} onChange={event => setVoidReason(event.target.value)}/><button className="button outline" disabled={!!busy || voidReason.trim().length < 10} onClick={() => { void action('voidMatch', { matchId: match.id, reason: voidReason }); }}>Void confirmed service fault</button></details>}
      </article>)}</section>
      <section className="panel progress-section"><h2><Trophy size={22}/>Ranked standings</h2><p className="progress-note">Ratings compare the controlled human format. Equal ratings share position; provisional players stay labelled.</p>{data.standings.length ? <div className="progress-comparison-table"><table><thead><tr><th>Place</th><th>Player</th><th>Rating</th><th>Rated games</th><th>Status</th></tr></thead><tbody>{data.standings.map(player => <tr key={player.id}><td>{player.rank}</td><th>{player.displayName}</th><td>{player.rating}</td><td>{player.ratedGames}</td><td>{player.provisional ? 'Provisional' : 'Established'}</td></tr>)}</tbody></table></div> : <p>The board starts with the first completed ranked game.</p>}</section>
    </>}
  </ProgressShell>;
}
