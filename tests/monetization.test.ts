import test from 'node:test';
import assert from 'node:assert/strict';
import { formatAudCents, shouldShowAds } from '../lib/monetization';

test('ads are limited to approved non-play surfaces', () => {
  assert.equal(shouldShowAds({ adFree: false, surface: 'home' }), true);
  assert.equal(shouldShowAds({ adFree: false, surface: 'lobby' }), true);
  assert.equal(shouldShowAds({ adFree: false, surface: 'scores' }), true);
  assert.equal(shouldShowAds({ adFree: false, surface: 'round-result' }), true);
  assert.equal(shouldShowAds({ adFree: false, surface: 'final-result' }), true);
  assert.equal(shouldShowAds({ adFree: true, surface: 'home' }), false);
  assert.equal(shouldShowAds({ adFree: false, surface: 'scores', activePlay: true }), false);
});

test('remove ads price is A$1.99', () => {
  assert.match(formatAudCents(199), /1\.99/);
});
