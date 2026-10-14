'use client';

import { useEffect, useMemo, useReducer, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, Bot, Check, CircleHelp, RotateCcw, Settings, Sparkles, Trophy } from 'lucide-react';
import type { Card } from '../../lib/types';
import { RULES } from '../../lib/rummy';
import { getAudioSettings, initAudio, playSound, setAudioSettings } from '../../lib/audio';
import { getSort, getSortMode, rememberSort, rememberSortMode, type HandSort, type HandSortMode } from '../../lib/client';
import { sortCards } from '../../lib/hand-order';
import { markTutorialCompleted } from '../../lib/tutorial-progress';
import {
  initialTutorialState, reduceTutorial, tutorialDiscardReady, tutorialExpectedCardIds,
  tutorialLayoffTarget, tutorialOpeningReady, TUTORIAL_AI_PENALTY,
  TUTORIAL_LAYOFF_IDS, type TutorialPhase,
} from '../../lib/tutorial';
import GameLogo from './GameLogo';
import BackgroundSuits from './BackgroundSuits';
import SortControl from './SortControl';
import TutorialRulesVisual from './TutorialRulesVisual';
import TutorialSettings from './TutorialSettings';

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

const TOTAL_STEPS = 11;
const tips: Record<TutorialPhase, { heading: string; text: string; action: string; number: number }> = {
  sort: { heading: '1. Tidy your cards', text: 'These are your cards! The Sort button puts them into a neat order. Find Sort at the bottom-right of the table and tap it.', action: 'Tap the Sort button', number: 1 },
  'sort-mode': { heading: '2. Choose your favourite order', text: 'Great! Now press and HOLD Sort for a moment. A small menu appears. Pick "By colour" or "By suit". This helps you spot matching cards.', action: 'Hold Sort, then choose colour or suit', number: 2 },
  settings: { heading: '3. Find the Settings button', text: 'Look at the top-right. Tap Settings. You can choose big cards first or small cards first, and turn the sounds on or off. Press Done to carry on.', action: 'Tap Settings at the top-right', number: 3 },
  'first-draw': { heading: '4. Pick up a card', text: 'Every turn starts with picking up one card. The face-down pile is where you draw a surprise card. Tap the glowing pile.', action: 'Tap the face-down draw pile', number: 4 },
  'first-discard': { heading: '5. Put one card down', text: 'Now you have 11 cards. You must throw away one. Tap the glowing Q♦ card, then tap Discard. You cannot put your run on the table on your first turn.', action: 'Tap Q♦, then Discard', number: 5 },
  'second-draw': { heading: '6. Take the card you need', text: 'The computer threw away a 9♠. You need this card! You can pick up the top face-up card instead of drawing from the face-down pile.', action: 'Tap the glowing 9♠ pile', number: 6 },
  opening: { heading: '7. Make your first run', text: 'A RUN is five numbers in a row. Find 5, 6, 7, the wild 2, and 9. The 2 pretends to be an 8. Tap these five cards, then tap Go Down.', action: 'Pick 5, 6, 7, 2 and 9, then Go Down', number: 7 },
  'second-discard': { heading: '8. End this turn', text: 'You put your run on the table! Now throw away the glowing A♠. Aces cost 20 points if you are left holding one when the hand ends.', action: 'Tap A♠, then Discard', number: 8 },
  'third-draw': { heading: '9. Your turn again', text: 'The computer has made a run too. You can see both runs on the table. First, pick up a card from the face-down pile.', action: 'Tap the face-down draw pile', number: 9 },
  layoff: { heading: '10. Add cards to the table', text: 'Now you can add cards to a run on the table. Tap the glowing card in your hand, then tap the glowing run. Keep doing this until your extra cards are gone.', action: 'Choose a glowing card, then the glowing run', number: 10 },
  'final-discard': { heading: '11. Finish your hand', text: 'Only one card is left in your hand! Tap the glowing A♥, then Discard. If your hand is empty, the round ends.', action: 'Tap A♥, then Discard', number: 11 },
  won: { heading: 'You finished your first hand!', text: 'You played all your cards and scored 0 points. Great job!', action: 'Practice complete', number: 11 },
};

const milestoneCopy: Partial<Record<TutorialPhase, { heading: string; text: string }>> = {
  'second-discard': {
    heading: 'You made a run!',
    text: 'See your cards on the table? They go 5, 6, 7, 8, 9. Your wild 2 is pretending to be an 8. That is called going down. On a later turn, you may add extra cards to runs or sets on the table.',
  },
};

export default function TutorialGame() {
  const [state, dispatch] = useReducer(reduceTutorial, undefined, initialTutorialState);
  const [lesson, setLesson] = useState<TutorialPhase | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sortMode, setSortMode] = useState<HandSortMode>('number');
  const [direction, setDirection] = useState<HandSort>('descending');
  const [sorted, setSorted] = useState(false);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    setSortMode(getSortMode());
    setDirection(getSort());
    setMuted(getAudioSettings().muted);
  }, []);
  useEffect(() => {
    if (state.phase === 'won') {
      markTutorialCompleted();
      playSound('roundWin');
    }
    if (state.phase === 'second-discard' || state.phase === 'won') setLesson(state.phase);
  }, [state.phase]);
  useEffect(() => {
    if (lesson) document.getElementById('tutorial-lesson-action')?.focus({ preventScroll: true });
  }, [lesson]);
  useEffect(() => {
    if (settingsOpen) document.getElementById('tutorial-settings-done')?.focus({ preventScroll: true });
  }, [settingsOpen]);

  // Keep the glowing target in view on phones, without scrolling on every card selection.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia('(max-width: 980px)').matches || lesson || settingsOpen) return;
    const target: Partial<Record<TutorialPhase, string>> = {
      sort: '.tutorial-sort-spot',
      'sort-mode': '.tutorial-sort-spot',
      settings: '.tutorial-settings-trigger',
      'first-draw': '.tutorial-stock',
      'first-discard': '.tutorial-hand',
      'second-draw': '.tutorial-pile-block:nth-child(2) .tutorial-pile',
      opening: '.tutorial-hand',
      'second-discard': '.tutorial-hand',
      'third-draw': '.tutorial-stock',
      layoff: '.tutorial-hand',
      'final-discard': '.tutorial-hand',
    };
    const frame = window.requestAnimationFrame(() => {
      if (state.phase !== 'sort') document.querySelector(target[state.phase] || '.tutorial-guide')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [state.phase, lesson, settingsOpen]);

  const busy = lesson !== null || settingsOpen;
  const tip = tips[state.phase];
  const expectedIds = tutorialExpectedCardIds(state);
  const target = tutorialLayoffTarget(state);
  const discardReady = tutorialDiscardReady(state);
  const openingReady = tutorialOpeningReady(state);
  const isDrawingStock = state.phase === 'first-draw' || state.phase === 'third-draw';
  const isDrawingDiscard = state.phase === 'second-draw';
  const canSelect = ['first-discard', 'opening', 'second-discard', 'layoff', 'final-discard'].includes(state.phase);
  const opponentDown = state.opponentRun.length > 0;
  const visibleHand = useMemo(
    () => sorted ? sortCards(state.hand, direction, sortMode) : state.hand,
    [sorted, state.hand, direction, sortMode],
  );

  function sortHand() {
    setSorted(true);
    dispatch({ type: 'sort' });
  }
  function changeMode(mode: HandSortMode) {
    setSortMode(mode);
    rememberSortMode(mode);
    setSorted(true);
    dispatch({ type: 'sort-mode', mode });
  }
  function changeDirection(value: HandSort) {
    setDirection(value);
    rememberSort(value);
    setSorted(true);
  }
  function changeSound(value: boolean) {
    setMuted(value);
    setAudioSettings({ muted: value });
  }
  function closeSettings() {
    setSettingsOpen(false);
    if (state.phase === 'settings') dispatch({ type: 'settings-done' });
  }
  function continueLesson() { setLesson(null); }
  function restart() {
    dispatch({ type: 'restart' });
    setLesson(null);
    setSettingsOpen(false);
    setSorted(false);
  }

  return <div className="parkes-app tutorial-app" onPointerDown={() => initAudio()} onClickCapture={event => {
    const element = event.target as HTMLElement;
    const button = element.closest('button');
    if (!button || button.disabled) return;
    initAudio();
    const type = button.classList.contains('tutorial-hand-card') ? 'select'
      : button.classList.contains('tutorial-pile') ? 'card'
      : button.classList.contains('tutorial-meld') ? 'layoff'
      : button.textContent?.includes('Go Down') ? 'meld'
      : button.textContent?.includes('Discard') ? 'discard' : 'click';
    playSound(type);
  }}>
    <div className="felt-grain" aria-hidden="true"/>
    <BackgroundSuits/>
    <header className="site-header tutorial-header">
      <GameLogo/>
      <span className="tutorial-mode"><Sparkles size={16}/>Guided practice · Game 1</span>
      <div className="tutorial-header-actions">
        <div className="tutorial-settings-spot">
          <button type="button" className={'button outline small tutorial-settings-trigger' + (state.phase === 'settings' ? ' tutorial-glow' : '')} onClick={() => setSettingsOpen(true)}><Settings size={17}/>Settings</button>
          {state.phase === 'settings' && <span className="tutorial-coach tutorial-coach-below"><ArrowDown size={15}/>Tap Settings here</span>}
        </div>
        <a className="button outline small tutorial-exit" href="/"><ArrowLeft size={16}/>Exit tutorial</a>
      </div>
    </header>
    <main className="tutorial-main">
      <section className="tutorial-guide panel" aria-label="Tutorial instructions" aria-live="polite">
        <div className="tutorial-progress-top"><span>LEARN PARKES RUMMY</span><strong>{Math.min(tip.number, TOTAL_STEPS)} / {TOTAL_STEPS}</strong></div>
        <div className="tutorial-progress" role="progressbar" aria-label="Tutorial progress" aria-valuemin={0} aria-valuemax={TOTAL_STEPS} aria-valuenow={Math.min(tip.number, TOTAL_STEPS)}>
          <span style={{ width: Math.min(100, tip.number / TOTAL_STEPS * 100) + '%' }}/>
        </div>
        <h1>{tip.heading}</h1><p>{tip.text}</p>
        <div className="tutorial-next"><CircleHelp size={17}/><strong>{tip.action}</strong></div>
        <TutorialRulesVisual/>
      </section>

      <section className="tutorial-table panel" aria-label="Practice card table">
        <div className="tutorial-mobile-step" role="status"><strong>{tip.heading}</strong><span>{tip.action}</span></div>
        <div className="tutorial-table-head">
          <div className="tutorial-player"><span className="tutorial-avatar"><Bot size={19}/></span><div><strong>AI Alex</strong><small>Rule 1 of 10 · {opponentDown ? 'DOWN' : 'NOT DOWN'} · {opponentDown ? 5 : 10} cards</small></div></div>
          <span className="tutorial-rule">YOUR RULE: {RULES[1][0].title}</span>
        </div>
        <div className="tutorial-opponent">
          <div className="tutorial-opponent-backs" aria-label={opponentDown ? 'AI Alex has five cards left' : 'AI Alex has ten cards'}>
            {Array.from({ length: opponentDown ? 5 : 10 }, (_, i) => <span className="tutorial-back card-back" key={i}><span/></span>)}
          </div>
          <button type="button" onClick={() => dispatch({ type: 'layoff', target: 'opponent-run' })}
            disabled={busy || target !== 'opponent-run'}
            className={'tutorial-meld tutorial-opponent-meld' + (target === 'opponent-run' ? ' tutorial-glow' : '')}
            aria-label={opponentDown ? 'AI Alex exposed run. Add selected card when highlighted' : 'AI Alex has no exposed cards yet'}>
            <span className="tutorial-meld-label">AI ALEX&apos;S EXPOSED RUN</span>
            {opponentDown
              ? <span className="tutorial-meld-cards">{state.opponentRun.map(item => <span className="tutorial-meld-card" key={item.id}><PracticeCard card={item}/></span>)}</span>
              : <span className="tutorial-meld-empty">AI run appears later</span>}
            {target === 'opponent-run' && <span className="tutorial-meld-hint"><ArrowRight size={14}/>Tap here to add 10♦</span>}
          </button>
        </div>
        <div className="tutorial-piles" aria-label="Draw and discard piles">
          <div className="tutorial-pile-block">
            <span>DRAW PILE</span>
            {isDrawingStock && <span className="tutorial-coach tutorial-pile-pointer">Tap here <ArrowDown size={13}/></span>}
            <button className={'tutorial-pile' + (isDrawingStock ? ' tutorial-glow' : '')} type="button" disabled={busy || !isDrawingStock}
              aria-label="Draw a face-down card from the stock" onClick={() => dispatch({ type: 'draw', source: 'stock' })}>
              <span className="tutorial-back tutorial-stock card-back"><span/></span>
            </button>
          </div>
          <div className="tutorial-pile-block">
            <span>DISCARD PILE</span>
            {isDrawingDiscard && <span className="tutorial-coach tutorial-pile-pointer">Take the 9♠ <ArrowDown size={13}/></span>}
            <button className={'tutorial-pile' + (isDrawingDiscard ? ' tutorial-glow' : '')} type="button" disabled={busy || !isDrawingDiscard}
              aria-label={'Take ' + cardName(state.topDiscard) + ' from the discard pile'}
              onClick={() => dispatch({ type: 'draw', source: 'discard' })}>
              <PracticeCard card={state.topDiscard}/>
            </button>
          </div>
        </div>

        <div className="tutorial-your-area">
          <div className="tutorial-section-title"><strong>YOUR TABLE</strong><small>{state.yourRun.length ? 'Your opening is down' : 'Go Down after your first turn'}</small></div>
          <button type="button" onClick={() => dispatch({ type: 'layoff', target: 'your-run' })}
            disabled={busy || target !== 'your-run'}
            className={'tutorial-meld tutorial-own-meld' + (target === 'your-run' ? ' tutorial-glow' : '')}
            aria-label="Your exposed run. Add selected card when highlighted">
            {state.yourRun.length
              ? <span className="tutorial-meld-cards">{state.yourRun.map(item => <span className="tutorial-meld-card" key={item.id}><PracticeCard card={item}/>{item.rank === 2 && <span className="tutorial-wild-assignment">= 8</span>}</span>)}</span>
              : <span className="tutorial-meld-empty">Your completed opening goes here</span>}
            {target === 'your-run' && <span className="tutorial-meld-hint"><ArrowRight size={14}/>Tap to extend your run</span>}
          </button>
          <div className="tutorial-section-title tutorial-hand-title"><strong>YOUR HAND</strong><small>{state.hand.length} cards · Tap to select</small></div>
          {canSelect && !busy && !openingReady && <div className="tutorial-hand-pointer"><ArrowDown size={15}/>Tap the golden cards{state.phase === 'opening' ? ' to make a run.' : '.'}</div>}
          <div className="tutorial-hand" data-eleven={state.hand.length === 11 ? 'true' : 'false'} aria-label="Your practice cards">
            {visibleHand.map(item => <button type="button" key={item.id} disabled={busy || !canSelect}
              className={'tutorial-hand-card' + (state.selected.includes(item.id) ? ' selected' : '') + (expectedIds.includes(item.id) ? ' suggested' : '')}
              aria-label={cardName(item) + (expectedIds.includes(item.id) ? ', suggested card' : '')}
              aria-pressed={state.selected.includes(item.id)}
              onClick={() => dispatch({ type: 'select', id: item.id })}><PracticeCard card={item}/></button>)}
          </div>
          <div className="tutorial-controls">
            <span className="tutorial-control-note">{state.phase === 'opening'
              ? state.selected.length + ' of 5 cards picked'
              : state.phase === 'layoff' ? state.laidOffCount + ' of ' + TUTORIAL_LAYOFF_IDS.length + ' cards added'
              : state.selected.length ? 'Card selected' : state.phase === 'sort' || state.phase === 'sort-mode' ? 'Let’s tidy up first' : 'Follow the golden glow'}</span>
            <div className="tutorial-action-spot">
              {openingReady && <span className="tutorial-coach tutorial-action-coach">Now tap Go Down <ArrowDown size={13}/></span>}
              <button type="button" className={'button gold' + (openingReady ? ' tutorial-glow' : '')} disabled={busy || !openingReady} onClick={() => dispatch({ type: 'go-down' })}><Check size={17}/>Go Down</button>
            </div>
            <div className="tutorial-action-spot">
              {discardReady && <span className="tutorial-coach tutorial-action-coach">Now Discard <ArrowDown size={13}/></span>}
              <button type="button" className={'button outline' + (discardReady ? ' tutorial-glow' : '')} disabled={busy || !discardReady} onClick={() => dispatch({ type: 'discard' })}>Discard<ArrowRight size={17}/></button>
            </div>
            <div className={'tutorial-sort-spot' + (state.phase === 'sort' || state.phase === 'sort-mode' ? ' tutorial-glow' : '')}>
              {state.phase === 'sort' && <span className="tutorial-coach tutorial-action-coach">Tap Sort <ArrowDown size={13}/></span>}
              {state.phase === 'sort-mode' && <span className="tutorial-coach tutorial-action-coach">Hold Sort <ArrowDown size={13}/></span>}
              <SortControl mode={sortMode} direction={direction} onSort={sortHand} onModeChange={changeMode}/>
            </div>
          </div>
        </div>
      </section>
      <div className="tutorial-bottom">
        <p><Sparkles size={14}/> No timer · No account needed · Practice never affects your real games</p>
        <button type="button" className="text-link" onClick={restart}><RotateCcw size={15}/>Restart tutorial</button>
      </div>
    </main>

    {lesson && <div className="tutorial-lesson-backdrop">
      <div className="tutorial-lesson panel" role="dialog" aria-modal="true" aria-labelledby="tutorial-lesson-title" aria-describedby="tutorial-lesson-description">
        {lesson === 'won' ? <>
          <Trophy size={43} className="tutorial-victory-icon"/>
          <h2 id="tutorial-lesson-title">You won the practice hand!</h2>
          <p id="tutorial-lesson-description">You emptied your hand, so you score zero penalty points. Your AI opponent still has five cards, worth {TUTORIAL_AI_PENALTY} points.</p>
          <div className="tutorial-results"><div><span>YOU</span><strong>+0</strong><small>Rule 2 next</small></div><div><span>AI ALEX</span><strong>+{TUTORIAL_AI_PENALTY}</strong><small>Cards left in hand</small></div></div>
          <p className="tutorial-win-note">In a full game, each player advances after meeting their own rule. Players who miss it repeat the same rule. Lowest total score wins.</p>
          <div className="tutorial-lesson-actions">
            <button type="button" id="tutorial-lesson-action" className="button outline" onClick={restart}><RotateCcw size={17}/>Replay tutorial</button>
            <a className="button gold" href="/">Play for real<ArrowRight size={18}/></a>
          </div>
        </> : <>
          <span className="tutorial-lesson-suit" aria-hidden="true">♠</span>
          <h2 id="tutorial-lesson-title">{milestoneCopy[lesson]?.heading}</h2>
          <p id="tutorial-lesson-description">{milestoneCopy[lesson]?.text}</p>
          <div className="tutorial-lesson-actions">
            <button type="button" id="tutorial-lesson-action" className="button gold" onClick={continueLesson}>Got it, let’s go<ArrowRight size={18}/></button>
          </div>
        </>}
      </div>
    </div>}
    {settingsOpen && <TutorialSettings direction={direction} onDirection={changeDirection} muted={muted} onSound={changeSound} onDone={closeSettings}/>}
  </div>;
}
