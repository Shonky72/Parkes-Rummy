'use client';

import { useEffect, useMemo, useReducer, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Bot, Check, RotateCcw, Settings, Sparkles, Trophy, X } from 'lucide-react';
import type { Card } from '../../lib/types';
import { RULES } from '../../lib/rummy';
import { getAudioSettings, initAudio, playSound, setAudioSettings } from '../../lib/audio';
import { getSort, getSortMode, rememberSort, rememberSortMode, type HandSort, type HandSortMode } from '../../lib/client';
import { sortCards } from '../../lib/hand-order';
import { markTutorialCompleted } from '../../lib/tutorial-progress';
import { tutorialCoachingStep } from '../../lib/tutorial-coaching';
import {
  initialTutorialState, reduceTutorial, tutorialDiscardReady, tutorialExpectedCardIds,
  tutorialLayoffTarget, tutorialOpeningReady, TUTORIAL_AI_PENALTY,
} from '../../lib/tutorial';
import GameLogo from './GameLogo';
import BackgroundSuits from './BackgroundSuits';
import SortControl from './SortControl';
import TutorialRulesVisual from './TutorialRulesVisual';
import TutorialSettings from './TutorialSettings';
import TutorialCoach from './TutorialCoach';
import '../tutorial-coach.css';

const suitMark = { C: '♣', D: '♦', H: '♥', S: '♠' } as const;
const suitName = { C: 'clubs', D: 'diamonds', H: 'hearts', S: 'spades' } as const;
const rankMark = (rank: number) => ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' } as Record<number, string>)[rank] || String(rank);
const cardName = (card: Card) => rankMark(card.rank) + ' of ' + suitName[card.suit] + (card.rank === 2 ? ', wild' : '');

function PracticeCard({ card }: { card: Card }) {
  return <span className={'card-face ' + (card.suit === 'D' || card.suit === 'H' ? 'red' : 'black') + (card.rank === 2 ? ' wild' : '')} role="img" aria-label={cardName(card)}>
    <span className="card-corner"><b>{rankMark(card.rank)}</b><span>{suitMark[card.suit]}</span></span>
    <span className="card-centre" aria-hidden="true">{suitMark[card.suit]}</span>
    {card.rank === 2 && <span className="wild-badge">WILD</span>}
  </span>;
}

export default function TutorialGame() {
  const [state, dispatch] = useReducer(reduceTutorial, undefined, initialTutorialState);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [sortMode, setSortMode] = useState<HandSortMode>('number');
  const [direction, setDirection] = useState<HandSort>('descending');
  const [sorted, setSorted] = useState(false);
  const [muted, setMuted] = useState(false);
  const [feedback, setFeedback] = useState('');
  const won = state.phase === 'won';
  const busy = settingsOpen || rulesOpen || won;

  useEffect(() => {
    setSortMode(getSortMode()); setDirection(getSort()); setMuted(getAudioSettings().muted);
    const button = document.querySelector('[data-tutorial-sort] .sort-button');
    if (!button) return;
    const update = () => setSortMenuOpen(button.getAttribute('aria-expanded') === 'true');
    const observer = new MutationObserver(update);
    observer.observe(button, { attributes: true, attributeFilter: ['aria-expanded'] });
    update();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (won) { markTutorialCompleted(); playSound('roundWin'); }
  }, [won]);

  // A settings, rules or result dialog is the only popup while open.
  useEffect(() => {
    if (!busy) return;
    const before = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const dialog = document.querySelector<HTMLElement>('.tutorial-app [role="dialog"]');
    const selector = 'button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]';
    dialog?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
    const trap = (event: KeyboardEvent) => {
      if (!dialog || event.key !== 'Tab') return;
      const items = [...dialog.querySelectorAll<HTMLElement>(selector)];
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', trap);
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, [busy, settingsOpen, rulesOpen]);

  const expectedIds = tutorialExpectedCardIds(state);
  const target = tutorialLayoffTarget(state);
  const discardReady = tutorialDiscardReady(state);
  const openingReady = tutorialOpeningReady(state);
  const isDrawingStock = state.phase === 'first-draw' || state.phase === 'third-draw';
  const isDrawingDiscard = state.phase === 'second-draw';
  const canSelect = ['first-discard', 'opening', 'second-discard', 'layoff', 'final-discard'].includes(state.phase);
  const opponentDown = state.opponentRun.length > 0;
  const coach = busy ? null : tutorialCoachingStep(state, sortMenuOpen);
  const visibleHand = useMemo(() => sorted ? sortCards(state.hand, direction, sortMode) : state.hand,
    [sorted, state.hand, direction, sortMode]);

  function sortHand() { setFeedback(''); setSorted(true); dispatch({ type: 'sort' }); }
  function changeMode(mode: HandSortMode) {
    setFeedback(''); setSortMode(mode); rememberSortMode(mode); setSorted(true);
    dispatch({ type: 'sort-mode', mode });
  }
  function changeDirection(value: HandSort) { setDirection(value); rememberSort(value); setSorted(true); }
  function changeSound(value: boolean) { setMuted(value); setAudioSettings({ muted: value }); }
  function closeSettings() {
    setSettingsOpen(false); setFeedback('');
    if (state.phase === 'settings') dispatch({ type: 'settings-done' });
  }
  function chooseCard(id: string) {
    if (!expectedIds.includes(id) && !state.selected.includes(id)) {
      setFeedback('Save this card for later. Choose the glowing card shown by the arrow.');
      return;
    }
    setFeedback(''); dispatch({ type: 'select', id });
  }
  function restart() {
    dispatch({ type: 'restart' }); setSettingsOpen(false); setRulesOpen(false); setSorted(false); setFeedback('');
  }

  return <div className="parkes-app tutorial-app" data-tutorial-phase={state.phase} onPointerDown={() => initAudio()} onClickCapture={event => {
    const button = (event.target as HTMLElement).closest('button');
    if (!button || button.disabled) return;
    initAudio();
    playSound(button.classList.contains('tutorial-hand-card') ? 'select'
      : button.classList.contains('tutorial-pile') ? 'card'
      : button.classList.contains('tutorial-meld') ? 'layoff'
      : button.textContent?.includes('Go Down') ? 'meld'
      : button.textContent?.includes('Discard') ? 'discard' : 'click');
  }}>
    <div className="felt-grain" aria-hidden="true"/><BackgroundSuits/>
    <header className="site-header tutorial-header">
      <GameLogo/>
      <span className="tutorial-mode"><Sparkles size={16}/><span>Practice hand</span></span>
      <div className="tutorial-header-actions">
        <button type="button" className="button outline small tutorial-rules-trigger" aria-label="Cards and points" onClick={() => setRulesOpen(true)}><BookOpen size={17}/><span>Cards &amp; points</span></button>
        <button type="button" data-tutorial-settings="" className="button outline small tutorial-settings-trigger" onClick={() => setSettingsOpen(true)}><Settings size={17}/><span>Settings</span></button>
        <a className="button outline small tutorial-exit" href="/" aria-label="Exit tutorial"><ArrowLeft size={16}/><span>Exit tutorial</span></a>
      </div>
    </header>
    <main className="tutorial-main">
      <h1 className="sr-only">Learn with a practice hand</h1>
      <section className="tutorial-table panel" aria-label="Practice card table">
        <div className="tutorial-table-head">
          <div className="tutorial-player"><span className="tutorial-avatar"><Bot size={19}/></span><div><strong>AI Alex</strong><small>Rule 1 of 10 · {opponentDown ? 'DOWN' : 'NOT DOWN'} · {opponentDown ? 5 : 10} cards</small></div></div>
          <span className="tutorial-rule">YOUR RULE: {RULES[1][0].title}</span>
        </div>
        <div className="tutorial-opponent">
          <div className="tutorial-opponent-backs" aria-label={opponentDown ? 'AI Alex has five cards left' : 'AI Alex has ten cards'}>
            {Array.from({ length: opponentDown ? 5 : 10 }, (_, i) => <span className="tutorial-back card-back" key={i}><span/></span>)}
          </div>
          <button type="button" data-tutorial-opponent-run="" onClick={() => dispatch({ type: 'layoff', target: 'opponent-run' })}
            disabled={busy || target !== 'opponent-run'} className={'tutorial-meld tutorial-opponent-meld' + (target === 'opponent-run' ? ' tutorial-glow' : '')}
            aria-label="Add your selected card to Alex’s run">
            <span className="tutorial-meld-label">AI ALEX&apos;S RUN</span>
            {opponentDown ? <span className="tutorial-meld-cards">{state.opponentRun.map(item => <span className="tutorial-meld-card" key={item.id}><PracticeCard card={item}/></span>)}</span>
              : <span className="tutorial-meld-empty">No cards on the table yet</span>}
          </button>
        </div>
        <div className="tutorial-piles" aria-label="Draw and discard piles">
          <div className="tutorial-pile-block"><span>DRAW PILE</span>
            <button data-tutorial-stock="" className={'tutorial-pile' + (isDrawingStock ? ' tutorial-glow' : '')} type="button" disabled={busy || !isDrawingStock}
              aria-label="Draw a face-down card from the stock" onClick={() => dispatch({ type: 'draw', source: 'stock' })}>
              <span className="tutorial-back tutorial-stock card-back"><span/></span>
            </button>
          </div>
          <div className="tutorial-pile-block"><span>DISCARD PILE</span>
            <button data-tutorial-discard-pile="" className={'tutorial-pile' + (isDrawingDiscard ? ' tutorial-glow' : '')} type="button" disabled={busy || !isDrawingDiscard}
              aria-label={'Take ' + cardName(state.topDiscard) + ' from the discard pile'} onClick={() => dispatch({ type: 'draw', source: 'discard' })}>
              <PracticeCard card={state.topDiscard}/>
            </button>
          </div>
        </div>
        <div className="tutorial-your-area">
          <div className="tutorial-section-title"><strong>YOUR TABLE</strong><small>{state.yourRun.length ? 'Your run' : 'No run yet'}</small></div>
          <button data-tutorial-your-run="" type="button" onClick={() => dispatch({ type: 'layoff', target: 'your-run' })}
            disabled={busy || target !== 'your-run'} className={'tutorial-meld tutorial-own-meld' + (target === 'your-run' ? ' tutorial-glow' : '')} aria-label="Add your selected card to your run">
            {state.yourRun.length ? <span className="tutorial-meld-cards">{state.yourRun.map(item => <span className="tutorial-meld-card" key={item.id}><PracticeCard card={item}/>{item.rank === 2 && <span className="tutorial-wild-assignment">= 8</span>}</span>)}</span>
              : <span className="tutorial-meld-empty">Your run goes here</span>}
          </button>
          <div className="tutorial-section-title tutorial-hand-title"><strong>YOUR HAND</strong><small>{state.hand.length} cards</small></div>
          <div className="tutorial-hand" data-eleven={state.hand.length === 11 ? 'true' : 'false'} aria-label="Your practice cards">
            {visibleHand.map(item => <button data-tutorial-card={item.id} type="button" key={item.id} disabled={busy || !canSelect}
              className={'tutorial-hand-card' + (state.selected.includes(item.id) ? ' selected' : '') + (expectedIds.includes(item.id) ? ' suggested' : '')}
              aria-label={cardName(item)} aria-pressed={state.selected.includes(item.id)} onClick={() => chooseCard(item.id)}><PracticeCard card={item}/></button>)}
          </div>
          <div className="tutorial-controls">
            <span className="tutorial-control-note">{state.selected.length ? `${state.selected.length} selected` : ''}</span>
            <div className="tutorial-action-spot"><button data-tutorial-go-down="" type="button" className="button gold" disabled={busy || !openingReady} onClick={() => dispatch({ type: 'go-down' })}><Check size={17}/>Go Down</button></div>
            <div className="tutorial-action-spot"><button data-tutorial-discard-button="" type="button" className="button outline" disabled={busy || !discardReady} onClick={() => dispatch({ type: 'discard' })}>Discard<ArrowRight size={17}/></button></div>
            <div data-tutorial-sort="" className="tutorial-sort-spot"><SortControl mode={sortMode} direction={direction} onSort={sortHand} onModeChange={changeMode}/></div>
          </div>
        </div>
      </section>
      <div className="tutorial-bottom"><p>No timer · Practice only</p><button type="button" className="text-link" onClick={restart}><RotateCcw size={15}/>Restart tutorial</button></div>
    </main>
    {coach && <TutorialCoach step={coach} feedback={feedback}/>}
    {settingsOpen && <TutorialSettings direction={direction} onDirection={changeDirection} muted={muted} onSound={changeSound} onDone={closeSettings}/>}
    {rulesOpen && <div className="tutorial-lesson-backdrop"><section role="dialog" aria-modal="true" aria-label="Cards and points" className="tutorial-rules-dialog panel" onKeyDown={e => { if (e.key === 'Escape') setRulesOpen(false); }}>
      <button type="button" className="icon-button tutorial-rules-close" aria-label="Close cards and points" onClick={() => setRulesOpen(false)}><X size={22}/></button>
      <TutorialRulesVisual/><button type="button" className="button gold" onClick={() => setRulesOpen(false)}>Back to practice</button>
    </section></div>}
    {won && <div className="tutorial-lesson-backdrop"><section className="tutorial-lesson panel" role="dialog" aria-modal="true" aria-labelledby="tutorial-win-title">
      <Trophy size={43} className="tutorial-victory-icon"/><h2 id="tutorial-win-title">You finished your first hand!</h2>
      <p>No cards left means 0 penalty points. Alex still has five cards, worth {TUTORIAL_AI_PENALTY} points.</p>
      <div className="tutorial-results"><div><span>YOU</span><strong>+0</strong><small>Rule 2 next</small></div><div><span>ALEX</span><strong>+{TUTORIAL_AI_PENALTY}</strong><small>Rule 2 next</small></div></div>
      <p>You both made a run, so you both move to the next rule. In a full game, the lowest total score wins.</p>
      <div className="tutorial-lesson-actions"><button type="button" className="button outline" onClick={restart}><RotateCcw size={17}/>Replay tutorial</button><a className="button gold" href="/">Play for real<ArrowRight size={18}/></a></div>
    </section></div>}
  </div>;
}
