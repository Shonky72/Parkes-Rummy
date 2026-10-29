"use client";

import { createMusicPlaylist } from "./music-playlist";
import { STREAK_CELEBRATION_TIMING } from "./streak-celebration";

/** Sound stays local to this browser. No requests or audio assets are needed for effects. */
export type SoundName =
  | "click"
  | "select"
  | "card"
  | "shuffle"
  | "deal"
  | "join"
  | "turn"
  | "meld"
  | "layoff"
  | "discard"
  | "roundWin"
  | "gameWin"
  | "error";

export interface AudioSettings {
  /** Master mute affects both effects and background music. */
  muted: boolean;
  /** Effects volume, from 0 to 1. */
  volume: number;
  musicEnabled: boolean;
  /** Background music volume, from 0 to 1. */
  musicVolume: number;
}

const STORAGE_KEY = "parkes-rummy:audio";
const SETTINGS_EVENT = "parkes-rummy:audio-settings";
const DEFAULTS: AudioSettings = {
  muted: false,
  volume: 0.35,
  musicEnabled: true,
  musicVolume: 0.16,
};

let settings: AudioSettings = { ...DEFAULTS };
let settingsLoaded = false;
let listenersAttached = false;
let userGestureSeen = false;
let context: AudioContext | null = null;
let master: GainNode | null = null;
let paperBuffer: AudioBuffer | null = null;
let music: HTMLAudioElement | null = null;
let musicStartPending = false;
let musicPlayAttempt = 0;
let musicUnavailable = false;
const musicPlaylist = createMusicPlaylist();
const unavailableMusic = new Set<string>();
let contextResumePending = false;
let queuedGestureSound: { name: SoundName; requestedAt: number } | null = null;
const lastPlayed = new Map<SoundName, number>();
let activeEffects: number[] = [];
let pageActive = true;
let resumeMusicAfterPage = false;
let stopStreakSound: (() => void) | null = null;

const COOLDOWN: Record<SoundName, number> = {
  click: 75,
  select: 45,
  card: 55,
  shuffle: 1_200,
  deal: 220,
  join: 700,
  turn: 1_200,
  meld: 350,
  layoff: 160,
  discard: 180,
  roundWin: 2_500,
  gameWin: 4_000,
  error: 450,
};

const DURATION: Record<SoundName, number> = {
  click: 0.06,
  select: 0.04,
  card: 0.11,
  shuffle: 0.65,
  deal: 0.28,
  join: 0.4,
  turn: 0.43,
  meld: 0.59,
  layoff: 0.24,
  discard: 0.14,
  roundWin: 0.81,
  gameWin: 1.5,
  error: 0.29,
};

function unit(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

function parseSettings(raw: string | null): AudioSettings {
  try {
    const saved: Partial<AudioSettings> | null = raw ? JSON.parse(raw) : null;
    if (!saved || typeof saved !== "object") return { ...DEFAULTS };
    return {
      muted: typeof saved.muted === "boolean" ? saved.muted : DEFAULTS.muted,
      volume: unit(saved.volume, DEFAULTS.volume),
      musicEnabled:
        typeof saved.musicEnabled === "boolean"
          ? saved.musicEnabled
          : DEFAULTS.musicEnabled,
      musicVolume: unit(saved.musicVolume, DEFAULTS.musicVolume),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function loadSettings(): void {
  if (typeof window === "undefined" || settingsLoaded) return;
  settingsLoaded = true;
  try {
    settings = parseSettings(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    // Private browsing and blocked storage still allow in-memory preferences.
  }
}

function emitSettings(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<AudioSettings>(SETTINGS_EVENT, { detail: { ...settings } }),
  );
}

function applyEffectsVolume(): void {
  if (!master || !context || context.state === "closed") return;
  const now = context.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setTargetAtTime(settings.muted ? 0 : settings.volume * 0.72, now, 0.012);
}

function wantsMusic(): boolean {
  return pageActive && (typeof document === 'undefined' || document.visibilityState !== 'hidden') && userGestureSeen && !settings.muted && settings.musicEnabled && settings.musicVolume > 0;
}

function nextMusicTrack(): void {
  if (!music || musicUnavailable) return;
  const next = musicPlaylist.next(unavailableMusic);
  musicPlayAttempt++;
  musicStartPending = false;
  if (!next) {
    // An unavailable soundtrack must never trigger an endless load/retry loop.
    musicUnavailable = true;
    music.pause();
    return;
  }
  music.src = next;
  applyMusicSettings();
}

function skipUnavailableMusic(): void {
  if (!music || musicUnavailable) return;
  unavailableMusic.add(musicPlaylist.current());
  nextMusicTrack();
}

function applyMusicSettings(): void {
  if (typeof window === "undefined") return;
  if (!wantsMusic()) {
    // Invalidate any pending play before a rapid mute/unmute or toggle change.
    musicPlayAttempt++;
    musicStartPending = false;
    music?.pause();
    return;
  }
  if (musicUnavailable) return;
  if (!music) {
    music = new Audio(musicPlaylist.current());
    music.loop = false;
    music.preload = "auto";
    music.setAttribute("playsinline", "");
    music.addEventListener("ended", () => {
      // A late event from a replaced source must not consume a second song.
      if (music?.ended) nextMusicTrack();
    });
    music.addEventListener("error", () => {
      // Source changes clear error; an intentional media abort is not a bad file.
      if (music?.error && music.error.code !== 1) skipUnavailableMusic();
    });
  }
  music.volume = settings.musicVolume;
  if (!music.paused || musicStartPending) return;
  musicStartPending = true;
  const attempt = ++musicPlayAttempt;
  // A blocked autoplay attempt is retried on the next real interaction.
  void music.play().then(
    () => {
      if (attempt !== musicPlayAttempt) return;
      musicStartPending = false;
      if (!wantsMusic()) music?.pause();
    },
    (error: unknown) => {
      if (attempt !== musicPlayAttempt) return;
      musicStartPending = false;
      if (error instanceof Error && error.name === "NotSupportedError") skipUnavailableMusic();
    },
  );
}


function onPageAway(): void {
  if (!pageActive) return;
  resumeMusicAfterPage = Boolean(music && !music.paused && !settings.muted && settings.musicEnabled && settings.musicVolume > 0);
  pageActive = false;
  musicPlayAttempt++;
  musicStartPending = false;
  music?.pause();
  queuedGestureSound = null;
  activeEffects = [];
  if (context?.state === 'running') void context.suspend().catch(() => {});
}

function onPageReturn(): void {
  pageActive = true;
  if (userGestureSeen && context?.state === 'suspended') void context.resume().catch(() => {});
  if (resumeMusicAfterPage) { resumeMusicAfterPage = false; applyMusicSettings(); }
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') onPageAway();
  else onPageReturn();
}

function attachListeners(): void {
  if (typeof window === "undefined" || listenersAttached) return;
  listenersAttached = true;
  window.addEventListener("pointerdown", onGesture, { passive: true, capture: true });
  document.addEventListener("visibilitychange", onVisibilityChange, { capture: true });
  window.addEventListener("pagehide", onPageAway, { capture: true });
  window.addEventListener("pageshow", onPageReturn, { capture: true });
  window.addEventListener("keydown", onKeyGesture, { capture: true });
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    settings = parseSettings(event.newValue);
    settingsLoaded = true;
    applyEffectsVolume();
    applyMusicSettings();
    emitSettings();
  });
}

function onKeyGesture(event: KeyboardEvent): void {
  if (event.repeat || event.key === "Tab" || event.metaKey || event.ctrlKey || event.altKey) return;
  onGesture();
}

function getContext(): AudioContext | null {
  if (typeof window === "undefined" || !userGestureSeen) return null;
  if (context?.state === "closed") {
    context = null;
    master = null;
    paperBuffer = null;
  }
  if (context) return context;
  const AudioContextClass = window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  try {
    context = new AudioContextClass();
    master = context.createGain();
    master.gain.value = settings.muted ? 0 : settings.volume * 0.72;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -13;
    limiter.knee.value = 12;
    limiter.ratio.value = 5;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.12;
    master.connect(limiter);
    limiter.connect(context.destination);
    return context;
  } catch {
    // Sound support is optional; play must remain available when audio fails.
    return null;
  }
}

function onGesture(): void {
  userGestureSeen = true;
  loadSettings();
  if (!settings.muted && settings.volume > 0) {
    const audio = getContext();
    if (audio && audio.state !== "running" && !contextResumePending) {
      contextResumePending = true;
      void audio.resume().then(
        () => {
          contextResumePending = false;
          const queued = queuedGestureSound;
          queuedGestureSound = null;
          if (queued && performance.now() - queued.requestedAt < 250) playSound(queued.name);
        },
        () => {
          contextResumePending = false;
          queuedGestureSound = null;
        },
      );
    }
  }
  applyMusicSettings();
}

/** Call from a pointer or keyboard interaction to unlock browser audio. */
export function initAudio(): void {
  if (typeof window === "undefined") return;
  loadSettings();
  attachListeners();
  // Mounting a settings panel must never trigger music before a user gesture.
  if (navigator.userActivation?.isActive || userGestureSeen) onGesture();
}

export function getAudioSettings(): AudioSettings {
  loadSettings();
  return { ...settings };
}

export function setAudioSettings(partial: Partial<AudioSettings>): void {
  loadSettings();
  settings = {
    muted: typeof partial.muted === "boolean" ? partial.muted : settings.muted,
    volume: unit(partial.volume, settings.volume),
    musicEnabled:
      typeof partial.musicEnabled === "boolean" ? partial.musicEnabled : settings.musicEnabled,
    musicVolume: unit(partial.musicVolume, settings.musicVolume),
  };
  if (typeof window !== "undefined") {
    attachListeners();
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Keep the preference for this visit if device storage is unavailable.
    }
    if (navigator.userActivation?.isActive) userGestureSeen = true;
  }
  applyEffectsVolume();
  applyMusicSettings();
  emitSettings();
}

function tone(
  frequency: number,
  start: number,
  duration: number,
  level: number,
  waveform: OscillatorType = "sine",
  endFrequency?: number,
): void {
  if (!context || !master) return;
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  oscillator.type = waveform;
  oscillator.frequency.setValueAtTime(frequency, start);
  if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.linearRampToValueAtTime(level, start + Math.min(0.006, duration / 5));
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(envelope);
  envelope.connect(master);
  oscillator.onended = () => {
    oscillator.disconnect();
    envelope.disconnect();
  };
  oscillator.start(start);
  oscillator.stop(start + duration + 0.015);
}

function paper(start: number, duration = 0.08, level = 0.3, frequency = 3_200, sweep = true): void {
  if (!context || !master) return;
  if (!paperBuffer) {
    paperBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const data = paperBuffer.getChannelData(0);
    let soft = 0;
    for (let index = 0; index < data.length; index++) {
      const white = Math.random() * 2 - 1;
      soft = soft * 0.72 + white * 0.28;
      data[index] = white * 0.38 + soft * 0.62;
    }
  }
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const envelope = context.createGain();
  source.buffer = paperBuffer;
  filter.type = "bandpass";
  filter.Q.value = 0.58;
  filter.frequency.setValueAtTime(frequency, start);
  if (sweep) filter.frequency.exponentialRampToValueAtTime(frequency * 0.62, start + duration);
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.linearRampToValueAtTime(level, start + 0.003);
  envelope.gain.linearRampToValueAtTime(level * 0.42, start + duration * 0.3);
  envelope.gain.linearRampToValueAtTime(level * 0.62, start + duration * 0.5);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(filter);
  filter.connect(envelope);
  envelope.connect(master);
  source.onended = () => {
    source.disconnect();
    filter.disconnect();
    envelope.disconnect();
  };
  source.start(start, Math.random() * 0.6, duration);
}

function cardTap(start: number, level = 1): void {
  paper(start, 0.075, 0.36 * level, 3_350);
  tone(165, start + 0.014, 0.043, 0.16 * level, "sine", 105);
}

function chime(frequency: number, start: number, duration: number, level = 0.18): void {
  tone(frequency, start, duration, level);
  tone(frequency * 2, start, duration * 0.4, level * 0.12);
}

/** Play one brief effect. Repeated polling and rapid clicks are rate limited. */
export function playSound(name: SoundName): void {
  if (typeof window === "undefined" || document.visibilityState === "hidden") return;
  loadSettings();
  if (settings.muted || settings.volume <= 0) return;
  if (!userGestureSeen) {
    if (navigator.userActivation?.isActive) initAudio();
    else return;
  }
  const audio = getContext();
  if (!audio) return;
  if (audio.state !== "running") {
    // Only retain a sound from the current gesture, never a backlog of game updates.
    if (navigator.userActivation?.isActive) {
      queuedGestureSound = { name, requestedAt: performance.now() };
      onGesture();
    }
    return;
  }
  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? -Infinity) < COOLDOWN[name]) return;
  const start = audio.currentTime + 0.005;
  activeEffects = activeEffects.filter((end) => end > start);
  if (activeEffects.length >= 4) return;
  lastPlayed.set(name, now);
  activeEffects.push(start + DURATION[name]);

  switch (name) {
    case "click":
      tone(720, start, 0.035, 0.09, "triangle", 570);
      paper(start, 0.023, 0.1, 4_100);
      break;
    case "select":
      // A quiet paper tap: fixed filtering, no oscillator or pitched sweep.
      paper(start, 0.04, 0.17, 1_850, false);
      break;
    case "card":
      cardTap(start, 0.78);
      break;
    case "shuffle":
      for (let index = 0; index < 8; index++) {
        const offset = index * 0.061;
        paper(start + offset, 0.08, 0.24 + (index % 3) * 0.025, 2_800 + index * 140);
        if (index % 2 === 0) tone(130, start + offset + 0.015, 0.028, 0.065);
      }
      cardTap(start + 0.53, 0.8);
      break;
    case "deal":
      for (let index = 0; index < 3; index++) cardTap(start + index * 0.082, 0.65);
      break;
    case "join":
      chime(392, start, 0.18, 0.15);
      chime(587.33, start + 0.11, 0.26, 0.18);
      break;
    case "turn":
      chime(523.25, start, 0.17, 0.18);
      chime(659.25, start + 0.14, 0.25, 0.17);
      break;
    case "meld":
      for (let index = 0; index < 3; index++) cardTap(start + index * 0.055, 0.5);
      [261.63, 329.63, 392].forEach((note, index) => {
        chime(note, start + 0.14 + index * 0.07, 0.27, 0.15);
      });
      break;
    case "layoff":
      cardTap(start, 0.75);
      chime(659.25, start + 0.035, 0.18, 0.09);
      break;
    case "discard":
      paper(start, 0.11, 0.39, 2_350);
      tone(125, start + 0.035, 0.06, 0.18, "sine", 85);
      break;
    case "roundWin":
      [261.63, 329.63, 392, 523.25].forEach((note, index) => {
        chime(note, start + index * 0.105, index === 3 ? 0.44 : 0.24, 0.18);
      });
      break;
    case "gameWin":
      [261.63, 329.63, 392, 523.25].forEach((note, index) => {
        chime(note, start + index * 0.12, 0.29, 0.18);
      });
      [261.63, 392, 523.25].forEach((note) => chime(note, start + 0.68, 0.7, 0.12));
      break;
    case "error":
      tone(233.08, start, 0.11, 0.13, "triangle", 220);
      tone(196, start + 0.12, 0.13, 0.12, "triangle", 185);
      break;
  }
}

/** Tune the celebration independently from card sounds and background music. */
export const STREAK_FANFARE = Object.freeze({
  buildNotes: [392, 440, 523.25, 587.33, 659.25, 783.99],
  buildOffsetsMs: [180, 820, 1_410, 1_930, 2_380, 2_700],
  landingNotes: [523.25, 659.25, 783.99, 1_046.5],
  buildLevel: 0.105,
  landingLevel: 0.12,
  landingDurationMs: 720,
});

/** Returns a real stop handle, including already-scheduled notes. No autoplay backlog. */
export function playStreakFanfare(reducedMotion = false): () => void {
  const noop = () => {};
  if (typeof window === 'undefined' || document.visibilityState === 'hidden' || !pageActive) return noop;
  loadSettings();
  if (settings.muted || settings.volume <= 0 || !userGestureSeen) return noop;
  const audio = getContext();
  if (!audio || !master || audio.state !== 'running') return noop;
  stopStreakSound?.();
  const output = audio.createGain();
  output.gain.value = 1;
  output.connect(master);
  const sources: OscillatorNode[] = [];
  const envelopes: GainNode[] = [];
  let stopped = false;
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (cleanupTimer !== undefined) clearTimeout(cleanupTimer);
    window.removeEventListener('pagehide', stop);
    window.removeEventListener(SETTINGS_EVENT, settingsChanged);
    document.removeEventListener('visibilitychange', visibilityChanged);
    // Disconnect the dedicated bus first, so scheduled or ringing notes stop immediately.
    output.disconnect();
    for (const source of sources) {
      try { source.stop(); } catch { /* A naturally ended oscillator is already silent. */ }
      source.disconnect();
    }
    for (const envelope of envelopes) envelope.disconnect();
    if (stopStreakSound === stop) stopStreakSound = null;
  };
  const settingsChanged = () => { if (settings.muted || settings.volume <= 0) stop(); };
  const visibilityChanged = () => { if (document.visibilityState === 'hidden') stop(); };
  stopStreakSound = stop;
  window.addEventListener('pagehide', stop);
  window.addEventListener(SETTINGS_EVENT, settingsChanged);
  document.addEventListener('visibilitychange', visibilityChanged);
  const start = audio.currentTime + 0.005;
  const note = (frequency: number, offsetMs: number, durationMs: number, level: number) => {
    const source = audio.createOscillator();
    const envelope = audio.createGain();
    sources.push(source); envelopes.push(envelope);
    const at = start + offsetMs / 1_000;
    const duration = durationMs / 1_000;
    source.type = 'sine';
    source.frequency.setValueAtTime(frequency, at);
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.linearRampToValueAtTime(level, at + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(envelope); envelope.connect(output);
    source.start(at); source.stop(at + duration + 0.02);
  };
  try {
    if (!reducedMotion) STREAK_FANFARE.buildNotes.forEach((frequency, index) => {
      note(frequency, STREAK_FANFARE.buildOffsetsMs[index], 320, STREAK_FANFARE.buildLevel);
    });
    const landing = reducedMotion ? 0 : STREAK_CELEBRATION_TIMING.landingMs;
    STREAK_FANFARE.landingNotes.forEach((frequency, index) => {
      note(frequency, landing + index * 45, STREAK_FANFARE.landingDurationMs, STREAK_FANFARE.landingLevel);
    });
    cleanupTimer = setTimeout(stop, landing + 1_100);
  } catch { stop(); }
  return stop;
}

