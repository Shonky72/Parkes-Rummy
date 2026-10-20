import test from 'node:test';
import assert from 'node:assert/strict';
import { formatAudCents, isAdvertisingGuidePath, shouldShowAds, type AdSurface } from '../lib/monetization';

test('only the five standalone public guides are eligible for manual advertising', () => {
  for (const pathname of ['/how-to-play', '/rules', '/scoring', '/help', '/progress-help']) {
    assert.equal(isAdvertisingGuidePath(pathname), true, pathname);
    assert.equal(shouldShowAds({ adFree: false, surface: 'guide', pathname }), true, pathname);
  }
});

test('gameplay, navigation, private pages, alerts and unknown paths remain excluded', () => {
  for (const pathname of ['/', '/play', '/tutorial', '/install', '/store', '/about-help', '/privacy', '/terms', '/cookies', '/data-account', '/profile', '/competition', '/ladder', '/admin/activity', '/join/ABCD', '/challenge/test', '/api/account/session', '/404', '/rules/unknown', '/rules/', '/%72ules', '//rules', 'https://parkesrummy.com/rules', '', null, undefined]) {
    assert.equal(isAdvertisingGuidePath(pathname), false, String(pathname));
    assert.equal(shouldShowAds({ adFree: false, surface: 'guide', pathname: pathname ?? null }), false, String(pathname));
  }
});

test('query strings and fragments never make an excluded route eligible', () => {
  for (const pathname of ['/?tab=store', '/?tab=games', '/play?tab=store', '/play?next=/rules', '/profile?pathname=/help', '/join/ABCD#/rules', '/rules-preview?path=/rules']) {
    assert.equal(isAdvertisingGuidePath(pathname), false, pathname);
  }
  for (const pathname of ['/rules?utm_source=share', '/how-to-play#going-down', '/scoring?from=home#example']) {
    assert.equal(isAdvertisingGuidePath(pathname), true, pathname);
  }
});

test('old ad surfaces and active play stay excluded even when given a guide pathname', () => {
  for (const surface of ['home', 'lobby', 'scores', 'round-result', 'final-result', 'loading', 'error']) {
    assert.equal(shouldShowAds({ adFree: false, surface: surface as AdSurface, pathname: '/rules' }), false, surface);
  }
  assert.equal(shouldShowAds({ adFree: false, surface: 'guide', pathname: '/rules', activePlay: true }), false);
  assert.equal(shouldShowAds({ adFree: true, surface: 'guide', pathname: '/rules' }), false);
});

test('remove ads price is A$1.99', () => {
  assert.match(formatAudCents(199), /1\.99/);
});
