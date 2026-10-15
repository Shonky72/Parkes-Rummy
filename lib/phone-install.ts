export type PhonePlatform = 'android' | 'ios';
export type InstallBrowser = 'chrome' | 'safari' | 'samsung' | 'opera' | 'other';
export interface InstallEnvironment { platform: PhonePlatform | 'desktop'; browser: InstallBrowser; embedded: boolean }
export interface InstallStep { title: string; text: string; visual: 'menu' | 'share' | 'add' | 'confirm'; label: string; detail?: string }
export interface InstallGuide { title: string; browser: InstallBrowser; note?: string; steps: InstallStep[]; source: string }

export const INSTALL_GUIDE_SEEN_KEY = 'parkes-rummy:install-guide-seen-v1';
export const INSTALL_GUIDE_EVENT = 'parkes-rummy:install-guide-seen';
export const PHONE_INSTALL_URL = 'https://parkesrummy.com/install';
export const GAME_HOME_URL = 'https://parkesrummy.com/';

/** A convenience hint, never an authority. The player always has manual selectors. */
export function detectInstallEnvironment(userAgent: string, platform = '', maxTouchPoints = 0): InstallEnvironment {
  const ios = /iPad|iPhone|iPod/i.test(userAgent) || (/Mac/i.test(platform) && maxTouchPoints > 1);
  const android = /Android/i.test(userAgent);
  const embedded = /FBAN|FBAV|Instagram|\bwv\b|TikTok|Bytedance|Line\//i.test(userAgent);
  let browser: InstallBrowser = 'other';
  if (/SamsungBrowser\//i.test(userAgent)) browser = 'samsung';
  else if (/OPR\/|OPiOS|Opera|OPT\//i.test(userAgent)) browser = 'opera';
  else if (/EdgA?\/|EdgiOS|FxiOS|Firefox|UCBrowser/i.test(userAgent)) browser = 'other';
  else if (/CriOS\/|Chrome\//i.test(userAgent)) browser = 'chrome';
  else if (/Safari\//i.test(userAgent)) browser = 'safari';
  return { platform: ios ? 'ios' : android ? 'android' : 'desktop', browser, embedded };
}

export function phoneInstallGuide(platform: PhonePlatform, browser: InstallBrowser): InstallGuide {
  if (platform === 'ios') return {
    title: 'iPhone or iPad · Safari', browser: 'safari',
    note: browser === 'safari' ? undefined : 'For these steps, open parkesrummy.com in Safari first. Other iPhone browsers use different menus.',
    source: 'https://support.apple.com/en-au/guide/iphone/iph42ab2f3a7/ios',
    steps: [
      { title: 'Open Share', text: 'Tap Share, the square with an arrow pointing up. In the compact toolbar, open the page menu first, then Share.', visual: 'share', label: 'Share' },
      { title: 'Add to Home Screen', text: 'Scroll down the Share list. Tap Add to Home Screen.', visual: 'add', label: 'Add to Home Screen', detail: 'Not listed? Scroll to Edit Actions.' },
      { title: 'Add your game', text: 'Leave Open as Web App switched on if shown. Tap Add. Look for Parkes Rummy on your home screen.', visual: 'confirm', label: 'Add', detail: 'Open as Web App' },
    ],
  };
  if (browser === 'samsung') return {
    title: 'Android · Samsung Internet', browser, source: 'https://developer.samsung.com/browser/android/web-developer-guide.html',
    steps: [
      { title: 'Open the menu', text: 'Tap the three lines in Samsung Internet. Some versions also show an install or plus icon beside the address.', visual: 'menu', label: 'Menu', detail: 'Three lines' },
      { title: 'Choose Home screen', text: 'Choose Add page to, then Home screen. A direct Install option also works when shown.', visual: 'add', label: 'Add page to', detail: 'Home screen' },
      { title: 'Add your game', text: 'Keep the name Parkes Rummy. Tap Add or Install, then confirm if your phone asks.', visual: 'confirm', label: 'Add' },
    ],
  };
  if (browser === 'opera') return {
    title: 'Android · Opera', browser, source: 'https://help.opera.com/en/mobile/android/',
    note: 'Opera Mini and older versions have different menus. A home-screen shortcut is also fine.',
    steps: [
      { title: 'Open the page menu', text: 'Tap the menu beside the address bar while Parkes Rummy is open.', visual: 'menu', label: 'Page menu' },
      { title: 'Choose Home screen', text: 'Tap Add to or Add bookmark. Choose Home screen, not Speed Dial.', visual: 'add', label: 'Add to', detail: 'Home screen' },
      { title: 'Add your game', text: 'Tap Add, then confirm if asked. Open Parkes Rummy from the new phone icon.', visual: 'confirm', label: 'Add' },
    ],
  };
  return {
    title: 'Android · Chrome', browser: 'chrome',
    note: browser === 'chrome' ? undefined : 'For these steps, open parkesrummy.com in Chrome on your Android phone.',
    source: 'https://support.google.com/chrome/answer/9658361?hl=en&co=GENIE.Platform%3DAndroid',
    steps: [
      { title: 'Open the menu', text: 'Tap the three dots beside the address bar in Chrome.', visual: 'menu', label: 'More', detail: 'Three dots' },
      { title: 'Choose Install', text: 'Tap Install and create shortcut, then Install. Older versions say Add to Home screen or Install app.', visual: 'add', label: 'Install and create shortcut', detail: 'Install' },
      { title: 'Confirm', text: 'Tap Install or Add to confirm. Look for the Parkes Rummy icon on your phone.', visual: 'confirm', label: 'Install' },
    ],
  };
}

/** Visiting help does not prove the app was installed. Keep those states separate. */
export function hasSeenInstallGuide(storage: Pick<Storage, 'getItem'>): boolean {
  try { return storage.getItem(INSTALL_GUIDE_SEEN_KEY) === 'yes'; } catch { return false; }
}
export function saveInstallGuideSeen(storage: Pick<Storage, 'setItem'>): void {
  try { storage.setItem(INSTALL_GUIDE_SEEN_KEY, 'yes'); } catch { /* Privacy mode: this visit still works. */ }
}
