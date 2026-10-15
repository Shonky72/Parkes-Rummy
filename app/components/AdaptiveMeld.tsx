'use client';

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, ChevronDown, Plus } from 'lucide-react';
import type { GroupLayoffTarget, LayoffTarget, Meld, TableCard } from '../../lib/types';
import { isCompleteRun, meldSpread, representedRank } from '../../lib/meld-layout';

export interface AdaptiveMeldProps {
  meld: Meld;
  targets: GroupLayoffTarget[];
  activeTarget: Pick<LayoffTarget, 'meldId' | 'end'> | null;
  hintsEnabled: boolean;
  manualAvailable: boolean;
  selectionCount: number;
  onTarget: (target: Pick<LayoffTarget, 'meldId' | 'end'>) => void;
  busy: boolean;
  renderCard: (card: TableCard) => ReactNode;
}
const suits = { C: '♣', D: '♦', H: '♥', S: '♠' };
const rankText = (rank: number) => ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' } as Record<number, string>)[rank] ?? String(rank);
const brief = (card: TableCard) => rankText(representedRank(card)) + suits[card.asSuit ?? card.suit];

export default function AdaptiveMeld({ meld, targets, activeTarget, hintsEnabled, manualAvailable, selectionCount, onTarget, busy, renderCard }: AdaptiveMeldProps) {
  const fan = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [measure, setMeasure] = useState({ available: 280, card: 48 });
  const complete = isCompleteRun(meld);
  const folded = complete && !expanded;
  const start = hintsEnabled ? targets.find(target => target.meldId === meld.id && target.end === 'start') : undefined;
  const end = hintsEnabled ? targets.find(target => target.meldId === meld.id && target.end === 'end') : undefined;
  const manual = !hintsEnabled && manualAvailable;
  const hasStart = meld.kind === 'run' && representedRank(meld.cards[0]) > 5;
  const hasEnd = meld.kind === 'set' || representedRank(meld.cards[meld.cards.length - 1]) < 14;
  useLayoutEffect(() => {
    const element = fan.current;
    if (!element) return;
    const update = () => {
      const card = element.querySelector<HTMLElement>('.exposed-card-wrap');
      const next = { available: element.clientWidth, card: card?.getBoundingClientRect().width || 48 };
      setMeasure(old => Math.abs(old.available - next.available) < .5 && Math.abs(old.card - next.card) < .5 ? old : next);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [folded, hasStart, hasEnd, meld.cards.length]);
  const spread = meldSpread(meld.cards.length, measure.available, measure.card);
  const rows: TableCard[][] = [];
  for (let i = 0; i < meld.cards.length; i += spread.columns) rows.push(meld.cards.slice(i, i + spread.columns));

  function target(position: 'start' | 'end', hint?: GroupLayoffTarget) {
    if (!hint && !manual) return <span className="meld-target-space" aria-hidden="true"/>;
    const chosen = !!hint && activeTarget?.meldId === meld.id && activeTarget.end === position;
    const selected = selectionCount > 1 ? `${selectionCount} selected cards` : 'the selected card';
    const addition = hint?.cards.map(brief).join(', ');
    return <button type="button" data-meld-target="" data-meld-id={meld.id} data-meld-end={position}
      className={`meld-target ${hint ? 'meld-target-hint' : 'meld-target-manual'} ${chosen ? 'target-selected' : ''}`}
      disabled={busy} onClick={() => onTarget({ meldId: meld.id, end: position })}
      aria-label={hint ? `Add ${addition} to the ${position} of this ${meld.kind}` : `Try adding ${selected} to the ${position} of this ${meld.kind}`}>
      <Plus size={23}/><span>{hint ? hint.cards.length > 1 ? `Add ${hint.cards.length}` : `Add ${rankText(hint.asRank)}${suits[hint.asSuit]}` : meld.kind === 'set' ? 'Add' : position === 'start' ? 'Start' : 'End'}</span>
    </button>;
  }
  return <div ref={root} className="meld-group adaptive-meld" data-meld-id={meld.id} data-complete-run={complete ? 'true' : undefined}>
    <label>{meld.kind.toUpperCase()}{complete && <span className="closed-run-label"><Check size={12}/>Complete · no additions</span>}</label>
    {folded ? <button type="button" className="complete-run-stack" onClick={() => setExpanded(true)} aria-expanded="false" aria-label="Completed run, 5 to Ace. No more cards fit. Show all ten cards.">
      <span className="complete-run-cards" aria-hidden="true"><span className="exposed-card-wrap" data-table-card={meld.cards[0].id}>{renderCard(meld.cards[0])}</span><span className="exposed-card-wrap" data-table-card={meld.cards[9].id}>{renderCard(meld.cards[9])}</span></span>
      <span className="complete-run-copy"><strong>5 → A</strong><span>Run complete</span><small>View 10 cards <ChevronDown size={12}/></small></span>
    </button> : <>
      <div className="meld-cards adaptive-meld-cards">
        {hasStart && !complete && target('start', start)}
        <div className="meld-fan" ref={fan} style={{ '--meld-overlap': `${spread.overlap}px` } as CSSProperties}>
          {rows.map((cards, row) => <div className="meld-fan-row" key={row}>{cards.map((card, i) => <div className="exposed-card-wrap" data-table-card={card.id} key={card.id} tabIndex={0} style={{ zIndex: i + 1 }} title={card.rank === 2 ? `Wild ${suits[card.suit]} represents ${brief(card)}` : brief(card)}>
            {renderCard(card)}<span className={`meld-corner-suit ${card.suit === 'H' || card.suit === 'D' ? 'red' : ''}`} aria-hidden="true">{suits[card.suit]}</span>
            {card.rank === 2 && card.asRank !== undefined && <small className="wild-assignment">2{suits[card.suit]} = {brief(card)}</small>}
          </div>)}</div>)}
        </div>
        {hasEnd && !complete && target('end', end)}
      </div>
      {complete && <button type="button" className="collapse-complete-run text-link" aria-expanded="true" onClick={() => setExpanded(false)}>Stack completed run</button>}
    </>}
  </div>;
}
