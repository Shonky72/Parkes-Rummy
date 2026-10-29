import type { PlayStreakSummary } from './play-streak';

/** One shared clock keeps the visual landing and the fanfare's final chord together. */
export const STREAK_CELEBRATION_TIMING = Object.freeze({
  holdMs: 1_650,
  rollMs: 1_350,
  landingMs: 3_000,
  messageMs: 3_650,
});

export interface StreakAward {
  day: string;
  handId: string;
  completedAt: number;
  previous: number;
  current: number;
}

/** A result view never awards a different hand or manufactures credit from a visit. */
export function streakAwardForResult(summary: PlayStreakSummary, handId: string): StreakAward | null {
  if (!summary.completedToday || summary.todayFirstHandId !== handId || !handId
    || !Number.isSafeInteger(summary.current) || summary.current < 1
    || !Number.isSafeInteger(summary.todayFirstCompletedAt)
    || summary.todayFirstCompletedAt === null || !/^\d{4}-\d{2}-\d{2}$/.test(summary.today)) return null;
  return {
    day: summary.today, handId, completedAt: summary.todayFirstCompletedAt,
    previous: summary.current - 1, current: summary.current,
  };
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** Device-only presentation memory. The server remains the source of earned streak credit. */
export function createStreakCelebrationHistory(storage: () => StorageLike | undefined) {
  const shown = new Set<string>();
  const keyFor = (accountId: string) => `parkes-rummy:streak-celebration:v1:${encodeURIComponent(accountId)}`;
  const identity = (accountId: string, award: StreakAward) => `${accountId}\u0000${award.day}`;
  const has = (accountId: string, award: StreakAward) => {
    const id = identity(accountId, award);
    if (shown.has(id)) return true;
    try {
      const value = storage()?.getItem(keyFor(accountId));
      if (value === award.day) { shown.add(id); return true; }
    } catch { /* The in-memory guard remains available when storage is blocked. */ }
    return false;
  };
  return {
    has,
    /** Call only after the award section is committed to the page. */
    claim(accountId: string, award: StreakAward): boolean {
      if (!accountId || has(accountId, award)) return false;
      shown.add(identity(accountId, award));
      try { storage()?.setItem(keyFor(accountId), award.day); } catch { /* Keep this visit's claim. */ }
      return true;
    },
  };
}

export const streakCelebrationHistory = createStreakCelebrationHistory(() =>
  typeof window === 'undefined' ? undefined : window.localStorage);
