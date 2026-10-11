import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's native TypeScript runner requires the explicit file extension.
import { getAudioSettings, initAudio, setAudioSettings } from "../lib/audio.ts";
// @ts-expect-error Node's native TypeScript runner requires the explicit file extension.
import { OPENING_MUSIC_URL, SHUFFLED_MUSIC_URLS } from "../lib/music-playlist.ts";

test("the shared music player honours gestures and settings, advances automatically, and bounds file failures", async () => {
  const globalNames = ["window", "navigator", "Audio"] as const;
  const originals = globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  const stored = new Map<string, string>();
  const page = Object.assign(new EventTarget(), {
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value); },
    },
  });
  const instances: FakeAudio[] = [];
  let rejectNextPlay: string | null = "NotAllowedError";
  let resolveNextPlay: (() => void) | null = null;
  let delayNextPlay = false;

  class FakeAudio extends EventTarget {
    private source: string;
    paused = true;
    ended = false;
    loop = false;
    preload = "";
    volume = 1;
    currentTime = 0;
    error: { code: number } | null = null;
    playCalls = 0;
    attributes = new Map<string, string>();

    constructor(source: string) {
      super();
      this.source = source;
      instances.push(this);
    }
    get src() { return this.source; }
    set src(source: string) {
      this.source = source;
      this.currentTime = 0;
      this.paused = true;
      this.ended = false;
      this.error = null;
    }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    play(): Promise<void> {
      this.playCalls++;
      if (rejectNextPlay) {
        const name = rejectNextPlay;
        rejectNextPlay = null;
        this.paused = true;
        return Promise.reject(new DOMException("Playback rejected", name));
      }
      this.paused = false;
      if (delayNextPlay) {
        delayNextPlay = false;
        return new Promise((resolve) => { resolveNextPlay = resolve; });
      }
      return Promise.resolve();
    }
    pause() { this.paused = true; }
    finish() {
      this.ended = true;
      this.paused = true;
      this.dispatchEvent(new Event("ended"));
    }
    fail() {
      this.error = { code: 4 };
      this.paused = true;
      this.dispatchEvent(new Event("error"));
    }
  }

  Object.defineProperties(globalThis, {
    window: { value: page, configurable: true },
    navigator: { value: { userActivation: { isActive: false } }, configurable: true },
    Audio: { value: FakeAudio, configurable: true },
  });
  const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
  const gesture = () => page.dispatchEvent(new Event("pointerdown"));

  try {
    initAudio();
    assert.equal(instances.length, 0, "Mounting waits for a real interaction");
    gesture();
    await settle();
    const player = instances[0];
    assert.equal(player.src, OPENING_MUSIC_URL);
    assert.equal(player.loop, false);
    assert.ok(player.attributes.has("playsinline"));
    assert.equal(player.playCalls, 1, "An autoplay rejection does not start a retry loop");
    assert.equal(player.paused, true);
    gesture();
    await settle();
    assert.equal(player.playCalls, 2);
    assert.equal(player.paused, false);
    assert.equal(player.src, OPENING_MUSIC_URL, "Blocked autoplay does not consume the opening song");

    player.currentTime = 27;
    for (const disabled of [{ muted: true }, { musicEnabled: false }, { musicVolume: 0 }]) {
      setAudioSettings(disabled);
      assert.equal(player.paused, true);
      assert.equal(player.currentTime, 27);
      setAudioSettings({ muted: false, musicEnabled: true, musicVolume: 0.24 });
      await settle();
      assert.equal(player.paused, false);
      assert.equal(player.src, OPENING_MUSIC_URL);
      assert.equal(player.currentTime, 27, "Toggles resume the current song without restarting");
    }
    assert.equal(player.volume, 0.24);
    assert.equal(getAudioSettings().volume, 0.35, "Music controls preserve effects volume");
    assert.equal(JSON.parse(stored.get("parkes-rummy:audio")!).musicVolume, 0.24);
    const callsBeforeMount = player.playCalls;
    initAudio();
    initAudio();
    assert.equal(instances.length, 1, "Screen changes retain one shared player");
    assert.equal(player.playCalls, callsBeforeMount);

    const additions = new Set<string>();
    for (let song = 0; song < 5; song++) {
      player.finish();
      await settle();
      assert.equal(player.paused, false, "Ended playback starts the next song automatically");
      additions.add(player.src);
      player.dispatchEvent(new Event("ended"));
      assert.equal(additions.has(player.src), true, "A stale ended event does not skip another song");
    }
    assert.deepEqual([...additions].sort(), [...SHUFFLED_MUSIC_URLS].sort());
    const lastOfBatch = player.src;
    player.finish();
    await settle();
    assert.notEqual(player.src, lastOfBatch);
    assert.notEqual(player.src, OPENING_MUSIC_URL);

    setAudioSettings({ musicEnabled: false });
    const callsWhileDisabled = player.playCalls;
    player.finish();
    await settle();
    assert.equal(player.paused, true);
    assert.equal(player.playCalls, callsWhileDisabled, "An end event never bypasses disabled music");
    delayNextPlay = true;
    setAudioSettings({ musicEnabled: true });
    setAudioSettings({ muted: true });
    setAudioSettings({ muted: false });
    const completeOldPlay = resolveNextPlay as (() => void) | null;
    assert.ok(completeOldPlay);
    completeOldPlay();
    await settle();
    assert.equal(player.paused, false, "A stale pending play does not undo rapid mute/unmute");

    const badFiles = new Set<string>();
    const attemptsBeforeFailures = player.playCalls;
    for (let failed = 0; failed < 5; failed++) {
      assert.equal(badFiles.has(player.src), false, "A failed file is never automatically retried");
      badFiles.add(player.src);
      player.fail();
      await settle();
    }
    assert.deepEqual([...badFiles].sort(), [...SHUFFLED_MUSIC_URLS].sort());
    assert.equal(player.paused, true, "All files unavailable leaves playback stopped");
    assert.equal(player.playCalls - attemptsBeforeFailures, 4);
    const stoppedAttempts = player.playCalls;
    for (let tap = 0; tap < 5; tap++) gesture();
    setAudioSettings({ muted: true });
    setAudioSettings({ muted: false });
    await settle();
    assert.equal(player.playCalls, stoppedAttempts, "Further game input cannot loop through failed files");
  } finally {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
