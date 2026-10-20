import type { Card, Difficulty, GameType, Meld, RuleDefinition } from './types';

/** Bump when rules, bot decisions, or evidence semantics change. Historical cohorts stay separate. */
export const RECORDS_ENGINE_VERSION = 'parkes-rummy-2026-10-records-v1';
export type RecordFormat = 'full-game' | 'quick-play' | 'challenge' | 'ranked';
export type RecordStatus = 'started' | 'completed' | 'abandoned' | 'service-interrupted';
export type AchievementId = 'born-ready' | 'chomping-at-the-bit' | 'first-chance' | 'natural-talent'
  | 'royal-appointment' | 'heart-of-parkes' | 'runway-closed' | 'borrowed-space'
  | 'six-of-the-best' | 'suit-yourself' | 'clean-sweep' | 'comeback-kid'
  | 'by-a-whisker' | 'against-the-table' | 'all-rounder' | 'on-a-roll';
export interface RecordConditions {
  engineVersion: string; format: RecordFormat; deal: 'random' | 'fixed';
  singleHand?: boolean;
  playerCount: number; humanCount: number; seat: number;
  startingSeat?: number;
  roster: { playerId: string; name: string; isBot: boolean; difficulty: Difficulty }[];
  hints: boolean; timerSeconds: number;
  /** Optional server-controlled identifiers. Never put a challenge seed here. */
  challengeId?: string; ranked?: boolean;
}
export interface RecordMoment {
  turn: number; actionId: number; opening: Meld[];
}
export interface RecordTimelineEntry {
  kind: 'deal' | 'draw' | 'discard' | 'opening' | 'layoff' | 'end' | 'abandonment';
  turn: number; actionId: number; ready: boolean; legal: boolean;
  /** Only the owner's pickup/discard/played cards; no other live hands or stock. */
  cards?: Card[]; source?: 'stock' | 'discard';
  opening?: Meld[]; text: string;
}
export interface RecordGameOutcome {
  finished: boolean; winnerIds: string[]; total: number; hands: number;
  observedFromStart?: boolean;
  scores: { playerId: string; total: number }[];
  /** Ties for highest after three hands count; all-equal scores do not count. */
  highestAfterThree: boolean;
  cleanSweep: boolean;
}
export interface RecordEvidence {
  schemaVersion: 1; gameId: string; handId: string; playerId: string;
  game: GameType; ruleNumber: number; ruleId: string; handNumber: number;
  startedAt: number; finishedAt: number | null; status: RecordStatus;
  eligible: boolean; exclusionReason: string | null; conditions: RecordConditions;
  readyFromDeal: boolean; firstDrawReady: boolean; firstDrawCompletedOpening: boolean;
  /** Deal is turn 0. First pickup is turn 1, before Go Down is permitted. */
  firstReady: RecordMoment | null; firstLegal: RecordMoment | null; actualOpening: RecordMoment | null;
  /** Legal own turns ending without opening, including the eventual final own turn. */
  opportunitiesPassed: number; legalOpportunityTurns: number[];
  firstDiscardSurvived: boolean | null; readinessLostOnDiscard: number;
  completed: boolean; wentOut: boolean; closingTurns: number | null;
  penalty: number | null; totalScore: number | null; ownTurns: number;
  wildcardCount: number | null; naturalEligible: boolean;
  achievements: AchievementId[];
  /** Most badges occur once per hand; Runway Closed records each distinct completed run. */
  achievementCounts?: Partial<Record<AchievementId, number>>;
  /** Bounded owner-only timeline, published only once a hand is over. */
  timeline: RecordTimelineEntry[]; timelineTruncated: boolean;
  gameOutcome: RecordGameOutcome | null;
  endActionId: number | null;
}
export interface RoomRecordEvent {
  eventId: string; type: 'hand-start' | 'hand-end' | 'abandonment';
  gameId: string; handId: string; playerId: string; status: RecordStatus;
  at: number; evidence: RecordEvidence;
}
export interface RoomRecords {
  schemaVersion: 1; engineVersion: string; gameId: string; handId: string | null;
  enabledAt: number; format?: RecordFormat; challengeId?: string;
  completeGameObserved?: boolean;
  /** Account membership is resolved outside the engine; only seat IDs enter. */
  eligiblePlayerIds?: string[];
  observedActionId: number;
  eligible: boolean; exclusionReason: string | null;
  current: Record<string, RecordEvidence>;
  /** Transactional outbox. Drain only after durable persistence in the room CAS. */
  events: RoomRecordEvent[];
}
export interface RecordRate { count: number; denominator: number; rate: number | null }
export interface RecordCohortSummary {
  cohortKey: string; conditions: RecordConditions;
  attempts: number; settledAttempts: number; completed: number; abandoned: number; pending: number; serviceInterrupted: number;
  successRate: RecordRate; settledSuccessRate: RecordRate; dealtReadyRate: RecordRate; firstDrawReadyRate: RecordRate; firstDrawCompletedOpeningRate: RecordRate;
  firstChanceRate: RecordRate; naturalRate: RecordRate;
  medianOpeningTurn: number | null; medianClosingTurns: number | null;
  averagePenalty: number | null; penaltySamples: number;
  recentPenaltyImprovement: number | null; improvementSamples: { recent: number; previous: number };
  recentOpeningImprovement: number | null; openingImprovementSamples: { recent: number; previous: number };
  best: RecordEvidence | null;
}
export interface RuleRecordSummary {
  ruleId: string; game: GameType; ruleNumber: number; title: string; description: string;
  definition: RuleDefinition; example: Meld[]; naturalEligible: boolean;
  attempts: number; settledAttempts: number; completed: number; pending: number; abandoned: number; serviceInterrupted: number;
  successRate: RecordRate; settledSuccessRate: RecordRate; dealtReadyRate: RecordRate; firstDrawReadyRate: RecordRate; firstDrawCompletedOpeningRate: RecordRate;
  firstChanceRate: RecordRate; naturalRate: RecordRate;
  medianOpeningTurn: number | null; medianClosingTurns: number | null;
  best: RecordEvidence | null; cohorts: RecordCohortSummary[];
}
export interface AchievementDefinition {
  id: AchievementId; name: string; description: string;
  group: 'Fortunate Deals' | 'Smart Play' | 'Rule Mastery' | 'Rivalries'; repeatable: boolean;
}
export interface EarnedAchievement extends AchievementDefinition {
  count: number; earnedAt: number | null; tier: 'earned' | 'bronze' | 'silver' | 'gold' | null;
  nextMilestone: number | null;
}
export interface RecordsAggregate {
  collectedSince: number | null;
  summary: {
    attempts: number; settledAttempts: number; completed: number; pending: number; abandoned: number; serviceInterrupted: number;
    handsWon: number; quickPlayWins: number; fullGameWins: number; fullGames: number;
    masteredRules: number; originalRules: number; quickPlayStreak: number;
  };
  rules: RuleRecordSummary[]; achievements: EarnedAchievement[];
  meldCollection: { kind: string; count: number; example: Meld }[];
  /** Final evidence only; the service paginates and enforces owner access. */
  recent: RecordEvidence[];
}
