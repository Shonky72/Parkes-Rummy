import type { HandSort, HandSortMode } from './client';
import type { Card } from './types';

const SUIT_ORDER = 'SHDC';
const GROUPED_SUIT_ORDER = 'HDCS';

/** Sort in the preferred direction, keeping wild twos last within their group. */
export function sortCards(cards: Card[], sort: HandSort, mode: HandSortMode = 'number'): Card[] {
  return [...cards].sort((a, b) => {
    const suitA = GROUPED_SUIT_ORDER.indexOf(a.suit);
    const suitB = GROUPED_SUIT_ORDER.indexOf(b.suit);
    const groupOrder = mode === 'colour' ? Math.floor(suitA / 2) - Math.floor(suitB / 2)
      : mode === 'suit' ? suitA - suitB : 0;
    const rankA = a.rank === 2 ? (sort === 'descending' ? 0 : 15) : a.rank;
    const rankB = b.rank === 2 ? (sort === 'descending' ? 0 : 15) : b.rank;
    return groupOrder
      || (sort === 'descending' ? rankB - rankA : rankA - rankB)
      || (mode === 'number' ? SUIT_ORDER.indexOf(a.suit) - SUIT_ORDER.indexOf(b.suit) : suitA - suitB)
      || a.id.localeCompare(b.id);
  });
}

/** Keep a manual arrangement through polls and removals; append newly drawn cards. */
export function arrangeHand(cards: Card[], orderedIds: readonly string[] | null, sort: HandSort, mode: HandSortMode = 'number'): Card[] {
  if (orderedIds === null) return sortCards(cards, sort, mode);

  const remaining = new Map(cards.map(card => [card.id, card]));
  const arranged: Card[] = [];
  for (const id of orderedIds) {
    const card = remaining.get(id);
    if (!card) continue;
    arranged.push(card);
    remaining.delete(id);
  }
  for (const card of cards) {
    if (!remaining.has(card.id)) continue;
    arranged.push(card);
    remaining.delete(card.id);
  }
  return arranged;
}

/** Insert one confirmed draw only while the complete prior hand and chosen slot still match. */
export function insertDrawnCard(cards: Card[], orderedIds: readonly string[], priorCardIds: readonly string[], beforeId: string | null): string[] | null {
  const currentIds = cards.map(card => card.id);
  const current = new Set(currentIds);
  const prior = new Set(priorCardIds);
  const ordered = new Set(orderedIds);
  if (current.size !== currentIds.length || prior.size !== priorCardIds.length || ordered.size !== orderedIds.length
    || currentIds.length !== priorCardIds.length + 1 || orderedIds.length !== priorCardIds.length
    || priorCardIds.some(id => !current.has(id) || !ordered.has(id))
    || (beforeId !== null && !prior.has(beforeId))) return null;

  const drawn = currentIds.find(id => !prior.has(id));
  if (drawn === undefined) return null;
  const result = [...orderedIds];
  result.splice(beforeId === null ? result.length : result.indexOf(beforeId), 0, drawn);
  return result;
}

/** Move one card into an insertion slot. A null slot means the end of the hand. */
export function moveCard(order: readonly string[], cardId: string, beforeId: string | null): string[] {
  const moved = [...order];
  const from = moved.indexOf(cardId);
  if (from === -1 || beforeId === cardId || (beforeId !== null && !moved.includes(beforeId))) return moved;

  moved.splice(from, 1);
  const destination = beforeId === null ? moved.length : moved.indexOf(beforeId);
  moved.splice(destination, 0, cardId);
  return moved;
}
