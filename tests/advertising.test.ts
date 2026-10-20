import test from 'node:test';
import assert from 'node:assert/strict';
import { advertisingAllowed } from '../lib/advertising';

const eligible = { enabled: true, consent: 'accepted', ready: true, adFree: false, pathname: '/how-to-play' };

test('accepted consent only permits advertising on an eligible public guide', () => {
  assert.equal(advertisingAllowed(eligible), true);
  for (const pathname of ['/', '/play', '/play?tab=store', '/?tab=games', '/join/ABCD', '/profile', '/competition', '/ladder', '/cookies', '/tutorial', '/missing', null]) {
    assert.equal(advertisingAllowed({ ...eligible, pathname }), false, String(pathname));
  }
});

test('fresh, declined and unrecognised consent values fail closed', () => {
  for (const consent of [null, '', 'declined', 'unknown', 'true']) {
    assert.equal(advertisingAllowed({ ...eligible, consent }), false, String(consent));
  }
});

test('account checking, account errors and account operations cannot open advertising', () => {
  for (const status of ['checking', 'error']) {
    for (const adFree of [false, true]) {
      assert.equal(advertisingAllowed({ ...eligible, ready: status === 'ready', adFree }), false, status);
    }
  }
  for (const operation of ['signin', 'signout', 'changing']) {
    assert.equal(advertisingAllowed({ ...eligible, ready: !operation }), false, operation);
  }
});

test('Remove Ads ownership and disabled advertising override accepted guide consent', () => {
  assert.equal(advertisingAllowed({ ...eligible, adFree: true }), false);
  assert.equal(advertisingAllowed({ ...eligible, enabled: false }), false);
  assert.equal(advertisingAllowed({ ...eligible, adFree: true, ready: false }), false);
});
