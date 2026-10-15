import type { Meld, TableCard } from './types';

export function representedRank(card: TableCard): number {
  const rank = card.asRank ?? card.rank;
  return rank === 1 ? 14 : rank;
}
export function isCompleteRun(meld: Meld): boolean {
  return meld.kind === 'run' && meld.cards.length === 10
    && meld.cards.every((card, index) => representedRank(card) === index + 5);
}

/** Keep every rank corner legible. Extremely long sets wrap rather than disappear offscreen. */
export function meldSpread(count: number, available: number, cardWidth: number) {
  if (!Number.isInteger(count) || count < 1) return { columns: 1, overlap: 0 };
  const width = Math.max(1, cardWidth);
  const room = Math.max(width, available);
  const minimumPeek = Math.min(width, 25);
  const columns = Math.max(1, Math.min(count, Math.floor((room - width) / minimumPeek) + 1));
  const preferred = count <= 4 ? width + 3 : width * .74;
  const step = columns <= 1 ? width : Math.min(preferred, (room - width) / (columns - 1));
  return { columns, overlap: width - step };
}

export function pendingMoveText(action: string): string | null {
  return ({ draw: 'Drawing a card…', discard: 'Discarding your card…', goDown: 'Putting your cards down…', layoff: 'Adding your cards…', layoffMany: 'Adding your cards…' } as Record<string, string>)[action] ?? null;
}
