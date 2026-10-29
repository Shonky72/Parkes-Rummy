import test from 'node:test';
import assert from 'node:assert/strict';
import { initAudio, playStreakFanfare, setAudioSettings } from '../lib/audio';

test('streak fanfare follows the result clock and stops on dismiss, mute, and hidden pages', () => {
  const originals = ['window', 'document', 'navigator'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  class Parameter {
    value = 0;
    setValueAtTime(value: number) { this.value = value; }
    linearRampToValueAtTime() {}
    exponentialRampToValueAtTime() {}
    cancelScheduledValues() {}
    setTargetAtTime(value: number) { this.value = value; }
  }
  class Gain {
    gain = new Parameter();
    disconnected = false;
    connect() {}
    disconnect() { this.disconnected = true; }
  }
  class Oscillator {
    type = 'sine';
    frequency = new Parameter();
    starts: number[] = [];
    stops: (number | undefined)[] = [];
    disconnected = false;
    connect() {}
    disconnect() { this.disconnected = true; }
    start(at: number) { this.starts.push(at); }
    stop(at?: number) { this.stops.push(at); }
  }
  const gains: Gain[] = [];
  const sources: Oscillator[] = [];
  class FakeContext {
    state = 'running';
    currentTime = 20;
    destination = {};
    createGain() { const gain = new Gain(); gains.push(gain); return gain; }
    createOscillator() { const source = new Oscillator(); sources.push(source); return source; }
    createDynamicsCompressor() {
      return { threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 }, connect() {} };
    }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    resume() { this.state = 'running'; return Promise.resolve(); }
  }
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const page = Object.assign(new EventTarget(), {
    AudioContext: FakeContext,
    localStorage: { getItem: () => JSON.stringify({ muted: false, volume: 0.35, musicEnabled: false, musicVolume: 0 }), setItem() {} },
  });
  Object.defineProperties(globalThis, {
    window: { value: page, configurable: true },
    document: { value: doc, configurable: true },
    navigator: { value: { userActivation: { isActive: false } }, configurable: true },
  });
  let stop = () => {};
  try {
    initAudio();
    playStreakFanfare();
    assert.equal(sources.length, 0, 'No gesture means no autoplay or delayed sound queue');
    page.dispatchEvent(new Event('pointerdown'));
    stop = playStreakFanfare();
    assert.equal(sources.length, 10, 'Six rising notes then a four-note finish');
    assert.equal(sources[6].starts[0], 23.005, 'The finishing chord starts on the three-second number landing');
    assert.equal(gains[0].gain.value, 0.35 * 0.72, 'The existing effects-volume bus controls the fanfare');
    stop();
    assert.ok(sources.every(source => source.disconnected && source.stops.at(-1) === undefined), 'Dismiss cancels even future scheduled notes');
    const mutedStart = sources.length;
    stop = playStreakFanfare();
    setAudioSettings({ muted: true });
    assert.ok(sources.slice(mutedStart).every(source => source.disconnected));
    const mutedCount = sources.length;
    playStreakFanfare();
    assert.equal(sources.length, mutedCount, 'Mute prevents new notes');
    setAudioSettings({ muted: false });
    assert.equal(sources.length, mutedCount, 'Unmuting never replays a cancelled fanfare');
    stop = playStreakFanfare(true);
    assert.equal(sources.length - mutedCount, 4, 'Reduced motion uses only the immediate completion chord');
    assert.equal(sources[mutedCount].starts[0], 20.005);
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    assert.ok(sources.slice(mutedCount).every(source => source.disconnected));
    const hiddenCount = sources.length;
    playStreakFanfare();
    assert.equal(sources.length, hiddenCount, 'Hidden pages remain silent');
  } finally {
    stop();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
