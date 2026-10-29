import { competitionCalendar, COMPETITION_TIMEZONE, shiftCalendarDay, sydneyDayKey } from './competition';
import type { RecordConditions, RecordEvidence } from './records-types';

export interface PlayStreakSummary {
  today: string;
  timeZone: 'Australia/Sydney';
  current: number;
  best: number;
  completedToday: boolean;
  /** Completed dates within the current Monday to Sunday Sydney week. */
  completedDays: string[];
  todayFirstHandId: string | null;
  todayFirstCompletedAt: number | null;
}

/** Only server-owned completion metadata. Hands, identities and scores stay private. */
export type PlayCompletionReceipt = Pick<RecordEvidence,
  'gameId' | 'handId' | 'status' | 'startedAt' | 'finishedAt' | 'endActionId' | 'eligible' | 'exclusionReason'> & {
  conditions: Pick<RecordConditions, 'format' | 'singleHand' | 'challengeId'>;
  gameOutcome: Pick<NonNullable<RecordEvidence['gameOutcome']>, 'finished' | 'observedFromStart'> | null;
};

/** A completed game counts for every participant, including a player who never melded. */
export function qualifiesForPlayStreak(receipt: PlayCompletionReceipt, now = Date.now()): boolean {
  if (receipt.status !== 'completed' || !Number.isSafeInteger(receipt.finishedAt)
    || receipt.finishedAt === null || receipt.finishedAt < receipt.startedAt || receipt.finishedAt > now
    || !Number.isSafeInteger(receipt.startedAt) || !Number.isSafeInteger(receipt.endActionId)
    || receipt.endActionId === null || receipt.endActionId < 0
    || !receipt.gameOutcome?.finished || receipt.gameOutcome.observedFromStart === false) return false;

  const format = receipt.conditions.format;
  const practice = format === 'challenge' && receipt.exclusionReason === 'challenge practice replay';
  if (!receipt.eligible && !practice) return false;
  if (format === 'quick-play' || format === 'challenge') return true;
  return (format === 'full-game' || format === 'ranked') && !receipt.conditions.singleHand;
}

/** Compute against the current server date, including when no new receipt arrives at midnight. */
export function summarizePlayStreak(receipts: readonly PlayCompletionReceipt[], now = Date.now()): PlayStreakSummary {
  const calendar = competitionCalendar(now);
  const qualified = receipts.filter(receipt => qualifiesForPlayStreak(receipt, now));
  const dates = [...new Set(qualified
    .map(receipt => sydneyDayKey(receipt.finishedAt!)))].sort();
  const completed = new Set(dates);
  let best = 0;
  let run = 0;
  let previous: string | undefined;
  for (const day of dates) {
    run = previous && shiftCalendarDay(previous, 1) === day ? run + 1 : 1;
    best = Math.max(best, run);
    previous = day;
  }
  const completedToday = completed.has(calendar.day);
  let anchor = completedToday ? calendar.day : shiftCalendarDay(calendar.day, -1);
  let current = 0;
  while (completed.has(anchor)) {
    current += 1;
    anchor = shiftCalendarDay(anchor, -1);
  }
  const firstToday = qualified.filter(receipt => sydneyDayKey(receipt.finishedAt!) === calendar.day)
    .sort((a,b) => a.finishedAt! - b.finishedAt! || (a.handId < b.handId ? -1 : a.handId > b.handId ? 1 : 0))[0];
  return {
    today: calendar.day, timeZone: COMPETITION_TIMEZONE, current, best, completedToday,
    completedDays: calendar.weekDays.filter(day => completed.has(day)),
    todayFirstHandId: firstToday?.handId ?? null,
    todayFirstCompletedAt: firstToday?.finishedAt ?? null,
  };
}
