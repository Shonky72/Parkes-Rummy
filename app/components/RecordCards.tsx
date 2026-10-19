import type { Meld, TableCard } from '../../lib/types';
const suits = { H: '♥', D: '♦', C: '♣', S: '♠' };
const rank = (value: number) => ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }[value] ?? String(value));
export function RecordCard({ card }: { card: TableCard }) {
  return <span className={`record-card ${card.suit === 'H' || card.suit === 'D' ? 'red' : 'black'}`} aria-label={`${rank(card.rank)} ${card.suit}${card.rank === 2 && card.asRank ? `, represents ${rank(card.asRank)} ${card.asSuit}` : ''}`}><b>{rank(card.rank)}</b><span>{suits[card.suit]}</span>{card.rank === 2 && card.asRank ? <small>{rank(card.asRank)}{card.asSuit ? suits[card.asSuit] : ''}</small> : null}</span>;
}
export default function RecordCards({ melds, label = 'Opening cards' }: { melds: Pick<Meld, 'kind' | 'cards'>[]; label?: string }) {
  return <div className="record-melds" aria-label={label}>{melds.map((meld, index) => <div className="record-meld" key={index}>{meld.cards.map((card, cardIndex) => <RecordCard card={card} key={card.id || cardIndex}/>)}</div>)}</div>;
}
