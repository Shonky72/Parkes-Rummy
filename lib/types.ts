import type { FontId, SymbolId } from './store-catalog';
import type { RoomRecords } from './records-types';
export type Suit = 'C' | 'D' | 'H' | 'S';
export type GameType = 1 | 2 | 3 | 4;
export type Difficulty = 'easy' | 'medium' | 'hard';
export interface Card { id: string; rank: number; suit: Suit }
export interface TableCard extends Card { asRank?: number; asSuit?: Suit }
export type MeldConstraint = 'any' | 'same-colour' | 'same-suit' | 'one-each-suit' | 'one-each-suit-alternate' | 'red' | 'black' | 'alternate' | 'hearts' | 'clubs' | 'diamonds' | 'spades';
export interface Meld {
  id: string; ownerId: string; kind: 'set' | 'run'; cards: TableCard[];
  constraint: MeldConstraint; naturalOnly?: boolean; wildsMatch?: boolean; persistentConstraint?: boolean;
}
export interface Requirement {
  kind: 'set' | 'run'; count: number; constraint?: MeldConstraint;
  naturalOnly?: boolean; wildsMatch?: boolean; persistentConstraint?: boolean;
}
export interface RuleDefinition {
  number: number; title: string; description: string; requirements: Requirement[];
  /** Complete alternative openings with the same total card count, never extra groups. */
  alternativeRequirements?: Requirement[][];
}
export interface PlayerState {
  id: string; name: string; color: number; tokenHash: string;
  fontId?: FontId; symbolId?: SymbolId;
  /** Current contract; absent only in rooms saved before individual progression. */
  ruleNumber?: number;
  hand: Card[]; score: number; down: boolean; completedTurns: number;
  laidDownTurn: number | null; isBot: boolean; difficulty: Difficulty;
  ready: boolean; joinedAt: number;
}
export interface PublicPlayer {
  id: string; name: string; color: number; handCount: number; score: number;
  fontId?: FontId; symbolId?: SymbolId;
  /** Supplied by the server; optional for a previously cached room snapshot. */
  ruleNumber?: number;
  down: boolean; completedTurns: number; laidDownTurn: number | null;
  isBot: boolean; difficulty: Difficulty; ready: boolean;
}
export interface RoomEvent {
  id: number; type: 'join' | 'leave' | 'start' | 'draw' | 'meld' | 'layoff' | 'discard' | 'round-end' | 'game-end' | 'settings' | 'timeout';
  playerId?: string; text: string; at: number;
  /** Physical identity only after a card is publicly laid off or discarded. Never included on draws. */
  cardId?: string;
}
export interface ScoreRow {
  playerId: string; name: string; penalty: number; total: number; cards: Card[];
  /** Older completed hands lack progression metadata. */
  ruleNumber?: number; melded?: boolean; nextRuleNumber?: number; completed?: boolean;
}
export interface RoundResult { round: number; winnerId: string; winnerName: string; scores: ScoreRow[] }
export interface RoomState {
  /** Server-private observations and durable outbox. Never included in PublicRoom. */
  records?: RoomRecords;
  /** Ranked admission is server-owned; the match identifier is never public. */
  ranked?: { format: 'ranked-human-v1'; matchId: string };
  /** Present only on new single-hand Quick Play rooms; old saves retain normal progression. */
  quickPlay?: { ruleNumber: number };
  code: string; hostId: string; game: GameType; round: number;
  status: 'lobby' | 'playing' | 'round-end' | 'finished';
  players: PlayerState[]; stock: Card[]; discardPile: Card[]; melds: Meld[];
  turnPlayerId: string; phase: 'draw' | 'play'; turnNumber: number;
  turnLimitSeconds: number; turnDeadline: number | null;
  showMoveHints?: boolean;
  result: RoundResult | null; history: RoundResult[]; events: RoomEvent[];
  version: number; createdAt: number; updatedAt: number; botDueAt: number;
  /** Latest gameplay event, retained independently of the bounded event history. */
  lastMoveAt?: number | null;
  recentActions: string[];
}
export interface PublicRoom {
  /** Announces the locked format without exposing private admission identifiers. */
  ranked?: { format: 'ranked-human-v1' };
  /** Owner-only completed-hand highlight. Absent during play and the lobby. */
  completedRecord?: {
    handId: string; openingTurn: number | null; firstLegalTurn: number | null;
    opportunitiesPassed: number; achievements: string[];
  };
  /** Owner-only finished game identifier; the streak service verifies any daily award. */
  completedPlay?: { handId: string };
  /** Present only on new single-hand Quick Play rooms; old saves retain normal progression. */
  quickPlay?: { ruleNumber: number };
  code: string; hostId: string; game: GameType; round: number;
  status: RoomState['status']; players: PublicPlayer[]; hand: Card[];
  youId: string; melds: Meld[]; turnPlayerId: string; phase: 'draw' | 'play';
  /** Authoritative contract for this seat; absent only from old cached views. */
  currentRule?: RuleDefinition;
  turnNumber: number; stockCount: number; discard: Card | null;
  turnLimitSeconds: number; turnDeadline: number | null;
  showMoveHints?: boolean;
  result: RoundResult | null; history: RoundResult[]; events: RoomEvent[];
  version: number; botDueAt: number;
  /** Optional only for cached views from before saved-game summaries. */
  updatedAt?: number; lastMoveAt?: number | null;
}
export interface RoomPreview {
  /** Present only on new single-hand Quick Play rooms; old saves retain normal progression. */
  quickPlay?: { ruleNumber: number };
  code: string; hostName: string; game: GameType; status: RoomState['status'];
  playerCount: number; players: { id: string; name: string; color: number; isBot: boolean; fontId?: FontId; symbolId?: SymbolId }[];
  showMoveHints?: boolean;
}
/** Seat-authorized metadata for switching tables; excludes all cards and credentials. */
export interface RoomSummary {
  /** Present only on new single-hand Quick Play rooms; old saves retain normal progression. */
  quickPlay?: { ruleNumber: number };
  code: string; game: GameType; status: RoomState['status'];
  hostName: string; isHost: boolean; playerCount: number; playerNames: string[];
  yourPlayerId: string; yourName: string; yourRuleNumber: number; round: number;
  turnPlayerName: string | null; turnPlayerId: string | null; turnNumber: number;
  isYourTurn: boolean; lastMoveAt: number | null; updatedAt: number; version: number;
  turnDeadline: number | null; currentPlayerIsBot: boolean; botDueAt: number;
}
export type RoomSummaryResult =
  | { code: string; status: 200; summary: RoomSummary }
  | { code: string; status: 400 | 401 | 403 | 404 | 500 | 503; error: string };
export interface LayoffTarget { meldId: string; end: 'start' | 'end'; asRank: number; asSuit: Suit }
/** Cards are ordered nearest the chosen end first, ready for consecutive placement. */
export interface GroupLayoffTarget extends LayoffTarget { cards: TableCard[] }
export type GameAction =
  | { type: 'start' | 'nextHand' | 'leave' | 'botStep' | 'timeout' }
  | { type: 'rematch'; expectedVersion?: number }
  | { type: 'setTurnLimit'; seconds: number }
  | { type: 'setMoveHints'; enabled: boolean }
  | { type: 'setGame'; game: GameType }
  | { type: 'addBot'; difficulty: Difficulty }
  | { type: 'setDifficulty'; playerId: string; difficulty: Difficulty }
  | { type: 'removePlayer'; playerId: string }
  | { type: 'setReady'; ready: boolean }
  | { type: 'draw'; source: 'stock' | 'discard' }
  | { type: 'goDown'; cardIds: string[]; expectedRuleNumber?: number }
  | { type: 'layoff'; cardId: string; meldId: string; end: 'start' | 'end' }
  | { type: 'layoffMany'; cardIds: string[]; meldId: string; end: 'start' | 'end' }
  | { type: 'discard'; cardId: string };

export type InvitationPreview=Omit<RoomPreview,'hostName'|'players'>;

