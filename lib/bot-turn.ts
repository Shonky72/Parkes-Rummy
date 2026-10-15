import { applyAction, cardPoints, GameError } from './rummy';
import type { GameAction, RoomState } from './types';

/** Complete ONE due computer turn in one transaction, not one network roundtrip
 * per card. Engine botStep remains a single legal action for existing callers.
 * The API checks authorization/due time and performs its usual optimistic save.
 */
export function advanceBotTurn(original: RoomState, actorId: string): RoomState {
  if (!original.players.some(player => player.id === actorId)) throw new GameError('Rejoin this table before playing.');
  const botId = original.turnPlayerId;
  if (original.status !== 'playing' || !original.players.some(player => player.id === botId && player.isBot)) return original;
  let room = original;
  // A hand has at most eleven cards. Draw + opening + ten additions + discard
  // fit this finite guard. No human action, next deal or second bot is included.
  for (let step = 0; step < 14 && room.status === 'playing' && room.turnPlayerId === botId; step++) {
    try {
      room = applyAction(room, actorId, { type: 'botStep' });
    } catch (error) {
      if (!(error instanceof GameError)) throw error;
      // A stale/legacy planning edge case must not repeat an invalid move forever.
      // Fall back through the ordinary engine; do not force cards or skip turns.
      const own = room.players.find(player => player.id === botId)!;
      const action: GameAction = room.phase === 'draw'
        ? { type: 'draw', source: room.stock.length || room.discardPile.length > 1 ? 'stock' : 'discard' }
        : { type: 'discard', cardId: [...own.hand].sort((a, b) => cardPoints(b) - cardPoints(a))[0].id };
      room = applyAction(room, botId, action);
    }
  }
  if (room === original) return original;
  if (room.status === 'playing' && room.turnPlayerId === botId) throw new GameError('Computer turn did not finish. Please retry.');
  // One saved request = one version; individual moves stay visible in events.
  return { ...room, version: original.version + 1 };
}
