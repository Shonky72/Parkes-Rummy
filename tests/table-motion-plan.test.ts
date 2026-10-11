import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Node's native TypeScript runner requires the explicit file extension.
import { getTableCardMoves, getWinningCardMove, winningCardChoreography, WINNING_CARD_TIMING } from '../lib/table-motion-plan.ts';
import type { PublicRoom, TableCard } from '../lib/types';

const card = (id: string, rank = 7): TableCard => ({ id, rank, suit: 'H' });

function playing(): PublicRoom {
  return {
    code: 'MOTION', game: 1, round: 2, hostId: 'you', youId: 'you',
    status: 'playing', version: 8, turnPlayerId: 'other', turnNumber: 10,
    phase: 'play', stockCount: 50, discard: card('old-discard', 9),
    turnLimitSeconds: 0, turnDeadline: null, botDueAt: 0,
    hand: [card('your-private-card', 6)],
    players: ['you', 'other'].map((id, index) => ({
      id, name: id, color: index, handCount: 1, score: 0,
      down: true, completedTurns: 2, laidDownTurn: 2,
      isBot: false, difficulty: 'medium', ready: true,
    })),
    melds: [{ id: 'existing', ownerId: 'you', kind: 'set', constraint: 'any',
      cards: [card('old-1'), card('old-2'), card('old-3')],
    }],
    result: null, history: [],
    events: [{ id: 8, type: 'draw', playerId: 'other', text: 'other drew from the draw pile.', at: 1 }],
  };
}

function ended(previous: PublicRoom, winnerId = 'other'): PublicRoom {
  const next = structuredClone(previous);
  next.status = 'round-end';
  next.version++;
  next.players.find(player => player.id === winnerId)!.handCount = 0;
  if (winnerId === 'you') next.hand = [];
  next.result = { round: next.round, winnerId, winnerName: winnerId, scores: [] };
  next.events.push({ id: 10, type: 'round-end', playerId: winnerId, text: `${winnerId} went out.`, at: 1 });
  return next;
}

test('a remote final discard uses its newly public physical card', () => {
  const previous = playing();
  const next = ended(previous);
  next.discard = card('final-card');
  next.events.splice(1, 0, { id: 9, type: 'discard', playerId: 'other', cardId: 'final-card', text: 'other discarded 7♥.', at: 1 });
  assert.deepEqual(getWinningCardMove(previous, next), { winnerId: 'other', action: 'discard', cardIds: ['final-card'] });
  assert.deepEqual(previous.hand, [card('your-private-card', 6)]);
});

test('a local final discard and final game event still identify one new finish', () => {
  const previous = playing();
  const next = ended(previous, 'you');
  next.status = 'finished';
  next.discard = previous.hand[0];
  next.events.splice(1, 0, { id: 9, type: 'discard', playerId: 'you', cardId: next.discard.id, text: 'you discarded 6♥.', at: 1 });
  next.events.push({ id: 11, type: 'game-end', text: 'Game finished.', at: 1 });
  assert.deepEqual(getWinningCardMove(previous, next), { winnerId: 'you', action: 'discard', cardIds: ['your-private-card'] });
});

test('combined layoffs with identical faces select the final event cardId', () => {
  const previous = playing();
  previous.players[1].handCount = 2;
  const next = ended(previous);
  next.melds[0].cards.push(card('earlier-seven'), card('winning-seven'));
  next.events = [previous.events[0],
    { id: 9, type: 'layoff', playerId: 'other', cardId: 'earlier-seven', text: 'other added 7♥ to the table.', at: 1 },
    { id: 10, type: 'layoff', playerId: 'other', cardId: 'winning-seven', text: 'other added 7♥ to the table.', at: 1 },
    { id: 11, type: 'round-end', playerId: 'other', text: 'other went out.', at: 1 },
  ];
  assert.deepEqual(getWinningCardMove(previous, next), { winnerId: 'other', action: 'layoff', cardIds: ['winning-seven'] });
});

test('a low-end batch flies 7, 6, 5 onto 8 in play order and reserves the gold finale for 5', () => {
  const previous = playing();
  previous.players[1].handCount = 3;
  previous.melds[0] = { id: 'run', ownerId: 'you', kind: 'run', constraint: 'any',
    cards: [card('old-eight', 8), card('old-nine', 9), card('old-ten', 10)] };
  const next = ended(previous);
  next.melds[0].cards.unshift(card('winning-five', 5), card('new-six', 6), card('new-seven', 7));
  next.events = [previous.events[0],
    { id: 9, type: 'layoff', playerId: 'other', cardId: 'new-seven', text: 'other added 7♥ to the table.', at: 1 },
    { id: 10, type: 'layoff', playerId: 'other', cardId: 'new-six', text: 'other added 6♥ to the table.', at: 1 },
    { id: 11, type: 'layoff', playerId: 'other', cardId: 'winning-five', text: 'other added 5♥ to the table.', at: 1 },
    { id: 12, type: 'round-end', playerId: 'other', text: 'other went out.', at: 1 },
  ];
  next.result!.scores = [{ playerId: 'you', name: 'you', penalty: 5, total: 5, cards: [card('unplayed-private-card')] }];
  const snapshot = structuredClone({ previous, next });
  assert.deepEqual(getTableCardMoves(previous, next), ['new-seven', 'new-six', 'winning-five'].map(cardId => ({
    cardId, meldId: 'run', ownerId: 'you', playerId: 'other',
  })));
  assert.deepEqual(getWinningCardMove(previous, next), { winnerId: 'other', action: 'layoff', cardIds: ['winning-five'] });
  assert.deepEqual({ previous, next }, snapshot);
});

test('a grouped local win animates every card across melds in placement order', () => {
  const previous = playing();
  previous.hand = [card('seven-a'), card('eight', 8), card('seven-b')];
  previous.players[0].handCount = 3;
  previous.melds.push({ id: 'other-set', ownerId: 'other', kind: 'set', constraint: 'any',
    cards: [card('old-eight-a', 8), card('old-eight-b', 8), card('old-eight-c', 8)] });
  const next = ended(previous, 'you');
  next.melds[0].cards.push(previous.hand[0], previous.hand[2]);
  next.melds[1].cards.push(previous.hand[1]);
  next.events = [previous.events[0],
    { id: 9, type: 'layoff', playerId: 'you', cardId: 'seven-a', text: 'you added 7♥ to the table.', at: 1 },
    { id: 10, type: 'layoff', playerId: 'you', cardId: 'eight', text: 'you added 8♥ to the table.', at: 1 },
    { id: 11, type: 'layoff', playerId: 'you', cardId: 'seven-b', text: 'you added 7♥ to the table.', at: 1 },
    { id: 12, type: 'round-end', playerId: 'you', text: 'you went out.', at: 1 },
  ];
  assert.deepEqual(getTableCardMoves(previous, next), [
    { cardId: 'seven-a', meldId: 'existing', ownerId: 'you', playerId: 'you' },
    { cardId: 'eight', meldId: 'other-set', ownerId: 'other', playerId: 'you' },
    { cardId: 'seven-b', meldId: 'existing', ownerId: 'you', playerId: 'you' },
  ]);
  assert.deepEqual(getWinningCardMove(previous, next), { winnerId: 'you', action: 'layoff', cardIds: ['seven-b'] });
  next.status = 'playing';
  next.result = null;
  next.players[0].handCount = 1;
  next.events.pop();
  assert.equal(getTableCardMoves(previous, next).length, 3, 'A non-winning batch still animates all three plays');
  assert.equal(getWinningCardMove(previous, next), null, 'Ordinary batches do not claim a finale');
});

test('public table planning keeps an opening group together and ignores cards which are not public plays', () => {
  const previous = playing();
  const next = ended(previous);
  next.melds.push({ id: 'opening', ownerId: 'other', kind: 'set', constraint: 'any',
    cards: [card('open-a', 8), card('open-b', 8), card('open-c', 8)] });
  next.events.splice(1, 0, { id: 9, type: 'meld', playerId: 'other', text: 'other went down.', at: 1 });
  next.result!.scores = [{ playerId: 'you', name: 'you', penalty: 5, total: 5, cards: [card('private-result')] }];
  assert.deepEqual(getTableCardMoves(previous, next), ['open-a', 'open-b', 'open-c'].map(cardId => ({
    cardId, meldId: 'opening', ownerId: 'other', playerId: 'other',
  })));
  assert.deepEqual(getWinningCardMove(previous, next)?.cardIds, ['open-a', 'open-b', 'open-c']);
});

test('public table planning rejects stale room snapshots and uncertain actors', () => {
  const previous = playing();
  const next = structuredClone(previous);
  next.version++;
  next.melds[0].cards.push(card('unattributed'));
  next.events.push(
    { id: 9, type: 'layoff', playerId: 'you', text: 'you added 7♥ to the table.', at: 1 },
    { id: 10, type: 'layoff', playerId: 'other', text: 'other added 7♥ to the table.', at: 1 },
  );
  assert.deepEqual(getTableCardMoves(previous, next), []);
  next.events[2].cardId = 'unattributed';
  assert.equal(getTableCardMoves(previous, next)[0]?.playerId, 'other');
  for (const replacement of [
    { version: previous.version }, { code: 'OTHER1' }, { round: 3 }, { game: 2 as const }, { youId: 'other' },
  ]) assert.deepEqual(getTableCardMoves(previous, { ...next, ...replacement }), []);
});

test('an opening meld which empties a hand offers only the winner’s new meld cards', () => {
  const previous = playing();
  previous.players[1].handCount = 3;
  previous.players[1].down = false;
  const next = ended(previous);
  next.melds.push({ id: 'opening', ownerId: 'other', kind: 'set', constraint: 'any', cards: [card('open-1', 8), card('open-2', 8), card('open-3', 8)] });
  next.melds[0].cards.push(card('someone-else-card'));
  next.events.splice(1, 0, { id: 9, type: 'meld', playerId: 'other', text: 'other went down.', at: 1 });
  assert.deepEqual(getWinningCardMove(previous, next), { winnerId: 'other', action: 'meld', cardIds: ['open-1', 'open-2', 'open-3'] });
});

test('legacy layoff events resolve unique public labels without guessing between duplicate cards', () => {
  const previous = playing();
  const next = ended(previous);
  next.melds[0].cards.push(card('legacy-winning'));
  next.events.splice(1, 0, { id: 9, type: 'layoff', playerId: 'other', text: 'other added 7♥ to the table.', at: 1 });
  assert.deepEqual(getWinningCardMove(previous, next)?.cardIds, ['legacy-winning']);
  next.melds[0].cards.push(card('ambiguous-copy'));
  assert.equal(getWinningCardMove(previous, next), null);
});

test('result polls, reconnection, old versions and different rooms or hands never replay the win', () => {
  const previous = playing();
  const next = ended(previous);
  next.discard = card('final-card');
  next.events.splice(1, 0, { id: 9, type: 'discard', playerId: 'other', cardId: 'final-card', text: 'other discarded 7♥.', at: 1 });
  assert.equal(getWinningCardMove(null, next), null);
  assert.equal(getWinningCardMove(next, { ...next, version: 10 }), null);
  for (const replacement of [
    { version: previous.version }, { code: 'OTHER1' }, { round: 3 }, { game: 2 as const },
    { youId: 'other' }, { status: 'playing' as const }, { result: null },
  ]) assert.equal(getWinningCardMove(previous, { ...next, ...replacement }), null);
});

test('a public empty hand and matching round-end event are required', () => {
  const previous = playing();
  const next = ended(previous);
  next.discard = card('final-card');
  next.events.splice(1, 0, { id: 9, type: 'discard', playerId: 'other', cardId: 'final-card', text: 'other discarded 7♥.', at: 1 });
  next.players[1].handCount = 1;
  assert.equal(getWinningCardMove(previous, next), null);
  next.players[1].handCount = 0;
  next.events = next.events.filter(event => event.type !== 'round-end');
  assert.equal(getWinningCardMove(previous, next), null);
});

test('score-card disclosure and unrelated public cards never supply a guessed winning card', () => {
  const previous = playing();
  const next = ended(previous);
  next.result!.scores = [{ playerId: 'you', name: 'you', penalty: 5, total: 5, cards: [card('not-a-play')] }];
  next.events.splice(1, 0, { id: 9, type: 'layoff', playerId: 'other', cardId: 'not-a-play', text: 'other added 7♥ to the table.', at: 1 });
  assert.equal(getWinningCardMove(previous, next), null);
  next.melds[0].cards.push(card('another-public-card'));
  assert.equal(getWinningCardMove(previous, next), null);
});

test('the final-card sequence includes a long readable hover and a complete landing before results', () => {
  const from = { left: 225, top: 486, width: 53, height: 91 };
  const to = { left: 273, top: 193, width: 43, height: 67 };
  const bounds = { left: 16, top: 104, width: 328, height: 342 };
  const choreography = winningCardChoreography(from, to, bounds, from.width / from.height);
  assert.ok(WINNING_CARD_TIMING.flight + WINNING_CARD_TIMING.arrival >= 6_000);
  assert.ok(WINNING_CARD_TIMING.fallback > WINNING_CARD_TIMING.flight + WINNING_CARD_TIMING.arrival + 500);
  assert.ok(WINNING_CARD_TIMING.fallback <= 8_000, 'A missing callback must still release the result promptly');
  const heldFrames = choreography.frames.filter(frame => frame.box.width === choreography.stage.width);
  assert.ok((heldFrames.at(-1)!.offset - heldFrames[0].offset) * WINNING_CARD_TIMING.flight >= 1_800);
  assert.ok(choreography.stage.width > from.width * 1.8, 'The last card is large enough to read on a phone');
});

test('local and remote winning cards finish at the physical discard or meld rectangle', () => {
  const bounds = { left: 16, top: 100, width: 328, height: 342 };
  for (const from of [
    { left: 225, top: 486, width: 53, height: 91 },
    { left: 287, top: 155, width: 23, height: 37 },
  ]) for (const to of [
    { left: 273, top: 193, width: 43, height: 67 },
    { left: 173, top: 314, width: 48, height: 76 },
  ]) {
    const before = structuredClone({ from, to, bounds });
    const { frames } = winningCardChoreography(from, to, bounds);
    assert.deepEqual(frames[0].box, from);
    assert.deepEqual(frames.at(-1)!.box, to);
    assert.equal(frames.at(-1)!.rotation, 0);
    assert.deepEqual({ from, to, bounds }, before);
  }
});

test('the featured card stays above the mobile dock and inside narrow or landscape table bounds', () => {
  const from = { left: 230, top: 450, width: 53, height: 91 };
  const to = { left: 263, top: 160, width: 43, height: 67 };
  for (const bounds of [
    { left: 16, top: 116, width: 288, height: 258 },
    { left: 16, top: 116, width: 328, height: 348 },
    { left: 16, top: 104, width: 812, height: 146 },
    { left: 16, top: 8, width: 568, height: 50 },
    { left: 16, top: 92, width: 1334, height: 652 },
  ]) {
    const { stage, frames } = winningCardChoreography(from, to, bounds);
    assert.ok(stage.width > 0 && stage.height > 0);
    assert.ok(stage.left >= bounds.left);
    assert.ok(stage.top >= bounds.top);
    assert.ok(stage.left + stage.width <= bounds.left + bounds.width);
    assert.ok(stage.top + stage.height <= bounds.top + bounds.height);
    for (const held of frames.filter(frame => frame.box.width === stage.width)) {
      assert.ok(held.box.top >= bounds.top);
      assert.ok(held.box.top + held.box.height <= bounds.top + bounds.height);
    }
  }
});

test('retargeting after the hand shrinks retains the source and follows the moved real pile', () => {
  const from = { left: 215, top: 470, width: 53, height: 91 };
  const before = { left: 268, top: 205, width: 43, height: 67 };
  const after = { left: 268, top: 165, width: 43, height: 67 };
  const bounds = { left: 16, top: 104, width: 328, height: 350 };
  const initial = winningCardChoreography(from, before, bounds);
  const updated = winningCardChoreography(from, after, bounds);
  assert.deepEqual(updated.frames[0], initial.frames[0]);
  assert.deepEqual(updated.stage, initial.stage);
  assert.deepEqual(updated.frames.at(-1)!.box, after);
  assert.notDeepEqual(updated.frames.at(-1), initial.frames.at(-1));
});
