import type { Card, PublicRoom } from './types';
import type { WinningCardPlayback } from './table-motion';

export const HAND_REVEAL_TIMING = { flip: 420, stagger: 65, hold: 600 } as const;

/** Only expose the authoritative completed hand, never opponents' live hands. */
export function completedHandCards(room: PublicRoom, playerId: string): Card[] | null {
  if (!['round-end', 'finished'].includes(room.status) || !room.result || room.result.round !== room.round) return null;
  return room.result.scores.find(row => row.playerId === playerId)?.cards ?? null;
}
export function handRevealDuration(room: PublicRoom): number {
  const count = Math.max(0, ...(room.result?.scores ?? []).map(row => row.cards.length));
  return HAND_REVEAL_TIMING.flip + Math.max(0, Math.min(11, count) - 1) * HAND_REVEAL_TIMING.stagger + HAND_REVEAL_TIMING.hold;
}

/** Begin the flip with the winning-card sequence, without waiting for landing.
 * Cancellation resolves the wait but never starts a reveal on a departed table.
 */
export function coordinateHandReveal(playback: WinningCardPlayback, onReveal: () => void, duration: number): WinningCardPlayback {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finishWait: (() => void) | undefined;
  const reveal = playback.started.then(() => {
    if (cancelled) return;
    onReveal();
    return new Promise<void>(resolve => {
      finishWait = resolve;
      timer = setTimeout(() => { timer = undefined; finishWait = undefined; resolve(); }, duration);
    });
  });
  return {
    started: playback.started,
    landed: playback.landed,
    finished: Promise.all([playback.finished, reveal]).then(() => undefined),
    cancel() {
      cancelled = true;
      clearTimeout(timer); timer = undefined;
      finishWait?.(); finishWait = undefined;
      playback.cancel();
    },
  };
}
