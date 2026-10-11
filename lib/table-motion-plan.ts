import type { PublicRoom, RoomEvent, TableCard } from './types';

export const WINNING_CARD_TIMING = {
  flight: 4_800,
  arrival: 1_200,
  // Includes the commit frames and a margin for a throttled animation callback.
  fallback: 7_200,
} as const;

export interface MotionBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface WinningCardFrame {
  box: MotionBox;
  rotation: number;
  offset: number;
}

/** Keep the featured card and its heading inside the visible upper table. */
export function winningCardChoreography(from: MotionBox, to: MotionBox, stageBounds: MotionBox, aspect = to.width / to.height): {
  stage: MotionBox;
  frames: WinningCardFrame[];
} {
  const headingSpace = Math.min(64, stageBounds.height * 0.4);
  const availableHeight = Math.max(8, stageBounds.height - headingSpace);
  const height = Math.min(204, availableHeight, Math.max(112, stageBounds.height * 0.54));
  const width = Math.min(132, stageBounds.width * 0.38, height * aspect);
  const stage = {
    left: stageBounds.left + (stageBounds.width - width) / 2,
    top: stageBounds.top + headingSpace + (availableHeight - width / aspect) * 0.45,
    width,
    height: width / aspect,
  };
  const blend = (start: MotionBox, end: MotionBox, amount: number): MotionBox => ({
    left: start.left + (end.left - start.left) * amount,
    top: start.top + (end.top - start.top) * amount,
    width: start.width + (end.width - start.width) * amount,
    height: start.height + (end.height - start.height) * amount,
  });
  return {
    stage,
    frames: [
      { box: from, rotation: -4, offset: 0 },
      { box: blend(from, stage, 0.24), rotation: -9, offset: 0.12 },
      { box: stage, rotation: -5, offset: 0.3 },
      { box: { ...stage, top: Math.max(stageBounds.top + headingSpace, stage.top - 6) }, rotation: 1, offset: 0.48 },
      { box: stage, rotation: 5, offset: 0.68 },
      { box: blend(stage, to, 0.42), rotation: 3, offset: 0.82 },
      { box: to, rotation: 0, offset: 1 },
    ],
  };
}

export interface WinningCardMove {
  winnerId: string;
  action: 'discard' | 'layoff' | 'meld';
  // All opening cards are played together. The visible last one receives the
  // slow finish; a discard or layoff identifies one physical card.
  cardIds: string[];
}

export interface PublicTableCardMove {
  cardId: string;
  meldId: string;
  ownerId: string;
  playerId: string;
}

/** Plan newly exposed table cards in public play order, without inspecting hidden hands or results. */
export function getTableCardMoves(previous: PublicRoom, next: PublicRoom): PublicTableCardMove[] {
  if (previous.code !== next.code || previous.game !== next.game || previous.round !== next.round
    || previous.youId !== next.youId || next.version <= previous.version) return [];
  const lastId = previous.events.reduce((highest, event) => Math.max(highest, event.id), -1);
  const events = next.events.filter(event => event.id > lastId);
  const oldHand = new Set(previous.hand.map(card => card.id));
  const oldCards = new Set(previous.melds.flatMap(meld => meld.cards.map(card => card.id)));
  const oldMelds = new Set(previous.melds.map(meld => meld.id));
  const layoffPlayers = new Set(events.filter(event => event.type === 'layoff' && event.playerId).map(event => event.playerId!));
  const moves: { move: PublicTableCardMove; eventId: number; index: number }[] = [];
  for (const meld of next.melds) {
    for (const card of meld.cards) {
      if (oldCards.has(card.id)) continue;
      const play = events.filter(event => event.type === 'layoff' && event.cardId === card.id).at(-1);
      const opening = !oldMelds.has(meld.id);
      // Public ownership or a physical play takes precedence over an older own hand.
      const playerId = opening ? meld.ownerId : play?.playerId ?? (oldHand.has(card.id) ? next.youId
        : layoffPlayers.size === 1 ? [...layoffPlayers][0] : null);
      if (!playerId) continue;
      const openingPlay = opening ? events.filter(event => event.type === 'meld' && event.playerId === meld.ownerId).at(-1) : undefined;
      moves.push({
        move: { cardId: card.id, meldId: meld.id, ownerId: meld.ownerId, playerId },
        eventId: play?.id ?? openingPlay?.id ?? Number.POSITIVE_INFINITY,
        index: moves.length,
      });
    }
  }
  // A low-end run ends up in reverse placement order on the table. Its flights
  // must still leave the hand in event order, including the final physical card.
  return moves.sort((a, b) => a.eventId === b.eventId ? a.index - b.index : a.eventId - b.eventId)
    .map(({ move }) => move);
}

function publicCardLabel(card: TableCard): string {
  const rank = card.rank === 1 || card.rank === 14 ? 'A'
    : card.rank === 13 ? 'K' : card.rank === 12 ? 'Q' : card.rank === 11 ? 'J' : String(card.rank);
  return rank + ({ C: '♣', D: '♦', H: '♥', S: '♠' }[card.suit]);
}

/** A fresh finish inferred solely from public plays and public hand counts. */
export function getWinningCardMove(previous: PublicRoom | null, next: PublicRoom): WinningCardMove | null {
  if (!previous || previous.status !== 'playing'
    || (next.status !== 'round-end' && next.status !== 'finished')
    || previous.code !== next.code || previous.game !== next.game
    || previous.round !== next.round || previous.youId !== next.youId
    || next.version <= previous.version || !next.result || next.result.round !== next.round) return null;

  const winnerId = next.result.winnerId;
  const before = previous.players.find(player => player.id === winnerId);
  const after = next.players.find(player => player.id === winnerId);
  if (!before || before.handCount < 1 || !after || after.handCount !== 0) return null;

  const lastId = previous.events.reduce((highest, event) => Math.max(highest, event.id), -1);
  const events = next.events.filter(event => event.id > lastId);
  const finish = events.filter(event => event.type === 'round-end' && event.playerId === winnerId).at(-1);
  if (!finish) return null;
  const action = events.filter((event): event is RoomEvent & { type: WinningCardMove['action'] } =>
    event.id < finish.id && event.playerId === winnerId
    && (event.type === 'discard' || event.type === 'layoff' || event.type === 'meld')).at(-1);
  if (!action) return null;

  if (action.type === 'discard') {
    const card = next.discard;
    if (!card || card.id === previous.discard?.id || (action.cardId && action.cardId !== card.id)) return null;
    return { winnerId, action: 'discard', cardIds: [card.id] };
  }

  const previousMelds = new Set(previous.melds.map(meld => meld.id));
  const previousCards = new Set(previous.melds.flatMap(meld => meld.cards.map(card => card.id)));
  const addedCards = next.melds.flatMap(meld => {
    if (action.type === 'meld' && (meld.ownerId !== winnerId || previousMelds.has(meld.id))) return [];
    if (action.type === 'layoff' && !previousMelds.has(meld.id)) return [];
    return meld.cards.filter(card => !previousCards.has(card.id));
  });
  if (action.type === 'meld') {
    return addedCards.length ? { winnerId, action: 'meld', cardIds: addedCards.map(card => card.id) } : null;
  }

  // New public play events identify the physical card. For an older room,
  // accept a label only when exactly one newly exposed card matches it.
  // Never inspect the opponent's remaining-card score rows to infer a move.
  const candidates = action.cardId
    ? addedCards.filter(card => card.id === action.cardId)
    : addedCards.filter(card => action.text.endsWith(`added ${publicCardLabel(card)} to the table.`));
  return candidates.length === 1
    ? { winnerId, action: 'layoff', cardIds: [candidates[0].id] }
    : null;
}
