import type { GameAction, PublicRoom, RoomPreview, RoomSummaryResult } from './types';
import { ROOM_PROTOCOL, ROOM_PROTOCOL_HEADER, ROOM_RELOAD_KEY, ROOM_UPDATE_MESSAGE, protocolReloadTarget } from './room-protocol';
import { isRoomCode, normalizeRoomCode } from './room-code';
import { getClientIdentity, isClientIdentityCurrent, subscribeClientIdentity } from './client-identity';
import { recheckAccount } from './account-client';

const NAME_KEY = 'parkes-rummy:name';
const TOKEN_KEY = 'parkes-rummy:seats';
const LAST_KEY = 'parkes-rummy:last-room';
const SORT_KEY = 'parkes-rummy:sort';
const SORT_MODE_KEY = 'parkes-rummy:sort-mode';
const HAND_ORDER_KEY = 'parkes-rummy:hand-order';
const SEATS_EVENT = 'parkes-rummy:seats-changed';
const pageMemory = new Map<string, string>();
const unsavedKeys = new Set<string>();
// Account membership markers are public identifiers, kept only in memory.
// Guest bearer tokens never enter an account's storage namespace.
let accountSeats: Record<string, string> = {};
let accountSeatsIdentity = '';
let accountHandOrders: Record<string, string[]> = {};
subscribeClientIdentity(() => { accountSeats = {}; accountHandOrders = {}; accountSeatsIdentity = getClientIdentity().key; });
export type HandSort = 'descending' | 'ascending';
export type HandSortMode = 'number' | 'colour' | 'suit';

function scopedKey(key: string): string {
  const accountId = getClientIdentity().accountId;
  return accountId ? `parkes-rummy:account:${encodeURIComponent(accountId)}:${key.slice('parkes-rummy:'.length)}` : key;
}
function currentAccountSeats(): Record<string, string> {
  const identity = getClientIdentity();
  if (accountSeatsIdentity !== identity.key) { accountSeats = {}; accountSeatsIdentity = identity.key; }
  return identity.ready ? accountSeats : {};
}
function seatsChanged() { if (typeof window !== 'undefined') window.dispatchEvent?.(new Event(SEATS_EVENT)); }

function read(key: string): string | null {
  if (typeof window === 'undefined') return null;
  // Quota-limited storage may permit reads while rejecting writes. Retain the
  // player's new seat and card order for this visit instead of reading old data.
  if (unsavedKeys.has(key)) return pageMemory.get(key) ?? null;
  try {
    const value = window.localStorage.getItem(key);
    if (value === null) pageMemory.delete(key); else pageMemory.set(key, value);
    return value;
  } catch { return pageMemory.get(key) ?? null; }
}
function write(key: string, value: string) {
  if (typeof window === 'undefined') return;
  pageMemory.set(key, value);
  try { window.localStorage.setItem(key, value); unsavedKeys.delete(key); }
  catch { unsavedKeys.add(key); }
}
export function storedName() { return read(scopedKey(NAME_KEY)) ?? ''; }
export function rememberName(name: string) { write(scopedKey(NAME_KEY), name.trim()); }
export function getSeats(): Record<string, string> {
  const identity = getClientIdentity();
  if (!identity.ready) return {};
  if (identity.accountId) return { ...currentAccountSeats() };
  try {
    const value: unknown = JSON.parse(read(TOKEN_KEY) ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([code, token]) => isRoomCode(code) && typeof token === 'string' && /^[a-f0-9]{64}$/.test(token)).map(([code, token]) => [normalizeRoomCode(code), token as string]));
  } catch { return {}; }
}
export function seatToken(code: string) { return getSeats()[normalizeRoomCode(code)]; }
export function rememberSeat(code: string, token: string, options: { visit?: boolean; expectedToken?: string | null } = {}): boolean {
  code = normalizeRoomCode(code);
  const identity = getClientIdentity();
  if (!identity.ready || !isRoomCode(code) || (identity.accountId ? token !== identity.key : !/^[a-f0-9]{64}$/.test(token))) return false;
  const seats = getSeats();
  // A late join may save a new table without replacing a newer seat or visit.
  if (options.expectedToken !== undefined && (seats[code] ?? null) !== options.expectedToken) return false;
  if (identity.accountId) accountSeats = { ...seats, [code]: token };
  else write(TOKEN_KEY, JSON.stringify({ ...seats, [code]: token }));
  if (options.visit !== false) write(scopedKey(LAST_KEY), code);
  seatsChanged();
  return true;
}
export function syncAccountSeats(seats: { code: string; token: string }[]): boolean {
  const identity = getClientIdentity();
  if (!identity.ready || !identity.accountId) return false;
  currentAccountSeats();
  const next = Object.fromEntries(seats.filter(seat => isRoomCode(seat.code) && seat.token === identity.key).map(seat => [normalizeRoomCode(seat.code), seat.token]));
  const changed = JSON.stringify(Object.entries(accountSeats).sort()) !== JSON.stringify(Object.entries(next).sort());
  accountSeats = next;
  // The caller owns rendering its authoritative list. Avoid starting another
  // refresh for every response, including an empty account on a new device.
  return changed;
}
export function forgetSeat(code: string, options: { expectedToken?: string | null } = {}): boolean {
  code = normalizeRoomCode(code);
  if (!getClientIdentity().ready || !isRoomCode(code)) return false;
  const seats = getSeats();
  // A pending removal belongs to the seat originally shown in its confirmation.
  if (options.expectedToken !== undefined && (seats[code] ?? null) !== options.expectedToken) return false;
  const orders = Object.entries(handOrders());
  const retainedOrders = orders.filter(([key]) => !key.startsWith(`${code}:`));
  delete seats[code];
  if (getClientIdentity().accountId) accountSeats = seats;
  else write(TOKEN_KEY, JSON.stringify(seats));
  if (normalizeRoomCode(read(scopedKey(LAST_KEY)) ?? '') === code) write(scopedKey(LAST_KEY), '');
  if (retainedOrders.length !== orders.length) {
    writeHandOrders(Object.fromEntries(retainedOrders));
  }
  seatsChanged();
  return true;
}
export function subscribeSavedSeats(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const stored = (event: StorageEvent) => {
    if (event.key === null) { unsavedKeys.clear(); pageMemory.clear(); }
    else if (event.key.startsWith('parkes-rummy:')) {
      unsavedKeys.delete(event.key);
      if (event.newValue === null) pageMemory.delete(event.key); else pageMemory.set(event.key, event.newValue);
    }
    if ((!getClientIdentity().accountId && event.key === TOKEN_KEY) || event.key === null) listener();
  };
  window.addEventListener(SEATS_EVENT, listener);
  window.addEventListener('storage', stored);
  const stopIdentity = subscribeClientIdentity(listener);
  return () => { stopIdentity(); window.removeEventListener(SEATS_EVENT, listener); window.removeEventListener('storage', stored); };
}
export function lastRoom() { return read(scopedKey(LAST_KEY)) ?? ''; }
export function getSort(): HandSort { return read(scopedKey(SORT_KEY)) === 'ascending' ? 'ascending' : 'descending'; }
export function rememberSort(value: HandSort) { write(scopedKey(SORT_KEY), value); }
export function getSortMode(): HandSortMode {
  const value = read(scopedKey(SORT_MODE_KEY));
  return value === 'colour' || value === 'suit' ? value : 'number';
}
export function rememberSortMode(value: HandSortMode) { write(scopedKey(SORT_MODE_KEY), value); }
function handOrders(): Record<string, string[]> {
  if (!getClientIdentity().ready) return {};
  if (getClientIdentity().accountId) return accountHandOrders;
  try {
    const saved = JSON.parse(read(scopedKey(HAND_ORDER_KEY)) ?? 'null') as { key?: unknown; ids?: unknown; hands?: unknown } | null;
    if (!saved || typeof saved !== 'object') return {};
    // Retain the original single-hand arrangement when upgrading to multiple tables.
    const hands = typeof saved.key === 'string' && Array.isArray(saved.ids) ? { [saved.key]: saved.ids } : saved.hands;
    if (!hands || typeof hands !== 'object' || Array.isArray(hands)) return {};
    return Object.fromEntries(Object.entries(hands).filter(([key, ids]) => key.length <= 180 && Array.isArray(ids)).map(([key, ids]) => [key, (ids as unknown[]).filter((id): id is string => typeof id === 'string').slice(0, 256)]));
  } catch { return {}; }
}
function writeHandOrders(hands: Record<string, string[]>) {
  // Card IDs contain their rank and suit. Account hands must disappear on
  // sign-out, so manual arrangements stay in memory with the current identity.
  if (getClientIdentity().accountId) accountHandOrders = hands;
  else write(HAND_ORDER_KEY, JSON.stringify({ version: 2, hands }));
}
export function savedHandOrder(key: string, cardIds: string[]): string[] | null {
  const ids = handOrders()[key];
  if (!ids) return null;
  // A rematch may reuse the room and rule number, but deals always have fresh card IDs.
  return ids.some(id => cardIds.includes(id)) ? ids : null;
}
export function rememberHandOrder(key: string, ids: string[]) {
  if (!getClientIdentity().ready) return;
  const prefix = `${key.split(':')[0]}:`;
  const others = Object.entries(handOrders()).filter(([oldKey]) => !oldKey.startsWith(prefix));
  writeHandOrders(Object.fromEntries([...others, [key, ids.slice(0, 256)]]));
}
export function actionId() { return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`; }

export class RoomError extends Error {
  status: number;
  room?: PublicRoom;
  constructor(message: string, status: number, room?: PublicRoom) { super(message); this.name = 'RoomError'; this.status = status; this.room = room; }
}
let protocolReloadStarted = false;
let incompatibleProtocol = false;
function refreshForProtocol(serverProtocol: string) {
  if (protocolReloadStarted) return;
  const target = protocolReloadTarget(window.location.href, serverProtocol);
  if (!target) return;
  const guard = `${ROOM_PROTOCOL}:${serverProtocol}:${window.location.pathname}`;
  try {
    if (window.sessionStorage.getItem(ROOM_RELOAD_KEY) === guard) return;
    window.sessionStorage.setItem(ROOM_RELOAD_KEY, guard);
  } catch { /* The public URL marker also prevents a loop when storage is unavailable. */ }
  protocolReloadStarted = true;
  // Navigation preserves the room path and all local seat/card-order storage.
  // No failed action is replayed after the updated page loads.
  try { window.location.replace(target); } catch { /* Leave the refresh message visible if navigation is blocked. */ }
}
async function request<T>(path: string, options: { method?: string; body?: unknown; token?: string; signal?: AbortSignal } = {}): Promise<T> {
  const identity = getClientIdentity();
  if (!identity.ready) throw new RoomError('Your account is changing. Please wait.', 401);
  const method = options.method ?? 'GET';
  if (method !== 'GET' && (incompatibleProtocol || protocolReloadStarted)) throw new RoomError(ROOM_UPDATE_MESSAGE, 426);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  const abort = () => controller.abort();
  const stopIdentity = subscribeClientIdentity(abort);
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', [ROOM_PROTOCOL_HEADER]: ROOM_PROTOCOL, 'X-Parkes-Identity': identity.key, ...((options.token || identity.accountId) ? { Authorization: `Bearer ${options.token || identity.key}` } : {}) },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      cache: 'no-store', signal: controller.signal,
    });
    const data = await response.json().catch(() => ({})) as { error?: string; code?: string; room?: PublicRoom };
    if (!isClientIdentityCurrent(identity)) throw new RoomError('Your account changed. Open the table again.', 401);
    if (response.status === 401 && data.code === 'ACCOUNT_IDENTITY_CHANGED') recheckAccount();
    const serverProtocol = response.headers.get(ROOM_PROTOCOL_HEADER);
    if (serverProtocol && serverProtocol !== ROOM_PROTOCOL) {
      incompatibleProtocol = true;
      // A read or an explicitly rejected write is safe to reload. A successful
      // write from an unexpected server must never be retried automatically.
      if (method === 'GET' || response.status === 426) refreshForProtocol(serverProtocol);
      throw new RoomError(ROOM_UPDATE_MESSAGE, 426);
    }
    if (serverProtocol === ROOM_PROTOCOL) incompatibleProtocol = false;
    if (!response.ok) throw new RoomError(data.error ?? 'The table did not respond. Please try again.', response.status, data.room);
    return data as T;
  } catch (error) {
    if (!isClientIdentityCurrent(identity)) throw new RoomError('Your account changed. Open the table again.', 401);
    if (error instanceof RoomError) throw error;
    if (error instanceof Error && error.name === 'AbortError') throw new RoomError('Connection timed out. Please try again.', 0);
    throw new RoomError('Connection lost. Reconnecting to your table…', 0);
  } finally {
    window.clearTimeout(timeout);
    stopIdentity();
    options.signal?.removeEventListener('abort', abort);
  }
}
export const roomApi = {
  create: (name: string) => request<{ room: PublicRoom; token: string }>('/api/rooms', { method: 'POST', body: { name } }),
  preview: (code: string) => request<{ preview: RoomPreview }>(`/api/rooms/${encodeURIComponent(code)}/preview`),
  join: (code: string, name: string, token?: string) => request<{ room: PublicRoom; token: string }>(`/api/rooms/${encodeURIComponent(code)}/join`, { method: 'POST', body: { name, ...(token ? { token } : {}) } }),
  get: (code: string, token: string, signal?: AbortSignal) => request<{ room: PublicRoom }>(`/api/rooms/${encodeURIComponent(code)}`, { token, signal }),
  summaries: (seats: { code: string; token: string }[], signal?: AbortSignal) => request<{ summaries: RoomSummaryResult[] }>('/api/rooms/summaries', { method: 'POST', body: { seats }, signal }),
  accountGames: (signal?: AbortSignal) => request<{ games: (import('./types').RoomSummary & { token: string })[] }>('/api/account/games', { signal }),
  removeAccountGame: (code: string, signal?: AbortSignal) => request<{ ok: true }>(`/api/account/games/${encodeURIComponent(code)}`, { method: 'DELETE', signal }),
  action: (code: string, token: string, action: GameAction, requestId = actionId()) => request<{ room: PublicRoom }>(`/api/rooms/${encodeURIComponent(code)}/action`, { method: 'POST', token, body: { action, requestId } }),
};
