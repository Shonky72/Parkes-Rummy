/** Actual card rectangles in DOM order, including the card currently being held. */
export interface HandCardRect {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface HandRow {
  cards: HandCardRect[];
  top: number;
  bottom: number;
}

export interface HandInsertion {
  beforeId: string | null;
  marker: { left: number; top: number; height: number };
}

/** Small selection lifts must not turn a single visual row into several rows. */
function handRows(cards: readonly HandCardRect[]): HandRow[] {
  const rows: HandRow[] = [];
  for (const card of [...cards].sort((a, b) => a.top - b.top || a.left - b.left)) {
    const bottom = card.top + card.height;
    const row = rows.find(candidate =>
      Math.min(candidate.bottom, bottom) - Math.max(candidate.top, card.top)
        > Math.min(candidate.bottom - candidate.top, card.height) / 2,
    );
    if (row) {
      row.cards.push(card);
      row.top = Math.min(row.top, card.top);
      row.bottom = Math.max(row.bottom, bottom);
    } else rows.push({ cards: [card], top: card.top, bottom });
  }
  for (const row of rows) row.cards.sort((a, b) => a.left - b.left);
  return rows;
}

/** Find an insertion within the row under the pointer, including its trailing slot. */
export function handInsertionAt(
  cards: readonly HandCardRect[],
  draggedId: string,
  point: { x: number; y: number },
): HandInsertion | null {
  const rows = handRows(cards);
  if (!rows.length) return null;
  const rowIndex = rows.reduce((closest, row, index) =>
    Math.abs(point.y - (row.top + row.bottom) / 2)
      < Math.abs(point.y - (rows[closest].top + rows[closest].bottom) / 2) ? index : closest,
  0);
  const row = rows[rowIndex];
  const candidates = row.cards.filter(card => card.id !== draggedId);
  const before = candidates.find(card => point.x < card.left + card.width / 2);
  // The end of the first row precedes the next row, not the entire hand.
  const following = rows.slice(rowIndex + 1).flatMap(next => next.cards).find(card => card.id !== draggedId);
  const anchor = before ?? candidates.at(-1) ?? row.cards[0];
  return {
    beforeId: before?.id ?? following?.id ?? null,
    marker: {
      left: before ? anchor.left - 3 : candidates.length ? anchor.left + anchor.width + 3 : anchor.left,
      top: anchor.top,
      height: anchor.height,
    },
  };
}

/** The closest column in the adjacent row is the natural keyboard destination. */
export function handVerticalNeighbour(
  cards: readonly HandCardRect[], cardId: string, direction: -1 | 1,
): string | null {
  const rows = handRows(cards);
  const index = rows.findIndex(row => row.cards.some(card => card.id === cardId));
  const card = rows[index]?.cards.find(card => card.id === cardId);
  const adjacent = rows[index + direction];
  if (!card || !adjacent) return null;
  const centre = card.left + card.width / 2;
  return adjacent.cards.reduce((closest, candidate) =>
    Math.abs(candidate.left + candidate.width / 2 - centre)
      < Math.abs(closest.left + closest.width / 2 - centre) ? candidate : closest,
  ).id;
}
