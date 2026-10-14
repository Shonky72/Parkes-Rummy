'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpDown, Ban, Check, ChevronRight, CircleHelp, Copy, Layers3, LoaderCircle, LogOut, Monitor, MoreVertical, Plus, RefreshCw, Settings, Smartphone, Sparkles, Star, Trash2, Trophy, UserRound, Users, Volume2, VolumeX, WifiOff, X, Bot, Music2, Timer, Headphones, Dices } from 'lucide-react';
import type { Card, Difficulty, GameAction, GameType, GroupLayoffTarget, LayoffTarget, Meld, PublicPlayer, PublicRoom, RoomPreview, ScoreRow, TableCard } from '../../lib/types';
import { RULES, canGoDown, canLayoff, findOpeningMelds, getLayoffGroupTargets, handPoints, ruleNumberFor } from '../../lib/rummy';
import { getAudioSettings, initAudio, playSound, setAudioSettings, type SoundName } from '../../lib/audio';
import { forgetSeat, getSeats, getSort, getSortMode, lastRoom, rememberHandOrder, rememberName, rememberSeat, rememberSort, rememberSortMode, roomApi, RoomError, savedHandOrder, seatToken, storedName, type HandSort, type HandSortMode } from '../../lib/client';
import { arrangeHand, insertDrawnCard, sortCards } from '../../lib/hand-order';
import { getHandDiscardAction, getHandLayoffGroupAction } from '../../lib/hand-actions';
import { animateRoomTransition, cancelTableMotion, type WinningCardPlayback } from '../../lib/table-motion';
import { isRoomCode, normalizeRoomCode, LEGACY_ROOM_CODE_LENGTH } from '../../lib/room-code';
import { getOpeningSelectionFeedback } from '../../lib/opening-feedback';
import { InviteQR } from './InviteQR';
import HandCards from './HandCards';
import DrawCardButton, { type DrawCardPlacement } from './DrawCardButton';
import BackgroundSuits from './BackgroundSuits';
import DeveloperCredit from './DeveloperCredit';
import SortControl from './SortControl';
import TurnAlert from './TurnAlert';
import YourGames from './YourGames';
import { InviteActions } from './InviteActions';
import { useSavedGames } from './useSavedGames';
import { splitSavedGames, summaryFromRoom } from '../../lib/saved-games';
import { getTurnVibrationEnabled, ownTurnAlertKey, setTurnVibrationEnabled, subscribeTurnVibrationPreference } from '../../lib/turn-alerts';
import { AccountControls, AccountLoading, useAccountSession } from './AccountControls';
import { refreshAccount, type AccountSnapshot } from '../../lib/account-client';
import { getClientIdentity, isClientIdentityCurrent } from '../../lib/client-identity';
import AdSlot from './AdSlot';
import StorePanel from './StorePanel';
import { hasCompletedTutorial, TUTORIAL_COMPLETED_EVENT } from '../../lib/tutorial-progress';
import GameLogo from './GameLogo';
import VoiceChatPanel from './VoiceChatPanel';
import { FONT_STYLES, PLAYER_SYMBOLS, type FontId, type SymbolId } from '../../lib/store-catalog';

const SUITS = { C: '♣', D: '♦', H: '♥', S: '♠' };
const SUIT_NAMES = { C: 'clubs', D: 'diamonds', H: 'hearts', S: 'spades' };
const COLORS = ['#f2c566', '#ff887d', '#7ac7ed', '#c7a4ee', '#95d3a1', '#f6a4c7', '#91c8c2', '#eaa977'];
const rankName = (rank: number) => ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }[rank] ?? String(rank));
const cardLabel = (card: Card) => `${rankName(card.rank)} of ${SUIT_NAMES[card.suit]}${card.rank === 2 ? ', wild' : ''}`;
const briefCard = (rank: number, suit: Card['suit']) => `${rankName(rank)}${SUITS[suit]}`;
const initials = (name: string) => name.trim().slice(0, 1).toUpperCase() || '';
const colorFor = (color: number) => COLORS[color % COLORS.length];
const handKey = (room: PublicRoom) => `${room.code}:${room.game}:${room.round}:${room.youId}`;
const handInteractionKey = (room: PublicRoom) => `${handKey(room)}:${room.turnNumber}:${room.status}`;

function HeaderRoomCode({ code }: { code: string }) {
  return <div className="header-room-code" data-code-length={code.length} aria-label={`Room code ${code}`}>
    <span>ROOM</span><strong>{code}</strong>
  </div>;
}
function GamesButton({ count, turns, onOpen, className = '' }: { count: number; turns: number; onOpen: () => void; className?: string }) {
  return <button type="button" className={`games-button ${turns ? 'games-awaiting-turn' : ''} ${className}`} onClick={onOpen} aria-label={`Your games, ${count} active games${turns ? `, your turn in ${turns}` : ''}`} title="Your games">
    <Layers3 size={18} aria-hidden="true"/><span>Games</span><b>{turns || count}</b>
  </button>;
}
function Avatar({ name, color = 0, className = '', bot = false, symbolId = 'initials' }: { name: string; color?: number; className?: string; bot?: boolean; symbolId?: SymbolId }) {
  const symbol = bot ? '' : PLAYER_SYMBOLS[symbolId]?.symbol;
  return <span className={`avatar ${className}`} style={{ '--avatar-color': colorFor(color) } as CSSProperties} aria-hidden="true">{symbol || initials(name) || <UserRound size={24}/>}{bot && <span className="avatar-bot"><Bot size={12}/></span>}</span>;
}
function PlayerName({ name, fontId = 'default', className = '' }: { name:string; fontId?:FontId; className?:string }) {
  return <span className={className} style={{ fontFamily: FONT_STYLES[fontId]?.stack ?? FONT_STYLES.default.stack }}>{name}</span>;
}
function CardBack({ className = '' }: { className?: string }) {
  return <span className={`card-back ${className}`} aria-hidden="true"><span/></span>;
}
const PIP_POSITIONS: Record<number, [number, number][]> = {
  5: [[27,25],[73,25],[50,50],[27,75],[73,75]],
  6: [[27,25],[73,25],[27,50],[73,50],[27,75],[73,75]],
  7: [[27,25],[73,25],[50,37.5],[27,50],[73,50],[27,75],[73,75]],
  8: [[27,25],[73,25],[50,37.5],[27,50],[73,50],[50,62.5],[27,75],[73,75]],
  9: [[27,22],[73,22],[27,41],[73,41],[50,50],[27,59],[73,59],[27,78],[73,78]],
};
function CardFace({ card, decorative = false, className = '' }: { card: TableCard; decorative?: boolean; className?: string }) {
  const red = card.suit === 'D' || card.suit === 'H';
  const wild = card.rank === 2;
  return <div className={`card-face ${red ? 'red' : 'black'} ${wild ? 'wild' : ''} ${decorative ? 'decorative-card' : ''} ${className}`} role="img" aria-label={cardLabel(card)}>
    <span className="card-corner"><b>{rankName(card.rank)}</b></span>
    {decorative && PIP_POSITIONS[card.rank] ? <svg className="card-pips" viewBox="0 0 100 140" aria-hidden="true">{PIP_POSITIONS[card.rank].map(([x,y], i) => <text key={i} x={x} y={y * 1.4} dominantBaseline="middle" textAnchor="middle" fontSize="29" fill="currentColor">{SUITS[card.suit]}</text>)}</svg> : <span className="card-centre" aria-hidden="true">{SUITS[card.suit]}</span>}
    {decorative && <span className="card-corner card-corner-bottom" aria-hidden="true"><b>{rankName(card.rank)}</b></span>}
    {wild && <span className="wild-badge">WILD</span>}
  </div>;
}
function StatusBadge({ down, winner = false }: { down: boolean; winner?: boolean }) {
  return <span className={`status-badge ${down ? 'is-down' : ''}`}>{winner ? 'OUT' : down ? 'DOWN' : 'NOT DOWN'}{down && <Check size={15}/>}</span>;
}
function DrawPiles({ room, isTurn, busy, inHand = false, onDraw }: {
  room: PublicRoom;
  isTurn: boolean;
  busy: boolean;
  inHand?: boolean;
  onDraw: (source: 'stock' | 'discard', placement?: DrawCardPlacement) => void;
}) {
  const drawAvailable = isTurn && room.phase === 'draw' && !busy;
  return <section className={`draw-section inset-panel${inHand ? ' hand-draw-piles' : ''}`} aria-label="Choose where to draw a card">
    <div className="draw-pile-choice">
      <label>Draw pile</label>
      <DrawCardButton source="stock" roomKey={handInteractionKey(room)} className={`stock-pile ${drawAvailable ? 'draw-available' : ''}`} onDraw={onDraw} disabled={!drawAvailable} ariaLabel={`Draw a card from the stock pile, ${room.stockCount} remaining. Hold and drag to choose a position in your hand.`} renderGhost={()=><CardBack/>}><CardBack/><CardBack/><CardBack/></DrawCardButton>
      <small>{room.stockCount} cards</small>
    </div>
    <div className="draw-pile-choice" data-discard-target={isTurn && room.phase === 'play' && !busy ? '' : undefined}>
      <label>Discard</label>
      <DrawCardButton source="discard" roomKey={handInteractionKey(room)} className={`discard-pile ${drawAvailable ? 'draw-available' : ''}`} onDraw={onDraw} disabled={!drawAvailable || !room.discard} ariaLabel={room.discard ? `Draw ${cardLabel(room.discard)} from the discard pile. Hold and drag to choose a position in your hand.` : 'Discard pile empty'} renderGhost={() => room.discard ? <CardFace card={room.discard}/> : <CardBack/>}>{room.discard ? <CardFace card={room.discard}/> : <span className="empty-discard">Empty</span>}</DrawCardButton>
      <small>Take top card</small>
    </div>
  </section>;
}
function Spinner({ text = 'One moment…' }: { text?: string }) { return <span className="inline-spinner"><LoaderCircle className="spin" size={19}/>{text}</span>; }
function Modal({ title, children, onClose, className = '' }: { title: string; children: ReactNode; onClose: () => void; className?: string }) {
  const id = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const prior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = prior;
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={dialogRef} tabIndex={-1} className={`modal panel ${className}`} role="dialog" aria-modal="true" aria-labelledby={id} onKeyDown={e => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]') ?? [])];
        const first = focusable[0], last = focusable.at(-1);
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    }}>
      <div className="modal-heading"><h2 id={id}>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={23}/></button></div>
      {children}
    </div>
  </div>;
}
function RuleList({ game, current, players, youId, fallbackRound = 1 }: { game: GameType; current?: number; players?: PublicPlayer[]; youId?: string; fallbackRound?: number }) {
  return <ol className="rule-list">{RULES[game].map(rule => {
    const onRule = players?.filter(player => ruleNumberFor(player, fallbackRound) === rule.number) ?? [];
    return <li key={rule.number} className={current === rule.number ? 'current' : ''}>
      <span className="rule-number">{rule.number}</span><div className="rule-list-copy"><span>{rule.title}</span>{game !== 1 && rule.description !== rule.title && <small>{rule.description}</small>}</div>
      {onRule.length > 0 && <div className="rule-avatars" role="img" aria-label={`Rule ${rule.number}: ${onRule.map(player => player.name).join(', ')}`} title={onRule.map(player => player.name).join(', ')}>{onRule.slice(0, 4).map(p => <Avatar key={p.id} name={p.name} color={p.color} className="tiny"/>)}{onRule.length > 4 && <small>+{onRule.length - 4}</small>}{onRule.some(p => p.id === youId) && <em>YOU</em>}</div>}
    </li>;
  })}</ol>;
}

function ruleOutcome(row: ScoreRow, fallbackRound: number, finished = false): string {
  const rule = ruleNumberFor(row, fallbackRound);
  // Older completed hands did not record who melded. Do not invent their outcome.
  if (row.melded === undefined) return `Rule ${rule}`;
  if (row.completed) return 'Rule 10 melded · All 10 rules complete';
  if (finished) return row.melded ? `Rule ${rule} melded` : `Rule ${rule} not melded`;
  const nextRule = row.nextRuleNumber ?? Math.min(10, rule + (row.melded ? 1 : 0));
  return row.melded ? `Rule ${rule} melded · Advance to Rule ${nextRule}` : `No meld · Repeat Rule ${nextRule}`;
}
function gameLabel(game: GameType) { return game === 4 ? 'Original Rules' : `Game ${game}`; }
function GameTabs({ value, onChange, disabled = false, originalRulesUnlocked = true, onLockedOriginal }: { value: GameType; onChange: (value: GameType) => void; disabled?: boolean; originalRulesUnlocked?: boolean; onLockedOriginal?: () => void }) {
  return <div className="segmented game-tabs" role="group" aria-label="Game rules">{([1, 2, 3, 4] as GameType[]).map(game => {
    const locked = game === 4 && !originalRulesUnlocked && value !== 4;
    return <button key={game} className={`${game === value ? 'active' : ''} ${locked ? 'locked-game' : ''}`} onClick={() => locked ? onLockedOriginal?.() : onChange(game)} aria-pressed={game === value} disabled={disabled} title={locked ? 'Original Rules · A$0.99 one-off host unlock' : undefined}>{locked ? '🔒 Original · A$0.99' : gameLabel(game)}</button>;
  })}</div>;
}
function Scoring({ compact = false }: { compact?: boolean }) {
  if (compact) return <div className="scoring-compact inset-panel"><h4>CARDS LEFT = POINTS</h4><div><span>5 – 7</span><strong>5</strong></div><div><span>8 – K</span><strong>10</strong></div><div><span>A, 2</span><strong>20</strong></div><p><Sparkles size={20}/><span>2s are wild</span></p></div>;
  return <section className="scoring-panel panel"><div className="scoring-title"><h2>Scoring</h2><p>When a player empties their hand, everyone else adds the value of their remaining cards.</p></div><div className="scoring-groups">
    {[[[5,'H'],[6,'H'],[7,'H']],[[8,'C'],[12,'D'],[13,'S']],[[14,'H'],[2,'C']]].map((group, i) => <div className="scoring-group" key={i}><div className="mini-fan">{group.map(([rank,suit], j) => <CardFace key={j} card={{id:`score-${i}-${j}`,rank:rank as number,suit:suit as Card['suit']}} className={`mini-card mini-card-${j}`}/>)}</div><div><b>{['5–7','8–K','A and 2'][i]}</b><strong>{[5,10,20][i]} points each</strong></div></div>)}
  </div><div className="scoring-footer"><span><Sparkles size={22}/>2s are wild</span><small>Totals include completed hands only.</small></div></section>;
}

function PlayerScores({ room }: { room: PublicRoom }) {
  return <section className="scoreboard panel">
    <div className="scoreboard-labels"><span>PLAYER</span><span>CURRENT RULE</span><span>THIS HAND</span><span>TOTAL POINTS</span></div>
    {room.players.map(player => {
      const ruleNumber = ruleNumberFor(player, room.round);
      const rule = RULES[room.game][ruleNumber - 1];
      return <div className="scoreboard-row" key={player.id}>
        <div className="score-player"><Avatar name={player.name} color={player.color} bot={player.isBot} symbolId={player.symbolId}/><strong><PlayerName name={player.name} fontId={player.fontId}/>{player.id === room.youId ? ' (You)' : ''}</strong></div>
        <div className="score-progress">
          <strong>Rule {ruleNumber} / 10</strong><p>{rule.title}</p>
          <div className="progress-steps" aria-label={`${player.name}: Rule ${ruleNumber} of 10${player.down ? ', melded' : ''}`}>{Array.from({ length: 10 }, (_, index) => {
            const number = index + 1;
            const complete = number < ruleNumber || (number === ruleNumber && player.down);
            return <span key={number} className={complete ? 'complete' : number === ruleNumber ? 'current' : ''}>{number}</span>;
          })}</div>
        </div>
        <StatusBadge down={player.down} winner={player.handCount === 0}/><b className="total-score">{player.score}</b>
      </div>;
    })}
    <div className="progress-legend"><span><i className="complete"/>Completed</span><span><i className="current"/>Current</span><span><i/>Next</span></div>
  </section>;
}

export default function ParkesApp({ initialCode }: { initialCode?: string }) {
  const account = useAccountSession();
  const openingPath = useRef<{ epoch: number; initialCode?: string; code?: string } | null>(null);
  if (account.status !== 'ready') return <AccountLoading account={account}/>;
  // An identity transition discards the entire previous player's hand, queued
  // operations, selection, animations, polling and list before rendering again.
  if (openingPath.current?.epoch !== account.epoch || openingPath.current.initialCode !== initialCode) {
    const code = typeof window === 'undefined' ? initialCode : /^\/join\/([A-Z0-9]{4}(?:[A-Z0-9]{2})?)$/.exec(window.location.pathname)?.[1];
    openingPath.current = { epoch: account.epoch, initialCode, code };
  }
  return <ParkesGame key={`${account.user?.id ?? 'guest'}:${account.epoch}`} initialCode={openingPath.current.code} account={account}/>;
}

function ParkesGame({ initialCode, account }: { initialCode?: string; account: AccountSnapshot }) {
  const identity = useRef(getClientIdentity());
  const appRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState(initialCode ?? '');
  const [entry, setEntry] = useState<'home' | 'invite'>(initialCode ? 'invite' : 'home');
  const [homeTab, setHomeTab] = useState<'play'|'games'|'store'>('play');
  const [tutorialCompleted, setTutorialCompleted] = useState(false);
  const [room, setRoom] = useState<PublicRoom | null>(null);
  const roomRef = useRef<PublicRoom | null>(null);
  const tokenRef = useRef('');
  const navigationEpoch = useRef(0);
  const pendingOperation = useRef<symbol | null>(null);
  const [preview, setPreview] = useState<RoomPreview | null>(null);
  const [loading, setLoading] = useState(!!initialCode);
  const [restoreCode, setRestoreCode] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [busy, setBusy] = useState('');
  const [openingCode, setOpeningCode] = useState('');
  const busyRef = useRef(false);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const [modal, setModal] = useState<'how' | 'settings' | 'rules' | 'leave' | 'games' | 'delete-game' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ code: string; token: string | null; returnToGames: boolean } | null>(null);
  const [rulesGame, setRulesGame] = useState<GameType>(1);
  const [pane, setPane] = useState<'table' | 'scores'>('table');
  const [mobileTable, setMobileTable] = useState(false);
  const [audio, setAudio] = useState({ muted: false, volume: .35, musicEnabled: true, musicVolume: .16 });
  const [turnVibration, setTurnVibration] = useState(true);
  const [sort, setSort] = useState<HandSort>('descending');
  const [sortMode, setSortMode] = useState<HandSortMode>('number');
  const sortPreferenceRef = useRef<{ direction: HandSort; mode: HandSortMode }>({ direction: 'descending', mode: 'number' });
  const [handOrder, setHandOrder] = useState<{ key: string; ids: string[] } | null>(null);
  const handOrderRef = useRef<{ key: string; ids: string[] } | null>(null);
  const pendingDrawPlacementRef = useRef<(DrawCardPlacement & { token: string; priorCardIds: string[] }) | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<Pick<LayoffTarget, 'meldId' | 'end'> | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [winningCardActive, setWinningCardActive] = useState(false);
  const winningPlaybackRef = useRef<{ key: string; playback: WinningCardPlayback } | null>(null);
  const [online, setOnline] = useState(true);
  const [needsGameUpdate, setNeedsGameUpdate] = useState(false);
  const [origin, setOrigin] = useState('');
  const [clockNow, setClockNow] = useState(0);
  const [openPlayerMenu, setOpenPlayerMenu] = useState<string | null>(null);
  const [botDifficulty, setBotDifficulty] = useState<Difficulty>('medium');
  const [addingAI, setAddingAI] = useState(false);
  const botPending = useRef('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const games = useSavedGames(room, tokenRef.current);
  const activeGames = splitSavedGames(games.entries).active;
  const waitingGames = activeGames.filter(item => !item.stale && !item.unavailable && item.summary?.status === 'playing' && item.summary.isYourTurn).length;
  const screenKey = room
    ? room.status === 'lobby' ? `lobby:${room.code}`
      : pane === 'table' ? `table:${handKey(room)}` : `scores:${room.code}`
    : entry;

  useEffect(() => {
    const update = () => setTutorialCompleted(hasCompletedTutorial());
    update();
    window.addEventListener('pageshow', update);
    window.addEventListener(TUTORIAL_COMPLETED_EVENT, update);
    return () => { window.removeEventListener('pageshow', update); window.removeEventListener(TUTORIAL_COMPLETED_EVENT, update); };
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const requestedTab = url.searchParams.get('tab');
    if (requestedTab === 'store' || requestedTab === 'games') setHomeTab(requestedTab);
    const purchase = url.searchParams.get('store_purchase') || url.searchParams.get('remove_ads');
    if (!purchase) return;
    url.searchParams.delete('store_purchase');
    url.searchParams.delete('remove_ads');
    url.searchParams.delete('product');
    url.searchParams.delete('session_id');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    if (purchase === 'success') { setHomeTab('store'); void refreshAccount({ suspend: true, manual: true }); }
  }, []);

  useLayoutEffect(() => {
    const query = window.matchMedia('(max-width: 850px)');
    const update = () => setMobileTable(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useLayoutEffect(() => {
    if (!window.matchMedia('(max-width: 850px), (pointer: coarse) and (max-width: 1100px)').matches) return;
    // Enter at the current rule and shared table, with the header still above.
    // Wait for the responsive dock to settle. Polls, turns, selections and Fold
    // resizing keep the player's scroll because they do not change screenKey.
    const frame = requestAnimationFrame(() => {
      const app = appRef.current;
      const dock = app?.querySelector<HTMLElement>('.your-hand');
      if (app && dock && getComputedStyle(dock).position === 'fixed') {
        app.style.setProperty('--hand-dock-height', `${Math.ceil(dock.getBoundingClientRect().height)}px`);
      }
      const table = app?.querySelector<HTMLElement>('.table-content');
      const top = table ? window.scrollY + table.getBoundingClientRect().top - 8 : 0;
      window.scrollTo({ top: Math.max(0, top), left: 0, behavior: 'instant' });
    });
    return () => cancelAnimationFrame(frame);
  }, [screenKey]);

  useEffect(() => {
    const app = appRef.current;
    const dock = app?.querySelector<HTMLElement>('.your-hand');
    if (!app || !dock) { app?.style.removeProperty('--hand-dock-height'); return; }
    const measure = () => {
      if (getComputedStyle(dock).position === 'fixed') {
        app.style.setProperty('--hand-dock-height', `${Math.ceil(dock.getBoundingClientRect().height)}px`);
      } else app.style.removeProperty('--hand-dock-height');
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(dock);
    window.addEventListener('resize', measure, { passive: true });
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      app.style.removeProperty('--hand-dock-height');
    };
  }, [screenKey]);

  useLayoutEffect(() => {
    const pending = winningPlaybackRef.current;
    const leftTable = !room || room.status === 'lobby' || pane !== 'table' || !!modal;
    if (pending && (!room || leftTable || pending.key !== handKey(room) || !['round-end', 'finished'].includes(room.status))) {
      winningPlaybackRef.current = null;
      pending.playback.cancel();
      setWinningCardActive(false);
    }
    if (leftTable) cancelTableMotion();
  }, [room?.code, room?.game, room?.round, room?.status, pane, modal]);

  const notify = useCallback((text: string, error = false) => {
    if (!alive.current || !isClientIdentityCurrent(identity.current)) return;
    setToast({ text, error });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), error ? 6500 : 3500);
    if (error) playSound('error');
  }, []);
  const acceptRoom = useCallback((next: PublicRoom, refreshRule = false) => {
    if (!alive.current || !isClientIdentityCurrent(identity.current)) return;
    const previous = roomRef.current;
    if (previous && previous.code === next.code && previous.youId === next.youId && previous.version > next.version) return;
    setNeedsGameUpdate(false);
    const isNew = !previous || previous.code !== next.code || previous.youId !== next.youId;
    if (!isNew && previous.version === next.version && !refreshRule) { setOnline(true); return; }
    const pendingDraw = pendingDrawPlacementRef.current;
    if (pendingDraw && (pendingDraw.roomKey !== handInteractionKey(next) || pendingDraw.token !== tokenRef.current || seatToken(next.code) !== pendingDraw.token)) pendingDrawPlacementRef.current = null;
    const ended = next.status === 'round-end' || next.status === 'finished';
    if (isNew) { setDraggedCardId(null); setOpenPlayerMenu(null); setAddingAI(false); setShowResult(false); }
    const newResult = ended && (isNew || previous.status !== next.status || previous.round !== next.round);
    const pending = winningPlaybackRef.current;
    if (pending && (newResult || !ended || pending.key !== handKey(next))) {
      winningPlaybackRef.current = null;
      pending.playback.cancel();
      setWinningCardActive(false);
    }
    const playback = animateRoomTransition(previous, next);
    let winningSound: SoundName | undefined;
    if (!isNew) {
      const lastEvent = previous.events.at(-1)?.id ?? -1;
      const events = next.events.filter(event => event.id > lastEvent);
      const soundMap: Record<string, SoundName> = { join:'join',start:'deal',draw:'card',meld:'meld',layoff:'layoff',discard:'discard','round-end':'roundWin','game-end':'gameWin' };
      const lastSound = [...events].reverse().find(event => soundMap[event.type]);
      if (lastSound) {
        if (playback && (lastSound.type === 'round-end' || lastSound.type === 'game-end')) winningSound = soundMap[lastSound.type];
        else playSound(soundMap[lastSound.type]);
      }
      if (next.status === 'playing' && next.turnPlayerId === next.youId && (next.turnPlayerId !== previous.turnPlayerId || next.turnNumber !== previous.turnNumber)) setTimeout(() => { if (alive.current && isClientIdentityCurrent(identity.current)) playSound('turn'); }, lastSound ? 160 : 0);
    }
    if (newResult) {
      if (playback) {
        const scheduled = { key: handKey(next), playback };
        winningPlaybackRef.current = scheduled;
        setShowResult(false);
        setWinningCardActive(true);
        const revealResult = () => {
          if (!alive.current || !isClientIdentityCurrent(identity.current) || winningPlaybackRef.current !== scheduled) return;
          winningPlaybackRef.current = null;
          setWinningCardActive(false);
          const latest = roomRef.current;
          if (!latest || handKey(latest) !== scheduled.key || !['round-end', 'finished'].includes(latest.status)) return;
          setShowResult(true);
          if (winningSound && !document.hidden) playSound(winningSound);
        };
        // Motion is presentation only. Resolve failures through the same path;
        // the authoritative room below is accepted without waiting for a frame.
        void playback.finished.then(revealResult, revealResult);
      } else setShowResult(true);
    }
    if (isNew || next.round !== previous?.round || next.status === 'lobby') { setSelected([]); setSelectedTarget(null); }
    else setSelected(old => old.filter(id => next.hand.some(card => card.id === id)));
    if (next.status === 'lobby') {
      handOrderRef.current = null;
      setHandOrder(null);
    } else {
      const key = handKey(next);
      const existing = handOrderRef.current;
      const sameHand = !isNew && previous?.status !== 'lobby' && existing?.key === key;
      const order = sameHand ? existing.ids : savedHandOrder(key, next.hand.map(card => card.id));
      const preference = sortPreferenceRef.current;
      let ids = arrangeHand(next.hand, order, preference.direction, preference.mode).map(card => card.id);
      const placement = pendingDrawPlacementRef.current;
      if (placement && next.phase === 'play' && next.turnPlayerId === next.youId) {
        // Polling might return the confirmed draw before its action response.
        // Apply the requested slot once, only to the one newly drawn card.
        const retainedOrder = ids.filter(id => placement.priorCardIds.includes(id));
        const inserted = insertDrawnCard(next.hand, retainedOrder, placement.priorCardIds, placement.beforeId);
        if (inserted) ids = inserted;
        pendingDrawPlacementRef.current = null;
      }
      handOrderRef.current = { key, ids };
      setHandOrder(handOrderRef.current);
      rememberHandOrder(key, ids);
    }
    roomRef.current = next;
    setRoom(next);
    setClockNow(Date.now());
    setOnline(true);
    if (isNew) setRulesGame(next.game);
  }, []);

  useEffect(() => {
    alive.current = true;
    initAudio();
    // Read device preferences after hydration, keeping the initial server markup stable.
    const hydrationFrame = requestAnimationFrame(() => {
      const direction = getSort();
      const mode = getSortMode();
      sortPreferenceRef.current = { direction, mode };
      setName(storedName() || account.user?.name.slice(0, 24) || ''); setAudio(getAudioSettings()); setSort(direction); setSortMode(mode); setOrigin(window.location.origin);
      setTurnVibration(getTurnVibrationEnabled());
      const candidate = initialCode ?? lastRoom();
      if (candidate && seatToken(candidate)) setRestoreCode(candidate);
    });
    let cancelled = false;
    const initialNavigation = navigationEpoch.current;
    const current = () => !cancelled && isClientIdentityCurrent(identity.current) && initialNavigation === navigationEpoch.current;
    async function loadInvite() {
      if (!initialCode) return;
      const token = seatToken(initialCode) ?? (account.user ? `account:${account.user.id}` : undefined);
      if (token) {
        try {
          let result = await roomApi.get(initialCode, token);
          if (!current()) return;
          // Opening an existing account seat is an explicit return, including a
          // game removed from the list. Do not auto-join a new account member.
          if (account.user) {
            result = await roomApi.join(initialCode, account.user.name.slice(0, 24) || 'Player', token);
            if (!current()) return;
          }
          if (rememberSeat(initialCode, token, account.user ? {} : { expectedToken: token })) {
            tokenRef.current = token; acceptRoom(result.room); setLoading(false); return;
          }
          // Another tab deleted or replaced this saved seat while loading.
          // Fall through to the invitation preview without restoring old access.
        }
        catch (error) { if (!current()) return; if (error instanceof RoomError && [401,403,404].includes(error.status) && seatToken(initialCode) === token) forgetSeat(initialCode); }
      }
      try { const result = await roomApi.preview(initialCode); if (current()) { setPreview(result.preview); setRulesGame(result.preview.game); } }
      catch (error) { if (current()) setInviteError(error instanceof Error ? error.message : 'This table could not be found.'); }
      finally { if (current()) setLoading(false); }
    }
    void loadInvite();
    const keyboard = () => initAudio();
    window.addEventListener('keydown', keyboard, { once: true });
    return () => { cancelled = true; alive.current = false; winningPlaybackRef.current = null; cancelTableMotion(); cancelAnimationFrame(hydrationFrame); if (toastTimer.current) clearTimeout(toastTimer.current); window.removeEventListener('keydown', keyboard); };
  }, [initialCode, acceptRoom, account.user?.id]);

  useEffect(() => subscribeTurnVibrationPreference(setTurnVibration), []);

  useEffect(() => {
    if (!room?.code) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let inFlight = false;
    let consecutiveFails = 0;
    const controller = new AbortController();
    const activeCode = room.code;
    const activeToken = tokenRef.current;
    async function poll() {
      if (disposed || inFlight || document.hidden) { if (!disposed) timer = setTimeout(poll, 1700); return; }
      inFlight = true;
      const epoch = navigationEpoch.current;
      const stillCurrent = () => !disposed && isClientIdentityCurrent(identity.current) && epoch === navigationEpoch.current && roomRef.current?.code === activeCode && tokenRef.current === activeToken;
      try {
        const result = await roomApi.get(activeCode, activeToken, controller.signal);
        if (stillCurrent()) { acceptRoom(result.room); consecutiveFails = 0; }
      } catch (error) {
        if (stillCurrent()) {
          consecutiveFails++;
          if (error instanceof RoomError && error.status === 426) {
            setNeedsGameUpdate(true);
            setOnline(true);
          } else if (consecutiveFails >= 2) setOnline(false);
          if (error instanceof RoomError && [401,403,404].includes(error.status)) {
            if (seatToken(activeCode) === activeToken) forgetSeat(activeCode);
            roomRef.current = null; tokenRef.current = ''; setRoom(null); setRestoreCode(''); setEntry('home'); setModal(null); setLoading(false); window.history.replaceState(null, '', '/'); notify(error.message, true);
          }
        }
      } finally {
        inFlight = false;
        if (!disposed) timer = setTimeout(poll, consecutiveFails ? Math.min(6000, 1600 * consecutiveFails) : 1450);
      }
    }
    const resume = () => { if (!document.hidden) { clearTimeout(timer); void poll(); } };
    timer = setTimeout(poll, 1450);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    return () => { disposed = true; clearTimeout(timer); controller.abort(); document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume); };
  }, [room?.code, acceptRoom, notify]);

  useEffect(() => {
    if (!room?.code || room.status !== 'playing') return;
    let disposed = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout>;
    const activeCode = room.code;
    const activeToken = tokenRef.current;
    const schedule = (delay = 550) => { if (!disposed) timer = setTimeout(tick, delay); };
    async function tick() {
      if (disposed) return;
      const current = roomRef.current;
      if (!current || current.code !== activeCode || current.status !== 'playing') return;
      if (document.hidden || inFlight) { schedule(900); return; }
      const now = Date.now();
      const expired = current.turnDeadline !== null && current.turnLimitSeconds > 0 && now >= current.turnDeadline + 100;
      const botDue = current.players.find(player => player.id === current.turnPlayerId)?.isBot && now >= current.botDueAt + 80;
      if (!expired && !botDue) { schedule(); return; }
      const key = `${expired ? 'timeout' : 'bot'}-${current.code}-${current.round}-${current.turnNumber}-${current.version}`;
      if (botPending.current === key) { schedule(); return; }
      inFlight = true;
      botPending.current = key;
      const epoch = navigationEpoch.current;
      try {
        const result = await roomApi.action(current.code, activeToken, { type: expired ? 'timeout' : 'botStep' }, key);
        if (!disposed && isClientIdentityCurrent(identity.current) && epoch === navigationEpoch.current && tokenRef.current === activeToken && roomRef.current?.code === current.code) acceptRoom(result.room);
      } catch { /* Retry the same action safely; room polling also recovers connection failures. */ }
      finally { inFlight = false; if (botPending.current === key) botPending.current = ''; schedule(700); }
    }
    const resume = () => { if (!document.hidden && !inFlight) { clearTimeout(timer); schedule(100); } };
    schedule(200);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    return () => { disposed = true; clearTimeout(timer); document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume); };
  }, [room?.code, room?.status, acceptRoom]);

  useEffect(() => {
    if (room?.status !== 'playing' || !room?.turnLimitSeconds || room?.turnDeadline === null) return;
    const interval = setInterval(() => setClockNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, [room?.status, room?.turnLimitSeconds, room?.turnDeadline]);

  useEffect(() => {
    if (entry !== 'invite' || room?.code || loading || !isRoomCode(code)) return;
    let disposed = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refreshPreview() {
      if (disposed) return;
      if (document.hidden || inFlight) { timer = setTimeout(refreshPreview, 3000); return; }
      inFlight = true;
      try {
        const result = await roomApi.preview(code);
        if (!disposed) { setPreview(result.preview); setInviteError(''); }
      } catch (error) {
        if (!disposed && error instanceof RoomError && error.status === 404) setInviteError(error.message);
      } finally { inFlight = false; if (!disposed) timer = setTimeout(refreshPreview, 3000); }
    }
    const resume = () => { if (!document.hidden && !inFlight) { clearTimeout(timer); void refreshPreview(); } };
    timer = setTimeout(refreshPreview, 3000);
    document.addEventListener('visibilitychange', resume);
    return () => { disposed = true; clearTimeout(timer); document.removeEventListener('visibilitychange', resume); };
  }, [entry, room?.code, loading, code]);

  const doAction = useCallback(async (action: GameAction, label: string = action.type, onFailure?: (error: unknown) => void) => {
    const active = roomRef.current;
    if (!active || busyRef.current) return;
    const epoch = navigationEpoch.current;
    const token = tokenRef.current;
    const operation = Symbol(label);
    pendingOperation.current = operation;
    const stillCurrent = () => alive.current && isClientIdentityCurrent(identity.current) && epoch === navigationEpoch.current && roomRef.current?.code === active.code && tokenRef.current === token;
    busyRef.current = true; setBusy(label);
    try { const result = await roomApi.action(active.code, token, action); if (stillCurrent()) { acceptRoom(result.room); setOpenPlayerMenu(null); } }
    catch (error) {
      if (!stillCurrent()) return;
      onFailure?.(error);
      if (error instanceof RoomError && error.status === 426) setNeedsGameUpdate(true);
      if (error instanceof RoomError && error.room && roomRef.current?.code === active.code && error.room.youId === active.youId) {
        // A rejected opening does not increment the room version. Still replace
        // its displayed rule with the authoritative correction from the server.
        acceptRoom(error.room, true);
      }
      notify(error instanceof Error ? error.message : 'Please try your move again.', true);
    }
    finally { if (pendingOperation.current === operation) { pendingOperation.current = null; busyRef.current = false; if (alive.current) setBusy(''); } }
  }, [acceptRoom, notify]);

  const reorderHand = useCallback((orderedIds: string[]) => {
    if (!isClientIdentityCurrent(identity.current)) return;
    const current = roomRef.current;
    if (!current || !orderedIds.some(id => current.hand.some(card => card.id === id))) return;
    const preference = sortPreferenceRef.current;
    const ids = arrangeHand(current.hand, orderedIds, preference.direction, preference.mode).map(card => card.id);
    handOrderRef.current = { key: handKey(current), ids };
    setHandOrder(handOrderRef.current);
    rememberHandOrder(handKey(current), ids);
  }, []);
  const playCardsToMeld = useCallback((cardIds: string[], target: Pick<LayoffTarget, 'meldId' | 'end'>) => {
    if (busyRef.current) return;
    const action = getHandLayoffGroupAction(roomRef.current, cardIds, target);
    if (!action) { notify(cardIds.length > 1 ? 'These cards do not fit together here. Check the sequence, chosen end and your turn.' : 'Invalid placement. Check the card, chosen set or run end, and your turn.', true); return; }
    setSelectedTarget(target);
    void doAction(action, 'layoff');
  }, [doAction, notify]);
  const playCardToMeld = useCallback((cardId: string, target: Pick<LayoffTarget, 'meldId' | 'end'>) => {
    playCardsToMeld([cardId], target);
  }, [playCardsToMeld]);
  const drawCard = useCallback(async (source: 'stock' | 'discard', placement?: DrawCardPlacement) => {
    const current = roomRef.current;
    if (!current || busyRef.current) return;
    if (current.status !== 'playing' || current.turnPlayerId !== current.youId || current.phase !== 'draw') { notify('Draw at the start of your turn.', true); return; }
    if (placement && (placement.roomKey !== handInteractionKey(current) || (placement.beforeId !== null && !current.hand.some(card => card.id === placement.beforeId)))) {
      notify('Your hand changed. Choose a position again.', true); return;
    }
    const pending = placement ? { ...placement, token: tokenRef.current, priorCardIds: current.hand.map(card => card.id) } : null;
    pendingDrawPlacementRef.current = pending;
    let uncertain = false;
    try {
      await doAction({ type: 'draw', source }, 'draw', error => {
        uncertain = error instanceof RoomError && (error.status === 0 || error.status >= 500);
      });
    } finally {
      // A lost response does not prove the draw failed. Retain the slot for
      // the next confirmed update without sending another draw automatically.
      if (pendingDrawPlacementRef.current === pending && !uncertain) pendingDrawPlacementRef.current = null;
    }
  }, [doAction, notify]);
  const discardCard = useCallback((cardId: string) => {
    if (busyRef.current) return;
    const action = getHandDiscardAction(roomRef.current, cardId);
    if (!action) { notify('Draw first, then discard one card on your turn.', true); return; }
    void doAction(action);
  }, [doAction, notify]);

  const enterRoom = async (mode: 'create' | 'join' | 'restore' | 'quick', requestedCode?: string) => {
    if (busyRef.current) return;
    const roomCode = normalizeRoomCode(requestedCode ?? (mode === 'restore' ? restoreCode : code));
    if (mode === 'restore' && roomCode === roomRef.current?.code) {
      setModal(null);
      if (roomRef.current.result && ['round-end', 'finished'].includes(roomRef.current.status)) setShowResult(true);
      return;
    }
    if (mode !== 'restore' && mode !== 'quick' && !name.trim()) { notify('Enter your name to take a seat.', true); return; }
    const chosenName = mode === 'quick' ? (name.trim() || account.user?.name?.slice(0, 24) || 'Player') : name.trim();
    if (mode === 'join' && !isRoomCode(roomCode)) { notify('Enter the four-character room code. Existing six-character codes still work.', true); return; }
    const epoch = ++navigationEpoch.current;
    const operation = Symbol(mode);
    pendingOperation.current = operation;
    const startingSeats = getSeats();
    const savedToken = mode === 'restore' ? startingSeats[roomCode] : undefined;
    const stillCurrent = () => alive.current && isClientIdentityCurrent(identity.current) && epoch === navigationEpoch.current;
    busyRef.current = true; setBusy(mode); setOpeningCode(mode === 'restore' ? roomCode : ''); setInviteError('');
    try {
      let next: PublicRoom;
      let token: string;
      if (mode === 'restore') {
        if (!savedToken) throw new RoomError('Your saved seat is no longer available.', 404);
        const result = await roomApi.get(roomCode, savedToken);
        if (!stillCurrent()) return;
        if (seatToken(roomCode) !== savedToken) throw new RoomError('Your saved seat changed. Open the table again.', 409);
        next = result.room; token = savedToken;
      } else {
        const result = (mode === 'create' || mode === 'quick') ? await roomApi.create(chosenName, mode === 'quick') : await roomApi.join(roomCode, chosenName, startingSeats[roomCode]);
        // A completed join keeps its seat even if the player went home while
        // the request was in flight. Only the chosen navigation opens the UI.
        if (!stillCurrent()) {
          if (!alive.current || !isClientIdentityCurrent(identity.current)) return;
          rememberSeat(result.room.code, result.token, { visit: false, expectedToken: startingSeats[result.room.code] ?? null });
          return;
        }
        next = result.room; token = result.token;
      }
      // Account discovery may see a newly joined membership before this
      // response arrives. Its identical nonsecret marker is the same seat.
      const expectedToken = account.user ? seatToken(next.code) ?? null : mode === 'restore' ? savedToken ?? null : startingSeats[next.code] ?? null;
      if (!rememberSeat(next.code, token, { expectedToken })) throw new RoomError('Your saved seat changed. Open the table again.', 409);
      if (mode !== 'restore') { rememberName(chosenName); playSound(mode === 'quick' ? 'shuffle' : 'join'); }
      tokenRef.current = token;
      setModal(null); setSelected([]); setSelectedTarget(null); setDraggedCardId(null);
      setPane('table'); setLoading(false); acceptRoom(next);
      setRestoreCode(next.code); setCode(next.code);
      window.history.replaceState(null, '', `/join/${next.code}`);
    } catch (error) {
      if (!stillCurrent()) return;
      notify(error instanceof Error ? error.message : 'Your seat could not be added. Please try again.', true);
      if (mode === 'restore' && error instanceof RoomError && [401,403,404].includes(error.status) && seatToken(roomCode) === savedToken) { forgetSeat(roomCode); setRestoreCode(''); }
    } finally {
      if (pendingOperation.current === operation) { pendingOperation.current = null; busyRef.current = false; if (alive.current) { setBusy(''); setOpeningCode(''); } }
    }
  };
  const home = () => {
    if (!isClientIdentityCurrent(identity.current)) return;
    const currentCode = roomRef.current?.code;
    if (currentCode) setRestoreCode(currentCode);
    navigationEpoch.current++;
    pendingDrawPlacementRef.current = null;
    pendingOperation.current = null; busyRef.current = false; setBusy(''); setOpeningCode('');
    winningPlaybackRef.current?.playback.cancel(); winningPlaybackRef.current = null; cancelTableMotion();
    roomRef.current = null; tokenRef.current = ''; setRoom(null); setEntry('home'); setModal(null); setDeleteTarget(null);
    setSelected([]); setSelectedTarget(null); setDraggedCardId(null); setShowResult(false); setWinningCardActive(false);
    setPreview(null); setInviteError(''); setLoading(false); setOpenPlayerMenu(null);
    window.history.replaceState(null, '', '/');
    void games.refresh();
  };
  const leave = async () => {
    const active = roomRef.current;
    if (!active) { home(); return; }
    if (active.status !== 'lobby') { home(); return; }
    if (busyRef.current) return;
    const epoch = navigationEpoch.current;
    const token = tokenRef.current;
    const operation = Symbol('leave'); pendingOperation.current = operation;
    setBusy('leave'); busyRef.current = true;
    try {
      await roomApi.action(active.code, token, { type:'leave' });
      if (!isClientIdentityCurrent(identity.current)) return;
      if (seatToken(active.code) === token) forgetSeat(active.code);
      if (alive.current && epoch === navigationEpoch.current && roomRef.current?.code === active.code) { home(); setRestoreCode(''); }
    }
    catch (error) { if (alive.current && isClientIdentityCurrent(identity.current) && epoch === navigationEpoch.current) notify(error instanceof Error ? error.message : 'Please try again.', true); }
    finally { if (pendingOperation.current === operation) { pendingOperation.current = null; busyRef.current = false; if (alive.current) setBusy(''); } }
  };
  const openGames = () => { setShowResult(false); setModal('games'); void games.refresh(); };
  const requestDeleteGame = (roomCode: string) => {
    if (busyRef.current) return;
    const normalized = normalizeRoomCode(roomCode);
    if (!isRoomCode(normalized)) return;
    setDeleteTarget({ code: normalized, token: seatToken(normalized) ?? null, returnToGames: modal === 'games' });
    setModal('delete-game');
  };
  const cancelDeleteGame = () => {
    setModal(deleteTarget?.returnToGames ? 'games' : null);
    setDeleteTarget(null);
  };
  const deleteSavedGame = async () => {
    if (!deleteTarget || busyRef.current) return;
    const target = deleteTarget;
    const epoch = navigationEpoch.current;
    const operation = Symbol('delete-game');
    if (account.user) {
      if (seatToken(target.code) !== target.token) { cancelDeleteGame(); void games.refresh(); return; }
      pendingOperation.current = operation; busyRef.current = true; setBusy('delete-game');
      try {
        await roomApi.removeAccountGame(target.code);
        if (!alive.current || !isClientIdentityCurrent(identity.current) || epoch !== navigationEpoch.current) return;
      } catch (error) {
        if (alive.current && isClientIdentityCurrent(identity.current)) notify(error instanceof Error ? error.message : 'Your game list could not be updated.', true);
        return;
      } finally {
        if (pendingOperation.current === operation) { pendingOperation.current = null; busyRef.current = false; if (alive.current) setBusy(''); }
      }
    }
    // A confirmation belongs to the saved seat shown when the dialog opened.
    // Another tab replacing that seat must not lose its new access.
    // An account list poll may already reflect the confirmed server removal.
    // Its missing marker is a completed deletion, not a replacement guest seat.
    if (!forgetSeat(target.code, { expectedToken: account.user ? seatToken(target.code) ?? null : target.token })) {
      cancelDeleteGame();
      void games.refresh();
      notify('Your saved seat changed. Review the game before deleting.', true);
      return;
    }
    if (roomRef.current?.code === target.code) { home(); setRestoreCode(''); }
    else {
      setModal(target.returnToGames ? 'games' : null);
      setDeleteTarget(null);
      if (restoreCode === target.code) setRestoreCode('');
    }
    void games.refresh();
    notify('Game deleted from your list.');
  };
  const rematchSavedGame = async (roomCode: string) => {
    if (busyRef.current) return;
    const entry = games.entries.find(item => item.code === roomCode);
    const active = roomRef.current;
    const currentSummary = active?.code === roomCode ? summaryFromRoom(active) : undefined;
    const summary = currentSummary && (!entry?.summary || currentSummary.version >= entry.summary.version) ? currentSummary : entry?.summary;
    const token = seatToken(roomCode);
    if (!summary || !token || (!currentSummary && (entry?.stale || entry?.unavailable))) {
      notify('Refresh this game before starting a rematch.', true);
      void games.refresh();
      return;
    }
    if (summary.status !== 'finished') { notify('This game has already moved on. Open the table to continue.', true); void games.refresh(); return; }
    if (!summary.isHost) { notify('The host starts the rematch.', true); return; }
    const epoch = ++navigationEpoch.current;
    const operation = Symbol('rematch');
    pendingOperation.current = operation;
    const stillCurrent = () => alive.current && isClientIdentityCurrent(identity.current) && epoch === navigationEpoch.current && seatToken(roomCode) === token;
    busyRef.current = true; setBusy('rematch'); setOpeningCode(roomCode);
    try {
      const result = await roomApi.action(roomCode, token, { type: 'rematch', expectedVersion: summary.version });
      if (!stillCurrent() || !rememberSeat(roomCode, token, { expectedToken: token })) return;
      tokenRef.current = token;
      setModal(null); setShowResult(false); setSelected([]); setSelectedTarget(null); setDraggedCardId(null);
      setPane('table'); setLoading(false); acceptRoom(result.room);
      setRestoreCode(roomCode); setCode(roomCode);
      window.history.replaceState(null, '', `/join/${roomCode}`);
      notify('Rematch lobby ready. Players and settings kept.');
    } catch (error) {
      if (!stillCurrent()) return;
      if (error instanceof RoomError && error.status === 426) setNeedsGameUpdate(true);
      if (error instanceof RoomError && error.room && roomRef.current?.code === roomCode && roomRef.current.youId === error.room.youId) acceptRoom(error.room, true);
      notify(error instanceof Error ? error.message : 'The rematch did not open. Please try again.', true);
    } finally {
      if (pendingOperation.current === operation) {
        pendingOperation.current = null; busyRef.current = false;
        if (alive.current) { setBusy(''); setOpeningCode(''); void games.refresh(); }
      }
    }
  };
  const gameList = <YourGames entries={games.entries} loading={games.loading} refreshing={games.refreshing} error={games.error} accountBacked={!!account.user} activeCode={room?.code} busyCode={openingCode || (busy ? '__busy' : undefined)} busyAction={busy === 'rematch' ? 'rematch' : 'open'} now={games.now} onOpen={roomCode => { void enterRoom('restore', roomCode); }} onRemove={requestDeleteGame} onRematch={roomCode => { void rematchSavedGame(roomCode); }} onRefresh={() => { void games.refresh(); }}/>
  const inviteLink = room && origin ? `${origin}/join/${room.code}` : '';
  const copy = async (value: string, message: string) => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else {
        const element = document.createElement('textarea'); element.value = value; element.style.position = 'fixed'; element.style.opacity = '0'; document.body.appendChild(element); element.select();
        if (!document.execCommand('copy')) throw new Error('copy');
        element.remove();
      }
      notify(message);
    } catch { notify('Copy was blocked by your browser. Select the invitation link below.', true); }
  };
  const share = async () => {
    const host = room?.players.find(p => p.id === room.hostId)?.name ?? 'your friends';
    if (navigator.share) {
      try { await navigator.share({ title:'Parkes Rummy', text:`Join ${host}’s table for Parkes Rummy.`, url: inviteLink }); return; }
      catch (error) { if (error instanceof Error && error.name === 'AbortError') return; }
    }
    await copy(inviteLink, 'Invite link copied. Share with your friends.');
  };
  const updateAudio = (patch: Partial<typeof audio>) => { setAudioSettings(patch); setAudio(getAudioSettings()); };
  const updateSort = (value: HandSort) => {
    if (!isClientIdentityCurrent(identity.current)) return;
    sortPreferenceRef.current.direction = value;
    setSort(value); rememberSort(value);
    const current = roomRef.current;
    if (current) reorderHand(sortCards(current.hand, value, sortPreferenceRef.current.mode).map(card => card.id));
  };
  const sortHand = () => {
    const current = roomRef.current;
    if (!current) return;
    const preference = sortPreferenceRef.current;
    reorderHand(sortCards(current.hand, preference.direction, preference.mode).map(card => card.id));
    notify(`Sorted by ${preference.mode} · ${preference.direction === 'descending' ? 'High to low' : 'Low to high'}`);
  };
  const updateSortMode = (value: HandSortMode) => {
    if (!isClientIdentityCurrent(identity.current)) return;
    sortPreferenceRef.current.mode = value;
    setSortMode(value); rememberSortMode(value);
    sortHand();
  };
  const me = room?.players.find(p => p.id === room.youId);
  const host = room?.players.find(p => p.id === room.hostId);
  const isHost = !!room && room.youId === room.hostId;
  const isTurn = !!room && room.status === 'playing' && room.turnPlayerId === room.youId;
  // A single mounted pair keeps touch targets and animation anchors unambiguous.
  const drawPiles = room ? <DrawPiles room={room} isTurn={isTurn} busy={!!busy} inHand={mobileTable} onDraw={(source, placement) => { void drawCard(source, placement); }}/> : null;
  const currentPlayer = room?.players.find(p => p.id === room.turnPlayerId);
  const currentRule = room ? room.currentRule ?? RULES[room.game][ruleNumberFor(me, room.round) - 1] : null;
  const currentRuleNumber = currentRule?.number ?? 1;
  const showMoveHints = room?.showMoveHints !== false;
  const sortedHand = useMemo(() => arrangeHand(room?.hand ?? [], room && handOrder?.key === handKey(room) ? handOrder.ids : null, sort, sortMode), [room?.hand, room?.code, room?.game, room?.round, room?.youId, handOrder, sort, sortMode]);
  const selectedCards = useMemo(() => (room?.hand ?? []).filter(card => selected.includes(card.id)), [room?.hand, selected]);
  const selectionMeld = useMemo(() => room && !me?.down && selectedCards.length ? findOpeningMelds(selectedCards, room.game, currentRuleNumber) : null, [selectedCards, room, me?.down, currentRuleNumber]);
  const openingFeedback = currentRule && !me?.down && selectedCards.length > 0 && !selectionMeld
    ? getOpeningSelectionFeedback(selectedCards, currentRule) : '';
  const targetCards = useMemo(() => draggedCardId ? (room?.hand ?? []).filter(card => card.id === draggedCardId) : selectedCards, [draggedCardId, room?.hand, selectedCards]);
  const targets = useMemo(() => showMoveHints && room && targetCards.length && canLayoff(room) ? getLayoffGroupTargets(targetCards, room.melds) : [], [showMoveHints, room, targetCards]);
  const activeTarget = selectedTarget && targets.find(t => t.meldId === selectedTarget.meldId && t.end === selectedTarget.end) || (targets.length === 1 ? targets[0] : null);
  const turnSeconds = room?.status === 'playing' && room.turnLimitSeconds > 0 && room.turnDeadline !== null ? Math.min(room.turnLimitSeconds, Math.max(0, Math.ceil((room.turnDeadline - clockNow) / 1000))) : null;
  const turnCountdown = turnSeconds === null ? null : <span className={`turn-countdown ${turnSeconds <= 10 ? 'countdown-urgent' : ''}`} aria-label={`${turnSeconds} seconds left in this turn`}><Timer size={13}/>{Math.floor(turnSeconds/60)}:{String(turnSeconds%60).padStart(2,'0')}</span>;
  const layoffHint = selectedCards.length > 1
    ? showMoveHints && targets.length === 0 && !draggedCardId ? 'Selected cards do not fit together at one end or set.' : `${selectedCards.length} cards selected · choose a set or run end`
    : 'Select cards to add, or one card to discard';
  const turnHint = !room || !me ? '' : room.status !== 'playing' ? 'Hand complete · review the scores' : !isTurn ? (currentPlayer?.isBot ? 'Thinking…' : '') : room.phase === 'draw' ? 'Tap to draw · Hold and drag into your hand' : me.completedTurns < 1 && !me.down ? 'First turn: draw, then discard. Go down from your next turn.' : me.down && me.laidDownTurn === room.turnNumber ? 'You’re down! Discard now. Add to melds from your next turn.' : me.down ? layoffHint : selected.length ? selectionMeld ? 'Opening ready. Go down, then discard.' : selectedCards.length === 1 ? 'Discard this card, or select the rest of your opening.' : openingFeedback : 'Select your opening cards, or select one card to discard';
  const toggleCard = (card: Card) => { setSelectedTarget(null); setSelected(old => old.includes(card.id) ? old.filter(id => id !== card.id) : [...old, card.id]); };

  return <div ref={appRef} className={`parkes-app ${room && room.status !== 'lobby' ? 'in-game' : ''}`} onPointerDown={() => initAudio()} onClickCapture={e => {
    const target = e.target as HTMLElement;
    const button = target.closest('button');
    if (button && !button.disabled && button.dataset.sound !== 'none') playSound(button.dataset.sound === 'card' ? 'card' : button.dataset.sound === 'select' ? 'select' : 'click');
  }}>
    <div className="felt-grain" aria-hidden="true"/>
    <BackgroundSuits/>
    {!room && entry === 'home' && <>
      <header className="site-header home-header"><GameLogo/><div className="header-actions"><button className="button outline how-button" onClick={() => setModal('how')}><CircleHelp size={24}/>How to play</button><button className="icon-button sound-button" onClick={() => updateAudio({muted:!audio.muted})} aria-label={audio.muted ? 'Turn sound on' : 'Mute sound'} title={audio.muted ? 'Turn sound on' : 'Mute sound'}>{audio.muted ? <VolumeX/> : <Volume2/>}</button><button className="icon-button home-settings" onClick={() => setModal('settings')} aria-label="Settings"><Settings size={22}/></button></div></header>
      <main className={'home-main' + (homeTab === 'store' ? ' store-active' : '')}>
        <section className="home-hero"><h1 className="hero-title">Parkes<br/>Rummy</h1><div className="hero-card-fan" aria-label="Five through nine of hearts and a wild two of diamonds">{[5,6,7,8,9,2].map((rank,index) => <div className={`hero-card hero-card-${index}`} key={rank}><CardFace decorative card={{id:`hero-${rank}`,rank,suit:rank === 2 ? 'D':'H'}}/></div>)}</div></section>
        <section className="start-panel panel"><h2>Let’s play</h2><AccountControls account={account} disabled={!!busy}/><nav className="home-play-tabs" aria-label="Play options"><button className={homeTab==='play'?'active':''} onClick={()=>setHomeTab('play')}>Play</button><button className={homeTab==='games'?'active':''} onClick={()=>setHomeTab('games')}>Your Games{activeGames.length>0&&<span>{activeGames.length}</span>}</button><button className={homeTab==='store'?'active':''} onClick={()=>setHomeTab('store')}>Store</button></nav>
          {homeTab==='play'&&<div className="home-tab-content"><form onSubmit={e => {e.preventDefault(); void enterRoom('create');}}><label htmlFor="home-name">Your name</label><div className="name-input"><Avatar name={name} symbolId={account.profile.symbol as SymbolId}/><input id="home-name" value={name} onChange={e => setName(e.target.value)} placeholder="Enter your name" maxLength={24} autoComplete="given-name" spellCheck={false}/></div><button className="button gold create-button home-main-action" disabled={!name.trim() || !!busy} type="submit">{busy === 'create' ? <Spinner text="Creating your table…"/> : <><Plus size={31}/>Create game</>}</button></form>
          <button type="button" className="button gold quick-play-button home-main-action" disabled={!!busy} onClick={() => { void enterRoom('quick'); }}>{busy === 'quick' ? <Spinner text="Starting Quick Play…"/> : <><Dices size={31}/>Quick Play</>}</button>
          {!tutorialCompleted && <a className="button outline home-tutorial-link home-main-action" href="/tutorial"><Sparkles size={31}/>Learn with a practice hand</a>}<div className="or-divider"><span/>Joining friends?<span/></div><form className="code-entry-form" onSubmit={e => {e.preventDefault(); void enterRoom('join');}}><label htmlFor="home-code">Room code</label><input className="text-input code-input" id="home-code" value={code} onChange={e => setCode(normalizeRoomCode(e.target.value).replace(/[^A-Z0-9]/g,'').slice(0,LEGACY_ROOM_CODE_LENGTH))} placeholder="4-character code" maxLength={LEGACY_ROOM_CODE_LENGTH} autoComplete="off" autoCapitalize="characters" spellCheck={false}/><button className="button outline join-button" disabled={!name.trim() || !isRoomCode(code) || !!busy} type="submit">{busy === 'join' ? <Spinner text="Joining your friends…"/> : 'Join game'}</button></form><p className="invite-help">Have an invite link? Open the link to join directly.</p><div className="browser-note"><Monitor size={24}/><span>{account.user ? 'Your account keeps your games ready on every device.' : 'Play here without signing in. Sign in only to move games or purchases between devices.'}</span></div></div>}
          {homeTab==='games'&&<div className="home-tab-content home-games-tab">{gameList}<button className="button gold" onClick={()=>setHomeTab('play')}><Plus size={19}/>Create or join another game</button></div>}
          {homeTab==='store'&&<div className="home-tab-content"><StorePanel account={account} onChanged={()=>{void games.refresh();}}/></div>}
        </section>
        <AdSlot surface="home" adFree={account.entitlements.removeAds}/>
      </main>
    </>}

    {!room && entry === 'invite' && <main className="guest-main"><GameLogo large/><p className="guest-kicker"><span/>Join your friends<span/></p><section className="guest-panel panel">
      <AccountControls account={account} disabled={!!busy}/>
      {loading ? <div className="invite-loading"><Spinner text="Finding your table…"/></div> : inviteError ? <div className="invite-error"><CircleHelp size={40}/><h2>Let’s find your table</h2><p>{inviteError}</p><button className="button gold" onClick={home}>Back to home</button></div> : preview && <>
        <Users className="guest-users-icon" size={54}/><p className="you-are-joining">You’re joining</p><h1>{preview.hostName}’s table</h1><span className="game-pill">{gameLabel(preview.game)}</span><p className="waiting-count">{preview.playerCount} player{preview.playerCount === 1 ? '' : 's'} {preview.status==='lobby'?'waiting':'playing'} <span>·</span> {8-preview.playerCount} seats open</p><div className="guest-players">{preview.players.map(p => <div key={p.id}><Avatar name={p.name} color={p.color} bot={p.isBot} symbolId={p.symbolId}/><PlayerName name={p.name} fontId={p.fontId}/></div>)}</div>
        {preview.status !== 'lobby' && <p className="form-notice">This game has started. New players join when the host opens the next lobby.</p>}
        <form onSubmit={e => {e.preventDefault(); void enterRoom('join');}}><label htmlFor="guest-name">Your name</label><div className="name-input"><Avatar name={name} color={preview.playerCount} symbolId={account.profile.symbol as SymbolId}/><input id="guest-name" value={name} onChange={e => setName(e.target.value)} placeholder="Enter your name" maxLength={24} autoComplete="given-name" spellCheck={false}/></div><button className="button gold" disabled={!name.trim() || !!busy || preview.status !== 'lobby' || preview.playerCount >= 8}>{busy === 'join' ? <Spinner text="Taking your seat…"/> : <>Join game<ArrowRight size={30}/></>}</button></form><p className="guest-account-note">{account.user ? 'Your seat follows your Google account' : 'No account needed · Guest seat stays on this device'}</p>
      </>}
    </section><p className="guest-ready-note">Joining marks you ready to play.</p><div className="guest-rules"><span>2s are wild</span><div className="guest-card-pair"><CardFace card={{id:'guest-2',rank:2,suit:'D'}}/><CardFace card={{id:'guest-7',rank:7,suit:'C'}}/></div><span>3s and 4s removed</span></div><button className="text-link" onClick={home}>Back to home</button></main>}

    {room && room.status === 'lobby' && <div className="lobby-shell"><div className="lobby-background-cards" aria-hidden="true"><span>♠</span><span>♣</span></div><header className="site-header lobby-header"><GameLogo/><HeaderRoomCode code={room.code}/><div className="header-actions"><span className="lobby-tag">LOBBY</span><button className="button outline small" onClick={() => setModal('leave')} aria-label="Leave lobby">Leave<span className="lobby-leave-context"> lobby</span></button>{account.entitlements.voiceChat&&<button className="icon-button" onClick={() => setModal('settings')} aria-label="Voice chat" title="Voice chat"><Headphones size={21}/></button>}<button className="icon-button" onClick={() => setModal('settings')} aria-label="Sound and settings"><Settings size={22}/></button></div></header><main className="lobby-main"><div className="lobby-title"><div><h1>{host&&<PlayerName name={host.name} fontId={host.fontId}/>}’s table {isHost && <span className="host-label">HOST</span>}</h1><p>{room.players.length} of 8 players joined</p></div><GamesButton count={activeGames.length} turns={waitingGames} onOpen={openGames} className="lobby-games-button"/></div><div className="lobby-grid"><div className="lobby-left"><section className="players-panel panel"><div className="panel-title"><h2>Players</h2><span className="ready-label"><span className="check-circle"><Check size={15}/></span>{room.players.every(p=>p.ready) ? 'Everyone is ready' : 'Waiting for players'}</span></div><div className="lobby-players">{room.players.map(p => <div className={`lobby-player ${p.id===room.youId ? 'your-seat' : ''}`} key={p.id}><Avatar name={p.name} color={p.color} bot={p.isBot} symbolId={p.symbolId}/><div className="player-info"><strong><PlayerName name={p.name} fontId={p.fontId}/>{p.id === room.youId ? ' · You' : ''}</strong>{p.id===room.hostId && <span className="host-label">Host</span>}<div className="player-ready"><span className="check-circle"><Check size={13}/></span>{p.isBot ? `AI · ${p.difficulty[0].toUpperCase()+p.difficulty.slice(1)}` : p.ready ? 'Ready' : 'Not ready'}</div></div>{isHost && p.id !== room.youId && <div className="player-menu-container"><button className="icon-button player-more" aria-label={`Manage ${p.name}`} aria-expanded={openPlayerMenu===p.id} onClick={() => setOpenPlayerMenu(openPlayerMenu===p.id ? null : p.id)}><MoreVertical size={23}/></button>{openPlayerMenu===p.id && <div className="player-menu">{p.isBot && <><label htmlFor={`difficulty-${p.id}`}>AI difficulty</label><select id={`difficulty-${p.id}`} value={p.difficulty} onChange={e=>doAction({type:'setDifficulty',playerId:p.id,difficulty:e.target.value as Difficulty})} disabled={!!busy}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></>}<button onClick={()=>doAction({type:'removePlayer',playerId:p.id})} disabled={!!busy}><X size={16}/>Remove player</button><button onClick={()=>setOpenPlayerMenu(null)}>Close</button></div>}</div>}</div>)}</div>
          {room.players.length<8 && <div className="open-seats"><div className="open-seat-avatars">{Array.from({length:Math.min(4,8-room.players.length)},(_,i)=><button key={i} className="open-seat-avatar" onClick={() => isHost ? setAddingAI(!addingAI) : void share()} aria-label={isHost ? 'Add an AI player to an open seat' : 'Invite a player to an open seat'}><UserRound size={26}/>{isHost && <Plus size={13} className="seat-plus"/>}</button>)}</div><div className="open-seat-copy"><strong>{8-room.players.length} seats open</strong><span>Room for up to 8 players</span>{isHost && <button className="text-link add-ai-link" onClick={() => setAddingAI(!addingAI)} aria-expanded={addingAI}><Bot size={15}/>Add an AI player</button>}</div></div>}
          {addingAI && isHost && room.players.length<8 && <div className="add-ai-panel"><div><strong><Bot size={19}/>Add an AI player</strong><p>Choose a difficulty for this player.</p></div><label className="sr-only" htmlFor="new-bot-difficulty">AI difficulty</label><select id="new-bot-difficulty" value={botDifficulty} onChange={e=>setBotDifficulty(e.target.value as Difficulty)}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select><button className="button gold small" onClick={async()=>{await doAction({type:'addBot',difficulty:botDifficulty});setAddingAI(false);}} disabled={!!busy}>{busy==='addBot' ? <Spinner text="Adding…"/> : <><Plus size={17}/>Add player</>}</button><button className="icon-button" onClick={()=>setAddingAI(false)} aria-label="Cancel adding AI"><X size={18}/></button></div>}
        </section><section className="lobby-rules panel"><div className="lobby-rules-heading"><h2>Game rules</h2><GameTabs value={room.game} onChange={game=>doAction({type:'setGame',game})} disabled={!isHost || !!busy} originalRulesUnlocked={account.entitlements.originalRules} onLockedOriginal={()=>notify('Original Rules is a one-off A$0.99 host unlock. Open the Store to unlock it; your guests join free.',true)}/><button className="text-link" onClick={()=>{setRulesGame(room.game);setModal('rules');}}>View 10 rules<ChevronRight size={20}/></button></div><div className="lobby-rule-notes"><span><Ban/>3s and 4s removed</span><span><Star fill="currentColor"/>2s are wild</span><p>Guests use the host’s<br/>selected rules.</p></div><div className="turn-limit-setting"><label htmlFor="turn-limit"><Timer size={17}/><span>Time per turn</span></label><select id="turn-limit" value={room.turnLimitSeconds} onChange={e=>doAction({type:'setTurnLimit',seconds:Number(e.target.value)})} disabled={!isHost||!!busy}><option value={0}>Unlimited</option><option value={30}>30 seconds</option><option value={60}>60 seconds</option><option value={90}>90 seconds</option><option value={120}>2 minutes</option></select>{room.turnLimitSeconds>0&&<small>Time runs out? A card is drawn if needed, then discarded, and play moves on.</small>}</div><div className="move-hints-setting"><div className="move-hints-copy"><label id="move-hints-label" htmlFor="move-hints-toggle"><Sparkles size={17}/>Show valid moves</label><small id="move-hints-description">Highlight matching places when a card is selected. Applies to every player.</small></div><div className="move-hints-control"><span aria-hidden="true">{showMoveHints?'On':'Off'}</span><button type="button" id="move-hints-toggle" className={`toggle ${showMoveHints?'on':''}`} role="switch" aria-checked={showMoveHints} aria-labelledby="move-hints-label" aria-describedby="move-hints-description" disabled={!isHost||!!busy} onClick={()=>doAction({type:'setMoveHints',enabled:!showMoveHints})}><span/></button></div>{!isHost&&<small className="move-hints-host-note">Chosen by the host</small>}</div></section></div>
          <aside className="invite-panel panel"><h2>Invite players</h2><p>Share a link or scan to join.</p><div className="room-code-box"><label>ROOM CODE</label><div><strong>{room.code}</strong><button className="icon-button" onClick={()=>copy(room.code,'Room code copied.')} aria-label="Copy room code"><Copy size={21}/></button></div></div><div className="qr-row"><div className="qr-wrap">{inviteLink ? <InviteQR value={inviteLink} size={168}/> : <div className="qr-loading"><LoaderCircle className="spin"/></div>}</div><p>Scan with a<br/>phone camera</p></div><InviteActions inviteLink={inviteLink} hostName={host?.name} onShare={share} onCopy={()=>copy(inviteLink,'Invite link copied.')}/><div className="invite-instructions"><span>Open invite → enter name → join</span><small>No account needed</small></div><details className="direct-link-details"><summary>Invitation link</summary><input aria-label="Invitation link" value={inviteLink} readOnly onFocus={e=>e.target.select()}/></details></aside>
        </div><AdSlot surface="lobby" adFree={account.entitlements.removeAds}/><footer className="lobby-start panel"><span className="check-circle large"><Check size={25}/></span><div><strong>{room.players.length<2 ? 'Your table is ready' : room.players.every(p=>p.ready) ? 'Everyone is ready' : 'Waiting for players'}</strong><p>{isHost ? room.players.length<2 ? 'Invite a friend or add an AI player' : 'Start now or invite more friends' : `Waiting for ${host?.name} to start`}</p></div>{isHost ? <button className="button gold" disabled={room.players.length<2 || !room.players.every(p=>p.ready) || !!busy} onClick={()=>{playSound('shuffle');void doAction({type:'start'});}}>{busy==='start' ? <Spinner text="Dealing cards…"/> : <>Start with {room.players.length} players<ArrowRight size={24}/></>}</button> : <span className="waiting-host"><LoaderCircle className="spin" size={18}/>Waiting for the host</span>}</footer></main></div>}

    {(!room || room.status === 'lobby') && <footer className="developer-footer" aria-label="Game developer"><DeveloperCredit/></footer>}

    {room && room.status !== 'lobby' && <>
      <header className="site-header game-header"><GameLogo/><HeaderRoomCode code={room.code}/><nav className="table-tabs" aria-label="Game view"><button className={pane==='table'?'active':''} onClick={()=>setPane('table')} aria-pressed={pane==='table'}>Table</button><button className={pane==='scores'?'active':''} onClick={()=>{setPane('scores');setRulesGame(room.game);}} aria-pressed={pane==='scores'}>Rules &amp; Scores</button></nav><div className="game-header-details"><GamesButton count={activeGames.length} turns={waitingGames} onOpen={openGames} className="header-games-button"/><button className="game-pill" onClick={()=>{setRulesGame(room.game);setModal('rules');}}>{gameLabel(room.game)}<ChevronRight size={14}/></button><span>{room.players.length} players</span><button className="button outline exit-game-button" onClick={home} title="Exit to the start screen. Your seat stays saved."><LogOut size={17}/><span>Exit game</span></button>{account.entitlements.voiceChat&&<button className="icon-button" onClick={()=>setModal('settings')} aria-label="Voice chat" title="Voice chat"><Headphones size={23}/></button>}<button className="icon-button" onClick={()=>setModal('settings')} aria-label="Settings"><Settings size={25}/></button></div></header>
      {needsGameUpdate && <div className="connection-banner game-update-banner" role="alert"><Sparkles size={18}/><span>A game update is ready. Reload to show your current rule. Your seat and cards are saved.</span><button className="button gold" onClick={()=>window.location.reload()}>Reload game</button></div>}
      {!online && !needsGameUpdate && <div className="connection-banner" role="status"><WifiOff size={17}/>Reconnecting… Your seat and game are saved.</div>}
      {pane==='table' ? <main className={`table-main ${room.players.length>4?'eight-players':''}`} data-room-key={`${room.code}:${room.round}:${room.youId}`}>
        <section className="opponents" aria-label="Other players’ hands">{room.players.filter(p=>p.id!==room.youId).map(p=><div className={`opponent panel ${p.id===room.turnPlayerId && room.status==='playing'?'active-turn':''}`} key={p.id}><div className="opponent-heading"><Avatar name={p.name} color={p.color} bot={p.isBot} symbolId={p.symbolId}/><div><strong><PlayerName name={p.name} fontId={p.fontId}/>{p.id===room.turnPlayerId && room.status==='playing' && <span className="turn-dot" title="Current turn"/>}{p.id===room.turnPlayerId&&turnCountdown}</strong><p>Rule {ruleNumberFor(p,room.round)} / 10 <span>|</span>{p.down?'DOWN':'NOT DOWN'}<span>|</span>{p.score} pts</p></div></div><div className="opponent-hand"><span>Cards in hand</span><div className="card-backs" data-player-hand={p.id} aria-label={`${p.name} has ${p.handCount} cards`} style={{'--back-count':Math.max(1,p.handCount)} as CSSProperties}>{Array.from({length:p.handCount},(_,i)=><CardBack key={i}/>)}{p.handCount===0 && <span className="empty-hand">Hand empty <Check size={16}/></span>}</div></div></div>)}</section>
        <div className="table-content"><aside className="table-sidebar panel"><section className="your-rule inset-panel"><h3>YOUR RULE</h3><div className="big-rule-number">{currentRuleNumber} / 10</div><p>{currentRule?.title}</p>{me?.down ? <small className="layoff-rule-note">Add matching numbers to sets or extend runs. Any colour or suit.</small> : room.game!==1 && <small>{currentRule?.description}</small>}<div className="requirement-tags">{currentRule?.requirements.map((req,i)=><span className={me?.down?'complete':''} key={i}>{req.kind==='set'?'Set':'Run'}{me?.down && <Check size={15}/>}</span>)}</div><StatusBadge down={!!me?.down}/></section>{!mobileTable && drawPiles}<Scoring compact/>{room.status==='playing' && <div className="sidebar-turn-note"><span className={isTurn?'gold-text':''}>{isTurn?'YOUR TURN':`${currentPlayer?.name}’s turn`}</span>{turnCountdown}<p>{room.phase==='draw'?'Draw a card':'Play or discard'}</p></div>}</aside>
          <div className="table-center"><div className="table-area-heading"><h2>Cards on the table</h2>{showMoveHints?(targets.length?<button className="target-shortcut text-link" onClick={()=>document.querySelector('.meld-target')?.scrollIntoView({behavior:'smooth',block:'center',inline:'center'})}>{targets.length} valid place{targets.length===1?'':'s'} to add<ChevronRight size={13}/></button>:<span>Select cards to see valid moves</span>):<span>Hints off · Choose a set or run end to play</span>}{(room.status==='round-end'||room.status==='finished')&&<button className="text-link" onClick={()=>setShowResult(true)} disabled={winningCardActive} aria-busy={winningCardActive}><Trophy size={17}/>{winningCardActive?'Winning card…':'Hand results'}</button>}</div><div className="meld-table">{[me,...room.players.filter(p=>p.id!==room.youId)].filter((p):p is PublicPlayer=>!!p).map(p=><section key={p.id} data-meld-owner={p.id} className={`meld-zone panel ${p.id===room.youId?'your-meld-zone':''}`}><div className="meld-owner"><Avatar name={p.name} color={p.color} bot={p.isBot} symbolId={p.symbolId}/><strong><PlayerName name={p.name} fontId={p.fontId}/>{p.id===room.youId&&<span> · You</span>}</strong><StatusBadge down={p.down} winner={p.handCount===0}/></div><div className="player-melds">{room.melds.filter(m=>m.ownerId===p.id).length ? room.melds.filter(m=>m.ownerId===p.id).map(meld=><MeldGroup key={meld.id} meld={meld} targets={targets} activeTarget={activeTarget} hintsEnabled={showMoveHints} manualAvailable={targetCards.length>0&&canLayoff(room)} selectionCount={targetCards.length} onTarget={target=>{if(targetCards.length)playCardsToMeld(targetCards.map(card=>card.id),target);}} busy={!!busy}/>) : <div className="meld-empty"><div aria-hidden="true">{Array.from({length:Math.min(7,RULES[room.game][ruleNumberFor(p,room.round)-1].requirements.reduce((s,r)=>s+r.count,0))},(_,i)=><span key={i}/>)}</div><p>{p.id===room.youId?'Build your opening meld':'Building their opening meld'}</p></div>}</div></section>)}</div>
          <section className={`your-hand panel ${isTurn?'hand-your-turn':''}`} aria-label="Your hand"><div className="hand-status"><span className={isTurn?'turn-label':'waiting-label'}>{room.status!=='playing'?'HAND COMPLETE':isTurn?'YOUR TURN':`${currentPlayer?.name}’S TURN`}</span>{turnCountdown}<p aria-live="polite">{turnHint}</p><button type="button" className="text-link clear-hand-selection" data-hidden={selected.length === 0 ? "true" : undefined} disabled={selected.length === 0} tabIndex={selected.length === 0 ? -1 : 0} aria-hidden={selected.length === 0} onClick={() => { setSelected([]); setSelectedTarget(null); }} aria-label={`Clear ${selected.length} selected cards`}><X size={14}/><span>Clear ({selected.length})</span></button>{mobileTable && <GamesButton count={activeGames.length} turns={waitingGames} onOpen={openGames} className="mobile-games-button"/>}</div>{mobileTable && drawPiles}<div className="hand-layout"><div className="your-hand-player"><Avatar name={me?.name??''} color={me?.color} symbolId={me?.symbolId}/><div><strong><PlayerName name={me?.name??''} fontId={me?.fontId}/><span> · You</span></strong><b>{me?.score} pts</b><span className="hand-card-count">{room.hand.length} cards</span><small>Hand value: {handPoints(room.hand)} pts</small></div></div><HandCards
              key={handKey(room)}
              cards={sortedHand}
              selected={selected}
              roomKey={handInteractionKey(room)}
              renderCard={card=><CardFace card={card}/>}
              onSelect={toggleCard}
              onReorder={reorderHand}
              onDragCardChange={setDraggedCardId}
              onPlayCard={playCardToMeld}
              onDiscardCard={discardCard}
            /><div className="hand-actions">{me?.down?<button className="button gold" disabled={!isTurn||!canLayoff(room)||!!busy||(showMoveHints?!activeTarget:selectedCards.length===0)} onClick={()=>{if(showMoveHints){if(activeTarget&&selectedCards.length)playCardsToMeld(selectedCards.map(card=>card.id),activeTarget);}else{const place=document.querySelector<HTMLButtonElement>('.meld-target-manual');place?.scrollIntoView({behavior:'smooth',block:'center',inline:'center'});place?.focus({preventScroll:true});}}}>{busy==='layoff'?<Spinner text="Adding…"/>:showMoveHints?'Add selected':'Choose place'}</button>:<button className="button gold" disabled={!canGoDown(room)||!selectionMeld||!!busy} onClick={()=>doAction({type:'goDown',cardIds:selected,expectedRuleNumber:currentRuleNumber})}>{busy==='goDown'?<Spinner text="Playing…"/>:'Go down'}</button>}<button className="button outline" disabled={!isTurn||room.phase!=='play'||selected.length!==1||!!busy} onClick={()=>{if(selected[0])discardCard(selected[0]);}}>Discard</button><SortControl mode={sortMode} direction={sort} onSort={sortHand} onModeChange={updateSortMode}/></div></div></section>
          {room.events.length>0 && <div className="last-event" aria-live="polite">{room.events.at(-1)?.text}</div>}
          </div></div>
      </main> : <main className="scores-main">
        <div className="scores-heading"><div><h1>Rules &amp; Scores</h1><p>Go down to advance. No meld means repeating your current rule.</p></div><GameTabs value={rulesGame} onChange={setRulesGame}/><button className="button outline" onClick={()=>setPane('table')}><ArrowLeft size={20}/>Back to table</button></div>
        <div className="scores-grid"><div className="scores-left">
          <PlayerScores room={room}/><Scoring/><AdSlot surface="scores" adFree={account.entitlements.removeAds}/>
          {room.history.length > 0 && <section className="history-panel panel"><h2>Completed hands</h2>{room.history.map(result => <details key={result.round}>
            <summary><span>Hand {result.round} · {result.winnerName} went out</span><ChevronRight size={18}/></summary>
            <div className="history-scores">{result.scores.map(row => <div key={row.playerId}>
              <strong>{row.name}</strong><span>+{row.penalty} points</span><b>{row.total} total</b>
              {row.ruleNumber !== undefined && <small className={`history-rule-outcome ${row.melded ? 'rule-advanced' : ''}`}>{ruleOutcome(row,result.round,room.status === 'finished' && result.round === room.round)}</small>}
            </div>)}</div>
          </details>)}</section>}
        </div><aside className="full-rule-panel panel"><h2>{gameLabel(rulesGame)} · Rule list</h2>
          <RuleList game={rulesGame} current={rulesGame===room.game?currentRuleNumber:undefined} players={rulesGame===room.game?room.players:undefined} fallbackRound={room.round} youId={room.youId}/>
          <p className="rule-panel-note">{rulesGame===room.game?'Your rule is highlighted. Avatars show each player’s current rule.':`Your table is playing ${gameLabel(room.game)}. Viewing the ${gameLabel(rulesGame)} rule list.`}</p>
        </aside></div>
      </main>}

    </>}

    <TurnAlert turnKey={ownTurnAlertKey(room)} active={isTurn} visible={!winningCardActive} vibrationEnabled={turnVibration}/>
    {modal==='games'&&<Modal title="Switch game" onClose={()=>setModal(null)} className="games-modal">{gameList}<button className="button gold another-game-button" onClick={home} disabled={!!busy}><Plus size={19}/>Create or join another game</button><p className="games-device-note">{account.user ? 'Sign in with the same Google account on another device to open these games. Your card order is remembered on each device.' : 'Guest tables are saved in this browser. Sign in before starting a new game to play across devices.'}</p></Modal>}
    {modal==='settings'&&<Modal title="Settings" onClose={()=>setModal(null)} className="settings-modal"><AccountControls account={account} compact disabled={!!busy}/><VoiceChatPanel account={account} roomCode={room?.code}/><div className="settings-row"><div><strong><Volume2 size={19}/>Game sound</strong><p>Card effects and background music</p></div><button className={`toggle ${!audio.muted?'on':''}`} role="switch" aria-checked={!audio.muted} aria-label="Game sound" onClick={()=>updateAudio({muted:!audio.muted})}><span/></button></div><div className="settings-row range-setting"><label htmlFor="effects-volume">Sound effects <span>{Math.round(audio.volume*100)}%</span></label><input type="range" id="effects-volume" min="0" max="1" step=".05" value={audio.volume} onChange={e=>updateAudio({volume:Number(e.target.value)})} onPointerUp={()=>playSound('card')} disabled={audio.muted}/></div><div className="settings-row"><div><strong><Music2 size={19}/>Background music</strong><p>A gentle soundtrack for your table</p></div><button className={`toggle ${audio.musicEnabled?'on':''}`} role="switch" aria-checked={audio.musicEnabled} aria-label="Background music" onClick={()=>updateAudio({musicEnabled:!audio.musicEnabled})}><span/></button></div><div className="settings-row range-setting"><label htmlFor="music-volume">Music volume <span>{Math.round(audio.musicVolume*100)}%</span></label><input type="range" id="music-volume" min="0" max="1" step=".02" value={audio.musicVolume} onChange={e=>updateAudio({musicVolume:Number(e.target.value)})} disabled={audio.muted||!audio.musicEnabled}/></div><div className="settings-row"><div><strong><Smartphone size={19}/>Vibrate on your turn</strong><p>A short buzz on supported phones</p></div><button className={`toggle ${turnVibration?'on':''}`} role="switch" aria-checked={turnVibration} aria-label="Vibrate on your turn" onClick={()=>setTurnVibrationEnabled(!turnVibration)}><span/></button></div><div className="settings-row sort-setting"><div><strong><ArrowUpDown size={19}/>Hand order</strong><p>Sort follows this direction. Hold Sort to choose number, colour or suit. Twos finish each group.</p></div><div className="segmented"><button className={sort==='descending'?'active':''} aria-pressed={sort==='descending'} onClick={()=>updateSort('descending')}>High → low</button><button className={sort==='ascending'?'active':''} aria-pressed={sort==='ascending'} onClick={()=>updateSort('ascending')}>Low → high</button></div></div><div className="settings-games-row"><button className="button outline" onClick={openGames}><Layers3 size={19}/>Your games<span>{activeGames.length}</span></button><p>Switch tables or create another game. Your seats stay saved.</p></div><p className="settings-save-note">Your preferences are remembered on this device.</p><button className="button gold" onClick={()=>setModal(null)}>Done</button>{room&&<button className="text-link settings-home" onClick={()=>room.status==='lobby'?setModal('leave'):home()}><LogOut size={17}/>{room.status==='lobby'?'Leave lobby':'Exit game'}{room.status!=='lobby'&&<small>Your seat stays saved</small>}</button>}<DeveloperCredit/></Modal>}
    {modal==='rules'&&<Modal title="Game rules" onClose={()=>setModal(null)} className="rules-modal"><GameTabs value={rulesGame} onChange={setRulesGame}/><RuleList game={rulesGame} current={room&&room.game===rulesGame&&room.status!=='lobby'?currentRuleNumber:undefined} players={room&&room.game===rulesGame&&room.status!=='lobby'?room.players:undefined} fallbackRound={room?.round} youId={room?.youId}/><div className="rules-modal-note"><Star size={19}/>Twos are wild · No threes, fours or jokers</div><div className="rules-modal-note rule-progress-note"><ArrowRight size={19}/><span>Go down during the round to advance one rule. Without a meld, repeat your current rule next hand.</span></div><div className="rules-modal-note"><Plus size={19}/><span>Opening requirements apply when going down. Later additions follow set numbers or run order, in any colour or suit. Twos are wild for later additions.</span></div>{rulesGame===4&&<div className="rules-modal-note"><Sparkles size={19}/><span>Original Rule 5 is the exception: its alternating red/black pattern must continue after laydown.</span></div>}{room&&<div className="rules-modal-note move-hints-rule-note"><Sparkles size={19}/>Move hints: {showMoveHints?'On':'Off'} · Chosen by the host in the lobby</div>}</Modal>}
    {modal==='how'&&<Modal title="How to play Parkes Rummy" onClose={()=>setModal(null)} className="how-modal"><a className="button gold how-tutorial-link" href="/tutorial"><Sparkles size={18}/>Learn with a practice hand<ArrowRight size={18}/></a><p className="modal-intro">Your friends. Ten rules. The lowest score wins.</p><div className="how-steps"><div><span>1</span><div><h3>Take a seat</h3><p>Create a table and share the invite link or QR. Play with 2–8 people, including optional AI players. The host chooses Game 1, Game 2 or Game 3.</p></div></div><div><span>2</span><div><h3>Draw, play, discard</h3><p>Everyone receives 10 cards. On your turn, tap either pile to draw, or hold and drag a card from a pile into your preferred hand position. Play eligible cards, then discard one. No going down on your first turn.</p></div></div><div><span>3</span><div><h3>Meet your current rule</h3><p>Select exactly the cards required by the rule and press <b>Go down</b>. Game 1 runs allow mixed suits. Games 2 and 3 add colour, suit and wildcard requirements shown with each rule. Ace follows king; twos are wild unless the opening requires natural cards.</p></div></div><div><span>4</span><div><h3>Add to the shared table</h3><p>From your next turn after going down, add matching numbers to sets or extend runs in number order. Colour and suit restrictions apply to the opening only. Twos are wild for later additions. Select several cards and tap one set or run end to add the whole group. Hold and drag an individual card to move or play. The host chooses whether valid places are highlighted. A laid two keeps its assigned value.</p></div></div><div><span>5</span><div><h3>Empty your hand</h3><p>The first empty hand ends the round. Everyone else scores their remaining cards. Players who went down advance to their next rule; everyone else repeats their current rule. The game ends after a round where someone melds Rule 10. Lowest total wins; equal lowest scores share the win.</p></div></div></div><Scoring/><button className="button gold" onClick={()=>{setRulesGame(room?.game??1);setModal('rules');}}>See the 10 rules<ChevronRight size={20}/></button></Modal>}
    {modal==='leave'&&<Modal title="Leave the lobby?" onClose={()=>setModal(null)} className="leave-modal"><p>Your seat will become available for another player.{isHost&&room&&room.players.length>1?' The next player becomes the host.':''}</p><div className="modal-buttons"><button className="button outline" onClick={()=>setModal(null)}>Stay at the table</button><button className="button gold" onClick={leave} disabled={!!busy}>{busy==='leave'?<Spinner text="Leaving…"/>:<><LogOut size={18}/>Leave lobby</>}</button></div></Modal>}
    {modal==='delete-game'&&deleteTarget&&<Modal title="Delete this game?" onClose={cancelDeleteGame} className="leave-modal delete-game-modal"><p>Remove room <strong>{deleteTarget.code}</strong> from {account.user ? 'your account’s game list on all devices' : 'your games on this device'}?</p><p>{account.user ? 'Your saved game will be hidden from your account. Open the room link to return. Other players keep their game.' : 'Your saved seat and card order will be deleted. Returning to the same seat will no longer be available in this browser. Other players keep their game.'}</p><div className="modal-buttons"><button type="button" className="button outline" onClick={cancelDeleteGame}>Keep game</button><button type="button" className="button gold" onClick={() => { void deleteSavedGame(); }} disabled={!!busy}>{busy === 'delete-game' ? <Spinner text="Removing…"/> : <><Trash2 size={18}/>Delete game</>}</button></div></Modal>}
    {room&&showResult&&!modal&&(room.status==='round-end'||room.status==='finished')&&room.result&&<Modal title={room.status==='finished'?'Final scores':`Hand ${room.round} complete`} onClose={()=>setShowResult(false)} className="result-modal"><RoundResults room={room} isHost={isHost} busy={busy} onAction={doAction} onRematch={()=>{void rematchSavedGame(room.code);}} onDelete={()=>requestDeleteGame(room.code)} onScores={()=>{setShowResult(false);setPane('scores');setRulesGame(room.game);}}/><AdSlot surface={room.status==='finished'?'final-result':'round-result'} adFree={account.entitlements.removeAds}/></Modal>}
    {toast&&<div className={`toast ${toast.error?'toast-error':''}`} role={toast.error?'alert':'status'}><span>{toast.error?<CircleHelp size={21}/>:<Check size={21}/>}</span><p>{toast.text}</p><button onClick={()=>setToast(null)} aria-label="Dismiss notification"><X size={18}/></button></div>}
  </div>;
}

function MeldGroup({ meld, targets, activeTarget, hintsEnabled, manualAvailable, selectionCount, onTarget, busy }: {
  meld: Meld;
  targets: GroupLayoffTarget[];
  activeTarget: Pick<LayoffTarget, 'meldId' | 'end'> | null;
  hintsEnabled: boolean;
  manualAvailable: boolean;
  selectionCount: number;
  onTarget: (target: Pick<LayoffTarget, 'meldId' | 'end'>) => void;
  busy: boolean;
}) {
  const start = hintsEnabled ? targets.find(target => target.meldId === meld.id && target.end === 'start') : undefined;
  const end = hintsEnabled ? targets.find(target => target.meldId === meld.id && target.end === 'end') : undefined;
  const manual = !hintsEnabled && manualAvailable;
  const renderTarget = (endPosition: 'start' | 'end', hint?: GroupLayoffTarget) => {
    const chosen = !!hint && activeTarget?.meldId === meld.id && activeTarget.end === endPosition;
    const selectionLabel = selectionCount > 1 ? `${selectionCount} selected cards` : 'the selected card';
    const additionLabel = hint?.cards.map(card => briefCard(card.asRank ?? card.rank, card.asSuit ?? card.suit)).join(', ');
    return <button
      type="button"
      data-meld-target=""
      data-meld-id={meld.id}
      data-meld-end={endPosition}
      className={`meld-target ${hint ? 'meld-target-hint' : 'meld-target-manual'} ${chosen ? 'target-selected' : ''}`}
      disabled={busy}
      onClick={() => onTarget({ meldId: meld.id, end: endPosition })}
      aria-label={hint ? `Add ${additionLabel} to the ${endPosition} of this ${meld.kind}` : meld.kind === 'set' ? `Try adding ${selectionLabel} to this set` : `Try adding ${selectionLabel} to the ${endPosition} of this run`}
    >
      <Plus size={27}/>
      <span>{hint ? hint.cards.length > 1 ? `Add ${hint.cards.length}` : `Add ${briefCard(hint.asRank, hint.asSuit)}` : meld.kind === 'set' ? 'Add' : endPosition === 'start' ? 'Start' : 'End'}</span>
    </button>;
  };
  return <div className="meld-group" data-meld-id={meld.id}>
    <label>{meld.kind.toUpperCase()}</label>
    <div className="meld-cards">
      {(start || (manual && meld.kind === 'run')) && renderTarget('start', start)}
      {meld.cards.map(card => <div className="exposed-card-wrap" data-table-card={card.id} key={card.id}>
        <CardFace card={card}/>
        {card.rank === 2 && card.asRank !== undefined && <small className="wild-assignment">{briefCard(2, card.suit)} = {briefCard(card.asRank, card.asSuit ?? card.suit)}</small>}
      </div>)}
      {(end || manual) && renderTarget('end', end)}
    </div>
  </div>;
}

function RoundResults({room,isHost,busy,onAction,onRematch,onDelete,onScores}:{room:PublicRoom;isHost:boolean;busy:string;onAction:(action:GameAction,label?:string)=>Promise<void>;onRematch:()=>void;onDelete:()=>void;onScores:()=>void}) {
  const result=room.result!;
  const finished=room.status==='finished';
  const lowest=Math.min(...room.players.map(p=>p.score));
  const winners=room.players.filter(p=>p.score===lowest);
  const host=room.players.find(p=>p.id===room.hostId);
  const me=room.players.find(p=>p.id===room.youId);
  const myScore=result.scores.find(row=>row.playerId===room.youId);
  const advanced=myScore?.melded??me?.down??false;
  const nextRuleNumber=myScore?.nextRuleNumber??Math.min(10,ruleNumberFor(me,room.round)+(advanced?1:0));
  return <>
    <div className="result-hero"><span className="trophy-circle"><Trophy size={39}/></span><h3>{finished?`${winners.map(p=>p.name).join(' & ')} ${winners.length>1?'win':'wins'}!`:`${result.winnerName} went out!`}</h3><p>{finished?`The lowest score wins · ${lowest} points${winners.length>1?' · Shared victory':''}`:'Cards left in hand have been added to everyone’s score.'}</p></div>
    <div className="result-table"><div className="result-table-head"><span>PLAYER</span><span>THIS HAND</span><span>TOTAL</span></div>{[...result.scores].sort((a,b)=>a.total-b.total).map(row=><div className="result-row" key={row.playerId}>
      <div><Avatar name={row.name} color={room.players.find(p=>p.id===row.playerId)?.color} className="small" symbolId={room.players.find(p=>p.id===row.playerId)?.symbolId}/><strong><PlayerName name={row.name} fontId={room.players.find(p=>p.id===row.playerId)?.fontId}/>{row.playerId===room.youId?' · You':''}</strong></div><span className={row.penalty===0?'zero-penalty':''}>+{row.penalty}</span><b>{row.total}</b>
      <p className={`result-rule-outcome ${row.melded?'rule-advanced':''}`}>{ruleOutcome(row,result.round,finished)}</p>
      {row.cards.length>0&&<details className="result-cards"><summary>Cards remaining</summary><div>{row.cards.map(card=><CardFace key={card.id} card={card}/>)}</div></details>}
    </div>)}</div>
    {!finished&&<p className="next-rule-note"><span>{advanced?'YOUR NEXT RULE':'REPEAT YOUR RULE'} · {nextRuleNumber} / 10</span>{RULES[room.game][nextRuleNumber-1].title}</p>}
    {isHost?<button className="button gold" disabled={!!busy} onClick={()=>finished?onRematch():onAction({type:'nextHand'})}>{busy?<Spinner text={finished?'Opening lobby…':'Dealing…'}/>:finished?<><RefreshCw size={20}/>Rematch</>:<>Deal hand {room.round+1}<ArrowRight size={21}/></>}</button>:<p className="waiting-host">{finished?`${host?.name ?? 'The host'} starts the rematch.`:<><LoaderCircle size={17} className="spin"/>Waiting for {host?.name} to deal the next hand</>}</p>}
    {finished&&<><p className="games-device-note result-rematch-note">A rematch keeps the players and settings, with scores reset to zero.</p><button type="button" className="button outline result-delete-game" onClick={onDelete} disabled={!!busy}><Trash2 size={18}/>Delete game from my list</button></>}
    <button className="text-link result-scores-link" onClick={onScores}>View rules &amp; scores<ChevronRight size={17}/></button>
  </>;
}
