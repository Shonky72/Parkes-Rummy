import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Node's native TypeScript runner requires the explicit file extension.
import { createClientIdentityGuard, safeAccountReturnPath } from '../lib/client-identity.ts';

test('identity changes invalidate pending work synchronously, including signing back into the same account', () => {
  const identity = createClientIdentityGuard();
  const guest = identity.get();
  const notifications: boolean[] = [];
  const stop = identity.subscribe(() => notifications.push(identity.current(guest)));
  const firstAccount = identity.change('player-a');
  assert.deepEqual(notifications, [false]);
  assert.equal(identity.current(guest), false);
  assert.equal(identity.current(firstAccount), true);
  assert.equal(identity.change('player-a'), firstAccount, 'Same account refresh preserves active game state');
  assert.equal(notifications.length, 1);
  const signingOut = identity.change(null, false);
  assert.equal(identity.current(firstAccount), false);
  assert.equal(identity.current(signingOut), false, 'An unresolved session cannot issue requests');
  const secondAccountVisit = identity.change('player-a');
  assert.equal(identity.current(firstAccount), false, 'Late work from a prior visit must stay obsolete');
  assert.equal(identity.current(secondAccountVisit), true);
  assert.ok(secondAccountVisit.epoch > firstAccount.epoch);
  stop();
});

test('Google return paths preserve only safe rooms and explicit progress destinations', () => {
  assert.equal(safeAccountReturnPath('/join/ABCD'), '/join/ABCD');
  assert.equal(safeAccountReturnPath('/join/ABCD12'), '/join/ABCD12');
  for (const path of ['/profile', '/competition', '/ladder', `/challenge/${'a'.repeat(43)}`]) assert.equal(safeAccountReturnPath(path), path);
  for (const path of ['/', '/join/ABC', '/join/ABCDE', '/join/abcd', '/join/ABCD?next=https://other.test', '/join/ABCD#hand', '//other.test', 'https://other.test/join/ABCD', '/\\other.test', '/join/%2F%2Fevil', '/api/auth/sign-out']) {
    assert.equal(safeAccountReturnPath(path), '/');
  }
  for (const path of ['/profile?next=https://evil.test', '/challenge/short', `/challenge/${'a'.repeat(43)}/admin`, '/competition#redirect', '/ladder/../../api/auth/sign-out']) assert.equal(safeAccountReturnPath(path), '/');
});
