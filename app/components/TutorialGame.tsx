'use client';

import { useEffect, useReducer, useState } from 'react';
import { ArrowLeft, ArrowRight, Bot, Check, CircleHelp, RotateCcw, Sparkles, Trophy, X } from 'lucide-react';
import type { Card } from '../../lib/types';
import { RULES } from '../../lib/rummy';
import { initAudio, playSound } from '../../lib/audio';
import {
  initialTutorialState, reduceTutorial, tutorialDiscardReady, tutorialExpectedCardIds,
  tutorialLayoffTarget, tutorialOpeningReady, TUTORIAL_AI_PENALTY,
  TUTORIAL_LAYOFF_IDS, type TutorialPhase,
} from '../../lib/tutorial';
import GameLogo from './GameLogo';
import BackgroundSuits from './BackgroundSuits';

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

const tips: Record<TutorialPhase, { heading: string; text: string; action: string; number: number }> = {
  intro: { heading: 'Learn by playing', text: 'A friendly practice hand walks you through the main controls.', action: 'Begin', number: 0 },
  'first-draw': { heading: '1. Draw from the stock', text: 'Each turn begins with a draw. Tap the glowing face-down stock pile to collect a card.', action: 'Tap the stock', number: 1 },
  'first-discard': { heading: '2. Discard to end your turn', text: 'You cannot Go Down on your first turn. Select the highlighted queen of diamonds and press Discard to keep the cards you need.', action: 'Select Q♦, then Discard', number: 2 },
  'second-draw': { heading: '3. Pick up a discard', text: 'The AI discarded a 9 of spades, the missing card for your opening run. Tap the discard pile to pick it up.', action: 'Tap the glowing discard', number: 3 },
  opening: { heading: '4. Make a run of five', text: 'Rule 1 requires five consecutive ranks. Select the highlighted 5, 6, 7, wild 2 and 9. The 2 represents an 8.', action: 'Select five cards, then Go Down', number: 4 },
  'second-discard': { heading: '5. Finish the turn', text: 'Your run is now on the table. Discard your ace of spades. Aces carry a 20-point penalty if still in your hand when someone goes out.', action: 'Select A♠, then Discard', number: 5 },
  'third-draw': { heading: '6. Draw again', text: 'The AI has also gone down with a run. Both runs are visible, and you may add to either from this turn onward.', action: 'Tap the stock', number: 6 },
  layoff: { heading: '7. Add to exposed runs', text: 'Select the highlighted card and tap the glowing run. Start with 10♣, then J♥, Q♠, K♦. Finish with 10♦ on the AI run.', action: 'Select a card, then tap the matching run', number: 7 },
  'final-discard': { heading: '8. Go out!', text: 'One card remains, the ace of hearts. Discard it to empty your hand and win this practice hand.', action: 'Select A♥, then Discard', number: 8 },
  won: { heading: 'Practice hand complete', text: 'You went out and scored zero penalty points.', action: 'Victory', number: 9 },
};

const milestoneCopy: Partial<Record<TutorialPhase, { heading: string; text: string }>> = {
  'second-draw': { heading: 'First turn complete', text: 'Well done. You have completed the compulsory first turn without going down. Now you are allowed to meet your rule.' },
  'second-discard': { heading: 'You went down!', text: 'The 2 stood in for an 8, making the run 5-6-7-8-9. Going down reveals those cards to the table. Discard one card, then you may add to exposed runs on later turns.' },
  layoff: { heading: 'Look at the shared table', text: 'Your run and the AI run are exposed. After going down on an earlier turn, you may extend either one. Select the highlighted card, then tap the matching run.' },
};

export default function TutorialGame() {
  const [state, dispatch] = useReducer(reduceTutorial, undefined, initialTutorialState);
  const [lesson, setLesson] = useState<TutorialPhase | null>('intro');
  useEffect(() => { if (state.phase === 'won') playSound('roundWin'); }, [state.phase]);
  useEffect(() => {
    if (state.phase === 'second-draw' || state.phase === 'second-discard' || state.phase === 'layoff' || state.phase === 'won') {
      setLesson(state.phase);
    }
  }, [state.phase]);
  useEffect(() => {
    if (lesson) document.getElementById('tutorial-lesson-action')?.focus({ preventScroll: true });
  }, [lesson]);

  const busy = lesson !== null;
  const tip = tips[state.phase];
  const expectedIds = tutorialExpectedCardIds(state);
  const target = tutorialLayoffTarget(state);
  const discardReady = tutorialDiscardReady(state);
  const isDrawingStock = state.phase === 'first-draw' || state.phase === 'third-draw';
  const isDrawingDiscard = state.phase === 'second-draw';
  const canSelect = ['first-discard', 'opening', 'second-discard', 'layoff', 'final-discard'].includes(state.phase);
  const opponentDown = state.opponentRun.length > 0;

  function continueLesson() {
    if (lesson === 'intro') dispatch({ type: 'start' });
    setLesson(null);
  }
  function restart() {
    dispatch({ type: 'restart' });
    setLesson('intro');
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
      <a className="button outline small tutorial-exit" href="/"><ArrowLeft size={16}/>Exit tutorial</a>
    </header>
    <main className="tutorial-main">
      <section className="tutorial-guide panel" aria-label="Tutorial instructions" aria-live="polite">
        <div className="tutorial-progress-top"><span>LEARN PARKES RUMMY</span><strong>{Math.min(tip.number, 8)} / 8</strong></div>
        <div className="tutorial-progress" role="progressbar" aria-label="Tutorial progress" aria-valuemin={0} aria-valuemax={8} aria-valuenow={Math.min(tip.number, 8)}>
          <span style={{ width: Math.min(100, tip.number / 8 * 100) + '%' }}/>
        </div>
        <h1>{tip.heading}</h1><p>{tip.text}</p>
        <div className="tutorial-next"><CircleHelp size={17}/><strong>{tip.action}</strong></div>
      </section>

      <section className="tutorial-table panel" aria-label="Practice card table">
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
            <span>STOCK</span>
            <button className={'tutorial-pile' + (isDrawingStock ? ' tutorial-glow' : '')} type="button" disabled={busy || !isDrawingStock}
              aria-label="Draw a face-down card from the stock" onClick={() => dispatch({ type: 'draw', source: 'stock' })}>
              <span className="tutorial-back tutorial-stock card-back"><span/></span>
            </button>
          </div>
          <div className="tutorial-pile-block">
            <span>DISCARD</span>
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
          <div className="tutorial-hand" data-eleven={state.hand.length === 11 ? 'true' : 'false'} aria-label="Your practice cards">
            {state.hand.map(item => <button type="button" key={item.id} disabled={busy || !canSelect}
              className={'tutorial-hand-card' + (state.selected.includes(item.id) ? ' selected' : '') + (expectedIds.includes(item.id) ? ' suggested' : '')}
              aria-label={cardName(item) + (expectedIds.includes(item.id) ? ', suggested card' : '')}
              aria-pressed={state.selected.includes(item.id)}
              onClick={() => dispatch({ type: 'select', id: item.id })}><PracticeCard card={item}/></button>)}
          </div>
          <div className="tutorial-controls">
            <span className="tutorial-control-note">{state.phase === 'opening' ? state.selected.length + ' of 5 cards selected' : state.phase === 'layoff' ? state.laidOffCount + ' of ' + TUTORIAL_LAYOFF_IDS.length + ' cards added' : state.selected.length ? 'Card selected' : 'Follow the golden highlight'}</span>
            <button type="button" className="button gold" disabled={busy || !tutorialOpeningReady(state)} onClick={() => dispatch({ type: 'go-down' })}><Check size={17}/>Go Down</button>
            <button type="button" className="button outline" disabled={busy || !discardReady} onClick={() => dispatch({ type: 'discard' })}>Discard<ArrowRight size={17}/></button>
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
          <h2 id="tutorial-lesson-title">{lesson === 'intro' ? 'Learn Parkes Rummy by winning' : milestoneCopy[lesson]?.heading}</h2>
          <p id="tutorial-lesson-description">{lesson === 'intro'
            ? 'Play through one guaranteed winning hand against a scripted AI. Learn drawing, discarding, wild cards, going down, adding to other players and scoring. Wrong moves never end the lesson.'
            : milestoneCopy[lesson]?.text}</p>
          <div className="tutorial-lesson-actions">
            {lesson !== 'intro' && <button type="button" className="text-link" onClick={() => setLesson(null)}><X size={14}/>Close</button>}
            <button type="button" id="tutorial-lesson-action" className="button gold" onClick={continueLesson}>{lesson === 'intro' ? 'Start winning hand' : 'Got it, continue'}<ArrowRight size={18}/></button>
          </div>
        </>}
      </div>
    </div>}
  </div>;
}
