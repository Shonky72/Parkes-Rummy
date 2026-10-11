import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Node's native TypeScript runner requires the explicit file extension.
import { facebookInviteUrl } from '../lib/invite-share.ts';

const origin = 'https://parkes-rummy.xshonkyx.chatgpt.site';

test('Facebook invitations share one public room URL for current and legacy rooms', () => {
  for (const code of ['ABCD', 'JT482T']) {
    const invitation = `${origin}/join/${code}`;
    const composer = new URL(facebookInviteUrl(invitation));
    assert.equal(composer.origin, 'https://www.facebook.com');
    assert.equal(composer.pathname, '/sharer/sharer.php');
    assert.deepEqual([...composer.searchParams.keys()], ['u']);
    assert.equal(composer.searchParams.get('u'), invitation);
  }
});

test('Sharing discards query and fragment credentials before composing the external URL', () => {
  const credential = '0123456789abcdef'.repeat(4);
  const invitation = `${origin}/join/ABCD`;
  const shared = facebookInviteUrl(`${invitation}?token=${credential}&name=Private%20Player#seat=${credential}`);
  const composer = new URL(shared);
  assert.equal(composer.searchParams.get('u'), invitation);
  assert.ok(!shared.includes(credential));
  assert.ok(!shared.includes('Private'));
  assert.equal(composer.searchParams.has('quote'), false);
});

test('Malformed links, embedded credentials and non-room paths never become Facebook invitations', () => {
  for (const invitation of [
    '', 'not a URL', '/join/ABCD', 'javascript:alert(1)',
    `http://parkes-rummy.xshonkyx.chatgpt.site/join/ABCD`,
    'https://username:credential@parkes-rummy.xshonkyx.chatgpt.site/join/ABCD',
    `${origin}/api/rooms/ABCD`, `${origin}/join/ABC`, `${origin}/join/ABCDE`,
    `${origin}/join/ABCDEFG`, `${origin}/join/AB!D`, `${origin}/join/ABCD/private`,
  ]) assert.equal(facebookInviteUrl(invitation), '', invitation);
});
