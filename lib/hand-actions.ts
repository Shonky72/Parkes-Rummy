import type { Card, GameAction, LayoffTarget, PublicRoom } from './types';
// @ts-expect-error Node's native TypeScript runner requires the explicit file extension.
import { canLayoff, getLayoffGroupTargets } from './rummy.ts';

/** Recheck a tap or drop against the latest room before submitting the move. */
export function getHandLayoffAction(
  room: PublicRoom | null,
  cardId: string,
  target: Pick<LayoffTarget, 'meldId' | 'end'>,
): Extract<GameAction, { type: 'layoff' }> | null {
  const action = getHandLayoffGroupAction(room, [cardId], target);
  return action?.type === 'layoff' ? action : null;
}

/** Recheck all selected cards against the latest hand, turn and exposed endpoint. */
export function getHandLayoffGroupAction(
  room: PublicRoom | null,
  cardIds: string[],
  target: Pick<LayoffTarget, 'meldId' | 'end'>,
): Extract<GameAction, { type: 'layoff' | 'layoffMany' }> | null {
  if (!room || !canLayoff(room) || !Array.isArray(cardIds) || cardIds.length < 1 || cardIds.length > 11 || new Set(cardIds).size !== cardIds.length) return null;
  const cards = cardIds.map(id => room.hand.find(candidate => candidate.id === id));
  if (cards.some(card => !card)) return null;
  const validTarget = getLayoffGroupTargets(cards as Card[], room.melds).find(candidate =>
    candidate.meldId === target.meldId && candidate.end === target.end);
  if (!validTarget) return null;
  return cardIds.length === 1
    ? { type: 'layoff', cardId: cardIds[0], meldId: validTarget.meldId, end: validTarget.end }
    : { type: 'layoffMany', cardIds: validTarget.cards.map(card => card.id), meldId: validTarget.meldId, end: validTarget.end };
}

/** Hand arrangement stays local; discarding always requires a legal play phase. */
export function getHandDiscardAction(
  room: PublicRoom | null,
  cardId: string,
): Extract<GameAction, { type: 'discard' }> | null {
  if (!room || room.status !== 'playing' || room.turnPlayerId !== room.youId || room.phase !== 'play') return null;
  if (!room.hand.some(card => card.id === cardId)) return null;
  return { type: 'discard', cardId };
}
