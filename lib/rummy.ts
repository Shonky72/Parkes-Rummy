import type {
  Card, Difficulty, GameAction, GameType, GroupLayoffTarget, LayoffTarget, Meld, MeldConstraint,
  PlayerState, PublicRoom, Requirement, RoomEvent, RoomPreview, RoomState,
  RuleDefinition, Suit, TableCard,
} from './types';

const SUITS: Suit[] = ['C', 'D', 'H', 'S'];
const RED: Suit[] = ['D', 'H'];
const BLACK: Suit[] = ['C', 'S'];
const RANKS = [2, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

const set = (count: number, extras: Partial<Requirement> = {}): Requirement => ({ kind: 'set', count, ...extras });
const run = (count: number, extras: Partial<Requirement> = {}): Requirement => ({ kind: 'run', count, ...extras });
const rule = (number: number, title: string, description: string, requirements: Requirement[], alternativeRequirements?: Requirement[][]): RuleDefinition => ({
  number, title, description, requirements, ...(alternativeRequirements ? { alternativeRequirements } : {}),
});

export const RULES: Record<GameType, RuleDefinition[]> = {
  1: [
    rule(1, 'Run of 5', 'Five consecutive cards. Mixed suits allowed.', [run(5)]),
    rule(2, '2 × 3 of a kind', 'Two separate groups of three matching ranks.', [set(3), set(3)]),
    rule(3, '3 of a kind + run of 4', 'Three matching ranks and four consecutive cards.', [set(3), run(4)]),
    rule(4, 'Run of 7', 'Seven consecutive cards. Mixed suits allowed.', [run(7)]),
    rule(5, '2 × 4 of a kind', 'Two separate groups of four matching ranks.', [set(4), set(4)]),
    rule(6, '4 of a kind + run of 5', 'Four matching ranks and five consecutive cards.', [set(4), run(5)]),
    rule(7, 'Run of 8', 'Eight consecutive cards. Mixed suits allowed.', [run(8)]),
    rule(8, '2 of a kind + 5 of a kind', 'A pair and five matching ranks.', [set(2), set(5)]),
    rule(9, 'Run of 9', 'Nine consecutive cards. Mixed suits allowed.', [run(9)]),
    rule(10, '3 of a kind + 5 of a kind', 'Three matching ranks and five matching ranks.', [set(3), set(5)]),
  ],
  2: [
    rule(1, 'Run of 4, one of each suit', 'Four consecutive cards with one club, diamond, heart and spade. Twos follow their printed suit.', [run(4, { constraint: 'one-each-suit', wildsMatch: true })]),
    rule(2, '2 × 3 of a kind: black + red', 'Three matching black cards and three matching red cards. Twos match the colour.', [set(3, { constraint: 'black', wildsMatch: true }), set(3, { constraint: 'red', wildsMatch: true })]),
    rule(3, 'Run of 6, one colour', 'Six consecutive cards, all black or all red. Twos match the colour.', [run(6, { constraint: 'same-colour', wildsMatch: true })]),
    rule(4, 'Run of 7, alternating colours', 'Seven consecutive cards alternating red and black. Twos match the colour of their position.', [run(7, { constraint: 'alternate', wildsMatch: true })]),
    rule(5, '2 of a kind + 5 of a kind, no twos', 'A pair and five matching ranks, using natural cards only.', [set(2, { naturalOnly: true }), set(5, { naturalOnly: true })]),
    rule(6, '3 × 3 of a kind', 'Three separate groups of three matching ranks.', [set(3), set(3), set(3)]),
    rule(7, '6 of a kind', 'Six matching ranks.', [set(6)]),
    rule(8, 'Run of 8, one suit', 'Eight consecutive cards, all represented in the same suit.', [run(8, { constraint: 'same-suit' })]),
    rule(9, '4 of a kind + 3 of a kind + a pair', 'Four matching ranks, three matching ranks and a pair.', [set(4), set(3), set(2)]),
    rule(10, '8 of a kind + a pair of hearts', 'Eight matching ranks and a pair represented as hearts.', [set(8), set(2, { constraint: 'hearts' })]),
  ],
  3: [
    rule(1, 'Run of 4, four suits, alternating colours', 'Four consecutive cards, one of each suit, alternating red and black. Either colour starts. Twos keep their printed suit.', [run(4, { constraint: 'one-each-suit-alternate', wildsMatch: true })]),
    rule(2, '4 of a kind + 3 of a kind, opposite colours', 'Four matching red cards and three matching black cards, or four black and three red. Twos match each set’s printed colour.', [set(4, { constraint: 'red', wildsMatch: true }), set(3, { constraint: 'black', wildsMatch: true })], [[set(4, { constraint: 'black', wildsMatch: true }), set(3, { constraint: 'red', wildsMatch: true })]]),
    rule(3, 'Run of 5, one suit', 'Five consecutive cards in one suit. Twos must have the same printed suit as the run.', [run(5, { constraint: 'same-suit', wildsMatch: true })]),
    rule(4, 'Run of 7, alternating colours + a pair', 'Seven consecutive cards alternating red and black, plus a matching pair. Twos in the run match their position’s printed colour; any two works in the pair.', [run(7, { constraint: 'alternate', wildsMatch: true }), set(2)]),
    rule(5, '3 of a kind + 5 of a kind, no twos', 'Three matching ranks and five matching ranks, using natural cards only. No twos in either set.', [set(3, { naturalOnly: true }), set(5, { naturalOnly: true })]),
    rule(6, '3 × 3 of a kind: red, black + any', 'Three matching red cards, three matching black cards and an unrestricted triple. Twos match the colour in the red and black sets; any two works in the third.', [set(3, { constraint: 'red', wildsMatch: true }), set(3, { constraint: 'black', wildsMatch: true }), set(3)]),
    rule(7, '6 of a kind + a pair', 'Six matching ranks and a matching pair. Any two works as a wild in either set.', [set(6), set(2)]),
    rule(8, 'Run of 9, one suit', 'Nine consecutive cards represented in one suit. Any two represents the needed rank and suit, regardless of its printed suit.', [run(9, { constraint: 'same-suit' })]),
    rule(9, '2 × 4 of a kind + a pair', 'Two separate groups of four matching ranks and a matching pair. Any two works as a wild.', [set(4), set(4), set(2)]),
    rule(10, '8 of a kind + a natural pair of hearts', 'Eight matching ranks plus two natural hearts of the same rank. Twos work in the eight-card set only; the heart pair has no twos.', [set(8), set(2, { constraint: 'hearts', naturalOnly: true })]),
  ],
  4: [
    rule(1, '4 of a kind: two suit pairs', 'Four matching ranks made from two cards of one suit and two cards of another suit. Twos may substitute only as their printed suit.', [set(4)]),
    rule(2, '4 of a kind + 3 of a kind + pair, no twos', 'Three separate natural sets: four matching ranks, three matching ranks and a pair. No twos anywhere in the opening meld.', [set(4, { naturalOnly: true }), set(3, { naturalOnly: true }), set(2, { naturalOnly: true })]),
    rule(3, 'Run of 10, one colour, no twos', 'A natural 5-through-Ace run of ten cards, all red or all black. No twos.', [run(10, { constraint: 'same-colour', naturalOnly: true })]),
    rule(4, '3 × 3 of a kind, special twos', 'Three separate triples. Twos cannot act as wilds; they are allowed only when three twos form one complete triple.', [set(3), set(3), set(3)]),
    rule(5, 'Run of 6, alternating colours', 'Six consecutive cards alternating red and black. Twos match the colour of their position. The alternating pattern must continue after laydown.', [run(6, { constraint: 'alternate', wildsMatch: true, persistentConstraint: true })]),
    rule(6, 'Royal Flush', '10, Jack, Queen, King and Ace in one suit. A two may replace a missing rank only when its printed suit matches the Royal Flush.', [run(5, { constraint: 'same-suit', wildsMatch: true })]),
    rule(7, '2 × 4 of a kind, each one colour', 'Two separate groups of four matching ranks. Every card in each group must be one colour. Twos match that group’s colour.', [set(4), set(4)]),
    rule(8, '4 pairs, one of each suit', 'Four pairs: one Clubs pair, one Diamonds pair, one Hearts pair and one Spades pair. Twos may substitute only in their printed suit.', [set(2), set(2), set(2), set(2)]),
    rule(9, 'Run of 6 + pair of Aces', 'A six-card run plus a pair of Aces. A two replacing an Ace must have the same printed suit as the Ace it pairs with.', [run(6), set(2)]),
    rule(10, 'Hand of Hearts: run of 5 + 3 of a kind', 'Five consecutive Hearts plus three Hearts of the same rank. The entire opening meld is Hearts. Only 2♥ may act as a wild.', [run(5, { constraint: 'hearts', wildsMatch: true }), set(3, { constraint: 'hearts', wildsMatch: true })]),
  ],
};

export class GameError extends Error {
  code: string;
  constructor(message: string, code = 'INVALID_ACTION') {
    super(message);
    this.name = 'GameError';
    this.code = code;
  }
}

const rankOf = (card: Card): number => card.rank === 1 ? 14 : card.rank;
const shownRank = (card: TableCard): number => card.asRank ?? rankOf(card);
const isRed = (suit: Suit): boolean => suit === 'D' || suit === 'H';
const validCard = (card: Card): boolean => !!card && typeof card.id === 'string' && card.id.length > 0 && RANKS.includes(rankOf(card)) && SUITS.includes(card.suit);
const clone = <T>(value: T): T => structuredClone(value);

/** A shared hand number is used only while reading a room saved before individual rules. */
export function ruleNumberFor(player?: { ruleNumber?: number } | null, fallbackRound = 1): number {
  const value = Number.isInteger(player?.ruleNumber) ? player!.ruleNumber!
    : Number.isInteger(fallbackRound) ? fallbackRound : 1;
  return Math.max(1, Math.min(10, value));
}

const MOVE_EVENT_TYPES = new Set<RoomEvent['type']>(['start', 'draw', 'meld', 'layoff', 'discard', 'timeout', 'round-end', 'game-end']);

/** Read older rooms without replacing a real move time with a settings/join time. */
export function lastMoveAtFor(room: Pick<RoomState, 'lastMoveAt' | 'events'>): number | null {
  if (room.lastMoveAt === null) return null;
  if (typeof room.lastMoveAt === 'number' && Number.isFinite(room.lastMoveAt)) return room.lastMoveAt;
  for (let index = room.events.length - 1; index >= 0; index--) {
    const entry = room.events[index];
    if (MOVE_EVENT_TYPES.has(entry.type) && Number.isFinite(entry.at)) return entry.at;
  }
  return null;
}

/** Fill legacy fields without dealing, advancing anyone, changing scores, or mutating the stored input. */
export function normalizeRoomProgression(original: RoomState): RoomState {
  const room = clone(original);
  for (const player of room.players) {
    player.ruleNumber = ruleNumberFor(player, room.status === 'lobby' ? 1 : room.round);
  }
  if (room.result && room.result.round === room.round && (room.status === 'round-end' || room.status === 'finished')) {
    const enrich = (row: NonNullable<RoomState['result']>['scores'][number]) => {
      const player = room.players.find(candidate => candidate.id === row.playerId);
      if (!player) return row;
      const ruleNumber = ruleNumberFor(row, player.ruleNumber);
      const melded = row.melded ?? player.down;
      return {
        ...row, ruleNumber, melded,
        nextRuleNumber: row.nextRuleNumber ?? Math.min(10, ruleNumber + Number(melded)),
        completed: row.completed ?? (melded && ruleNumber === 10),
      };
    };
    room.result.scores = room.result.scores.map(enrich);
    // Only the current legacy result still has trustworthy per-player down flags.
    // Leave earlier history untouched rather than inventing whether a player melded.
    room.history = room.history.map(result => result.round === room.result!.round && result.winnerId === room.result!.winnerId
      ? { ...result, scores: result.scores.map(enrich) } : result);
  }
  return room;
}

export function cardPoints(card: Card): number {
  const rank = rankOf(card);
  if (rank === 2 || rank === 14) return 20;
  if (rank >= 5 && rank <= 7) return 5;
  if (rank >= 8 && rank <= 13) return 10;
  throw new GameError('Threes and fours are removed from the deck.');
}

export function handPoints(cards: Card[]): number {
  return cards.reduce((total, card) => total + cardPoints(card), 0);
}

export function cardLabel(card: Card | TableCard): string {
  const rank = rankOf(card);
  const label = rank === 14 ? 'A' : rank === 13 ? 'K' : rank === 12 ? 'Q' : rank === 11 ? 'J' : String(rank);
  return label + ({ C: '♣', D: '♦', H: '♥', S: '♠' }[card.suit]);
}

function randomInt(max: number): number {
  if (max <= 1) return 0;
  const cutoff = 0x100000000 - (0x100000000 % max);
  const buffer = new Uint32Array(1);
  do { globalThis.crypto.getRandomValues(buffer); } while (buffer[0] >= cutoff);
  return buffer[0] % max;
}

function shuffled<T>(input: T[]): T[] {
  const result = [...input];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function createDeck(playerCount: number): Card[] {
  const packs = playerCount <= 4 ? 2 : playerCount <= 6 ? 3 : 4;
  const dealId = globalThis.crypto.randomUUID();
  const cards: Card[] = [];
  for (let pack = 0; pack < packs; pack++) {
    for (const suit of SUITS) for (const rank of RANKS) {
      cards.push({ id: `${dealId}-${pack}-${suit}-${rank}`, rank, suit });
    }
  }
  return shuffled(cards);
}

interface SuitPattern { allowed: Suit[][]; unique: boolean; constraint: MeldConstraint }

function suitPatterns(requirement: Requirement, count: number): SuitPattern[] {
  const constraint = requirement.constraint ?? 'any';
  const repeated = (allowed: Suit[], name = constraint): SuitPattern => ({ allowed: Array.from({ length: count }, () => allowed), unique: false, constraint: name });
  switch (constraint) {
    case 'red': return [repeated(RED)];
    case 'black': return [repeated(BLACK)];
    case 'hearts': return [repeated(['H'])];
    case 'clubs': return [repeated(['C'])];
    case 'diamonds': return [repeated(['D'])];
    case 'spades': return [repeated(['S'])];
    case 'same-colour': return [repeated(RED, 'red'), repeated(BLACK, 'black')];
    case 'same-suit': return SUITS.map(suit => repeated([suit]));
    case 'one-each-suit': return [{ allowed: Array.from({ length: count }, () => SUITS), unique: true, constraint }];
    case 'one-each-suit-alternate':
    case 'alternate': return [false, true].map(redFirst => ({
      allowed: Array.from({ length: count }, (_, index) => ((index % 2 === 0) === redFirst) ? RED : BLACK),
      unique: constraint === 'one-each-suit-alternate', constraint,
    }));
    default: return [repeated(SUITS)];
  }
}

function possibleSuits(card: Card, allowed: Suit[], wildsMatch?: boolean): Suit[] {
  if (card.rank !== 2 || wildsMatch) return allowed.includes(card.suit) ? [card.suit] : [];
  return allowed.includes(card.suit) ? [card.suit, ...allowed.filter(suit => suit !== card.suit)] : allowed;
}

function tableCard(card: Card, rank: number, suit: Suit): TableCard {
  return card.rank === 2 ? { ...card, asRank: rank, asSuit: suit } : { ...card };
}

function matchSet(cards: Card[], requirement: Requirement): Meld | null {
  if (requirement.naturalOnly && cards.some(card => card.rank === 2)) return null;
  const naturals = cards.filter(card => card.rank !== 2);
  const rank = naturals.length ? rankOf(naturals[0]) : 5;
  if (naturals.some(card => rankOf(card) !== rank)) return null;
  const ordered = [...naturals, ...cards.filter(card => card.rank === 2)];
  for (const pattern of suitPatterns(requirement, cards.length)) {
    const result: TableCard[] = [];
    const solve = (index: number, used: Set<Suit>): boolean => {
      if (index === ordered.length) return true;
      const card = ordered[index];
      for (const suit of possibleSuits(card, pattern.allowed[index], requirement.wildsMatch)) {
        if (pattern.unique && used.has(suit)) continue;
        result.push(tableCard(card, rank, suit));
        if (solve(index + 1, new Set([...used, suit]))) return true;
        result.pop();
        if (!pattern.unique) break;
      }
      return false;
    };
    if (solve(0, new Set())) return { id: '', ownerId: '', kind: 'set', cards: result, constraint: pattern.constraint, naturalOnly: requirement.naturalOnly, wildsMatch: requirement.wildsMatch, persistentConstraint: requirement.persistentConstraint };
  }
  return null;
}

function matchRun(cards: Card[], requirement: Requirement): Meld | null {
  if (requirement.naturalOnly && cards.some(card => card.rank === 2)) return null;
  const naturals = cards.filter(card => card.rank !== 2);
  const wilds = cards.filter(card => card.rank === 2);
  const naturalRanks = new Set(naturals.map(rankOf));
  if (naturalRanks.size !== naturals.length) return null;
  for (let start = 5; start <= 15 - cards.length; start++) {
    if (naturals.some(card => rankOf(card) < start || rankOf(card) >= start + cards.length)) continue;
    const fixed = Array.from({ length: cards.length }, (_, index) => naturals.find(card => rankOf(card) === start + index));
    for (const pattern of suitPatterns(requirement, cards.length)) {
      const result: TableCard[] = [];
      const solve = (index: number, wildMask: number, usedSuits: Set<Suit>): boolean => {
        if (index === cards.length) return true;
        const seenWildSuits = new Set<Suit>();
        const candidates = fixed[index] ? [{ card: fixed[index]!, wildIndex: -1 }] : wilds.map((card, wildIndex) => ({ card, wildIndex }));
        for (const { card, wildIndex } of candidates) {
          if (wildIndex >= 0 && ((wildMask & (1 << wildIndex)) || seenWildSuits.has(card.suit))) continue;
          if (wildIndex >= 0) seenWildSuits.add(card.suit);
          for (const suit of possibleSuits(card, pattern.allowed[index], requirement.wildsMatch)) {
            if (pattern.unique && usedSuits.has(suit)) continue;
            result.push(tableCard(card, start + index, suit));
            if (solve(index + 1, wildIndex < 0 ? wildMask : wildMask | (1 << wildIndex), new Set([...usedSuits, suit]))) return true;
            result.pop();
            if (!pattern.unique) break;
          }
        }
        return false;
      };
      if (solve(0, 0, new Set())) return { id: '', ownerId: '', kind: 'run', cards: result, constraint: pattern.constraint, naturalOnly: requirement.naturalOnly, wildsMatch: requirement.wildsMatch, persistentConstraint: requirement.persistentConstraint };
    }
  }
  return null;
}

function matchRequirement(cards: Card[], requirement: Requirement): Meld | null {
  if (cards.length !== requirement.count) return null;
  return requirement.kind === 'set' ? matchSet(cards, requirement) : matchRun(cards, requirement);
}

function* combinations(length: number, count: number, from = 0, mask = 0): Generator<number> {
  if (!count) { yield mask; return; }
  for (let index = from; index <= length - count; index++) yield* combinations(length, count - 1, index + 1, mask | (1 << index));
}

const cardsForMask = (cards: Card[], mask: number): Card[] => cards.filter((_, index) => !!(mask & (1 << index)));

/** Allows unused cards internally; the public opening validator requires exact cardinality. */
function searchMelds(cards: Card[], requirements: Requirement[]): Meld[] | null {
  const candidates = requirements.map(requirement => {
    const found: { mask: number; meld: Meld; value: number }[] = [];
    for (const mask of combinations(cards.length, requirement.count)) {
      const subset = cardsForMask(cards, mask);
      const meld = matchRequirement(subset, requirement);
      if (meld) found.push({ mask, meld, value: handPoints(subset) });
    }
    return found.sort((a, b) => b.value - a.value);
  });
  if (candidates.some(group => !group.length)) return null;
  const failed = new Set<string>();
  const solve = (index: number, used: number): Meld[] | null => {
    if (index === requirements.length) return [];
    const key = `${index}:${used}`;
    if (failed.has(key)) return null;
    for (const candidate of candidates[index]) {
      if (candidate.mask & used) continue;
      const remaining = solve(index + 1, used | candidate.mask);
      if (remaining) return [candidate.meld, ...remaining];
    }
    failed.add(key);
    return null;
  };
  return solve(0, 0);
}

const requirementOptions = (definition: RuleDefinition): Requirement[][] => [definition.requirements, ...(definition.alternativeRequirements ?? [])];

/** Each option is a complete contract; its groups never mix with another option. */
function searchOpening(cards: Card[], definition: RuleDefinition): Meld[] | null {
  for (const requirements of requirementOptions(definition)) {
    const melds = searchMelds(cards, requirements);
    if (melds) return melds;
  }
  return null;
}

function customSetMeld(cards: Card[], asRank: number, constraint: MeldConstraint = 'any', wildsMatch = false): Meld {
  return { id: '', ownerId: '', kind: 'set', cards: cards.map(card => tableCard(card, asRank, card.suit)), constraint, wildsMatch };
}
function naturalSetRank(cards: Card[]): number | null {
  if (!cards.length || cards.some(card => card.rank === 2)) return null;
  const rank = rankOf(cards[0]);
  return cards.every(card => rankOf(card) === rank) ? rank : null;
}
function representedSetRank(cards: Card[]): number | null {
  const naturals = cards.filter(card => card.rank !== 2);
  if (!naturals.length) return 5;
  const rank = rankOf(naturals[0]);
  return naturals.every(card => rankOf(card) === rank) ? rank : null;
}
function maskWithout(length: number, used: number) { return ((1 << length) - 1) ^ used; }

function findOriginalOpeningMelds(cards: Card[], round: number): Meld[] | null {
  if (round === 1) {
    const rank = representedSetRank(cards);
    if (rank === null) return null;
    const suitCounts = new Map<Suit, number>();
    for (const card of cards) suitCounts.set(card.suit, (suitCounts.get(card.suit) ?? 0) + 1);
    if (suitCounts.size !== 2 || [...suitCounts.values()].some(count => count !== 2)) return null;
    return [customSetMeld(cards, rank)];
  }
  if (round === 2) {
    for (const fourMask of combinations(cards.length, 4)) {
      const four = cardsForMask(cards, fourMask), fourRank = naturalSetRank(four);
      if (fourRank === null) continue;
      const remainingAfterFour = maskWithout(cards.length, fourMask);
      for (const threeMask of combinations(cards.length, 3)) {
        if (threeMask & ~remainingAfterFour) continue;
        const three = cardsForMask(cards, threeMask), threeRank = naturalSetRank(three);
        if (threeRank === null || threeRank === fourRank) continue;
        const pairMask = remainingAfterFour ^ threeMask;
        const pair = cardsForMask(cards, pairMask), pairRank = naturalSetRank(pair);
        if (pair.length !== 2 || pairRank === null || pairRank === fourRank || pairRank === threeRank) continue;
        return [customSetMeld(four, fourRank), customSetMeld(three, threeRank), customSetMeld(pair, pairRank)];
      }
    }
    return null;
  }
  if (round === 3) {
    const meld = matchRun(cards, run(10, { constraint: 'same-colour', naturalOnly: true }));
    return meld ? [meld] : null;
  }
  if (round === 4) {
    const tripleRank = (group: Card[]) => group.every(card => card.rank === 2) ? 2 : naturalSetRank(group);
    for (const firstMask of combinations(cards.length, 3)) {
      const first = cardsForMask(cards, firstMask), firstRank = tripleRank(first);
      if (firstRank === null) continue;
      const remainingAfterFirst = maskWithout(cards.length, firstMask);
      for (const secondMask of combinations(cards.length, 3)) {
        if (secondMask & ~remainingAfterFirst) continue;
        const second = cardsForMask(cards, secondMask), secondRank = tripleRank(second);
        if (secondRank === null || secondRank === firstRank) continue;
        const thirdMask = remainingAfterFirst ^ secondMask;
        const third = cardsForMask(cards, thirdMask), thirdRank = tripleRank(third);
        if (third.length !== 3 || thirdRank === null || thirdRank === firstRank || thirdRank === secondRank) continue;
        return [customSetMeld(first, firstRank), customSetMeld(second, secondRank), customSetMeld(third, thirdRank)];
      }
    }
    return null;
  }
  if (round === 5) {
    const meld = matchRun(cards, run(6, { constraint: 'alternate', wildsMatch: true, persistentConstraint: true }));
    return meld ? [meld] : null;
  }
  if (round === 6) {
    if (cards.length !== 5 || cards.some(card => card.suit !== cards[0].suit)) return null;
    const naturals = cards.filter(card => card.rank !== 2);
    if (naturals.some(card => rankOf(card) < 10 || rankOf(card) > 14) || new Set(naturals.map(rankOf)).size !== naturals.length) return null;
    const fixed = new Map(naturals.map(card => [rankOf(card), card]));
    const wilds = cards.filter(card => card.rank === 2);
    let wildIndex = 0;
    const ordered: TableCard[] = [];
    for (let rank = 10; rank <= 14; rank++) {
      const card = fixed.get(rank) ?? wilds[wildIndex++];
      if (!card) return null;
      ordered.push(tableCard(card, rank, cards[0].suit));
    }
    return [{ id:'', ownerId:'', kind:'run', cards:ordered, constraint:'same-suit', wildsMatch:true }];
  }
  if (round === 7) {
    const groupInfo = (group: Card[]) => {
      const rank = representedSetRank(group); if (rank === null) return null;
      const red = isRed(group[0].suit); if (group.some(card => isRed(card.suit) !== red)) return null;
      return { rank, constraint: (red ? 'red' : 'black') as MeldConstraint };
    };
    for (const firstMask of combinations(cards.length, 4)) {
      const first = cardsForMask(cards, firstMask), firstInfo = groupInfo(first); if (!firstInfo) continue;
      const second = cardsForMask(cards, maskWithout(cards.length, firstMask)), secondInfo = groupInfo(second); if (!secondInfo) continue;
      let firstRank = firstInfo.rank, secondRank = secondInfo.rank;
      if (first.every(card => card.rank === 2) && firstRank === secondRank) firstRank = secondRank === 5 ? 6 : 5;
      if (second.every(card => card.rank === 2) && firstRank === secondRank) secondRank = firstRank === 5 ? 6 : 5;
      if (firstRank === secondRank) continue;
      return [customSetMeld(first, firstRank, firstInfo.constraint, true), customSetMeld(second, secondRank, secondInfo.constraint, true)];
    }
    return null;
  }
  if (round === 8) {
    const names: Record<Suit, MeldConstraint> = { C:'clubs', D:'diamonds', H:'hearts', S:'spades' };
    const melds: Meld[] = [];
    for (const suit of SUITS) {
      const pair = cards.filter(card => card.suit === suit);
      if (pair.length !== 2) return null;
      const rank = representedSetRank(pair); if (rank === null) return null;
      melds.push(customSetMeld(pair, rank, names[suit], true));
    }
    return melds;
  }
  if (round === 9) {
    for (const pairMask of combinations(cards.length, 2)) {
      const pair = cardsForMask(cards, pairMask), naturals = pair.filter(card => card.rank !== 2), twos = pair.filter(card => card.rank === 2);
      if (naturals.some(card => rankOf(card) !== 14) || (twos.length && (naturals.length !== 1 || twos[0].suit !== naturals[0].suit))) continue;
      const runCards = cardsForMask(cards, maskWithout(cards.length, pairMask));
      const runMeld = matchRun(runCards, run(6)); if (!runMeld) continue;
      return [runMeld, customSetMeld(pair, 14)];
    }
    return null;
  }
  if (round === 10) return searchMelds(cards, [run(5, { constraint:'hearts', wildsMatch:true }), set(3, { constraint:'hearts', wildsMatch:true })]);
  return null;
}

export function findOpeningMelds(cards: Card[], game: GameType, round: number): Meld[] | null {
  const definition = RULES[game]?.[round - 1];
  if (!definition || cards.length !== definition.requirements.reduce((sum, requirement) => sum + requirement.count, 0)) return null;
  if (new Set(cards.map(card => card.id)).size !== cards.length || cards.some(card => !validCard(card))) return null;
  const melds = game === 4 ? findOriginalOpeningMelds(cards, round) : searchOpening(cards, definition);
  return melds?.map((meld, index) => ({ ...meld, id: `opening-${index + 1}` })) ?? null;
}

/**
 * Opening colour, suit and natural-card requirements apply only when going down.
 * Later additions match the set's rank or extend a run, with ordinary wild twos.
 * Keep saved opening metadata and exposed wild assignments intact, including in
 * rooms created under earlier rules; no re-matching or migration is needed.
 */
export function getLayoffTargets(card: Card, melds: Meld[]): LayoffTarget[] {
  return getLayoffGroupTargets([card], melds).map(({ meldId, end, asRank, asSuit }) => ({ meldId, end, asRank, asSuit }));
}

/** Match the entire selection without changing the hand or existing wild assignments. */
export function getLayoffGroupTargets(cards: Card[], melds: Meld[]): GroupLayoffTarget[] {
  if (!Array.isArray(cards) || cards.length < 1 || cards.length > 11 || cards.some(card => !validCard(card))) return [];
  const ids = new Set(cards.map(card => card.id));
  if (ids.size !== cards.length || melds.some(meld => meld.cards.some(card => ids.has(card.id)))) return [];
  const targets: GroupLayoffTarget[] = [];
  const naturals = cards.filter(card => card.rank !== 2);
  const wilds = cards.filter(card => card.rank === 2);
  for (const meld of melds) {
    if (!meld.cards.length) continue;
    if (meld.kind === 'set') {
      const asRank = shownRank(meld.cards[0]);
      if (asRank === 2) {
        if (cards.every(card => card.rank === 2)) {
          const additions = cards.map(card => tableCard(card, 2, card.suit));
          targets.push({ meldId: meld.id, end: 'end', asRank:2, asSuit:additions[0].suit, cards:additions });
        }
        continue;
      }
      if (!Number.isInteger(asRank) || asRank < 5 || asRank > 14 || naturals.some(card => rankOf(card) !== asRank)) continue;
      const additions = [...naturals, ...wilds].map(card => tableCard(card, asRank, card.suit));
      targets.push({ meldId: meld.id, end: 'end', asRank, asSuit: additions[0].suit, cards: additions });
    } else {
      const naturalByRank = new Map(naturals.map(card => [rankOf(card), card]));
      if (naturalByRank.size !== naturals.length) continue;
      for (const end of ['start', 'end'] as const) {
        const step = end === 'start' ? -1 : 1;
        const edge = shownRank(end === 'start' ? meld.cards[0] : meld.cards[meld.cards.length - 1]);
        const ranks = cards.map((_, index) => edge + step * (index + 1));
        if (ranks.some(rank => !Number.isInteger(rank) || rank < 5 || rank > 14) || naturals.some(card => !ranks.includes(rankOf(card)))) continue;
        let wildIndex = 0;
        // Reserve every natural rank first so a wild never consumes a later natural's place.
        const additions = ranks.map(rank => {
          const card = naturalByRank.get(rank) ?? wilds[wildIndex++];
          return tableCard(card, rank, card.suit);
        });
        if (meld.persistentConstraint && meld.constraint === 'alternate') {
          const edgeCard = end === 'start' ? meld.cards[0] : meld.cards[meld.cards.length - 1];
          let expectedRed = !isRed(edgeCard.asSuit ?? edgeCard.suit);
          let validPattern = true;
          for (const addition of additions) {
            if (isRed(addition.suit) !== expectedRed) { validPattern = false; break; }
            expectedRed = !expectedRed;
          }
          if (!validPattern) continue;
        }
        targets.push({ meldId: meld.id, end, asRank: ranks[0], asSuit: additions[0].suit, cards: additions });
      }
    }
  }
  return targets;
}

export function canGoDown(room: PublicRoom): boolean {
  const player = room.players.find(candidate => candidate.id === room.youId);
  return !!player && room.status === 'playing' && room.turnPlayerId === room.youId && room.phase === 'play' && !player.down && player.completedTurns > 0;
}

export function canLayoff(room: PublicRoom): boolean {
  const player = room.players.find(candidate => candidate.id === room.youId);
  return !!player && room.status === 'playing' && room.turnPlayerId === room.youId && room.phase === 'play' && player.down && player.laidDownTurn !== room.turnNumber;
}

export function createPlayer(input: { id: string; name: string; tokenHash: string; color: number; isBot?: boolean; difficulty?: Difficulty; fontId?: PlayerState['fontId']; symbolId?: PlayerState['symbolId'] }): PlayerState {
  const name = input.name.trim();
  if (!name || name.length > 24) throw new GameError('Enter a name between 1 and 24 characters.');
  if (!input.id) throw new GameError('A player ID is required.');
  return {
    id: input.id, name, tokenHash: input.tokenHash, color: input.color, fontId: input.fontId ?? 'default', symbolId: input.symbolId ?? 'initials',
    ruleNumber: 1,
    hand: [], score: 0, down: false, completedTurns: 0, laidDownTurn: null,
    isBot: input.isBot ?? false, difficulty: input.difficulty ?? 'medium',
    ready: true, joinedAt: Date.now(),
  };
}

export function createRoom(code: string, host: PlayerState): RoomState {
  const now = Date.now();
  return {
    code: code.toUpperCase(), hostId: host.id, game: 1, round: 1, status: 'lobby',
    players: [clone(host)], stock: [], discardPile: [], melds: [], turnPlayerId: '',
    phase: 'draw', turnNumber: 0, turnLimitSeconds: 0, turnDeadline: null, showMoveHints: true, result: null, history: [],
    events: [{ id: 1, type: 'join', playerId: host.id, text: `${host.name} created the table.`, at: now }],
    version: 1, createdAt: now, updatedAt: now, botDueAt: 0, lastMoveAt: null, recentActions: [],
  };
}

export function publicRoom(original: RoomState, youId: string): PublicRoom {
  const room = normalizeRoomProgression(original);
  const own = room.players.find(player => player.id === youId);
  return {
    code: room.code, hostId: room.hostId, game: room.game, round: room.round, status: room.status,
    players: room.players.map(({ id, name, color, hand, score, ruleNumber, down, completedTurns, laidDownTurn, isBot, difficulty, ready, fontId, symbolId }) => ({ id, name, color, handCount: hand.length, score, ruleNumber, down, completedTurns, laidDownTurn, isBot, difficulty, ready, fontId: fontId ?? 'default', symbolId: symbolId ?? 'initials' })),
    hand: own?.hand ?? [], youId,
    currentRule: clone(RULES[room.game][ruleNumberFor(own, room.round) - 1]),
    melds: room.melds, turnPlayerId: room.turnPlayerId, phase: room.phase, turnNumber: room.turnNumber,
    stockCount: room.stock.length, discard: room.discardPile.at(-1) ?? null,
    turnLimitSeconds: room.turnLimitSeconds, turnDeadline: room.turnDeadline,
    showMoveHints: room.showMoveHints !== false,
    result: room.result, history: room.history, events: room.events, version: room.version, botDueAt: room.botDueAt,
    updatedAt: room.updatedAt, lastMoveAt: lastMoveAtFor(room),
  };
}

export function roomPreview(room: RoomState): RoomPreview {
  return {
    code: room.code, hostName: room.players.find(player => player.id === room.hostId)?.name ?? 'The host',
    game: room.game, status: room.status, playerCount: room.players.length,
    showMoveHints: room.showMoveHints !== false,
    players: room.players.map(({ id, name, color, isBot, fontId, symbolId }) => ({ id, name, color, isBot, fontId: fontId ?? 'default', symbolId: symbolId ?? 'initials' })),
  };
}

function event(room: RoomState, type: RoomEvent['type'], text: string, playerId?: string, cardId?: string): void {
  const at = Date.now();
  // Preserve legacy move times before a settings event trims the retained history.
  room.lastMoveAt = MOVE_EVENT_TYPES.has(type) ? at : lastMoveAtFor(room);
  room.events.push({ id: (room.events.at(-1)?.id ?? 0) + 1, type, playerId, text, at, ...(cardId ? { cardId } : {}) });
  if (room.events.length > 80) room.events.splice(0, room.events.length - 80);
}

function requireHost(room: RoomState, actor: PlayerState): void {
  if (actor.id !== room.hostId) throw new GameError('Only the host controls this setting.');
}

function requireLobby(room: RoomState): void {
  if (room.status !== 'lobby') throw new GameError('Change the table setup in the lobby before starting.');
}

function requireTurn(room: RoomState, actor: PlayerState, phase?: 'draw' | 'play'): void {
  if (room.status !== 'playing') throw new GameError('This hand is not in progress.');
  if (room.turnPlayerId !== actor.id) throw new GameError('Wait for your turn.');
  if (phase && room.phase !== phase) throw new GameError(phase === 'draw' ? 'You have already drawn. Play or discard a card.' : 'Draw a card before playing.');
}

function resetDeadline(room: RoomState): void {
  room.turnDeadline = room.status === 'playing' && room.turnLimitSeconds > 0 ? Date.now() + room.turnLimitSeconds * 1000 : null;
}

function beginHand(room: RoomState): void {
  room.stock = createDeck(room.players.length);
  room.discardPile = [];
  room.melds = [];
  room.result = null;
  room.status = 'playing';
  room.turnNumber = 1;
  room.phase = 'draw';
  room.turnPlayerId = room.players[(room.round - 1) % room.players.length].id;
  resetDeadline(room);
  for (const player of room.players) {
    player.hand = [];
    player.down = false;
    player.completedTurns = 0;
    player.laidDownTurn = null;
  }
  for (let card = 0; card < 10; card++) for (const player of room.players) player.hand.push(room.stock.pop()!);
  room.discardPile.push(room.stock.pop()!);
  event(room, 'start', `Hand ${room.round} dealt. Complete your own rule to advance.`);
}

function finishHand(room: RoomState, winner: PlayerState): void {
  if (room.status !== 'playing') return;
  const scores = room.players.map(player => {
    const penalty = handPoints(player.hand);
    player.score += penalty;
    const ruleNumber = ruleNumberFor(player, room.round);
    return {
      playerId: player.id, name: player.name, penalty, total: player.score, cards: clone(player.hand),
      ruleNumber, melded: player.down,
      nextRuleNumber: Math.min(10, ruleNumber + Number(player.down)),
      completed: player.down && ruleNumber === 10,
    };
  });
  room.result = { round: room.round, winnerId: winner.id, winnerName: winner.name, scores };
  room.history.push(clone(room.result));
  room.status = scores.some(row => row.completed) ? 'finished' : 'round-end';
  room.turnDeadline = null;
  event(room, 'round-end', `${winner.name} went out and ended hand ${room.round}.`, winner.id);
  if (room.status === 'finished') {
    const best = Math.min(...room.players.map(player => player.score));
    const names = room.players.filter(player => player.score === best).map(player => player.name).join(' and ');
    event(room, 'game-end', `${names} finished with the lowest score: ${best}.`);
  }
}

function paceBots(room: RoomState): void {
  const bot = room.players.find(player => player.id === room.turnPlayerId);
  room.botDueAt = room.status === 'playing' && bot?.isBot ? Date.now() + (room.phase === 'draw' ? 800 : 650) : 0;
}

function removeFromHand(player: PlayerState, cardId: string): Card {
  const index = player.hand.findIndex(card => card.id === cardId);
  if (index < 0) throw new GameError('Choose a card from your own hand.');
  return player.hand.splice(index, 1)[0];
}

function expireTurn(original: RoomState): RoomState {
  let room = clone(original);
  const playerId = room.turnPlayerId;
  const player = room.players.find(candidate => candidate.id === playerId)!;
  const name = player.name;
  // Disable only this expired deadline while applying the ordinary draw/discard rules.
  room.turnDeadline = null;
  if (room.phase === 'draw') {
    const source = room.stock.length || room.discardPile.length > 1 ? 'stock' : 'discard';
    room = applyAction(room, playerId, { type: 'draw', source });
  }
  const hand = room.players.find(candidate => candidate.id === playerId)!.hand;
  const discard = [...hand].sort((a, b) => cardPoints(b) - cardPoints(a))[0];
  room = applyAction(room, playerId, { type: 'discard', cardId: discard.id });
  event(room, 'timeout', `${name}'s turn timed out. A card was discarded and play moved on.`, playerId);
  room.version = original.version + 1;
  room.updatedAt = Date.now();
  return room;
}

export function applyAction(original: RoomState, actorId: string, action: GameAction): RoomState {
  const room = normalizeRoomProgression(original);
  const actor = room.players.find(player => player.id === actorId);
  if (!actor) throw new GameError('Rejoin this table before playing.', 'NOT_IN_ROOM');
  if (!action || typeof action !== 'object') throw new GameError('Choose an action to continue.');
  if (action.type === 'goDown' && action.expectedRuleNumber !== undefined && action.expectedRuleNumber !== ruleNumberFor(actor, room.round)) {
    const currentRule = RULES[room.game][ruleNumberFor(actor, room.round) - 1];
    throw new GameError(`Your current rule is Rule ${currentRule.number}: ${currentRule.title}. Check the updated rule and select your cards again.`, 'RULE_CHANGED');
  }
  const expired = room.status === 'playing' && room.turnDeadline !== null && Date.now() >= room.turnDeadline;
  if (action.type === 'timeout') {
    if (!expired) throw new GameError('The current player still has time.');
    return expireTurn(original);
  }
  if (expired && ['draw', 'goDown', 'layoff', 'layoffMany', 'discard', 'botStep'].includes(action.type)) return expireTurn(original);
  if (action.type === 'botStep') {
    const bot = room.players.find(player => player.id === room.turnPlayerId);
    if (room.status !== 'playing' || !bot?.isBot) throw new GameError('The next move belongs to a human player.');
    return applyAction(original, bot.id, chooseBotAction(publicRoom(room, bot.id), bot.difficulty));
  }
  switch (action.type) {
    case 'setMoveHints': {
      requireHost(room, actor); requireLobby(room);
      if (typeof action.enabled !== 'boolean') throw new GameError('Choose whether move hints are on or off.');
      room.showMoveHints = action.enabled;
      event(room, 'settings', `${actor.name} turned move hints ${action.enabled ? 'on' : 'off'}.`, actor.id);
      break;
    }
    case 'setTurnLimit': {
      requireHost(room, actor); requireLobby(room);
      if (!Number.isInteger(action.seconds) || (action.seconds !== 0 && (action.seconds < 15 || action.seconds > 300))) throw new GameError('Choose Unlimited or a turn limit from 15 to 300 seconds.');
      room.turnLimitSeconds = action.seconds;
      room.turnDeadline = null;
      event(room, 'settings', action.seconds ? `${actor.name} set a ${action.seconds}-second turn limit.` : `${actor.name} selected unlimited turn time.`, actor.id);
      break;
    }
    case 'setGame': {
      requireHost(room, actor); requireLobby(room);
      if (![1,2,3,4].includes(action.game)) throw new GameError('Choose Game 1, Game 2, Game 3 or Original Rules.');
      room.game = action.game;
      event(room, 'settings', `${actor.name} selected Game ${room.game}.`, actor.id);
      break;
    }
    case 'addBot': {
      requireHost(room, actor); requireLobby(room);
      if (room.players.length >= 8) throw new GameError('All eight seats are filled.');
      if (!DIFFICULTIES.includes(action.difficulty)) throw new GameError('Choose easy, medium or hard.');
      const freeColor = Array.from({ length: 8 }, (_, index) => index).find(color => !room.players.some(player => player.color === color)) ?? room.players.length;
      const botNames = ['Alex', 'Sam', 'Riley', 'Charlie', 'Morgan', 'Jamie', 'Taylor', 'Casey'];
      const name = botNames.find(candidate => !room.players.some(player => player.name === candidate)) ?? `AI ${room.players.length}`;
      const bot = createPlayer({ id: `bot-${globalThis.crypto.randomUUID()}`, name, tokenHash: '', color: freeColor, isBot: true, difficulty: action.difficulty });
      room.players.push(bot);
      event(room, 'join', `${name} joined as a ${action.difficulty} AI player.`, bot.id);
      break;
    }
    case 'setDifficulty': {
      requireHost(room, actor); requireLobby(room);
      const bot = room.players.find(player => player.id === action.playerId);
      if (!bot?.isBot) throw new GameError('Choose an AI player.');
      if (!DIFFICULTIES.includes(action.difficulty)) throw new GameError('Choose easy, medium or hard.');
      bot.difficulty = action.difficulty;
      event(room, 'settings', `${bot.name} is now ${action.difficulty}.`, bot.id);
      break;
    }
    case 'removePlayer': {
      requireHost(room, actor); requireLobby(room);
      if (action.playerId === actor.id) throw new GameError('Use Leave table to leave your own seat.');
      const index = room.players.findIndex(player => player.id === action.playerId);
      if (index < 0) throw new GameError('This player has already left.');
      const [removed] = room.players.splice(index, 1);
      event(room, 'leave', `${removed.name} left the table.`, removed.id);
      break;
    }
    case 'leave': {
      requireLobby(room);
      room.players = room.players.filter(player => player.id !== actor.id);
      if (room.hostId === actor.id) room.hostId = room.players.find(player => !player.isBot)?.id ?? room.players[0]?.id ?? '';
      event(room, 'leave', `${actor.name} left the table.`, actor.id);
      break;
    }
    case 'setReady': {
      requireLobby(room);
      if (typeof action.ready !== 'boolean') throw new GameError('Choose your ready status.');
      actor.ready = action.ready;
      event(room, 'settings', `${actor.name} is ${actor.ready ? 'ready' : 'not ready'}.`, actor.id);
      break;
    }
    case 'start': {
      requireHost(room, actor); requireLobby(room);
      if (room.players.length < 2 || room.players.length > 8) throw new GameError('Start with 2 to 8 players. Add an AI player for solo play.');
      if (room.players.some(player => !player.ready)) throw new GameError('Wait for every player to be ready.');
      room.round = 1;
      room.history = [];
      for (const player of room.players) { player.score = 0; player.ruleNumber = 1; }
      beginHand(room);
      break;
    }
    case 'nextHand': {
      requireHost(room, actor);
      if (room.status !== 'round-end') throw new GameError('Finish the current hand before dealing the next one.');
      for (const player of room.players) {
        if (player.down) player.ruleNumber = Math.min(10, ruleNumberFor(player, room.round) + 1);
      }
      room.round++;
      beginHand(room);
      break;
    }
    case 'rematch': {
      requireHost(room, actor);
      if (action.expectedVersion !== undefined) {
        if (!Number.isSafeInteger(action.expectedVersion) || action.expectedVersion < 1) throw new GameError('Refresh your games before starting a rematch.');
        if (room.status !== 'finished' || action.expectedVersion !== room.version) throw new GameError('This game has changed. Review the latest table before starting a rematch.', 'ROOM_CHANGED');
      }
      if (room.status !== 'finished' && room.status !== 'round-end') throw new GameError('Finish the current hand before returning to the lobby.');
      room.status = 'lobby'; room.round = 1; room.stock = []; room.discardPile = []; room.melds = [];
      room.history = []; room.result = null; room.turnPlayerId = ''; room.phase = 'draw'; room.turnNumber = 0; room.turnDeadline = null;
      room.lastMoveAt = null;
      for (const player of room.players) {
        player.score = 0; player.ruleNumber = 1; player.hand = []; player.down = false; player.completedTurns = 0; player.laidDownTurn = null; player.ready = true;
      }
      event(room, 'settings', `${actor.name} opened the lobby for another game.`, actor.id);
      break;
    }
    case 'draw': {
      requireTurn(room, actor, 'draw');
      if (action.source !== 'stock' && action.source !== 'discard') throw new GameError('Choose the draw pile or discard pile.');
      if (action.source === 'stock' && !room.stock.length) {
        if (room.discardPile.length <= 1) throw new GameError('The draw pile is empty. Draw the visible discard.');
        const top = room.discardPile.pop()!;
        room.stock = shuffled(room.discardPile);
        room.discardPile = [top];
      }
      const card = action.source === 'stock' ? room.stock.pop() : room.discardPile.pop();
      if (!card) throw new GameError('The discard pile is empty. Draw from the stock.');
      actor.hand.push(card);
      room.phase = 'play';
      event(room, 'draw', `${actor.name} drew from the ${action.source === 'stock' ? 'draw pile' : 'discard pile'}.`, actor.id);
      break;
    }
    case 'goDown': {
      requireTurn(room, actor, 'play');
      if (actor.down) throw new GameError('You have already gone down. Add to exposed cards on later turns.');
      if (actor.completedTurns < 1) throw new GameError('Complete your first turn before going down.');
      if (!Array.isArray(action.cardIds) || new Set(action.cardIds).size !== action.cardIds.length) throw new GameError('Select each card once.');
      const selected = action.cardIds.map(id => actor.hand.find(card => card.id === id));
      if (selected.some(card => !card)) throw new GameError('Choose opening cards from your own hand.');
      const ruleNumber = ruleNumberFor(actor, room.round);
      const melds = findOpeningMelds(selected as Card[], room.game, ruleNumber);
      if (!melds) throw new GameError(`Rule ${ruleNumber} requires ${RULES[room.game][ruleNumber - 1].title}. Select exactly those cards.`);
      const ids = new Set(action.cardIds);
      actor.hand = actor.hand.filter(card => !ids.has(card.id));
      actor.down = true; actor.laidDownTurn = room.turnNumber;
      room.melds.push(...melds.map(meld => ({ ...meld, id: globalThis.crypto.randomUUID(), ownerId: actor.id })));
      event(room, 'meld', `${actor.name} went down.`, actor.id);
      if (!actor.hand.length) finishHand(room, actor);
      break;
    }
    case 'layoff':
    case 'layoffMany': {
      requireTurn(room, actor, 'play');
      if (!actor.down) throw new GameError('Go down before adding to exposed cards.');
      if (actor.laidDownTurn === room.turnNumber) throw new GameError('Wait until your next turn before adding to any exposed cards.');
      const cardIds = action.type === 'layoff' ? [action.cardId] : action.cardIds;
      if (!Array.isArray(cardIds) || cardIds.length < 1 || cardIds.length > 11 || cardIds.some(id => typeof id !== 'string' || !id || id.length > 100) || new Set(cardIds).size !== cardIds.length) throw new GameError('Select between 1 and 11 different cards.');
      const selected = cardIds.map(id => actor.hand.find(card => card.id === id));
      if (selected.some(card => !card)) throw new GameError('Choose cards from your own hand.');
      const target = getLayoffGroupTargets(selected as Card[], room.melds).find(candidate => candidate.meldId === action.meldId && candidate.end === action.end);
      if (!target) throw new GameError(action.type === 'layoff' ? 'This card does not fit at the selected end of this group.' : 'All selected cards must fit together at the selected end of this group.');
      const meld = room.melds.find(candidate => candidate.id === target.meldId)!;
      // Validate every card before removing any; one accepted request advances one version.
      for (const laid of target.cards) {
        const card = removeFromHand(actor, laid.id);
        if (target.end === 'start') meld.cards.unshift(laid); else meld.cards.push(laid);
        event(room, 'layoff', `${actor.name} added ${cardLabel(card)} to the table.`, actor.id, card.id);
      }
      if (!actor.hand.length) finishHand(room, actor);
      break;
    }
    case 'discard': {
      requireTurn(room, actor, 'play');
      const card = removeFromHand(actor, action.cardId);
      room.discardPile.push(card);
      actor.completedTurns++;
      event(room, 'discard', `${actor.name} discarded ${cardLabel(card)}.`, actor.id, card.id);
      if (!actor.hand.length) finishHand(room, actor);
      else {
        const index = room.players.findIndex(player => player.id === actor.id);
        room.turnPlayerId = room.players[(index + 1) % room.players.length].id;
        room.phase = 'draw'; room.turnNumber++;
        resetDeadline(room);
      }
      break;
    }
    default: throw new GameError('Choose a valid game action.');
  }
  room.version = original.version + 1;
  room.updatedAt = Date.now();
  paceBots(room);
  return room;
}

/** Whether a partial group fits inside some legal completed run. Only the bot's own cards are supplied. */
function partialRunFits(cards: Card[], requirement: Requirement): boolean {
  if (requirement.naturalOnly && cards.some(card => card.rank === 2)) return false;
  const naturals = cards.filter(card => card.rank !== 2);
  const wilds = cards.filter(card => card.rank === 2);
  if (new Set(naturals.map(rankOf)).size !== naturals.length) return false;
  for (let start = 5; start <= 15 - requirement.count; start++) {
    if (naturals.some(card => rankOf(card) < start || rankOf(card) >= start + requirement.count)) continue;
    for (const pattern of suitPatterns(requirement, requirement.count)) {
      let valid = true;
      const used = new Set<Suit>();
      let occupied = 0;
      for (const card of naturals) {
        const slot = rankOf(card) - start;
        if (!pattern.allowed[slot].includes(card.suit) || (pattern.unique && used.has(card.suit))) { valid = false; break; }
        occupied |= 1 << slot;
        used.add(card.suit);
      }
      if (!valid) continue;
      const assignWilds = (index: number, slots: number, suits: Set<Suit>): boolean => {
        if (index === wilds.length) return true;
        for (let slot = 0; slot < requirement.count; slot++) {
          if (slots & (1 << slot)) continue;
          for (const suit of possibleSuits(wilds[index], pattern.allowed[slot], requirement.wildsMatch)) {
            if (pattern.unique && suits.has(suit)) continue;
            if (assignWilds(index + 1, slots | (1 << slot), new Set([...suits, suit]))) return true;
            if (!pattern.unique) break;
          }
        }
        return false;
      };
      if (assignWilds(0, occupied, used)) return true;
    }
  }
  return false;
}

function partialGroupValue(cards: Card[], requirement: Requirement): number {
  if (!cards.length) return 0;
  if (cards.length > requirement.count) return -Infinity;
  const valid = requirement.kind === 'set' ? !!matchSet(cards, requirement) : partialRunFits(cards, requirement);
  if (!valid) return -Infinity;
  const filled = cards.length;
  return filled * 100 + (filled * filled / (requirement.count * requirement.count)) * 16 + (filled === requirement.count ? 32 : 0) + handPoints(cards) * 0.008;
}

/** Disjoint partial-meld planning; cards cannot count towards two opening requirements. */
function makeHandPlanner(hand: Card[], requirements: Requirement[]): (available: number) => number {
  const size = 1 << hand.length;
  const values = requirements.map(requirement => {
    const scores = new Float64Array(size);
    scores.fill(-Infinity); scores[0] = 0;
    for (let count = 1; count <= Math.min(requirement.count, hand.length); count++) {
      for (const mask of combinations(hand.length, count)) scores[mask] = partialGroupValue(cardsForMask(hand, mask), requirement);
    }
    return scores;
  });
  const memo = requirements.map(() => new Map<number, number>());
  const solve = (index: number, available: number): number => {
    if (index === requirements.length) return 0;
    const cached = memo[index].get(available);
    if (cached !== undefined) return cached;
    let best = -Infinity;
    for (let mask = available; ; mask = (mask - 1) & available) {
      const value = values[index][mask];
      if (value > -Infinity) best = Math.max(best, value + solve(index + 1, available ^ mask));
      if (!mask) break;
    }
    memo[index].set(available, best);
    return best;
  };
  return available => solve(0, available);
}

/** Compare complete colour arrangements, keeping disjoint-card planning inside each. */
function makeOpeningPlanner(hand: Card[], definition: RuleDefinition): (available: number) => number {
  const planners = requirementOptions(definition).map(requirements => makeHandPlanner(hand, requirements));
  return available => Math.max(...planners.map(plan => plan(available)));
}

function mediumCardUtility(card: Card, hand: Card[], requirements: Requirement[]): number {
  if (card.rank === 2) return requirements.every(requirement => requirement.naturalOnly) ? -100 : 100;
  let utility = 0;
  for (const requirement of requirements) {
    if (requirement.kind === 'set') {
      const matches = hand.filter(other => other.id !== card.id && rankOf(other) === rankOf(card) && (!['red', 'black', 'hearts'].includes(requirement.constraint ?? '') || possibleSuits(other, requirement.constraint === 'red' ? RED : requirement.constraint === 'black' ? BLACK : ['H'], true).length)).length;
      utility += matches * 16;
    } else {
      for (const other of hand) {
        if (other.id === card.id || other.rank === 2) continue;
        if (requirement.constraint === 'same-suit' && other.suit !== card.suit) continue;
        if (requirement.constraint === 'same-colour' && isRed(other.suit) !== isRed(card.suit)) continue;
        const distance = Math.abs(rankOf(other) - rankOf(card));
        if (distance > 0 && distance < requirement.count) utility += (requirement.count - distance) * 2;
      }
      if (hand.some(other => other.id !== card.id && rankOf(other) === rankOf(card))) utility -= 10;
    }
  }
  return utility - cardPoints(card) * 0.1;
}

function mediumOpeningCardUtility(card: Card, hand: Card[], definition: RuleDefinition): number {
  return Math.max(...requirementOptions(definition).map(requirements => mediumCardUtility(card, hand, requirements)));
}

function bestDiscard(view: PublicRoom, difficulty: Difficulty): Card {
  const hand = view.hand;
  if (hand.length === 1) return hand[0];
  const own = view.players.find(player => player.id === view.youId)!;
  if (own.down) {
    return [...hand].sort((a, b) => {
      const aFits = getLayoffTargets(a, view.melds).length > 0;
      const bFits = getLayoffTargets(b, view.melds).length > 0;
      return Number(aFits) - Number(bFits) || cardPoints(b) - cardPoints(a);
    })[0];
  }
  const definition = RULES[view.game][ruleNumberFor(own, view.round) - 1];
  if (difficulty === 'easy') {
    const naturals = hand.filter(card => card.rank !== 2);
    const choices = naturals.length ? naturals : hand;
    return choices[randomInt(choices.length)];
  }
  if (difficulty === 'medium') return [...hand].sort((a, b) => mediumOpeningCardUtility(a, hand, definition) - mediumOpeningCardUtility(b, hand, definition) || cardPoints(b) - cardPoints(a))[0];
  const planner = makeOpeningPlanner(hand, definition);
  const full = (1 << hand.length) - 1;
  let best = hand[0], bestValue = -Infinity;
  for (let index = 0; index < hand.length; index++) {
    const card = hand[index];
    const remainingMask = full ^ (1 << index);
    // High penalty deadwood leaves first. A wild remains useful while drawing towards a contract.
    const naturalOnly = requirementOptions(definition).every(requirements => requirements.every(requirement => requirement.naturalOnly));
    const flexibility = card.rank === 2 && !naturalOnly ? -1.5 : 0;
    const value = planner(remainingMask) + cardPoints(card) * 0.02 + flexibility;
    if (value > bestValue) { bestValue = value; best = card; }
  }
  return best;
}

/** Deliberately accepts only public state: hidden hands and the stock sequence are unavailable. */
export function chooseBotAction(view: PublicRoom, difficulty: Difficulty = 'medium'): GameAction {
  if (view.status !== 'playing' || view.turnPlayerId !== view.youId) throw new GameError('This AI player is waiting for its turn.');
  const own = view.players.find(player => player.id === view.youId);
  if (!own || !view.hand.length) throw new GameError('This AI player has no active hand.');
  const definition = RULES[view.game][ruleNumberFor(own, view.round) - 1];
  if (view.phase === 'draw') {
    const discard = view.discard;
    if (!view.stockCount && discard) return { type: 'draw', source: 'discard' };
    if (discard && difficulty !== 'easy') {
      if (own.down && getLayoffTargets(discard, view.melds).length) return { type: 'draw', source: 'discard' };
      if (!own.down) {
        const extended = [...view.hand, discard];
        if (searchOpening(extended, definition)) return { type: 'draw', source: 'discard' };
        if (difficulty === 'hard') {
          const planner = makeOpeningPlanner(extended, definition);
          const previous = planner((1 << view.hand.length) - 1);
          const full = (1 << extended.length) - 1;
          let improved = false;
          for (let index = 0; index < view.hand.length; index++) {
            if (planner(full ^ (1 << index)) > previous + 1) { improved = true; break; }
          }
          if (improved) return { type: 'draw', source: 'discard' };
        } else if (mediumOpeningCardUtility(discard, extended, definition) > Math.min(...view.hand.map(card => mediumOpeningCardUtility(card, extended, definition))) + 8) return { type: 'draw', source: 'discard' };
      }
    }
    return { type: 'draw', source: 'stock' };
  }
  if (canGoDown(view)) {
    const opening = searchOpening(view.hand, definition);
    if (opening) return { type: 'goDown', cardIds: opening.flatMap(meld => meld.cards.map(card => card.id)), expectedRuleNumber: ruleNumberFor(own, view.round) };
  }
  if (canLayoff(view)) {
    for (const card of [...view.hand].sort((a, b) => cardPoints(b) - cardPoints(a))) {
      const targets = getLayoffTargets(card, view.melds);
      if (targets.length) return { type: 'layoff', cardId: card.id, meldId: targets[0].meldId, end: targets[0].end };
    }
  }
  return { type: 'discard', cardId: bestDiscard(view, difficulty).id };
}
