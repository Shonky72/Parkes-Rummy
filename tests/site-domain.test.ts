import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Node's native TypeScript runner requires the explicit file extension.
import { canonicalSiteRedirect, originalGamesUrl, ORIGINAL_SITE_ORIGIN, PRIMARY_SITE_ORIGIN } from '../lib/site-domain.ts';

test('the www alias redirects to HTTPS apex while retaining room paths and public query markers', () => {
  for (const origin of ['https://www.parkesrummy.com', 'http://www.parkesrummy.com', 'https://www.parkesrummy.com:8443']) {
    assert.equal(canonicalSiteRedirect(`${origin}/`), `${PRIMARY_SITE_ORIGIN}/`);
    assert.equal(canonicalSiteRedirect(`${origin}/join/ABCD?_game_update=multi-game-turns-v6`), `${PRIMARY_SITE_ORIGIN}/join/ABCD?_game_update=multi-game-turns-v6`);
    assert.equal(canonicalSiteRedirect(`${origin}/join/JT482T`), `${PRIMARY_SITE_ORIGIN}/join/JT482T`);
  }
});

test('the original host, apex and other hosts never redirect', () => {
  for (const origin of [ORIGINAL_SITE_ORIGIN, PRIMARY_SITE_ORIGIN, 'http://localhost:3000', 'https://terminal.local', 'https://www.parkesrummy.com.example.org', 'https://example.org']) {
    assert.equal(canonicalSiteRedirect(`${origin}/join/ABCD`), null, origin);
  }
});

test('malformed, credential-bearing and non-web URLs never produce redirect targets', () => {
  for (const input of ['', '/join/ABCD', 'not a URL', 'ftp://www.parkesrummy.com/join/ABCD', 'https://player:secret@www.parkesrummy.com/join/ABCD']) {
    assert.equal(canonicalSiteRedirect(input), null, input);
  }
});

test('recovery links exist only for the exact new HTTPS origin', () => {
  assert.equal(originalGamesUrl(PRIMARY_SITE_ORIGIN), `${ORIGINAL_SITE_ORIGIN}/`);
  for (const origin of ['', ORIGINAL_SITE_ORIGIN, 'http://parkesrummy.com', 'https://www.parkesrummy.com', 'https://parkesrummy.com:8443', 'https://parkesrummy.com/', 'https://parkesrummy.com.example.org']) {
    assert.equal(originalGamesUrl(origin, 'ABCD'), null, origin);
  }
});

test('recovery links retain only validated current and legacy room codes', () => {
  assert.equal(originalGamesUrl(PRIMARY_SITE_ORIGIN, 'abcd'), `${ORIGINAL_SITE_ORIGIN}/join/ABCD`);
  assert.equal(originalGamesUrl(PRIMARY_SITE_ORIGIN, 'JT 482T'), `${ORIGINAL_SITE_ORIGIN}/join/JT482T`);
  for (const code of ['', 'ABC', 'ABCDE', 'A0CD', 'AB!D', 'ABCD/private', '../ABCD', '//example.org', 'ABCD?token=private', 'ABCD#seat=private', 'https://example.org']) {
    assert.equal(originalGamesUrl(PRIMARY_SITE_ORIGIN, code), `${ORIGINAL_SITE_ORIGIN}/`, code);
  }
});
