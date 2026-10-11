import type { PublicRoom } from './types';

const VIBRATION_KEY = 'parkes-rummy.turn-vibration.v1';
const HEARD_TURNS_KEY = 'parkes-rummy.heard-turns.v1';
const PREFERENCE_EVENT = 'parkes-rummy:turn-vibration';
const MAX_HEARD_TURNS = 128;
export const TURN_VIBRATION_MS = 80;

type AlertStorage = Pick<Storage, 'getItem' | 'setItem'>;
type TurnSnapshot = Pick<PublicRoom, 'code' | 'game' | 'round' | 'turnNumber' | 'youId' | 'turnPlayerId' | 'status' | 'events'>;

/** Draws, selections and polling never change the identity of an own turn. */
export function ownTurnAlertKey(room: TurnSnapshot | null | undefined): string | null {
  if (!room || room.status !== 'playing' || !room.youId || room.turnPlayerId !== room.youId) return null;
  // A new deal/discard starts a turn. Its event identity also distinguishes a
  // rematch, where the room code, round and turn number are reused.
  const boundary = room.events.findLast(event => event.type === 'start' || event.type === 'discard');
  return JSON.stringify([room.code, room.game, room.round, room.turnNumber, room.youId, boundary?.id ?? 0, boundary?.at ?? 0]);
}

/** A tab remembers delivered turn alerts across refreshes and component mounts. */
export function createTurnAlertLedger(storage?: AlertStorage) {
  let heard: string[] = [];
  try {
    const saved: unknown = JSON.parse(storage?.getItem(HEARD_TURNS_KEY) ?? '[]');
    if (Array.isArray(saved)) heard = [...new Set(saved.filter((key): key is string => typeof key === 'string' && key.length <= 512))].slice(-MAX_HEARD_TURNS);
  } catch { /* Storage restrictions must not break the table. */ }
  const keys = new Set(heard);
  return {
    claim(key: string | null | undefined): boolean {
      if (!key || keys.has(key)) return false;
      keys.add(key);
      heard.push(key);
      if (heard.length > MAX_HEARD_TURNS) keys.delete(heard.shift()!);
      try { storage?.setItem(HEARD_TURNS_KEY, JSON.stringify(heard)); } catch { /* Retain the in-memory guard. */ }
      return true;
    },
  };
}

let activeLedger: ReturnType<typeof createTurnAlertLedger> | undefined;
let vibrationPreference: boolean | undefined;

export function claimTurnAlert(key: string): boolean {
  if (!activeLedger) {
    let storage: AlertStorage | undefined;
    try { storage = typeof window === 'undefined' ? undefined : window.sessionStorage; } catch { /* Use memory. */ }
    activeLedger = createTurnAlertLedger(storage);
  }
  return activeLedger.claim(key);
}

export function getTurnVibrationEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  if (vibrationPreference === undefined) {
    try { vibrationPreference = window.localStorage.getItem(VIBRATION_KEY) !== 'off'; }
    catch { vibrationPreference = true; }
  }
  return vibrationPreference;
}

export function setTurnVibrationEnabled(enabled: boolean): void {
  vibrationPreference = enabled;
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(VIBRATION_KEY, enabled ? 'on' : 'off'); } catch { /* Keep the choice for this visit. */ }
  if (!enabled) stopTurnVibration();
  window.dispatchEvent(new Event(PREFERENCE_EVENT));
}

export function subscribeTurnVibrationPreference(listener: (enabled: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const changed = () => listener(getTurnVibrationEnabled());
  const stored = (event: StorageEvent) => {
    if (event.key !== VIBRATION_KEY && event.key !== null) return;
    vibrationPreference = event.key === null || event.newValue !== 'off';
    if (!vibrationPreference) stopTurnVibration();
    changed();
  };
  window.addEventListener(PREFERENCE_EVENT, changed);
  window.addEventListener('storage', stored);
  return () => {
    window.removeEventListener(PREFERENCE_EVENT, changed);
    window.removeEventListener('storage', stored);
  };
}

export function stopTurnVibration(): void {
  try { if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(0); }
  catch { /* Unsupported/blocked hardware is optional. */ }
}

/** Called only while the current own turn is visible. No timer repeats a buzz. */
export function vibrateForTurn(key: string): boolean {
  if (typeof document === 'undefined' || document.hidden || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function' || !getTurnVibrationEnabled()) return false;
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return false;
  if (!claimTurnAlert(key)) return false;
  try { return navigator.vibrate(TURN_VIBRATION_MS); }
  catch { return false; }
}
