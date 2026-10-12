'use client';

import { useId } from 'react';
import { ArrowRight, Check, ChevronDown, Clock3, Layers3, LoaderCircle, RefreshCw, Trash2, Trophy, Users, WifiOff } from 'lucide-react';
import { formatLastMove, splitSavedGames, type SavedGameEntry } from '../../lib/saved-games';
import type { RoomSummary } from '../../lib/types';

export interface YourGamesProps {
  entries: SavedGameEntry[];
  loading: boolean;
  refreshing: boolean;
  error?: string;
  activeCode?: string;
  busyCode?: string;
  busyAction?: 'open' | 'rematch';
  onOpen: (code: string) => void;
  onRematch: (code: string) => void;
  onRemove: (code: string) => void;
  onRefresh: () => void;
  now?: number;
  accountBacked?: boolean;
}

function turnLabel(summary: RoomSummary): string {
  if (summary.status === 'lobby') return 'In lobby';
  if (summary.status === 'round-end') return 'Hand complete';
  if (summary.status === 'finished') return 'Game finished';
  if (summary.isYourTurn) return 'Your turn';
  return summary.turnPlayerName ? `${summary.turnPlayerName}’s turn` : 'Waiting for the next turn';
}

function openLabel(summary?: RoomSummary): string {
  if (summary?.status === 'lobby') return 'Open lobby';
  if (summary?.status === 'round-end') return 'View scores';
  if (summary?.status === 'finished') return 'View results';
  return 'Open table';
}

function LastMove({ at, now }: { at: number | null; now?: number }) {
  if (at === null || !Number.isFinite(at)) return <span>No moves yet</span>;
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return <span>No moves yet</span>;
  const exact = date.toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' });
  return <span>Last move <time dateTime={date.toISOString()} title={exact} aria-label={`Last move ${exact}`}>{formatLastMove(at, now)}</time></span>;
}

type GameCardProps = Pick<YourGamesProps, 'activeCode' | 'busyCode' | 'busyAction' | 'onOpen' | 'onRematch' | 'onRemove' | 'onRefresh' | 'now' | 'accountBacked'> & {
  entry: SavedGameEntry;
  updating: boolean;
};

function SavedGameCard({ entry, activeCode, busyCode, busyAction, onOpen, onRematch, onRemove, onRefresh, now, updating, accountBacked }: GameCardProps) {
  const summary = entry.summary;
  const unavailable = entry.unavailable === true;
  const stale = entry.stale === true || Boolean(entry.error);
  const finished = summary?.status === 'finished';
  const yourTurn = Boolean(summary?.status === 'playing' && summary.isYourTurn && !stale && !unavailable);
  const current = entry.code === activeCode;
  const currentActive = current && !finished;
  const actionPending = Boolean(busyCode);
  const opening = entry.code === busyCode && busyAction !== 'rematch';
  const rematching = entry.code === busyCode && busyAction === 'rematch';
  const hostRematch = finished && summary.isHost === true && !stale && !unavailable;
  const title = summary ? `${summary.hostName}’s table` : 'Saved table';
  const buttonLabel = currentActive ? 'Current table' : opening ? 'Opening…' : openLabel(summary);
  const status = unavailable ? 'Unavailable' : summary ? turnLabel(summary) : updating ? 'Updating…' : 'Update needed';
  const roundEnded = summary?.status === 'round-end' || finished;

  return <article className={`saved-game${yourTurn ? ' saved-game-your-turn' : ''}${current ? ' saved-game-current' : ''}${unavailable ? ' saved-game-unavailable' : ''}`} aria-label={`${title}, room ${entry.code}`}>
    <div className="saved-game-topline">
      <span className="saved-game-game">{summary ? `Game ${summary.game}` : 'Room'}</span>
      <span className="saved-game-code" aria-label={`Room code ${entry.code}`} data-code-length={entry.code.length}>{entry.code}</span>
      {summary ? <span className="saved-game-player-count" aria-label={`${summary.playerCount} players`}><Users size={15} aria-hidden="true"/>{summary.playerCount}<span className="saved-game-player-word"> players</span></span> : <span/>}
    </div>

    <div className="saved-game-identity"><h3 title={title}>{title}</h3>{summary && <p title={summary.playerNames.join(', ')}>{summary.playerNames.join(' · ')}</p>}</div>

    <div className="saved-game-status-line">
      <span className={`saved-game-turn${yourTurn ? ' is-your-turn' : ''}`}>
        {unavailable ? <WifiOff size={15} aria-hidden="true"/> : roundEnded ? <Trophy size={15} aria-hidden="true"/> : summary?.status === 'lobby' ? <Users size={15} aria-hidden="true"/> : <span className="saved-game-turn-dot" aria-hidden="true"/>}
        <span>{summary && stale && !unavailable ? 'Last seen: ' : ''}{status}</span>
      </span>
      {summary && summary.status !== 'lobby' && <span className="saved-game-rule">Your rule <strong>{summary.yourRuleNumber}</strong><span> / 10</span></span>}
    </div>

    {summary && <div className="saved-game-last-move"><Clock3 size={14} aria-hidden="true"/><LastMove at={summary.lastMoveAt} now={now}/>{summary.status !== 'lobby' && <span className="saved-game-hand">Hand {summary.round}</span>}</div>}

    {(entry.error || entry.stale) && <div className="saved-game-notice"><WifiOff size={15} aria-hidden="true"/><p>{entry.error || 'Showing the last saved update.'}</p></div>}

    {finished && !hostRematch && !rematching && <p className="saved-game-host-note">{stale || unavailable ? 'Refresh to check rematch availability.' : 'Only the host starts a rematch.'}</p>}

    <div className="saved-game-actions">
      {(stale || unavailable) && <button type="button" className="button outline saved-game-retry" onClick={onRefresh} disabled={updating || actionPending} aria-label={`Refresh room ${entry.code}`}><RefreshCw size={15} aria-hidden="true"/>Retry</button>}
      {(hostRematch || rematching) && <button type="button" className="button gold saved-game-rematch" onClick={() => onRematch(entry.code)} disabled={actionPending} aria-label={`${rematching ? 'Opening rematch lobby' : 'Rematch'}, ${title}, room ${entry.code}`}>
        {rematching ? <LoaderCircle size={16} className="spin" aria-hidden="true"/> : <RefreshCw size={16} aria-hidden="true"/>}<span>{rematching ? 'Opening lobby…' : 'Rematch'}</span>
      </button>}
      {(!unavailable || finished) && <button type="button" className={`button ${yourTurn ? 'gold' : 'outline'} saved-game-open`} onClick={() => onOpen(entry.code)} disabled={currentActive || actionPending || unavailable} aria-label={`${buttonLabel}, ${title}, room ${entry.code}`} title={unavailable ? 'Refresh to reconnect this saved seat.' : undefined}>
        {opening ? <LoaderCircle size={16} className="spin" aria-hidden="true"/> : currentActive ? <Check size={16} aria-hidden="true"/> : null}
        <span>{buttonLabel}</span>{!currentActive && !opening && !finished && <ArrowRight size={17} aria-hidden="true"/>}
      </button>}
      <button type="button" className="button quiet saved-game-remove" onClick={() => onRemove(entry.code)} disabled={actionPending} aria-label={`Delete room ${entry.code} from ${accountBacked ? 'your account' : 'this device'}`}><Trash2 size={15} aria-hidden="true"/><span>{accountBacked ? 'Delete from my games' : 'Delete from this device'}</span></button>
    </div>
  </article>;
}

export default function YourGames({ entries, loading, refreshing, error, activeCode, busyCode, busyAction, onOpen, onRematch, onRemove, onRefresh, now, accountBacked }: YourGamesProps) {
  const headingId = useId();
  const updating = loading || refreshing;
  const actionPending = Boolean(busyCode);
  const { active, finished } = splitSavedGames(entries);
  const cardProps = { activeCode, busyCode, busyAction, onOpen, onRematch, onRemove, onRefresh, now, updating, accountBacked };

  return <section className="your-games panel" aria-labelledby={headingId} aria-busy={updating}>
    <header className="your-games-heading">
      <div><h2 id={headingId}><Layers3 size={22} aria-hidden="true"/>Your games</h2><span className="your-games-count">{active.length} active {active.length === 1 ? 'game' : 'games'}</span></div>
      <button type="button" className="button outline your-games-refresh" onClick={onRefresh} disabled={updating || actionPending} aria-label="Refresh saved games"><RefreshCw size={16} className={updating ? 'spin' : undefined} aria-hidden="true"/><span>{updating ? 'Updating…' : 'Refresh'}</span></button>
    </header>

    {error && <p className="your-games-notice" role="status"><WifiOff size={17} aria-hidden="true"/><span>{error}</span></p>}

    {active.length === 0 ? <div className="your-games-empty">
      {loading ? <><LoaderCircle size={24} className="spin" aria-hidden="true"/><p>Loading saved games…</p></> : <><Layers3 size={27} aria-hidden="true"/><div><strong>{finished.length ? 'No active games' : 'No saved games yet'}</strong><p>Create a game or join with a room code.</p></div></>}
    </div> : <div className="your-games-grid">
      {active.map(entry => <SavedGameCard key={entry.code} entry={entry} {...cardProps}/>)}
    </div>}

    {finished.length > 0 && <details className="finished-games">
      <summary><span className="finished-games-title"><Trophy size={19} aria-hidden="true"/>Finished games</span><span className="finished-games-count">{finished.length}</span><ChevronDown className="finished-games-chevron" size={18} aria-hidden="true"/></summary>
      <div className="your-games-grid finished-games-grid">{finished.map(entry => <SavedGameCard key={entry.code} entry={entry} {...cardProps}/>)}</div>
    </details>}
  </section>;
}
