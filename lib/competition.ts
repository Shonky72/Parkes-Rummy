import type {
  ChallengeScore, ChallengeTotal, ConsistencyAttempt, ConsistencyStanding, DailyChallengeResult,
  DuelTotal, LadderEligibility, LadderPlayer, LadderResult, LadderUpdate, WeeklyChallengeTotal,
} from './competition-types';

export const COMPETITION_TIMEZONE = 'Australia/Sydney';
export const CONSISTENCY_MINIMUM_ATTEMPTS = 20;
export const CHALLENGE_SCORE_TURN_CAP = 9_999;
export const CHALLENGE_MAX_PENALTY = 220;
export const LADDER_FORMAT = 'ranked-human-v1';
export const LADDER_POLICY = Object.freeze({
  format: LADDER_FORMAT, initialRating: 1000, kFactor: 32, provisionalGames: 10,
  playerCount: 2, humanCount: 2, showMoveHints: false, pairGamesPerDay: 2,
  calendarTimezone: COMPETITION_TIMEZONE, reconnectGraceSeconds: 300,
});
export const COMPETITION_POLICY = Object.freeze({
  timezone: COMPETITION_TIMEZONE,
  weekStarts: 'Monday',
  firstScoredAttempts: 1,
  weeklyCountedDays: 5,
  duelDeals: 3,
  abandonedPoints: -1,
  consistencyMinimum: CONSISTENCY_MINIMUM_ATTEMPTS,
  scoring: 'Complete the opening first; then earlier personal opening turn, going out, fewer closing turns, and lower remaining points. Equal results share a place.',
  points: 'Points encode those five priorities as an integer. Turn credits reach their floor at 9,999; the full turn count stays in the record. Weekly and duel totals add the points from counted deals.',
  attempts: 'The first reserved attempt counts. Reconnect resumes the same hand. Replays are practice. Withdrawal scores below every finished hand. Confirmed service interruptions are excluded.',
  weekly: 'Weeks begin Monday at midnight in Sydney. Your best five daily first attempts count. Missing days contribute zero; equal totals share a place.',
  duels: 'Both friends play the same three deals. A duel result is final after all three first attempts settle. Equal point totals are a draw.',
  consistency: 'Twenty qualifying dealt attempts are required for a full ranking. Unfinished and withdrawn hands stay in the denominator. Completion rate comes first, then median personal opening turn. Equal figures share a place.',
  ladder: 'Two humans knowingly choose ranked play with hints off. Ratings start at 1,000 and use Elo with K=32. The first ten rated games are provisional. A tie scores one half. At most two games against the same account count each Sydney day. Confirmed service failures do not change ratings.',
});

type CalendarInput = Date | number | string;
const DAY_MS = 86_400_000;
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: COMPETITION_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});
const timeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: COMPETITION_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function civilDay(day: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new RangeError('Use a YYYY-MM-DD calendar date.');
  const date = new Date(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) throw new RangeError('Invalid calendar date.');
  return date;
}

export function sydneyDayKey(input: CalendarInput = Date.now()): string {
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    civilDay(input);
    return input;
  }
  const date = input instanceof Date ? input : new Date(input);
  if (!Number.isFinite(date.getTime())) throw new RangeError('Invalid competition date.');
  const parts = dayFormatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function shiftCalendarDay(day: string, amount: number): string {
  if (!Number.isSafeInteger(amount)) throw new RangeError('Invalid calendar day offset.');
  const date = civilDay(day);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

/** Monday's civil date, independent of browser timezone and DST day length. */
export function sydneyWeekKey(input: CalendarInput = Date.now()): string {
  const day = sydneyDayKey(input);
  const weekday = civilDay(day).getUTCDay();
  return shiftCalendarDay(day, -((weekday + 6) % 7));
}

export function sydneyMidnight(day: string): number {
  const target = civilDay(day).getTime();
  let timestamp = target;
  for (let pass = 0; pass < 3; pass++) {
    const parts = timeFormatter.formatToParts(timestamp);
    const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)!.value);
    const represented = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    const difference = represented - target;
    if (!difference) return timestamp;
    timestamp -= difference;
  }
  throw new RangeError('Unable to resolve Sydney calendar boundary.');
}

export function sydneyDayBounds(input: CalendarInput = Date.now()) {
  const day = sydneyDayKey(input);
  return { day, week: sydneyWeekKey(day), start: sydneyMidnight(day), end: sydneyMidnight(shiftCalendarDay(day, 1)) };
}

export function competitionCalendar(input: CalendarInput = Date.now()) {
  const day = sydneyDayKey(input);
  const week = sydneyWeekKey(day);
  return { day, week, timezone: COMPETITION_TIMEZONE, weekDays: Array.from({ length: 7 }, (_, index) => shiftCalendarDay(week, index)) };
}

function validateScore(score: ChallengeScore): void {
  if (!score || !['completed', 'abandoned', 'service-interrupted'].includes(score.outcome)) throw new RangeError('Invalid challenge outcome.');
  if (!Number.isSafeInteger(score.penalty) || score.penalty < 0 || score.penalty > CHALLENGE_MAX_PENALTY) throw new RangeError('Invalid remaining-card points.');
  if (score.outcome !== 'completed') return;
  if (typeof score.completed !== 'boolean' || typeof score.wentOut !== 'boolean') throw new RangeError('Invalid challenge result.');
  if (score.completed ? !Number.isSafeInteger(score.openingTurn) || score.openingTurn! < 2 : score.openingTurn !== null) throw new RangeError('Opening turn must match a legal completed opening.');
  if (score.wentOut && !score.completed) throw new RangeError('A player must complete the opening before going out.');
  if (score.wentOut ? !Number.isSafeInteger(score.closingTurns) || score.closingTurns! < 0 : score.closingTurns !== null) throw new RangeError('Closing turns must match going out.');
}

/** Negative means first ranks above second; no timestamp or identifier tiebreak. */
export function compareChallengeScores(first: ChallengeScore, second: ChallengeScore): number {
  validateScore(first); validateScore(second);
  const outcomeOrder = { completed: 0, abandoned: 1, 'service-interrupted': 2 };
  const statusDifference = outcomeOrder[first.outcome] - outcomeOrder[second.outcome];
  if (statusDifference) return statusDifference;
  if (first.outcome !== 'completed') return 0;
  return Number(second.completed) - Number(first.completed)
    || (first.openingTurn ?? Infinity) - (second.openingTurn ?? Infinity)
    || Number(second.wentOut) - Number(first.wentOut)
    || (first.closingTurns ?? Infinity) - (second.closingTurns ?? Infinity)
    || first.penalty - second.penalty
    || 0;
}

/** Mixed-radix integer: every higher-priority digit dominates all lower digits. */
export function challengePoints(score: ChallengeScore): number | null {
  validateScore(score);
  if (score.outcome === 'service-interrupted') return null;
  if (score.outcome === 'abandoned') return COMPETITION_POLICY.abandonedPoints;
  const turnBase = CHALLENGE_SCORE_TURN_CAP + 1;
  const openingCredit = score.completed ? CHALLENGE_SCORE_TURN_CAP - Math.min(score.openingTurn!, CHALLENGE_SCORE_TURN_CAP) : 0;
  const closingCredit = score.wentOut ? CHALLENGE_SCORE_TURN_CAP - Math.min(score.closingTurns!, CHALLENGE_SCORE_TURN_CAP) : 0;
  const penaltyCredit = CHALLENGE_MAX_PENALTY - score.penalty;
  return (((Number(score.completed) * turnBase + openingCredit) * 2 + Number(score.wentOut)) * turnBase + closingCredit) * (CHALLENGE_MAX_PENALTY + 1) + penaltyCredit;
}

export function rankWithTies<T>(items: readonly T[], compare: (first: T, second: T) => number): Array<T & { rank: number }> {
  const sorted = [...items].sort(compare);
  let rank = 0;
  return sorted.map((item, index) => {
    if (index === 0 || compare(sorted[index - 1], item) !== 0) rank = index + 1;
    return { ...item, rank };
  });
}

function emptyTotal(): ChallengeTotal {
  return { points: 0, attempts: 0, completions: 0, wentOut: 0, abandoned: 0, serviceInterrupted: 0 };
}

export function totalChallengeScores(scores: readonly ChallengeScore[]): ChallengeTotal {
  return scores.reduce((total, score) => {
    const points = challengePoints(score);
    if (points === null) { total.serviceInterrupted++; return total; }
    total.points += points;
    total.attempts++;
    if (score.outcome === 'abandoned') total.abandoned++;
    else {
      total.completions += Number(score.completed);
      total.wentOut += Number(score.wentOut);
    }
    return total;
  }, emptyTotal());
}

function sameScore(first: ChallengeScore, second: ChallengeScore): boolean {
  return first.outcome === second.outcome && first.completed === second.completed && first.openingTurn === second.openingTurn
    && first.wentOut === second.wentOut && first.closingTurns === second.closingTurns && first.penalty === second.penalty;
}

function singleAccount(results: readonly DailyChallengeResult[]): void {
  if (new Set(results.map(result => result.accountId)).size > 1) throw new RangeError('Aggregate one account at a time.');
}

/** Duplicate identical rows deduplicate; conflicting claimed first attempts fail closed. */
export function weeklyBestFive(results: readonly DailyChallengeResult[], input: CalendarInput = Date.now()): WeeklyChallengeTotal {
  singleAccount(results);
  const week = sydneyWeekKey(input);
  const unique = new Map<string, DailyChallengeResult>();
  for (const result of results) {
    if (!result.firstAttempt || result.practice || sydneyWeekKey(result.day) !== week) continue;
    validateScore(result.score);
    const previous = unique.get(result.day);
    if (previous && (previous.challengeId !== result.challengeId || !sameScore(previous.score, result.score))) throw new RangeError('More than one first scored daily attempt exists.');
    unique.set(result.day, result);
  }
  const settled = [...unique.values()].filter(result => result.score.outcome !== 'service-interrupted');
  const serviceInterrupted = unique.size - settled.length;
  const chosen = settled.sort((first, second) => challengePoints(second.score)! - challengePoints(first.score)! || first.day.localeCompare(second.day)).slice(0, 5);
  return {
    ...totalChallengeScores(chosen.map(result => result.score)), serviceInterrupted,
    week, countedDays: chosen.map(result => result.day).sort(), availableDays: settled.length,
  };
}

/** Only the three immutable challenge IDs assigned to this duel are counted. */
export function threeDealTotal(results: readonly DailyChallengeResult[], challengeIds: readonly [string, string, string]): DuelTotal {
  singleAccount(results);
  if (new Set(challengeIds).size !== 3) throw new RangeError('A duel requires three distinct controlled deals.');
  const unique = new Map<string, DailyChallengeResult>();
  for (const result of results) {
    if (!result.firstAttempt || result.practice || !challengeIds.includes(result.challengeId)) continue;
    validateScore(result.score);
    const previous = unique.get(result.challengeId);
    if (previous && !sameScore(previous.score, result.score)) throw new RangeError('More than one first scored duel attempt exists.');
    unique.set(result.challengeId, result);
  }
  const settled = [...unique.values()].filter(result => result.score.outcome !== 'service-interrupted');
  const serviceInterrupted = unique.size - settled.length;
  return {
    ...totalChallengeScores(settled.map(result => result.score)), serviceInterrupted,
    completedDeals: settled.length, expectedDeals: 3, complete: settled.length === 3,
  };
}

export function compareChallengeTotals(first: ChallengeTotal, second: ChallengeTotal): number {
  return second.points - first.points;
}

/** Rotation includes every free opening exactly once per 30 weeks. */
export function ruleOfTheWeek(input: CalendarInput = Date.now()): { game: 1 | 2 | 3; ruleNumber: number; ruleId: string; week: string } {
  const week = sydneyWeekKey(input);
  const weeks = Math.floor((civilDay(week).getTime() - civilDay('2026-10-19').getTime()) / (7 * DAY_MS));
  const index = ((weeks % 30) + 30) % 30;
  const game = (1 + Math.floor(index / 10)) as 1 | 2 | 3;
  const ruleNumber = 1 + index % 10;
  return { game, ruleNumber, ruleId: `${game}:${ruleNumber}`, week };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Cohorts never compete across rules, versions, seats, hints, AI or player counts. */
export function consistencyBoard(attempts: readonly ConsistencyAttempt[], options: {
  minimumAttempts?: number; ruleId?: string; cohortKey?: string;
} = {}): ConsistencyStanding[] {
  const minimumAttempts = options.minimumAttempts ?? CONSISTENCY_MINIMUM_ATTEMPTS;
  if (!Number.isSafeInteger(minimumAttempts) || minimumAttempts < 1) throw new RangeError('Choose a positive consistency sample threshold.');
  const groups = new Map<string, ConsistencyAttempt[]>();
  for (const attempt of attempts) {
    if (!attempt.eligible || !['completed', 'abandoned', 'started'].includes(attempt.status)
      || (options.ruleId && attempt.ruleId !== options.ruleId) || (options.cohortKey && attempt.cohortKey !== options.cohortKey)) continue;
    const key = JSON.stringify([attempt.ruleId, attempt.cohortKey, attempt.accountId]);
    const group = groups.get(key) ?? [];
    group.push(attempt); groups.set(key, group);
  }
  const boards = new Map<string, ConsistencyStanding[]>();
  for (const group of groups.values()) {
    const first = group[0];
    const completed = group.filter(attempt => attempt.status === 'completed' && attempt.completed);
    const penalties = group.flatMap(attempt => attempt.penalty === null ? [] : [attempt.penalty]);
    const entry: ConsistencyStanding = {
      accountId: first.accountId, displayName: first.displayName, ruleId: first.ruleId, cohortKey: first.cohortKey,
      attempts: group.length, completed: completed.length, abandoned: group.filter(attempt => attempt.status === 'abandoned').length,
      pending: group.filter(attempt => attempt.status === 'started').length,
      completionRate: completed.length / group.length,
      medianOpeningTurn: median(completed.flatMap(attempt => attempt.openingTurn === null ? [] : [attempt.openingTurn])),
      averagePenalty: penalties.length ? penalties.reduce((sum, value) => sum + value, 0) / penalties.length : null,
      minimumAttempts, provisional: group.length < minimumAttempts, rank: 0,
    };
    const key = JSON.stringify([first.ruleId, first.cohortKey]);
    const board = boards.get(key) ?? [];
    board.push(entry); boards.set(key, board);
  }
  return [...boards.entries()].sort(([first], [second]) => first.localeCompare(second)).flatMap(([, board]) => rankWithTies(board, (first, second) =>
    Number(first.provisional) - Number(second.provisional)
    || second.completed * first.attempts - first.completed * second.attempts
    || (first.medianOpeningTurn ?? Infinity) - (second.medianOpeningTurn ?? Infinity)
    || 0));
}

export function newLadderPlayer(): LadderPlayer { return { rating: LADDER_POLICY.initialRating, ratedGames: 0 }; }
export function ladderProvisional(ratedGames: number): boolean { return ratedGames < LADDER_POLICY.provisionalGames; }

function validateLadderPlayer(player: LadderPlayer): void {
  if (!Number.isFinite(player.rating) || !Number.isSafeInteger(player.ratedGames) || player.ratedGames < 0) throw new RangeError('Invalid ladder player.');
}

export function calculateElo(firstRating: number, secondRating: number, firstScore: 0 | 0.5 | 1) {
  if (!Number.isFinite(firstRating) || !Number.isFinite(secondRating) || ![0, 0.5, 1].includes(firstScore)) throw new RangeError('Invalid Elo result.');
  const expected = 1 / (1 + 10 ** ((secondRating - firstRating) / 400));
  const firstDelta = Math.round(LADDER_POLICY.kFactor * (firstScore - expected)) || 0;
  return { firstRating: firstRating + firstDelta, secondRating: secondRating - firstDelta, firstDelta, secondDelta: firstDelta === 0 ? 0 : -firstDelta };
}

export function ratedPairDayKey(firstAccountId: string, secondAccountId: string, input: CalendarInput = Date.now()): string {
  if (!firstAccountId || !secondAccountId || firstAccountId === secondAccountId) throw new RangeError('Ranked play requires two different accounts.');
  return [sydneyDayKey(input), ...[firstAccountId, secondAccountId].sort().map(encodeURIComponent)].join(':');
}

export function rateHumanLadder(first: LadderPlayer, second: LadderPlayer, result: LadderResult,
  eligibility: LadderEligibility): LadderUpdate {
  validateLadderPlayer(first); validateLadderPlayer(second);
  if (!['first', 'second', 'tie'].includes(result)) throw new RangeError('Invalid ranked result.');
  let reason: string | null = null;
  if (eligibility.format !== LADDER_FORMAT || !eligibility.bothOptedIn) reason = 'Ordinary social games are unranked.';
  else if (eligibility.playerCount !== 2 || eligibility.humanCount !== 2 || eligibility.showMoveHints) reason = 'Ranked play requires two humans with hints off.';
  else if (eligibility.outcome === 'service-interrupted') reason = 'Confirmed service interruption; ratings unchanged.';
  else if (!['completed', 'forfeit'].includes(eligibility.outcome)) reason = 'The ranked result has not settled.';
  else if (!Number.isSafeInteger(eligibility.pairRatedGamesToday) || eligibility.pairRatedGamesToday < 0) throw new RangeError('Invalid rated pair participation count.');
  else if (eligibility.pairRatedGamesToday >= LADDER_POLICY.pairGamesPerDay) reason = 'Two games against this account already counted today in Sydney.';
  else if (eligibility.outcome === 'forfeit' && result === 'tie') reason = 'A forfeit requires a winner.';
  const unchanged = (player: LadderPlayer) => ({ ...player, delta: 0, provisional: ladderProvisional(player.ratedGames) });
  if (reason) return { rated: false, reason, first: unchanged(first), second: unchanged(second) };
  const elo = calculateElo(first.rating, second.rating, result === 'first' ? 1 : result === 'second' ? 0 : 0.5);
  return {
    rated: true, reason: null,
    first: { rating: elo.firstRating, ratedGames: first.ratedGames + 1, delta: elo.firstDelta, provisional: ladderProvisional(first.ratedGames + 1) },
    second: { rating: elo.secondRating, ratedGames: second.ratedGames + 1, delta: elo.secondDelta, provisional: ladderProvisional(second.ratedGames + 1) },
  };
}
