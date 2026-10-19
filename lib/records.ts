import { getRuleExample, naturalOpeningEligible, RULES } from './rummy';
import type { GameType, Meld } from './types';
import type {
  AchievementDefinition, AchievementId, EarnedAchievement, RecordCohortSummary,
  RecordConditions, RecordEvidence, RecordRate, RecordsAggregate, RuleRecordSummary,
} from './records-types';

export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
  { id: 'born-ready', name: 'Born Ready', group: 'Fortunate Deals', repeatable: true, description: 'Receive the complete opening in the initial ten-card deal.' },
  { id: 'chomping-at-the-bit', name: 'Chomping at the Bit', group: 'Fortunate Deals', repeatable: true, description: 'Complete the opening with the first pickup while the first-turn restriction applies.' },
  { id: 'first-chance', name: 'First Chance', group: 'Smart Play', repeatable: true, description: 'Play the opening on the first own turn where Go Down is legal and the complete opening is present.' },
  { id: 'natural-talent', name: 'Natural Talent', group: 'Smart Play', repeatable: true, description: 'Play an opening without twos on a rule allowing wildcards.' },
  { id: 'royal-appointment', name: 'Royal Appointment', group: 'Rule Mastery', repeatable: false, description: 'Play Original Rules’ Royal Flush with natural cards.' },
  { id: 'heart-of-parkes', name: 'Heart of Parkes', group: 'Rule Mastery', repeatable: false, description: 'Complete Original Rules’ Hand of Hearts opening.' },
  { id: 'runway-closed', name: 'Runway Closed', group: 'Smart Play', repeatable: true, description: 'Add the card completing an exposed 5-through-Ace run.' },
  { id: 'borrowed-space', name: 'Borrowed Space', group: 'Smart Play', repeatable: true, description: 'Go out by adding the final card to another player’s meld.' },
  { id: 'six-of-the-best', name: 'Six of the Best', group: 'Rule Mastery', repeatable: false, description: 'Complete Game 2’s six-of-a-kind opening.' },
  { id: 'suit-yourself', name: 'Suit Yourself', group: 'Rule Mastery', repeatable: false, description: 'Complete Game 3’s nine-card same-suit opening.' },
  { id: 'clean-sweep', name: 'Clean Sweep', group: 'Rule Mastery', repeatable: false, description: 'Complete all ten personal rules in a full game across exactly ten deals, without repeating a rule.' },
  { id: 'comeback-kid', name: 'Comeback Kid', group: 'Rivalries', repeatable: false, description: 'Win a full game outright after sharing or holding the highest penalty total after hand three. All-equal scores do not qualify.' },
  { id: 'by-a-whisker', name: 'By a Whisker', group: 'Rivalries', repeatable: true, description: 'Win a full game outright by five points over the next-lowest total.' },
  { id: 'against-the-table', name: 'Against the Table', group: 'Rivalries', repeatable: false, description: 'Win a completed four-human-player full game outright.' },
  { id: 'all-rounder', name: 'All-Rounder', group: 'Rule Mastery', repeatable: false, description: 'Complete all 30 openings across Games 1–3. Original Rules is a separate optional collection.' },
  { id: 'on-a-roll', name: 'On a Roll', group: 'Rivalries', repeatable: true, description: 'Win three consecutive qualifying Quick Play hands. Withdrawal or a loss ends the run; service interruptions and practice do not count.' },
] as const;

export const RECORDS_POLICY = {
  attempts: 'Attempts are settled qualifying hands dealt: completed hands plus deliberate withdrawals. Reconnectable hands stay pending; confirmed service interruptions are listed separately.',
  success: 'Rule success is accepted complete openings divided by settled qualifying hands dealt on the rule, including withdrawals.',
  firstDraw: 'First-Draw Ready uses settled hands where the player made a first pickup. An opening already present in the deal also counts as ready after the pickup.',
  firstChance: 'First-Chance Conversion uses settled hands with a recorded legal opening opportunity. First-turn readiness never counts as a passed legal opportunity.',
  natural: 'Natural Opening Rate uses accepted openings on rules allowing optional wildcards. Natural-only rules and Original Rules’ special natural-twos rule are excluded.',
  comparisons: 'Compare the same complete rule, engine version, format, deal, seat, player count, AI strengths, hints and timer. Equally early openings tie; timestamps never break the tie.',
  penalties: 'Penalty averages include points held on deliberate withdrawal. Recent improvement compares the latest five settled hands with the previous five in the same conditions.',
  onARoll: 'Quick Play streaks use one human and one to three AI opponents, with at most one Hard AI, ordered by attempt start. Loss or withdrawal ends a run. An unfinished attempt prevents a later run from bridging the gap. Confirmed service interruptions, practice and other formats leave the streak unchanged. Each consecutive group of three wins adds one occurrence.',
  history: 'Collection starts with new instrumented games. Earlier deals and readiness are never reconstructed from old final scores.',
  review: 'Private timelines contain only the player’s own pickups, played cards and opening examples. Reviews appear after the hand ends. Long timelines retain the deal, the latest 119 actions and separate milestone evidence.',
} as const;

/** Comparable conditions never include identity, emails, network timings or a future deck. */
export function cohortKey(conditions: RecordConditions): string {
  const count = conditions.playerCount;
  const startingSeat = conditions.startingSeat ?? 0;
  const order = Array.from({ length: count }, (_, index) => conditions.roster[(startingSeat + index) % count]);
  return JSON.stringify([
    conditions.engineVersion, conditions.format, conditions.deal, conditions.singleHand ?? conditions.format === 'quick-play',
    conditions.challengeId ?? null, count, conditions.humanCount,
    (conditions.seat - startingSeat + count) % count,
    order.map(player => player?.isBot ? `ai:${player.difficulty}` : 'human'),
    conditions.hints, conditions.timerSeconds, conditions.ranked === true,
  ]);
}

/** Alias for callers preferring an explicit name. */
export const recordCohortKey = cohortKey;

export function comparableRecords(a: RecordEvidence, b: RecordEvidence): boolean {
  return a.ruleId === b.ruleId && cohortKey(a.conditions) === cohortKey(b.conditions);
}

/** Return null for a non-comparable/incomplete pair, or zero for a shared speed record. */
export function compareOpeningRecords(a: RecordEvidence, b: RecordEvidence): number | null {
  if (!comparableRecords(a, b) || !a.actualOpening || !b.actualOpening
    || a.status === 'started' || b.status === 'started' || !a.eligible || !b.eligible) return null;
  return Math.sign(a.actualOpening.turn - b.actualOpening.turn);
}

function rate(count: number, denominator: number): RecordRate {
  return { count, denominator, rate: denominator ? count / denominator : null };
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/** A start snapshot and retried terminal snapshots describe one physical attempt. */
export function deduplicateRecordEvidence(input: readonly RecordEvidence[]): RecordEvidence[] {
  const latest = new Map<string, RecordEvidence>();
  for (const evidence of input) {
    const key = `${evidence.handId}:${evidence.playerId}`;
    const existing = latest.get(key);
    if (!existing || (existing.status === 'started' && evidence.status !== 'started')
      || (existing.status !== 'started' && evidence.status !== 'started' && (evidence.finishedAt ?? 0) > (existing.finishedAt ?? 0))) latest.set(key, evidence);
  }
  return [...latest.values()];
}

function settledRows(rows: RecordEvidence[]): RecordEvidence[] {
  return rows.filter(row => row.eligible && (row.status === 'completed' || row.status === 'abandoned'));
}

function metrics(rows: RecordEvidence[]) {
  const settled = settledRows(rows);
  const completed = settled.filter(row => row.completed && !!row.actualOpening);
  const firstDraw = settled.filter(row => row.ownTurns >= 1);
  const legal = settled.filter(row => row.firstLegal !== null);
  const natural = completed.filter(row => row.naturalEligible);
  const best = completed.reduce<RecordEvidence | null>((record, row) => !record || row.actualOpening!.turn < record.actualOpening!.turn ? row : record, null);
  return {
    attempts: settled.length, completed: completed.length,
    pending: rows.filter(row => row.eligible && row.status === 'started').length,
    abandoned: settled.filter(row => row.status === 'abandoned').length,
    serviceInterrupted: rows.filter(row => row.status === 'service-interrupted').length,
    successRate: rate(completed.length, settled.length),
    dealtReadyRate: rate(settled.filter(row => row.readyFromDeal).length, settled.length),
    firstDrawReadyRate: rate(firstDraw.filter(row => row.firstDrawReady).length, firstDraw.length),
    firstChanceRate: rate(legal.filter(row => row.actualOpening?.turn === row.firstLegal?.turn && row.opportunitiesPassed === 0).length, legal.length),
    naturalRate: rate(natural.filter(row => row.wildcardCount === 0).length, natural.length),
    medianOpeningTurn: median(completed.map(row => row.actualOpening!.turn)),
    medianClosingTurns: median(settled.flatMap(row => row.wentOut && row.closingTurns !== null ? [row.closingTurns] : [])),
    best,
  };
}

function cohortSummary(rows: RecordEvidence[]): RecordCohortSummary {
  const penalties = settledRows(rows).filter(row => row.penalty !== null).sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
  const recent = penalties.slice(-5).map(row => row.penalty!);
  const previous = penalties.slice(-10, -5).map(row => row.penalty!);
  const openings = settledRows(rows).filter(row => row.actualOpening !== null).sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
  const recentOpenings = openings.slice(-5).map(row => row.actualOpening!.turn);
  const previousOpenings = openings.slice(-10, -5).map(row => row.actualOpening!.turn);
  return {
    cohortKey: cohortKey(rows[0].conditions), conditions: rows[0].conditions, ...metrics(rows),
    averagePenalty: average(penalties.map(row => row.penalty!)), penaltySamples: penalties.length,
    recentPenaltyImprovement: recent.length === 5 && previous.length === 5 ? average(previous)! - average(recent)! : null,
    improvementSamples: { recent: recent.length, previous: previous.length },
    recentOpeningImprovement: recentOpenings.length === 5 && previousOpenings.length === 5 ? median(previousOpenings)! - median(recentOpenings)! : null,
    openingImprovementSamples: { recent: recentOpenings.length, previous: previousOpenings.length },
  };
}

export function ruleRecordCatalog(): Omit<RuleRecordSummary, keyof ReturnType<typeof metrics> | 'cohorts'>[] {
  return ([1, 2, 3, 4] as GameType[]).flatMap(game => RULES[game].map(definition => ({
    ruleId: `${game}:${definition.number}`, game, ruleNumber: definition.number,
    title: definition.title, description: definition.description, definition,
    example: getRuleExample(game, definition.number), naturalEligible: naturalOpeningEligible(game, definition.number),
  })));
}

function qualifiesQuickPlay(row: RecordEvidence): boolean {
  const { conditions } = row;
  return row.eligible && conditions.format === 'quick-play' && conditions.deal === 'random'
    && conditions.humanCount === 1 && conditions.playerCount >= 2 && conditions.playerCount <= 4
    && conditions.roster.filter(player => player.isBot && player.difficulty === 'hard').length <= 1;
}

function earnedAchievements(rows: RecordEvidence[]): { achievements: EarnedAchievement[]; quickPlayStreak: number } {
  const occurrences = new Map<AchievementId, number[]>();
  const add = (id: AchievementId, at: number) => occurrences.set(id, [...(occurrences.get(id) ?? []), at]);
  const settled = settledRows(rows);
  for (const row of settled) {
    for (const id of new Set(row.achievements)) {
      // Lifetime collections/streaks are derived across evidence, never accepted from a single hand.
      if (id !== 'all-rounder' && id !== 'on-a-roll') {
        const count = row.achievementCounts?.[id] ?? 1;
        for (let index = 0; index < count; index++) add(id, row.finishedAt ?? row.startedAt);
      }
    }
  }
  const mastered = new Map<string, number>();
  for (const row of settled) {
    if (row.game !== 4 && row.completed && row.actualOpening) mastered.set(row.ruleId, Math.min(mastered.get(row.ruleId) ?? Infinity, row.finishedAt ?? row.startedAt));
  }
  if (mastered.size === 30) add('all-rounder', Math.max(...mastered.values()));
  let quickPlayStreak = 0;
  for (const row of rows.filter(qualifiesQuickPlay).sort((a, b) => a.startedAt - b.startedAt || a.handId.localeCompare(b.handId))) {
    if (row.status === 'service-interrupted') continue;
    if (row.status === 'completed' && row.wentOut && row.completed) {
      quickPlayStreak++;
      if (quickPlayStreak % 3 === 0) add('on-a-roll', row.finishedAt ?? row.startedAt);
    } else quickPlayStreak = 0;
  }
  const achievements = ACHIEVEMENTS.map(definition => {
    const times = occurrences.get(definition.id) ?? [];
    const count = definition.repeatable ? times.length : Math.min(1, times.length);
    const tier = count >= 100 ? 'gold' : count >= 25 ? 'silver' : count >= 5 ? 'bronze' : count ? 'earned' : null;
    return {
      ...definition, count, tier, earnedAt: times.length ? Math.min(...times) : null,
      nextMilestone: definition.repeatable ? [1, 5, 25, 100].find(value => value > count) ?? null : count ? null : 1,
    } as EarnedAchievement;
  });
  return { achievements, quickPlayStreak };
}

function collectionKey(meld: Meld): string {
  if (meld.kind === 'set') return `${meld.cards.length} of a kind`;
  const suits = new Set(meld.cards.map(card => card.asSuit ?? card.suit));
  return `${meld.cards.length}-card ${suits.size === 1 ? 'suited ' : ''}run`;
}

/** Pure owner aggregate. Call with one authenticated account's server-owned evidence. */
export function aggregateRecords(input: readonly RecordEvidence[]): RecordsAggregate {
  const rows = deduplicateRecordEvidence(input).filter(row => row.eligible || row.status === 'service-interrupted');
  const settled = settledRows(rows);
  const rules = ruleRecordCatalog().map(definition => {
    const matching = rows.filter(row => row.ruleId === definition.ruleId);
    const cohorts = new Map<string, RecordEvidence[]>();
    for (const row of matching) {
      const key = cohortKey(row.conditions);
      cohorts.set(key, [...(cohorts.get(key) ?? []), row]);
    }
    return { ...definition, ...metrics(matching), cohorts: [...cohorts.values()].map(cohortSummary) };
  });
  const { achievements, quickPlayStreak } = earnedAchievements(rows);
  const fullGames = new Map(settled.filter(row => row.conditions.format !== 'quick-play'
    && row.conditions.format !== 'challenge' && !row.conditions.singleHand
    && row.status === 'completed' && row.gameOutcome?.finished && row.gameOutcome.observedFromStart !== false).map(row => [row.gameId, row]));
  const collection = new Map<string, { kind: string; count: number; example: Meld }>();
  for (const row of settled) for (const meld of row.actualOpening?.opening ?? []) {
    const kind = collectionKey(meld);
    const existing = collection.get(kind);
    collection.set(kind, { kind, count: (existing?.count ?? 0) + 1, example: existing?.example ?? meld });
  }
  const overall = metrics(rows);
  return {
    collectedSince: rows.length ? Math.min(...rows.map(row => row.startedAt)) : null,
    summary: {
      attempts: overall.attempts, completed: overall.completed, pending: overall.pending,
      abandoned: overall.abandoned, serviceInterrupted: overall.serviceInterrupted,
      handsWon: settled.filter(row => row.status === 'completed' && row.wentOut).length,
      quickPlayWins: settled.filter(row => qualifiesQuickPlay(row) && row.status === 'completed' && row.wentOut).length,
      fullGames: fullGames.size,
      fullGameWins: [...fullGames.values()].filter(row => row.gameOutcome!.winnerIds.includes(row.playerId)).length,
      masteredRules: rules.filter(row => row.game !== 4 && row.completed > 0).length,
      originalRules: rules.filter(row => row.game === 4 && row.completed > 0).length,
      quickPlayStreak,
    },
    rules, achievements, meldCollection: [...collection.values()],
    recent: rows.filter(row => row.status !== 'started').sort((a, b) => (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt)).slice(0, 30),
  };
}

export interface HeadToHeadRecords {
  completedHands: number; ownHandsWon: number; friendHandsWon: number; otherHandsWon: number;
  ownRulesCompleted: number; friendRulesCompleted: number;
  quickPlayHands: number; ownQuickPlayWins: number; friendQuickPlayWins: number;
  fullGames: number; ownFullGameWins: number; friendFullGameWins: number;
  sharedFullGameWins: number; otherFullGameWins: number;
  interruptedSharedHands: number;
}

/** Aggregate only actual shared tables; matching unrelated random rules is not head-to-head play. */
export function headToHeadRecords(ownInput: readonly RecordEvidence[], friendInput: readonly RecordEvidence[]): HeadToHeadRecords {
  const own = deduplicateRecordEvidence(ownInput);
  const friend = new Map(deduplicateRecordEvidence(friendInput).map(row => [row.handId, row]));
  const shared = own.flatMap(row => {
    const other = friend.get(row.handId);
    return other && row.playerId !== other.playerId && row.gameId === other.gameId ? [{ own: row, friend: other }] : [];
  });
  const finished = shared.filter(pair => pair.own.eligible && pair.friend.eligible
    && pair.own.status === 'completed' && pair.friend.status === 'completed');
  const quick = finished.filter(pair => pair.own.conditions.format === 'quick-play');
  const games = new Map(finished.filter(pair => ['full-game', 'ranked'].includes(pair.own.conditions.format)
    && !pair.own.conditions.singleHand && !pair.friend.conditions.singleHand
    && pair.own.gameOutcome?.finished && pair.friend.gameOutcome?.finished
    && pair.own.gameOutcome.observedFromStart !== false && pair.friend.gameOutcome.observedFromStart !== false).map(pair => [pair.own.gameId, pair]));
  const outcomes = [...games.values()].map(pair => ({
    own: pair.own.gameOutcome!.winnerIds.includes(pair.own.playerId),
    friend: pair.friend.gameOutcome!.winnerIds.includes(pair.friend.playerId),
  }));
  return {
    completedHands: finished.length,
    ownHandsWon: finished.filter(pair => pair.own.wentOut).length,
    friendHandsWon: finished.filter(pair => pair.friend.wentOut).length,
    otherHandsWon: finished.filter(pair => !pair.own.wentOut && !pair.friend.wentOut).length,
    ownRulesCompleted: finished.filter(pair => pair.own.completed).length,
    friendRulesCompleted: finished.filter(pair => pair.friend.completed).length,
    quickPlayHands: quick.length,
    ownQuickPlayWins: quick.filter(pair => pair.own.wentOut).length,
    friendQuickPlayWins: quick.filter(pair => pair.friend.wentOut).length,
    fullGames: games.size,
    ownFullGameWins: outcomes.filter(outcome => outcome.own && !outcome.friend).length,
    friendFullGameWins: outcomes.filter(outcome => outcome.friend && !outcome.own).length,
    sharedFullGameWins: outcomes.filter(outcome => outcome.own && outcome.friend).length,
    otherFullGameWins: outcomes.filter(outcome => !outcome.own && !outcome.friend).length,
    interruptedSharedHands: shared.filter(pair => ['abandoned', 'service-interrupted'].includes(pair.own.status)
      || ['abandoned', 'service-interrupted'].includes(pair.friend.status)).length,
  };
}
