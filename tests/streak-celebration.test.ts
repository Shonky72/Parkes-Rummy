import test from 'node:test';
import assert from 'node:assert/strict';
import { createStreakCelebrationHistory, streakAwardForResult, STREAK_CELEBRATION_TIMING } from '../lib/streak-celebration';
import type { PlayStreakSummary } from '../lib/play-streak';

const summary: PlayStreakSummary = {
  today: '2026-10-30', timeZone: 'Australia/Sydney', current: 3, best: 7,
  completedToday: true, completedDays: ['2026-10-28', '2026-10-29', '2026-10-30'],
  todayFirstHandId: 'finished-hand', todayFirstCompletedAt: 1_793_304_000_000,
};

test('only the first server-confirmed finished hand earns a daily celebration', () => {
  assert.deepEqual(streakAwardForResult(summary, 'finished-hand'), {
    day: '2026-10-30', handId: 'finished-hand', completedAt: summary.todayFirstCompletedAt,
    previous: 2, current: 3,
  });
  assert.equal(streakAwardForResult(summary, 'later-hand'), null);
  assert.equal(streakAwardForResult(summary, ''), null);
  assert.equal(streakAwardForResult({ ...summary, completedToday: false }, 'finished-hand'), null);
  assert.equal(streakAwardForResult({ ...summary, todayFirstHandId: null }, 'finished-hand'), null);
  assert.equal(streakAwardForResult({ ...summary, todayFirstCompletedAt: null }, 'finished-hand'), null);
  assert.equal(streakAwardForResult({ ...summary, current: 0 }, 'finished-hand'), null);
  assert.equal(streakAwardForResult({ ...summary, current: 1.5 }, 'finished-hand'), null);
  assert.equal(streakAwardForResult({ ...summary, current: NaN }, 'finished-hand'), null);
});

test('a new or restarted streak animates zero to one', () => {
  const award = streakAwardForResult({ ...summary, current: 1 }, 'finished-hand');
  assert.equal(award?.previous, 0);
  assert.equal(award?.current, 1);
});

test('presentation claims survive refresh and remain isolated by account and calendar day', () => {
  const values = new Map<string, string>();
  const storage = () => ({ getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } });
  const award = streakAwardForResult(summary, 'finished-hand')!;
  const original = createStreakCelebrationHistory(storage);
  assert.equal(original.has('player-one', award), false);
  assert.equal(values.size, 0, 'A read does not mark an unseen celebration as presented');
  assert.equal(original.claim('player-one', award), true);
  assert.equal(original.claim('player-one', award), false);
  const refreshed = createStreakCelebrationHistory(storage);
  assert.equal(refreshed.has('player-one', award), true);
  assert.equal(refreshed.claim('player-one', award), false);
  assert.equal(refreshed.claim('player-two', award), true);
  assert.equal(refreshed.claim('player-one', { ...award, day: '2026-10-31', handId: 'next-day', previous: 3, current: 4 }), true);
  assert.equal(refreshed.claim('', award), false);
});

test('blocked storage still suppresses repeated presentation during the current visit', () => {
  const history = createStreakCelebrationHistory(() => { throw new Error('Storage blocked'); });
  const award = streakAwardForResult(summary, 'finished-hand')!;
  assert.equal(history.has('player', award), false);
  assert.equal(history.claim('player', award), true);
  assert.equal(history.claim('player', award), false);
});

test('visual hold and roll share the exact sound landing clock', () => {
  assert.equal(STREAK_CELEBRATION_TIMING.holdMs + STREAK_CELEBRATION_TIMING.rollMs, STREAK_CELEBRATION_TIMING.landingMs);
  assert.ok(STREAK_CELEBRATION_TIMING.holdMs >= 1_500);
  assert.ok(STREAK_CELEBRATION_TIMING.messageMs > STREAK_CELEBRATION_TIMING.landingMs);
});
