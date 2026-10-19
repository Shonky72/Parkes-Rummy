import type { CSSProperties, ReactNode } from 'react';
import type { Card } from '../../lib/types';
import { HAND_REVEAL_TIMING } from '../../lib/hand-reveal';

/** Read-only cards; no selection, drag, focusable button or game action. */
export default function EndHandCards({ cards, playerName, renderCard, animate = false, compact = false }: {
  cards: Card[]; playerName: string; renderCard: (card: Card) => ReactNode; animate?: boolean; compact?: boolean;
}) {
  return <div className={`end-hand-cards${compact ? ' end-hand-compact' : ''}${animate ? ' end-hand-flipping' : ''}`}
    aria-label={`${playerName}: ${cards.length} cards remaining`}>
    {cards.length ? cards.map((card, index) => <span className="end-hand-card" key={card.id} data-revealed-card={card.id}
      style={{ '--flip-delay': `${Math.min(index, 10) * HAND_REVEAL_TIMING.stagger}ms` } as CSSProperties}>
      <span className="end-hand-card-inner">
        {animate && <span className="end-hand-card-back card-back" aria-hidden="true"><span/></span>}
        <span className="end-hand-card-front">{renderCard(card)}</span>
      </span>
    </span>) : <span className="end-hand-empty">No cards left</span>}
  </div>;
}
