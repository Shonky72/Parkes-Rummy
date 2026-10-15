import test from 'node:test';
import assert from 'node:assert/strict';
import { detectInstallEnvironment, phoneInstallGuide, hasSeenInstallGuide, saveInstallGuideSeen, INSTALL_GUIDE_SEEN_KEY } from '../lib/phone-install';

const chrome = 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36';
const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1';
test('detects Chrome, Samsung and Opera before the shared Chrome/Safari tokens', () => {
  assert.deepEqual(detectInstallEnvironment(chrome), { platform: 'android', browser: 'chrome', embedded: false });
  assert.equal(detectInstallEnvironment(chrome + ' SamsungBrowser/28.0').browser, 'samsung');
  assert.equal(detectInstallEnvironment(chrome + ' OPR/89.0').browser, 'opera');
  assert.equal(detectInstallEnvironment(chrome + ' EdgA/140.0').browser, 'other');
});
test('recognises iPhone, iOS Chrome and desktop-style iPads', () => {
  assert.equal(detectInstallEnvironment(iphone).browser, 'safari');
  assert.equal(detectInstallEnvironment(iphone + ' CriOS/140.0').browser, 'chrome');
  assert.equal(detectInstallEnvironment('Mozilla/5.0 (Macintosh) Version/18.0 Safari/605.1', 'MacIntel', 5).platform, 'ios');
  assert.equal(detectInstallEnvironment('Mozilla/5.0 (Macintosh) Version/18.0 Safari/605.1', 'MacIntel', 0).platform, 'desktop');
});
test('detects in-app browsers without treating them as install-capable browsers', () => {
  assert.equal(detectInstallEnvironment(chrome + ' Instagram').embedded, true);
  assert.equal(detectInstallEnvironment(chrome + ' wv').embedded, true);
  assert.equal(detectInstallEnvironment(iphone + ' FBAN/FBIOS').embedded, true);
});
test('every route has three short picture steps and a primary browser-help source', () => {
  for (const platform of ['android', 'ios'] as const) for (const browser of ['chrome', 'safari', 'samsung', 'opera', 'other'] as const) {
    const guide = phoneInstallGuide(platform, browser);
    assert.equal(guide.steps.length, 3);
    assert.ok(guide.steps.every(step => step.text.length < 210 && step.text.length > 30));
    assert.match(guide.source, /^https:\/\/(support\.google\.com|support\.apple\.com|developer\.samsung\.com|help\.opera\.com)\//);
    if (platform === 'ios') { assert.equal(guide.browser, 'safari'); assert.ok(guide.steps.some(step => step.visual === 'share')); }
  }
});
test('manual fallback does not show Android Chrome menu instructions on iOS', () => {
  const guide = phoneInstallGuide('ios', 'chrome');
  assert.match(guide.note!, /Safari first/);
  assert.ok(!guide.steps.some(step => step.text.includes('three dots')));
});
test('seen state is distinct from installation and handles unavailable storage', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  assert.equal(hasSeenInstallGuide(storage), false);
  saveInstallGuideSeen(storage);
  assert.equal(hasSeenInstallGuide(storage), true);
  assert.equal(values.get(INSTALL_GUIDE_SEEN_KEY), 'yes');
  assert.equal(values.size, 1);
  const blocked = { getItem: () => { throw new Error('Blocked'); }, setItem: () => { throw new Error('Blocked'); } };
  assert.equal(hasSeenInstallGuide(blocked), false);
  assert.doesNotThrow(() => saveInstallGuideSeen(blocked));
});
