import type { Difficulty, GameType, PublicRoom, RoomState } from './types';

export const CHALLENGE_ENGINE_VERSION = 'parkes-challenge-v1' as const;
export type ChallengeEngineVersion = typeof CHALLENGE_ENGINE_VERSION;

/** Server-private definition. Never return this object or its seed to a client. */
export interface ChallengeConfig {
  id: string;
  engineVersion: ChallengeEngineVersion;
  seed: string;
  game: GameType;
  ruleNumber: number;
  humanSeat: number;
  startingSeat: number;
  /** Bot difficulties in seating order, excluding the human's seat. */
  difficulties: Difficulty[];
  showMoveHints: boolean;
}

export interface PrivateChallengeState {
  config: ChallengeConfig;
  randomCursor: number;
  humanPlayerId: string;
  /** Assigned atomically by the persistence layer; never accepted from a browser. */
  attemptId?: string;
  /** Server-assigned attempt close time; late actions never enter standings. */
  deadlineAt?: number;
  practice: boolean;
}

export interface ChallengeRoom extends RoomState { challenge: PrivateChallengeState }

export interface PublicChallengeInfo {
  id: string; engineVersion: ChallengeEngineVersion; game: GameType; ruleNumber: number;
  humanSeat: number; startingSeat: number; difficulties: Difficulty[]; showMoveHints: boolean;
  practice: boolean;
  deadlineAt?: number;
}

export interface PublicChallengeRoom extends PublicRoom { challenge: PublicChallengeInfo }

export type ChallengeOutcome = 'completed' | 'abandoned' | 'service-interrupted';
export interface ChallengeScore {
  completed: boolean;
  openingTurn: number | null;
  wentOut: boolean;
  closingTurns: number | null;
  penalty: number;
  outcome: ChallengeOutcome;
}

export interface DailyChallengeResult {
  challengeId: string; day: string; accountId: string; score: ChallengeScore;
  /** Only the unique reserved first attempt belongs in published standings. */
  firstAttempt: boolean;
  practice?: boolean;
}

export interface ChallengeTotal {
  points: number; attempts: number; completions: number; wentOut: number;
  abandoned: number; serviceInterrupted: number;
}

export interface WeeklyChallengeTotal extends ChallengeTotal {
  week: string; countedDays: string[]; availableDays: number;
}

export interface DuelTotal extends ChallengeTotal {
  completedDeals: number; expectedDeals: 3; complete: boolean;
}

export interface ConsistencyAttempt {
  accountId: string; displayName: string; ruleId: string; cohortKey: string;
  completed: boolean; openingTurn: number | null; penalty: number | null;
  eligible: boolean;
  status: 'completed' | 'abandoned' | 'service-interrupted' | 'started';
}

export interface ConsistencyStanding {
  accountId: string; displayName: string; ruleId: string; cohortKey: string;
  attempts: number; completed: number; abandoned: number; pending: number; completionRate: number;
  medianOpeningTurn: number | null; averagePenalty: number | null;
  minimumAttempts: number; provisional: boolean; rank: number;
}

export interface LadderPlayer { rating: number; ratedGames: number }
export type LadderResult = 'first' | 'second' | 'tie';
export interface LadderEligibility {
  format: string;
  playerCount: number;
  humanCount: number;
  bothOptedIn: boolean;
  showMoveHints: boolean;
  pairRatedGamesToday: number;
  outcome: 'completed' | 'forfeit' | 'service-interrupted';
}

export interface LadderUpdate {
  rated: boolean; reason: string | null;
  first: LadderPlayer & { delta: number; provisional: boolean };
  second: LadderPlayer & { delta: number; provisional: boolean };
}
