export const ACTIVITY_INTERVAL_MS = 30_000;
export const ACTIVITY_ONLINE_MS = 90_000;
export const ACTIVITY_HISTORY_DAYS = 30;
export type ActivityPlace = 'home' | 'lobby' | 'playing' | 'results';
export interface ActivityPulse { tabId: string; guestId: string; visible: boolean; roomCode?: string; name?: string }
export interface ActivityPlayer {
  id: string; name: string; email: string | null; guest: boolean;
  place: ActivityPlace; rooms: string[]; lastSeen: number;
}
export interface ActivityGame {
  code: string; game: number; quick: boolean; rule: number;
  onlineHumans: number; humanSeats: number; aiSeats: number;
  currentPlayer: string; lastMoveAt: number | null;
}
export interface ActivityDay { day: string; players: number; signedIn: number; guests: number; gamesStarted: number; peakOnline: number; peakPlaying: number }
export interface ActivitySnapshot {
  generatedAt: number; trackingSince: number; timeZone: 'Australia/Sydney';
  onlineWindowSeconds: number; refreshSeconds: number; historyDays: number;
  totals: { online: number; playing: number; signedIn: number; guests: number; liveGames: number; aiInLiveGames: number; todayPlayers: number; todayGames: number; returningAccounts: number; peakToday: number };
  players: ActivityPlayer[]; games: ActivityGame[]; history: ActivityDay[];
  playersTruncated: boolean;
}
export function validActivityPulse(value: unknown): value is ActivityPulse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  return typeof p.tabId === 'string' && uuid.test(p.tabId) && typeof p.guestId === 'string' && uuid.test(p.guestId)
    && typeof p.visible === 'boolean'
    && (p.roomCode === undefined || (typeof p.roomCode === 'string' && /^[A-Z0-9]{4,6}$/.test(p.roomCode)))
    && (p.name === undefined || (typeof p.name === 'string' && p.name.length <= 80));
}
